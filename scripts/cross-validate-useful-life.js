// 대장 내용연수 vs 학습사전·고시표 교차검증 결과 엑셀 생성
//   node scripts/cross-validate-useful-life.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ExcelJS = require('exceljs');

const desktop = path.join(process.env.USERPROFILE, 'Desktop');
const sourceName = fs.readdirSync(desktop).find((name) =>
    name.includes('2026_10_07')
    && name.includes('수량수정')
    && name.endsWith('.xlsx')
    && !name.startsWith('~')
);
if (!sourceName) {
    console.error('대상 대장을 찾지 못했습니다.');
    process.exit(1);
}

const publicDir = path.join(__dirname, '..', 'public');
const sandbox = {
    console,
    indexedDB: null,
    fetch: () => Promise.reject(new Error('네트워크 없음')),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
};
vm.createContext(sandbox);

if (fs.existsSync(path.join(publicDir, 'goods-catalog.js'))) {
    vm.runInContext(fs.readFileSync(path.join(publicDir, 'goods-catalog.js'), 'utf8'), sandbox, { filename: 'goods-catalog.js' });
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
const aliasFile = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
const aliasItems = aliasFile.items || aliasFile;
sandbox.setUsefulLifeAliases(aliasItems);

const lifeMeta = typeof sandbox.getUsefulLifeMeta === 'function' ? sandbox.getUsefulLifeMeta() : {};

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
        const cols = {};
        sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, col) => {
            const text = cellText(cell.value).replace(/\s+/g, '');
            if (text === '내용연수') cols.life = col;
            if (text === '분류번호') cols.code = col;
            if (text === '품명') cols.item = col;
            if (text === '자산명') cols.assetName = col;
            if (text === '자산번호') cols.assetNumber = col;
            if (text === '규격') cols.model = col;
            if (text === '계정과목명' || text === '계정과목') cols.category = col;
            if (text === '취득일자' || text === '취득일') cols.acquiredAt = col;
            if (text === '순번') cols.seq = col;
        });
        if (cols.life) return { headerRow: rowNumber, ...cols };
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

function expectedLife({ code, itemName, assetName, model }) {
    const names = [itemName, assetName, String(model || '').split(',')[0].trim()].filter(Boolean);

    if (code) {
        const byCode = sandbox.lookupUsefulLifeByCode(code);
        if (byCode) {
            const years = Number(byCode.usefulLife) || 0;
            return {
                years,
                label: years > 0 ? String(years) : '미고시',
                goodsClNm: byCode.goodsClNm || '',
                goodsClNo: byCode.goodsClNo || code,
                source: '분류번호',
                verdict: years > 0 ? 'resolved' : 'unnotified',
                aliasAt: ''
            };
        }
    }

    for (const name of names) {
        const alias = aliasLookup(name);
        if (!alias) continue;

        let years = Number(alias.usefulLife) || 0;
        let goodsClNm = alias.goodsClNm || '';
        let goodsClNo = alias.goodsClNo || '';
        let source = '학습사전';

        if (!(years > 0) && goodsClNo) {
            const entry = sandbox.lookupUsefulLifeByCode(goodsClNo);
            if (entry) {
                years = Number(entry.usefulLife) || 0;
                goodsClNm = entry.goodsClNm || goodsClNm;
                source = '학습사전+고시표';
            }
        }

        if (!(years > 0)) {
            const match = sandbox.matchUsefulLife({ itemName: name, goodsClNo: goodsClNo || code });
            if (match?.verdict === 'resolved' && Number(match.entry?.usefulLife) > 0) {
                years = Number(match.entry.usefulLife);
                goodsClNm = match.entry.goodsClNm || goodsClNm;
                goodsClNo = match.entry.goodsClNo || goodsClNo;
                source = '학습사전+매칭';
            }
        }

        return {
            years,
            label: years > 0 ? String(years) : '미고시',
            goodsClNm,
            goodsClNo,
            source,
            verdict: years > 0 ? 'resolved' : 'unnotified',
            aliasAt: alias.decidedAt || ''
        };
    }

    for (const name of names) {
        const match = sandbox.matchUsefulLife({ itemName: name, goodsClNo: code });
        if (!match?.entry && match?.verdict === 'missing') continue;
        if (match?.verdict === 'resolved' || match?.verdict === 'unnotified') {
            const years = Number(match.entry?.usefulLife) || 0;
            return {
                years,
                label: years > 0 ? String(years) : '미고시',
                goodsClNm: match.entry?.goodsClNm || '',
                goodsClNo: match.entry?.goodsClNo || '',
                source: `자동매칭(${match.entry?.match || match.verdict})`,
                verdict: match.verdict,
                aliasAt: ''
            };
        }
        if (match?.verdict === 'ambiguous') {
            return {
                years: 0,
                label: '',
                goodsClNm: match.candidates?.[0]?.goodsClNm || '',
                goodsClNo: match.candidates?.[0]?.goodsClNo || '',
                source: '확인필요',
                verdict: 'ambiguous',
                aliasAt: ''
            };
        }
    }

    return {
        years: 0,
        label: '',
        goodsClNm: '',
        goodsClNo: '',
        source: '기준없음',
        verdict: 'missing',
        aliasAt: ''
    };
}

