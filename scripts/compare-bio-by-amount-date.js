/**
 * 바이오식품소재.xlsx vs 바이오식품소재2.xlsx
 * 취득일자 + 취득금액이 같으면 같은 물품(1:1)으로 매칭
 *
 *   node scripts/compare-bio-by-amount-date.js
 */
const path = require('path');
const ExcelJS = require('exceljs');

const desktop = path.join(process.env.USERPROFILE, 'Desktop');
const fileA = path.join(desktop, '바이오식품소재.xlsx');
const fileB = path.join(desktop, '바이오식품소재2.xlsx');

function cellText(value) {
    if (value == null) return '';
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return '';
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    if (typeof value === 'object') {
        if (value.result != null) return cellText(value.result);
        if (value.text != null) return cellText(value.text);
        if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
    }
    return String(value).replace(/\s+/g, ' ').trim();
}

function parseAmount(value) {
    const text = cellText(value).replace(/,/g, '').replace(/원/g, '').trim();
    if (!text) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
}

function parseQty(value) {
    const n = parseAmount(value);
    return n == null ? 0 : n;
}

function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const text = cellText(value);
    const m = text.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return text;
}

function nameKey(value) {
    return cellText(value).replace(/\s+/g, '').toLowerCase();
}

function pairKey(date, amount) {
    if (!date || amount == null) return '';
    return `${date}|${amount}`;
}

function styleHeader(row) {
    row.font = { bold: true };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
}

async function loadA() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fileA);
    const sheet = wb.worksheets[0];
    const rows = [];
    for (let r = 7; r <= sheet.rowCount; r += 1) {
        const row = sheet.getRow(r);
        const name = cellText(row.getCell(2).value);
        const seq = cellText(row.getCell(1).value);
        if (!name && !seq) continue;
        rows.push({
            source: 'A',
            excelRow: r,
            seq,
            name,
            date: parseDate(row.getCell(3).value),
            amount: parseAmount(row.getCell(6).value),
            qty: parseQty(row.getCell(4).value),
            unitPrice: parseAmount(row.getCell(5).value),
            classNo: cellText(row.getCell(10).value),
            ident: cellText(row.getCell(12).value),
            life: cellText(row.getCell(13).value),
            dept: cellText(row.getCell(8).value)
        });
    }
    return rows;
}

async function loadB() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fileB);
    const sheet = wb.worksheets[0];
    const rows = [];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
        const row = sheet.getRow(r);
        const name = cellText(row.getCell(3).value);
        const seq = cellText(row.getCell(1).value);
        if (!name && !seq) continue;
        rows.push({
            source: 'B',
            excelRow: r,
            seq,
            name,
            date: parseDate(row.getCell(6).value),
            amount: parseAmount(row.getCell(11).value),
            qty: parseQty(row.getCell(9).value),
            unitPrice: parseAmount(row.getCell(10).value),
            classNo: cellText(row.getCell(4).value),
            life: cellText(row.getCell(12).value),
            dept: cellText(row.getCell(14).value),
            assetNo: cellText(row.getCell(2).value),
            location: cellText(row.getCell(15).value)
        });
    }
    return rows;
}

function groupByPair(rows) {
    const map = new Map();
    rows.forEach((row, index) => {
        const key = pairKey(row.date, row.amount);
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ ...row, index });
    });
    return map;
}

