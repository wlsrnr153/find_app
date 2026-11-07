/**
 * 자산대장에서 내용연수 「유사등재」물품만 추려 엑셀로 저장한다.
 * 기준: 학습사전(alias) 또는 유사·동의어·포함 매칭으로 연수가 잡혔고,
 *       자산명 ≠ 적용 고시분류명 인 경우.
 *
 *   node scripts/export-similar-useful-life.js
 *   node scripts/export-similar-useful-life.js --file "파일명일부"
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ExcelJS = require('exceljs');

const desktop = path.join(process.env.USERPROFILE, 'Desktop');
const publicDir = path.join(__dirname, '..', 'public');
const fileArg = (() => {
    const idx = process.argv.indexOf('--file');
    return idx >= 0 ? process.argv[idx + 1] : '2026_10_13';
})();

const sourceName = fs.readdirSync(desktop).find((name) =>
    name.includes(fileArg)
    && name.includes('내용연수')
    && name.endsWith('.xlsx')
    && !name.startsWith('~')
);
if (!sourceName) {
    console.error(`대장을 찾지 못했습니다: Desktop/*${fileArg}*내용연수*.xlsx`);
    process.exit(1);
}

const aliasPath = [
    path.join(__dirname, '..', 'data', 'useful-life-aliases.json'),
    path.join(publicDir, 'useful-life-aliases.json')
].find((p) => fs.existsSync(p));
if (!aliasPath) {
    console.error('useful-life-aliases.json 없음');
    process.exit(1);
}

const sandbox = {
    console,
    fetch: () => Promise.reject(new Error('offline')),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(publicDir, 'useful-life.js'), 'utf8'), sandbox);
sandbox.applyUsefulLifeSnapshot(JSON.parse(fs.readFileSync(path.join(publicDir, 'useful-life.json'), 'utf8')));

const aliasFile = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
const aliasItems = aliasFile.items || aliasFile;
sandbox.setUsefulLifeAliases(aliasItems);

const SIMILAR_MATCHES = new Set(['alias', 'synonym', 'contains', 'contained', 'locale', 'family', 'similar']);

function cellText(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
        if (value.result != null) return cellText(value.result);
        if (value.text != null) return cellText(value.text);
        if (value instanceof Date) {
            const y = value.getFullYear();
            const m = String(value.getMonth() + 1).padStart(2, '0');
            const d = String(value.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
    }
    return String(value).trim();
}

function findHeader(sheet) {
    for (let rowNumber = 1; rowNumber <= 20; rowNumber += 1) {
        const cols = {};
        sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, col) => {
            const text = cellText(cell.value).replace(/\s+/g, '');
            if (text === '순번') cols.seq = col;
            if (text === '자산명') cols.name = col;
            if (text === '취득일자' || text === '취득일') cols.acquiredAt = col;
            if (text === '취득수량') cols.qty = col;
            if (text === '단가') cols.unitPrice = col;
            if (text === '취득가액') cols.amount = col;
            if (text === '소속') cols.org = col;
            if (text === '조사부서') cols.dept = col;
            if (text === '사용위치') cols.location = col;
            if (text === '운영부서') cols.opsDept = col;
            if (text === '자산번호') cols.assetNo = col;
            if (text === '분류번호') cols.classNo = col;
            if (text === '품명') cols.classNm = col;
            if (text === '식별번호') cols.ident = col;
            if (text === '내용연수') cols.life = col;
            if (text === '규격') cols.model = col;
            if (text === '계정과목명' || text === '계정과목') cols.category = col;
            if (text === '운영여부') cols.status = col;
        });
        if (cols.name && cols.life) return { headerRow: rowNumber, ...cols };
    }
    return null;
}

function aliasLookup(name) {
    const key = sandbox.normalizeGoodsName(name);
    if (!key) return null;
    const hits = aliasItems
        .filter((item) => sandbox.normalizeGoodsName(item.nameKey) === key)
        .sort((a, b) => String(b.decidedAt || '').localeCompare(String(a.decidedAt || '')));
    return hits[0] || null;
}

function isSimilarRegistration(assetName, matchedName, via) {
    if (!assetName || !matchedName) return false;
    if (!SIMILAR_MATCHES.has(via) && via !== 'code') return false;
    const a = sandbox.normalizeGoodsName(assetName);
    const b = sandbox.normalizeGoodsName(matchedName);
    if (!a || !b || a === b) return false;
    // code만으로 잡힌 경우는 학습사전에 있고 이름이 다를 때만 유사등재로 본다
    if (via === 'code') return Boolean(aliasLookup(assetName));
    return true;
}

function styleHeader(row) {
    row.font = { bold: true };
    row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8EEF7' }
    };
}

(async () => {
    const srcPath = path.join(desktop, sourceName);
    console.log('원본:', sourceName);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(srcPath);
    const sheet = wb.worksheets[0];
    const header = findHeader(sheet);
    if (!header) throw new Error('헤더(자산명·내용연수)를 찾지 못했습니다');

    const detailRows = [];
    const mappingMap = new Map();

    for (let r = header.headerRow + 1; r <= sheet.rowCount; r += 1) {
        const row = sheet.getRow(r);
        const name = cellText(row.getCell(header.name).value);
        if (!name) continue;

        const lifeRaw = cellText(row.getCell(header.life).value);
        const classNo = cellText(row.getCell(header.classNo)?.value);
        const classNm = cellText(row.getCell(header.classNm)?.value);
        const alias = aliasLookup(name);

        // 분류번호가 있으면 code 우선. 유사등재 판별은 적용 분류명·학습사전으로.
        const matched = sandbox.matchUsefulLife({ itemName: name, goodsClNo: '' });
        let via = matched?.entry?.match || '';
        let appliedNo = matched?.entry?.goodsClNo || '';
        let appliedNm = matched?.entry?.goodsClNm || '';
        let appliedLife = matched?.entry?.usefulLife;

        if (alias) {
            via = via || 'alias';
            appliedNo = appliedNo || alias.goodsClNo || '';
            appliedNm = appliedNm || alias.goodsClNm || '';
            if (appliedLife == null || appliedLife === '') appliedLife = alias.usefulLife;
        }

        // 대장에 이미 분류·품명이 있고 학습사전 기반이면 그 값을 보조
        if (!appliedNm && classNm) appliedNm = classNm;
        if (!appliedNo && classNo) appliedNo = classNo;

        if (!isSimilarRegistration(name, appliedNm, via || (alias ? 'alias' : ''))) continue;

        const record = {
            순번: cellText(row.getCell(header.seq)?.value),
            자산명: name,
            취득일자: cellText(row.getCell(header.acquiredAt)?.value),
            취득수량: cellText(row.getCell(header.qty)?.value),
            단가: cellText(row.getCell(header.unitPrice)?.value),
            취득가액: cellText(row.getCell(header.amount)?.value),
            소속: cellText(row.getCell(header.org)?.value),
            조사부서: cellText(row.getCell(header.dept)?.value),
            사용위치: cellText(row.getCell(header.location)?.value),
            운영부서: cellText(row.getCell(header.opsDept)?.value),
            자산번호: cellText(row.getCell(header.assetNo)?.value),
            식별번호: cellText(row.getCell(header.ident)?.value),
            규격: cellText(row.getCell(header.model)?.value),
            계정과목명: cellText(row.getCell(header.category)?.value),
            운영여부: cellText(row.getCell(header.status)?.value),
            대장내용연수: lifeRaw,
            대장분류번호: classNo,
            대장품명: classNm,
            유사등재분류번호: appliedNo,
            유사등재분류명: appliedNm,
            유사등재내용연수: appliedLife == null || appliedLife === ''
                ? ''
                : (Number(appliedLife) > 0 ? String(appliedLife) : '미고시'),
            매칭방식: via === 'alias' ? '학습사전(유사등재)'
                : via === 'synonym' ? '동의어'
                    : via === 'contains' || via === 'contained' ? '포함매칭'
                        : via === 'locale' ? '표기확장'
                            : via === 'family' || via === 'similar' ? '유사후보'
                                : via === 'code' ? '학습사전(분류반영)'
                                    : via || '학습사전',
            학습입력시각: alias?.decidedAt || ''
        };
        detailRows.push(record);

        const mapKey = `${sandbox.normalizeGoodsName(name)}|${appliedNo}`;
        if (!mappingMap.has(mapKey)) {
            mappingMap.set(mapKey, {
                자산명: name,
                유사등재분류번호: appliedNo,
                유사등재분류명: appliedNm,
                유사등재내용연수: record.유사등재내용연수,
                매칭방식: record.매칭방식,
                건수: 0
            });
        }
        mappingMap.get(mapKey).건수 += 1;
    }

    const out = new ExcelJS.Workbook();
    out.creator = 'find-app';
    out.created = new Date();

    const summary = out.addWorksheet('요약');
    summary.addRows([
        ['문서', '내용연수 유사등재 물품 목록'],
        ['원본대장', sourceName],
        ['추출일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
        ['추출기준', '자산명 ≠ 적용 고시분류명 이고, 학습사전·동의어·포함·유사 매칭으로 내용연수가 적용된 행'],
        ['유사등재 행수', detailRows.length],
        ['고유 매핑 수', mappingMap.size],
        ['학습사전 경로', path.basename(aliasPath)],
        ['학습사전 건수', aliasItems.length]
    ]);
    summary.getColumn(1).width = 16;
    summary.getColumn(2).width = 90;

    const mapSheet = out.addWorksheet('유사등재매핑');
    const mapHeaders = ['자산명', '유사등재분류번호', '유사등재분류명', '유사등재내용연수', '매칭방식', '건수'];
    mapSheet.addRow(mapHeaders);
    styleHeader(mapSheet.getRow(1));
    [...mappingMap.values()]
        .sort((a, b) => b.건수 - a.건수 || a.자산명.localeCompare(b.자산명, 'ko'))
        .forEach((row) => mapSheet.addRow(mapHeaders.map((h) => row[h])));
    mapSheet.columns.forEach((col, i) => {
        col.width = [28, 16, 28, 14, 18, 10][i] || 14;
    });

    const detail = out.addWorksheet('유사등재상세');
    const detailHeaders = [
        '순번', '자산명', '유사등재분류명', '유사등재분류번호', '유사등재내용연수', '대장내용연수',
        '매칭방식', '취득일자', '취득수량', '단가', '취득가액', '소속', '조사부서', '운영부서',
        '사용위치', '자산번호', '식별번호', '규격', '계정과목명', '운영여부',
        '대장분류번호', '대장품명', '학습입력시각'
    ];
    detail.addRow(detailHeaders);
    styleHeader(detail.getRow(1));
    detailRows.forEach((row) => detail.addRow(detailHeaders.map((h) => row[h])));
    detail.columns.forEach((col) => {
        col.width = 14;
    });
    detail.getColumn(2).width = 28;
    detail.getColumn(3).width = 28;
    detail.getColumn(18).width = 28;

    const stamp = new Date().toISOString().slice(0, 10);
    const outName = `내용연수_유사등재물품_${stamp}.xlsx`;
    const outPath = path.join(desktop, outName);
    await out.xlsx.writeFile(outPath);

    console.log(`저장: ${outName}`);
    console.log(`유사등재 ${detailRows.length}행 · 고유매핑 ${mappingMap.size}건`);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
