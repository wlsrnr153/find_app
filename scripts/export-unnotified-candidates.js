// 미고시 물품 후보군 + RFID 불용처리용 법적 근거 엑셀을 만든다.
//   node scripts/export-unnotified-candidates.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ExcelJS = require('exceljs');

const desktop = path.join(process.env.USERPROFILE, 'Desktop');
const publicDir = path.join(__dirname, '..', 'public');
const CANDIDATE_LIMIT = 10;

const sourceName = fs.readdirSync(desktop).find((name) =>
    name.includes('2026_10_01')
    && name.endsWith('.xlsx')
    && !name.startsWith('~')
    && !name.includes('백업')
    && !name.includes('내용연수')
    && !name.includes('미고시')
);
if (!sourceName) {
    console.error('자산대장을 바탕화면에서 찾지 못했습니다.');
    process.exit(1);
}

const sandbox = {
    console,
    indexedDB: null,
    fetch: () => Promise.reject(new Error('네트워크 없음')),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
};
vm.createContext(sandbox);
const catalogEngine = path.join(publicDir, 'goods-catalog.js');
if (fs.existsSync(catalogEngine)) {
    vm.runInContext(fs.readFileSync(catalogEngine, 'utf8'), sandbox, { filename: 'goods-catalog.js' });
}
vm.runInContext(fs.readFileSync(path.join(publicDir, 'useful-life.js'), 'utf8'), sandbox, { filename: 'useful-life.js' });
sandbox.applyUsefulLifeSnapshot(JSON.parse(fs.readFileSync(path.join(publicDir, 'useful-life.json'), 'utf8')));

const catalogPath = [
    path.join(publicDir, 'goods-catalog.json'),
    path.join(__dirname, '..', 'data', 'goods-catalog.json')
].find((p) => fs.existsSync(p));
if (catalogPath && typeof sandbox.applyGoodsCatalogSnapshot === 'function') {
    sandbox.applyGoodsCatalogSnapshot(JSON.parse(fs.readFileSync(catalogPath, 'utf8')));
}

const aliasPath = path.join(__dirname, '..', 'data', 'useful-life-aliases.json');
if (fs.existsSync(aliasPath)) {
    const aliasFile = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
    sandbox.setUsefulLifeAliases(aliasFile.items || aliasFile);
}

function cellText(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
        if (value.result != null) return cellText(value.result);
        if (value.text != null) return cellText(value.text);
        if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
    }
    return String(value).trim();
}

function findHeader(sheet) {
    for (let rowNumber = 1; rowNumber <= 20; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const cols = {};
        row.eachCell({ includeEmpty: true }, (cell, col) => {
            const text = cellText(cell.value).replace(/\s+/g, '');
            if (text === '내용연수') cols.life = col;
            if (text === '분류번호') cols.code = col;
            if (text === '품명') cols.item = col;
            if (text === '자산명') cols.assetName = col;
            if (text === '규격') cols.model = col;
            if (text === '계정과목명' || text === '계정과목') cols.category = col;
            if (text === '자산번호' || text === '관리번호') cols.assetNumber = col;
            if (text === '취득일자' || text === '취득일') cols.acquiredAt = col;
            if (text === '사용위치' || text === '현사용위치') cols.location = col;
        });
        if (cols.life) return { headerRow: rowNumber, ...cols };
    }
    return null;
}

function formatCandidate(candidate) {
    if (!candidate?.goodsClNo) return '';
    const years = candidate.notified && Number(candidate.usefulLife) > 0
        ? `${candidate.usefulLife}년`
        : '미고시';
    return `${candidate.goodsClNm} [${candidate.goodsClNo}] · ${years}`;
}

function collectCandidates(record) {
    const matchName = record.className || record.specHead || record.assetName;
    const life = sandbox.matchUsefulLife({
        itemName: matchName,
        goodsClNo: record.code,
        acquiredAt: record.acquiredAt
    });

    const candidates = [];
    const seen = new Set();
    const push = (candidate) => {
        if (!candidate?.goodsClNo || seen.has(candidate.goodsClNo)) return;
        if (candidates.length >= CANDIDATE_LIMIT) return;
        seen.add(candidate.goodsClNo);
        candidates.push({
            goodsClNo: candidate.goodsClNo,
            goodsClNm: candidate.goodsClNm,
            usefulLife: Number(candidate.usefulLife) || 0,
            notified: !!candidate.notified && Number(candidate.usefulLife) > 0,
            match: candidate.match || ''
        });
    };

    if (life?.entry) push(life.entry);
    (life?.candidates || []).forEach(push);
    if (typeof sandbox.collectUsefulLifeBroadCandidates === 'function') {
        sandbox.collectUsefulLifeBroadCandidates(matchName || record.assetName, CANDIDATE_LIMIT).forEach(push);
    }
    if (typeof sandbox.searchUsefulLifeClasses === 'function') {
        sandbox.searchUsefulLifeClasses(matchName || record.assetName, 8).forEach(push);
    }

    const notified = candidates.filter((c) => c.notified);
    const unnotified = candidates.filter((c) => !c.notified);
    return {
        life,
        candidates: [...notified, ...unnotified].slice(0, CANDIDATE_LIMIT),
        notifiedCandidates: notified
    };
}