function normalizeLifeCell(text) {
    const t = String(text || '').trim();
    if (!t) return { kind: 'blank', value: '', num: null };
    if (t === '미고시') return { kind: 'unnotified', value: '미고시', num: 0 };
    if (/^\d+(\.\d+)?$/.test(t)) return { kind: 'years', value: String(Number(t)), num: Number(t) };
    return { kind: 'other', value: t, num: null };
}

function compareLife(actual, expected) {
    // expected.label: 'N' | '미고시' | ''
    if (expected.verdict === 'ambiguous' || expected.verdict === 'missing') {
        if (actual.kind === 'blank') {
            return { status: '기준없음_공란', ok: true, note: '검증 기준 없음(공란 유지)' };
        }
        return {
            status: '기준없음_입력있음',
            ok: false,
            note: `기준 없이 대장에 "${actual.value}" 입력됨`
        };
    }

    if (expected.label === '미고시') {
        if (actual.kind === 'unnotified') {
            return { status: '일치_미고시', ok: true, note: '' };
        }
        if (actual.kind === 'years') {
            return { status: '불일치_연수입력', ok: false, note: `기대 미고시 / 대장 ${actual.value}년` };
        }
        if (actual.kind === 'blank') {
            return { status: '누락_미고시', ok: false, note: '기대 미고시인데 공란' };
        }
        return { status: '불일치', ok: false, note: `기대 미고시 / 대장 "${actual.value}"` };
    }

    // expected years
    if (actual.kind === 'years' && actual.num === expected.years) {
        return { status: '일치_연수', ok: true, note: '' };
    }
    if (actual.kind === 'unnotified') {
        return { status: '불일치_미고시표기', ok: false, note: `기대 ${expected.years}년 / 대장 미고시` };
    }
    if (actual.kind === 'blank') {
        return { status: '누락_연수', ok: false, note: `기대 ${expected.years}년인데 공란` };
    }
    if (actual.kind === 'years') {
        return { status: '불일치_연수차이', ok: false, note: `기대 ${expected.years}년 / 대장 ${actual.num}년` };
    }
    return { status: '불일치', ok: false, note: `기대 ${expected.years}년 / 대장 "${actual.value}"` };
}

function styleHeader(row) {
    row.font = { bold: true };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    row.alignment = { vertical: 'middle', wrapText: true };
}

function statusFill(status) {
    if (status.startsWith('일치')) return 'FFD1FAE5';
    if (status.startsWith('불일치') || status.startsWith('누락')) return 'FFFECACA';
    if (status.startsWith('기준없음')) return 'FFFEF3C7';
    return null;
}