(async () => {
    const rowsA = await loadA();
    const rowsB = await loadB();
    const mapA = groupByPair(rowsA);
    const mapB = groupByPair(rowsB);

    const matched = [];
    const onlyA = [];
    const onlyB = [];
    const usedB = new Set();
    const noKeyA = [];
    const noKeyB = [];

    for (const [key, listA] of mapA.entries()) {
        const poolB = (mapB.get(key) || []).filter((item) => !usedB.has(item.index));
        const remainingA = [...listA];
        const remainingB = [...poolB];

        // 같은 일자+금액 안에서는 이름이 같은 것부터 1:1
        for (let i = remainingA.length - 1; i >= 0; i -= 1) {
            const a = remainingA[i];
            const j = remainingB.findIndex((b) => nameKey(b.name) === nameKey(a.name));
            if (j < 0) continue;
            const b = remainingB[j];
            matched.push({ a, b, key, nameSame: true });
            usedB.add(b.index);
            remainingA.splice(i, 1);
            remainingB.splice(j, 1);
        }

        // 나머지는 일자+금액만 같으면 같은 물품으로 1:1
        while (remainingA.length && remainingB.length) {
            const a = remainingA.shift();
            const b = remainingB.shift();
            matched.push({ a, b, key, nameSame: nameKey(a.name) === nameKey(b.name) });
            usedB.add(b.index);
        }

        remainingA.forEach((a) => onlyA.push(a));
    }

    for (const [, listB] of mapB.entries()) {
        listB.forEach((b) => {
            if (!usedB.has(b.index)) onlyB.push(b);
        });
    }

    rowsA.forEach((row, index) => {
        if (!pairKey(row.date, row.amount)) noKeyA.push({ ...row, index });
    });
    rowsB.forEach((row, index) => {
        if (!pairKey(row.date, row.amount)) noKeyB.push({ ...row, index });
    });

    const nameSame = matched.filter((m) => m.nameSame);
    const nameDiff = matched.filter((m) => !m.nameSame);
    const qtyA = rowsA.reduce((s, r) => s + (r.qty || 0), 0);
    const qtyB = rowsB.reduce((s, r) => s + (r.qty || 0), 0);
    const sumA = rowsA.reduce((s, r) => s + (r.amount || 0), 0);
    const sumB = rowsB.reduce((s, r) => s + (r.amount || 0), 0);

    const out = new ExcelJS.Workbook();
    const summary = out.addWorksheet('요약');
    [
        ['비교기준', '취득일자 + 취득금액이 같으면 같은 물품 (1:1 매칭)'],
        ['파일A', '바이오식품소재.xlsx'],
        ['파일B', '바이오식품소재2.xlsx'],
        ['비교일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
        ['A 행수(물품건수)', rowsA.length],
        ['B 행수(물품건수)', rowsB.length],
        ['A 취득수량 합계', qtyA],
        ['B 취득수량 합계', qtyB],
        ['A 취득가액 합계', sumA],
        ['B 취득가격 합계', sumB],
        ['금액 합계 차이(A-B)', sumA - sumB],
        ['매칭됨(일자+금액)', matched.length],
        ['  └ 자산명도 같음', nameSame.length],
        ['  └ 자산명만 다름', nameDiff.length],
        ['A에만 있음', onlyA.length + noKeyA.length],
        ['B에만 있음', onlyB.length + noKeyB.length],
        ['참고', 'A 파일 상단 요약의 119는 행수가 아니라 취득수량 합계로 보임']
    ].forEach((row) => summary.addRow(row));
    summary.getColumn(1).width = 28;
    summary.getColumn(2).width = 64;

    const matchSheet = out.addWorksheet('매칭됨');
    matchSheet.addRow([
        '취득일자', '취득금액', '자산명동일', 'A자산명', 'B자산명',
        'A순번', 'B순번', 'A수량', 'B수량', 'A분류번호', 'B분류번호', 'A내용연수', 'B내용연수'
    ]);
    styleHeader(matchSheet.getRow(1));
    matched
        .sort((x, y) => String(x.a.date).localeCompare(String(y.a.date)) || (x.a.amount - y.a.amount))
        .forEach(({ a, b, nameSame: same }) => {
            matchSheet.addRow([
                a.date, a.amount, same ? 'Y' : 'N', a.name, b.name,
                a.seq, b.seq, a.qty, b.qty, a.classNo, b.classNo, a.life, b.life
            ]);
        });
    matchSheet.autoFilter = { from: 'A1', to: 'M1' };
    matchSheet.views = [{ state: 'frozen', ySplit: 1 }];
    matchSheet.columns.forEach((c) => { c.width = 12; });
    matchSheet.getColumn(4).width = 28;
    matchSheet.getColumn(5).width = 28;

    const onlyASheet = out.addWorksheet('A에만');
    onlyASheet.addRow(['취득일자', '취득금액', '자산명', '순번', '수량', '단가', '분류번호', '식별번호', '내용연수', '엑셀행']);
    styleHeader(onlyASheet.getRow(1));
    [...onlyA, ...noKeyA]
        .sort((x, y) => String(x.date).localeCompare(String(y.date)) || ((x.amount || 0) - (y.amount || 0)))
        .forEach((a) => {
            onlyASheet.addRow([a.date, a.amount, a.name, a.seq, a.qty, a.unitPrice, a.classNo, a.ident, a.life, a.excelRow]);
        });
    onlyASheet.views = [{ state: 'frozen', ySplit: 1 }];
    onlyASheet.getColumn(3).width = 28;

    const onlyBSheet = out.addWorksheet('B에만');
    onlyBSheet.addRow(['취득일자', '취득금액', '자산명', '순번', '수량', '단가', '분류번호', '자산번호', '내용연수', '사용위치', '엑셀행']);
    styleHeader(onlyBSheet.getRow(1));
    [...onlyB, ...noKeyB]
        .sort((x, y) => String(x.date).localeCompare(String(y.date)) || ((x.amount || 0) - (y.amount || 0)))
        .forEach((b) => {
            onlyBSheet.addRow([b.date, b.amount, b.name, b.seq, b.qty, b.unitPrice, b.classNo, b.assetNo || '', b.life, b.location || '', b.excelRow]);
        });
    onlyBSheet.views = [{ state: 'frozen', ySplit: 1 }];
    onlyBSheet.getColumn(3).width = 28;
    onlyBSheet.getColumn(10).width = 24;

    const stamp = new Date().toISOString().slice(0, 10);
    const outName = `바이오식품소재_취득일자금액_재비교_${stamp}.xlsx`;
    await out.xlsx.writeFile(path.join(desktop, outName));

    console.log(JSON.stringify({
        rowsA: rowsA.length,
        rowsB: rowsB.length,
        qtyA,
        qtyB,
        sumA,
        sumB,
        matched: matched.length,
        nameSame: nameSame.length,
        nameDiff: nameDiff.length,
        onlyA: onlyA.length + noKeyA.length,
        onlyB: onlyB.length + noKeyB.length,
        out: outName,
        onlyASample: onlyA.slice(0, 8).map((a) => `${a.date}/${a.amount} ${a.name} qty=${a.qty}`),
        onlyBSample: onlyB.slice(0, 8).map((b) => `${b.date}/${b.amount} ${b.name} qty=${b.qty}`),
        nameDiffSample: nameDiff.slice(0, 6).map(({ a, b }) => `${a.date}/${a.amount}: ${a.name} || ${b.name}`)
    }, null, 2));
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