function styleHeader(row) {
    row.font = { bold: true };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    row.alignment = { vertical: 'middle', wrapText: true };
}

function addLegalSheet(workbook, meta) {
    const sheet = workbook.addWorksheet('법적근거');
    const lines = [
        ['구분', '내용'],
        ['문서목적', 'RFID 물품관리시스템 불용물품 처리 시, 조달청 내용연수표에 연수가 고시되지 않은(미고시) 물품에 대한 처리 근거와 유의사항을 정리한 참고자료'],
        ['작성일', meta.createdAt],
        ['기준 내용연수표', `${meta.lifeAsOf || '-'} (로컬 스냅샷 · 고시 ${meta.lifeNotified || '-'}건 / 전체 ${meta.lifeTotal || '-'}건)`],
        ['대상 대장', meta.sourceName],
        ['미고시 건수', `${meta.unnotifiedCount}건`],
        ['', ''],
        ['1. 법령·고시', ''],
        ['물품관리법 제16조의2(물품의 내용연수) ①', '조달청장은 대통령령으로 정하는 바에 따라 각 중앙관서(그 소속 기관을 포함한다)에서 공통적으로 사용하며 관리가 필요한 물품에 대한 내용연수를 정하여 각 중앙관서의 장에게 통보하여야 한다.'],
        ['물품관리법 제16조의2 ②', '각 중앙관서의 장은 제1항에 따라 내용연수가 정하여지지 아니한 물품에 대하여 내용연수를 정하여 운영할 수 있다. 이 경우 조달청장에게 통보하여야 한다.'],
        ['물품관리법 제16조의2 ③', '각 중앙관서의 장은 그 관서의 특수한 사정으로 제1항에 따라 정하여진 내용연수를 적용하기 곤란한 경우에는 조달청장과 협의하여 내용연수를 조정할 수 있다.'],
        ['조달청 내용연수 고시(유사분류 적용)', '내용연수표에 게재되지 아니한 물품으로서 각 중앙관서의 장이 별도로 내용연수를 책정하지 않은 물품에 대하여는 유사분류 물품의 내용연수를 적용할 수 있다. (예: 진공성형기 → 사출성형기)'],
        ['유사분류 선정 순서(고시 요지)', '① 소분류(물품분류번호 상위 6자리)가 동일한 물품 중 용도·기능이 가장 유사한 물품 → ② 중분류(상위 4자리) 동일 → ③ 대분류(상위 2자리) 동일 → ④ 분류가 다르더라도 실제 용도·기능이 유사한 물품. 다만 유사분류는 조달청장이 고시한 내용연수표에 명시된 물품에 한한다.'],
        ['물품관리법 제35조(불용의 결정 등) 요지', '물품관리관은 소관 물품 중 사용할 필요가 없거나 사용할 수 없는 물품이 있으면 불용 결정을 한다. (대통령령으로 정하는 물품은 소속 중앙관서의 장 승인)'],
        ['물품관리법 시행규칙 제51조(불용 결정 기준) 주요 사유', '① 사용할 필요가 없고 앞으로도 사용할 전망이 없는 물품 ② 정수·수요 초과 재고 ③ 원장비 사용 불가·취득 가능성 없는 부속품 ④ 규격·모형 변경으로 수리 곤란 ⑤ 시설 제거 후 활용 불가 ⑥ 훼손·마모로 본래 목적 사용 불가 ⑦ 수선이 비경제적인 물품 ⑧ 이에 준하는 사유로 중앙관서의 장이 인정하는 물품'],
        ['', ''],
        ['2. 미고시와 불용처리의 관계', ''],
        ['미고시의 의미', '해당 물품분류번호(또는 매칭된 분류)가 조달청 내용연수표에 없거나, 표에 있어도 내용연수(년)가 고시되지 않은 상태를 말한다. RFID·물품관리시스템에서 내용연수 필드가 비거나 「미고시」로 표기되는 경우가 이에 해당한다.'],
        ['미고시 ≠ 불용 불가', '내용연수 미고시만으로 불용이 금지되거나 자동 허용되는 것은 아니다. 불용은 물품관리법·시행규칙상 사용필요성·사용가능성·수리경제성 등 별도 기준에 따라 결정한다.'],
        ['미고시일 때 실무 처리', '① 「미고시후보」 시트의 유사·고시 후보를 참고해 유사분류 내용연수를 적용하거나, ② 기관장이 내용연수를 별도 책정·운영하고 조달청장에게 통보(법 제16조의2 제2항)한 뒤, 그 연수를 기준으로 경과 여부를 판단한다.'],
        ['내용연수 경과와 계속 사용', '조달청 내용연수 고시 유의사항에 따라, 내용연수가 경과하였더라도 사용에 지장이 없는 물품은 계속 사용한다.'],
        ['내용연수 미경과 처분', '경제적 수리한계 초과, 에너지이용 합리화법에 따른 절약 제품 교체가 유리한 경우, 시스템 장비의 주장비 교체에 따른 부속장비 동시 교체, 공공 안전·복지상 사용목적 달성 곤란 또는 효율 현저 저하 등의 사유가 있으면 내용연수 경과 여부와 관계없이 처분할 수 있다(고시 요지).'],
        ['', ''],
        ['3. RFID 물품관리시스템 입력·증빙 권고', ''],
        ['시스템 입력', '미고시 물품은 내용연수 칸에 「미고시」를 유지하거나, 유사분류·기관 책정 연수를 확정한 뒤 숫자 연수를 입력한다. 확정 연수를 넣는 경우 적용 근거(유사분류 코드·품명 또는 기관 책정 공문)를 비고·첨부한다.'],
        ['불용 결의·품의 시 권고 기재', '① 해당 분류가 조달청 내용연수표상 미고시(또는 미게재)라는 사실 ② 적용한 유사분류(분류번호·품명·내용연수) 또는 기관 책정 연수 ③ 불용 사유가 시행규칙 제51조 어느 호에 해당하는지 ④ (해당 시) 내용연수 미경과 처분 사유'],
        ['본 파일 활용', '「미고시후보」시트: 대장상 미고시 물품과 유사·고시 후보군. 「법적근거」시트: 법령·고시 요지 및 RFID 불용 처리 시 참고 문구. 실제 처분은 최신 법령·해당 기관 내부규정·물품관리관 판단을 따른다.'],
        ['참고', '법령 원문·최신 고시 번호는 국가법령정보센터 및 조달청 고시를 확인한다. 본 시트는 실무 참고용 요약이며 법률 자문이 아니다.']
    ];

    lines.forEach((line, index) => {
        const row = sheet.addRow(line);
        if (index === 0) styleHeader(row);
        else if (String(line[0] || '').match(/^\d+\./) || line[0] === '') {
            row.getCell(1).font = { bold: true };
        }
        row.alignment = { vertical: 'top', wrapText: true };
    });
    sheet.getColumn(1).width = 42;
    sheet.getColumn(2).width = 96;
    sheet.getRow(1).height = 22;
}