function toKst(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

async function main() {
    const sourcePath = path.join(desktop, sourceName);
    const workbookIn = new ExcelJS.Workbook();
    await workbookIn.xlsx.readFile(sourcePath);
    const sheetIn = workbookIn.getWorksheet('물품관리대장-제출자료') || workbookIn.worksheets[0];
    const header = findHeader(sheetIn);
    if (!header?.life) throw new Error('내용연수 열을 찾지 못했습니다');

    const rows = [];
    const lastRow = sheetIn.actualRowCount || sheetIn.rowCount;
    for (let rowNumber = header.headerRow + 1; rowNumber <= lastRow; rowNumber += 1) {
        const row = sheetIn.getRow(rowNumber);
        const assetName = header.assetName ? cellText(row.getCell(header.assetName).value) : '';
        const itemName = header.item ? cellText(row.getCell(header.item).value) : '';
        if (!assetName && !itemName && !cellText(row.getCell(1).value)) continue;

        const code = header.code ? cellText(row.getCell(header.code).value) : '';
        const model = header.model ? cellText(row.getCell(header.model).value) : '';
        const actualRaw = cellText(row.getCell(header.life).value);
        const actual = normalizeLifeCell(actualRaw);
        const expected = expectedLife({ code, itemName, assetName, model });
        const cmp = compareLife(actual, expected);

        rows.push({
            rowNumber,
            seq: header.seq ? cellText(row.getCell(header.seq).value) : '',
            assetNumber: header.assetNumber ? cellText(row.getCell(header.assetNumber).value) : '',
            assetName,
            itemName,
            code,
            model,
            category: header.category ? cellText(row.getCell(header.category).value) : '',
            acquiredAt: header.acquiredAt ? cellText(row.getCell(header.acquiredAt).value) : '',
            actual: actual.value || '(공란)',
            expected: expected.label || '(기준없음)',
            expectedClass: expected.goodsClNm,
            expectedCode: expected.goodsClNo,
            source: expected.source,
            aliasAt: expected.aliasAt,
            status: cmp.status,
            ok: cmp.ok,
            note: cmp.note
        });
    }

    const summary = {
        total: rows.length,
        matchYears: rows.filter((r) => r.status === '일치_연수').length,
        matchUnnotified: rows.filter((r) => r.status === '일치_미고시').length,
        mismatch: rows.filter((r) => !r.ok && !r.status.startsWith('기준없음')).length,
        noBaseOk: rows.filter((r) => r.status === '기준없음_공란').length,
        noBaseWarn: rows.filter((r) => r.status === '기준없음_입력있음').length
    };
    summary.match = summary.matchYears + summary.matchUnnotified;
    summary.passRate = summary.total
        ? (((summary.match + summary.noBaseOk) / summary.total) * 100).toFixed(2)
        : '0';

    const out = new ExcelJS.Workbook();
    out.creator = '물품 조사 시스템';
    out.created = new Date();

    // 요약
    const sumSheet = out.addWorksheet('검증요약');
    const sumLines = [
        ['구분', '내용'],
        ['검증일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
        ['대상 대장', sourceName],
        ['학습사전 건수', aliasItems.length],
        ['학습사전 동기화', toKst(aliasFile.updatedAt)],
        ['학습 최종 입력', toKst(
            aliasItems.slice().sort((a, b) => String(b.decidedAt || '').localeCompare(String(a.decidedAt || '')))[0]?.decidedAt
        )],
        ['고시표 기준일', lifeMeta?.기준일 || ''],
        ['고시표 건수', `${lifeMeta?.고시건수 || ''} / ${lifeMeta?.건수 || ''}`],
        ['', ''],
        ['전체 행', summary.total],
        ['일치(연수)', summary.matchYears],
        ['일치(미고시)', summary.matchUnnotified],
        ['일치 합계', summary.match],
        ['불일치·누락', summary.mismatch],
        ['기준없음(공란 유지)', summary.noBaseOk],
        ['기준없음(입력 있음)', summary.noBaseWarn],
        ['검증 통과율(일치+기준없음공란)', `${summary.passRate}%`],
        ['', ''],
        ['판정 기준', '학습사전(nameKey→분류) 우선, 없으면 대장 분류번호·자동매칭. 고시 연수 없으면 미고시로 기대.'],
        ['불일치 의미', '대장 내용연수가 학습/고시 기대값과 다름. 「검증불일치」시트 확인.']
    ];
    sumLines.forEach((line, index) => {
        const row = sumSheet.addRow(line);
        if (index === 0) styleHeader(row);
        row.alignment = { vertical: 'top', wrapText: true };
    });
    sumSheet.getColumn(1).width = 34;
    sumSheet.getColumn(2).width = 72;

    const detailHeaders = [
        '검증결과', '비고', '대장행', '순번', '자산번호', '자산명', '대장품명', '대장분류번호',
        '대장내용연수', '기대내용연수', '기대분류명', '기대분류번호', '기대출처', '학습입력시각',
        '규격', '계정과목', '취득일자'
    ];

    function addDetailSheet(name, list) {
        const sheet = out.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
        styleHeader(sheet.addRow(detailHeaders));
        list.forEach((entry) => {
            const values = {
                '검증결과': entry.status,
                '비고': entry.note,
                '대장행': entry.rowNumber,
                '순번': entry.seq,
                '자산번호': entry.assetNumber,
                '자산명': entry.assetName,
                '대장품명': entry.itemName,
                '대장분류번호': entry.code,
                '대장내용연수': entry.actual,
                '기대내용연수': entry.expected,
                '기대분류명': entry.expectedClass,
                '기대분류번호': entry.expectedCode,
                '기대출처': entry.source,
                '학습입력시각': toKst(entry.aliasAt),
                '규격': entry.model,
                '계정과목': entry.category,
                '취득일자': entry.acquiredAt
            };
            const excelRow = sheet.addRow(detailHeaders.map((h) => values[h] ?? ''));
            const fill = statusFill(entry.status);
            if (fill) {
                excelRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
            }
        });
        sheet.columns = detailHeaders.map((headerName) => {
            const widthMap = {
                '검증결과': 16, '비고': 36, '자산명': 28, '대장품명': 22, '기대분류명': 28,
                '규격': 28, '학습입력시각': 22, '기대출처': 16
            };
            return { width: widthMap[headerName] || 12 };
        });
        return sheet;
    }

    addDetailSheet('전체검증', rows);
    addDetailSheet('검증불일치', rows.filter((r) => !r.ok && !r.status.startsWith('기준없음')));
    addDetailSheet('일치_연수', rows.filter((r) => r.status === '일치_연수'));
    addDetailSheet('일치_미고시', rows.filter((r) => r.status === '일치_미고시'));
    addDetailSheet('기준없음', rows.filter((r) => r.status.startsWith('기준없음')));

    const stamp = new Date().toISOString().slice(0, 10);
    const outName = `내용연수_교차검증결과_${stamp}.xlsx`;
    await out.xlsx.writeFile(path.join(desktop, outName));

    console.log(JSON.stringify({
        source: sourceName,
        out: outName,
        aliases: aliasItems.length,
        ...summary
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