function addHelpSheet(workbook) {
    const sheet = workbook.addWorksheet('사용안내');
    [
        ['미고시 후보·법적근거 엑셀 사용 안내'],
        [''],
        ['1. 「미고시후보」시트에는 대장에서 내용연수가 미고시로 표기된 물품과, 유사·고시 후보 분류가 정리되어 있습니다.'],
        ['2. 「유사고시후보」열은 내용연수가 고시된 유사 분류만 모은 것입니다. RFID 불용·내용연수 입력 시 우선 참고하세요.'],
        ['3. 「적용내용연수(안)」·「적용근거」열에 기관이 확정한 연수와 근거(유사분류 코드 또는 기관 책정)를 기입하면 됩니다.'],
        ['4. 「법적근거」시트 문구를 불용 품의·결의서 참고용으로 활용할 수 있습니다. 최신 법령·고시는 별도 확인이 필요합니다.'],
        ['5. 후보군은 자동 매칭 결과이므로, 최종 유사분류는 용도·기능을 사람이 확인한 뒤 적용하세요.']
    ].forEach((line, index) => {
        const row = sheet.addRow(line);
        if (index === 0) row.font = { bold: true, size: 14 };
    });
    sheet.getColumn(1).width = 110;
}

async function main() {
    const sourcePath = path.join(desktop, sourceName);
    const workbookIn = new ExcelJS.Workbook();
    await workbookIn.xlsx.readFile(sourcePath);
    const sheetIn = workbookIn.getWorksheet('물품관리대장-제출자료') || workbookIn.worksheets[0];
    const header = findHeader(sheetIn);
    if (!header?.life) throw new Error('내용연수 열을 찾지 못했습니다');

    const records = [];
    const lastRow = sheetIn.actualRowCount || sheetIn.rowCount;
    for (let rowNumber = header.headerRow + 1; rowNumber <= lastRow; rowNumber += 1) {
        const row = sheetIn.getRow(rowNumber);
        const lifeText = cellText(row.getCell(header.life).value);
        if (lifeText !== '미고시') continue;
        const assetName = header.assetName ? cellText(row.getCell(header.assetName).value) : '';
        const className = header.item ? cellText(row.getCell(header.item).value) : '';
        if (!assetName && !className) continue;
        records.push({
            rowNumber,
            assetNumber: header.assetNumber ? cellText(row.getCell(header.assetNumber).value) : '',
            assetName,
            className,
            code: header.code ? cellText(row.getCell(header.code).value) : '',
            model: header.model ? cellText(row.getCell(header.model).value) : '',
            category: header.category ? cellText(row.getCell(header.category).value) : '',
            acquiredAt: header.acquiredAt ? cellText(row.getCell(header.acquiredAt).value) : '',
            location: header.location ? cellText(row.getCell(header.location).value) : '',
            specHead: header.model
                ? cellText(row.getCell(header.model).value).split(',')[0].trim()
                : ''
        });
    }

    const enriched = records.map((record) => {
        const { life, candidates, notifiedCandidates } = collectCandidates(record);
        return { record, life, candidates, notifiedCandidates };
    });

    const out = new ExcelJS.Workbook();
    out.creator = '물품 조사 시스템';
    out.created = new Date();

    const candidateHeaders = [
        '연번', '대장행', '자산번호', '자산명', '대장품명', '대장분류번호', '규격', '계정과목', '취득일자', '사용위치',
        '매칭분류번호', '매칭분류명', '매칭상태', '내용연수',
        '유사고시후보', '후보1', '후보2', '후보3', '후보4', '후보5', '후보6', '후보7', '후보8',
        '적용내용연수(안)', '적용근거', '비고'
    ];
    const candidateSheet = out.addWorksheet('미고시후보', {
        views: [{ state: 'frozen', ySplit: 1 }]
    });
    styleHeader(candidateSheet.addRow(candidateHeaders));

    enriched.forEach((entry, index) => {
        const { record, life, candidates, notifiedCandidates } = entry;
        const values = {
            '연번': index + 1,
            '대장행': record.rowNumber,
            '자산번호': record.assetNumber,
            '자산명': record.assetName,
            '대장품명': record.className,
            '대장분류번호': record.code || life?.entry?.goodsClNo || '',
            '규격': record.model,
            '계정과목': record.category,
            '취득일자': record.acquiredAt,
            '사용위치': record.location,
            '매칭분류번호': life?.entry?.goodsClNo || life?.goodsClNo || '',
            '매칭분류명': life?.entry?.goodsClNm || life?.goodsClNm || '',
            '매칭상태': '미고시',
            '내용연수': '미고시',
            '유사고시후보': notifiedCandidates.map(formatCandidate).join(' | '),
            '적용내용연수(안)': '',
            '적용근거': '',
            '비고': life?.note || ''
        };
        candidates.forEach((candidate, i) => {
            values[`후보${i + 1}`] = formatCandidate(candidate);
        });
        const excelRow = candidateSheet.addRow(candidateHeaders.map((h) => values[h] ?? ''));
        excelRow.getCell(candidateHeaders.indexOf('내용연수') + 1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFDE68A' }
        };
        excelRow.getCell(candidateHeaders.indexOf('적용내용연수(안)') + 1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFDBEAFE' }
        };
        excelRow.getCell(candidateHeaders.indexOf('적용근거') + 1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFDBEAFE' }
        };
    });

    candidateSheet.columns = candidateHeaders.map((header) => {
        const widthMap = {
            '자산명': 28, '대장품명': 22, '규격': 36, '유사고시후보': 48,
            '후보1': 32, '후보2': 32, '후보3': 32, '후보4': 28,
            '후보5': 28, '후보6': 28, '후보7': 28, '후보8': 28,
            '적용내용연수(안)': 14, '적용근거': 36, '비고': 24, '사용위치': 18
        };
        return { width: widthMap[header] || 12 };
    });

    const lifeMeta = typeof sandbox.getUsefulLifeMeta === 'function'
        ? sandbox.getUsefulLifeMeta()
        : null;
    addLegalSheet(out, {
        createdAt: new Date().toISOString().slice(0, 10),
        sourceName,
        unnotifiedCount: enriched.length,
        lifeAsOf: lifeMeta?.기준일 || '',
        lifeTotal: lifeMeta?.건수 || '',
        lifeNotified: lifeMeta?.고시건수 || ''
    });
    addHelpSheet(out);

    const stamp = new Date().toISOString().slice(0, 10);
    const outName = `미고시_후보군_법적근거_${stamp}.xlsx`;
    const outPath = path.join(desktop, outName);
    await out.xlsx.writeFile(outPath);

    console.log(JSON.stringify({
        source: sourceName,
        out: outName,
        unnotified: enriched.length,
        withNotifiedCandidate: enriched.filter((e) => e.notifiedCandidates.length > 0).length
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
