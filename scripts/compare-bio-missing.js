/**
 * 바이오식품소재 vs 바이오식품소재2
 * - 이름 변경(폴딩체어→접이식의자) 무시
 * - 취득일자+금액으로 매칭
 * - A가 수량 합친 행이면 단가×수량으로 B 단건들과 매칭
 * - 매칭 후 남는 것만 "없는 물품"
 *
 *   node scripts/compare-bio-missing.js
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
    if (n == null || n <= 0) return 1;
    return n;
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

function styleHeader(row) {
    row.font = { bold: true };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
}

function unitAmount(row) {
    if (row.unitPrice != null && row.unitPrice > 0) return row.unitPrice;
    if (row.amount != null && row.qty > 0) return Math.round(row.amount / row.qty);
    return row.amount;
}

async function loadA() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fileA);
    const sheet = wb.worksheets[0];
    const rows = [];
    for (let r = 7; r <= sheet.rowCount; r += 1) {
        const row = sheet.getRow(r);
        const name = cellText(row.getCell(2).value);
        if (!name) continue;
        const amount = parseAmount(row.getCell(6).value);
        const qty = parseQty(row.getCell(4).value);
        const unitPrice = parseAmount(row.getCell(5).value);
        rows.push({
            excelRow: r,
            seq: cellText(row.getCell(1).value),
            name,
            date: parseDate(row.getCell(3).value),
            amount,
            qty,
            unitPrice: unitPrice != null ? unitPrice : (amount != null ? Math.round(amount / qty) : null),
            classNo: cellText(row.getCell(10).value),
            ident: cellText(row.getCell(12).value),
            life: cellText(row.getCell(13).value)
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
        if (!name) continue;
        const amount = parseAmount(row.getCell(11).value);
        const qty = parseQty(row.getCell(9).value);
        const unitPrice = parseAmount(row.getCell(10).value);
        rows.push({
            excelRow: r,
            seq: cellText(row.getCell(1).value),
            name,
            date: parseDate(row.getCell(6).value),
            amount,
            qty,
            unitPrice: unitPrice != null ? unitPrice : amount,
            classNo: cellText(row.getCell(4).value),
            assetNo: cellText(row.getCell(2).value),
            life: cellText(row.getCell(12).value),
            location: cellText(row.getCell(15).value)
        });
    }
    return rows;
}

(async () => {
    const rowsA = await loadA();
    const rowsB = await loadB();

    const usedA = new Set();
    const usedB = new Set();
    const matched = [];

    // 1) 취득일자 + 취득금액(행 금액) 완전 동일 → 1:1
    for (let i = 0; i < rowsA.length; i += 1) {
        if (usedA.has(i)) continue;
        const a = rowsA[i];
        if (!a.date || a.amount == null) continue;
        const j = rowsB.findIndex((b, idx) =>
            !usedB.has(idx) && b.date === a.date && b.amount === a.amount
        );
        if (j < 0) continue;
        usedA.add(i);
        usedB.add(j);
        matched.push({
            type: '일자+금액',
            a,
            bList: [rowsB[j]],
            note: a.name === rowsB[j].name ? '이름동일' : `이름변경: ${a.name} → ${rowsB[j].name}`
        });
    }

    // 2) 남은 A: 같은 날짜 + A단가 == B금액 인 B를 A수량만큼 소비
    for (let i = 0; i < rowsA.length; i += 1) {
        if (usedA.has(i)) continue;
        const a = rowsA[i];
        const unit = unitAmount(a);
        if (!a.date || unit == null) continue;

        const candidates = [];
        rowsB.forEach((b, idx) => {
            if (usedB.has(idx)) return;
            if (b.date !== a.date) return;
            const bUnit = unitAmount(b);
            if (bUnit === unit || b.amount === unit) candidates.push(idx);
        });

        if (candidates.length < a.qty) continue;
        const take = candidates.slice(0, a.qty);
        take.forEach((idx) => usedB.add(idx));
        usedA.add(i);
        const bList = take.map((idx) => rowsB[idx]);
        const bNames = [...new Set(bList.map((b) => b.name))];
        matched.push({
            type: '일자+단가(수량분할)',
            a,
            bList,
            note: bNames.length === 1 && bNames[0] === a.name
                ? `수량분할 ${a.qty}건`
                : `이름변경·수량분할: ${a.name} → ${bNames.join(', ')} (${a.qty}건)`
        });
    }

    // 3) 남은 B를 같은 날짜+금액으로 남은 A와 한번 더 (단가 기준 A 잔여)
    for (let j = 0; j < rowsB.length; j += 1) {
        if (usedB.has(j)) continue;
        const b = rowsB[j];
        if (!b.date || b.amount == null) continue;
        const i = rowsA.findIndex((a, idx) =>
            !usedA.has(idx) && a.date === b.date && (a.amount === b.amount || unitAmount(a) === b.amount)
        );
        if (i < 0) continue;
        usedA.add(i);
        usedB.add(j);
        matched.push({
            type: '일자+단가',
            a: rowsA[i],
            bList: [b],
            note: rowsA[i].name === b.name ? '이름동일' : `이름변경: ${rowsA[i].name} → ${b.name}`
        });
    }

    const missingA = rowsA.filter((_, i) => !usedA.has(i)); // A에만 → B에 없음
    const missingB = rowsB.filter((_, j) => !usedB.has(j)); // B에만 → A에 없음

    const out = new ExcelJS.Workbook();
    const summary = out.addWorksheet('요약');
    [
        ['비교기준', '취득일자+금액(필요 시 단가·수량분할). 자산명 변경은 무시'],
        ['파일A', '바이오식품소재.xlsx'],
        ['파일B', '바이오식품소재2.xlsx'],
        ['비교일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
        ['A 행수', rowsA.length],
        ['B 행수', rowsB.length],
        ['A 취득수량 합', rowsA.reduce((s, r) => s + r.qty, 0)],
        ['B 취득수량 합', rowsB.reduce((s, r) => s + r.qty, 0)],
        ['매칭된 A행', matched.length],
        ['매칭에 소비된 B행', [...usedB].length],
        ['B에 없는 물품(A에만)', missingA.length],
        ['A에 없는 물품(B에만)', missingB.length]
    ].forEach((row) => summary.addRow(row));
    summary.getColumn(1).width = 28;
    summary.getColumn(2).width = 70;

    const missASheet = out.addWorksheet('B에없음_A에만');
    missASheet.addRow(['취득일자', '취득금액', '단가', '수량', '자산명', '순번', '분류번호', '식별번호', '내용연수', '엑셀행']);
    styleHeader(missASheet.getRow(1));
    missingA
        .sort((x, y) => String(x.date).localeCompare(String(y.date)) || ((x.amount || 0) - (y.amount || 0)))
        .forEach((a) => {
            missASheet.addRow([a.date, a.amount, a.unitPrice, a.qty, a.name, a.seq, a.classNo, a.ident, a.life, a.excelRow]);
        });
    missASheet.views = [{ state: 'frozen', ySplit: 1 }];
    missASheet.getColumn(5).width = 28;

    const missBSheet = out.addWorksheet('A에없음_B에만');
    missBSheet.addRow(['취득일자', '취득금액', '단가', '수량', '자산명', '순번', '분류번호', '자산번호', '내용연수', '사용위치', '엑셀행']);
    styleHeader(missBSheet.getRow(1));
    missingB
        .sort((x, y) => String(x.date).localeCompare(String(y.date)) || ((x.amount || 0) - (y.amount || 0)))
        .forEach((b) => {
            missBSheet.addRow([b.date, b.amount, b.unitPrice, b.qty, b.name, b.seq, b.classNo, b.assetNo, b.life, b.location, b.excelRow]);
        });
    missBSheet.views = [{ state: 'frozen', ySplit: 1 }];
    missBSheet.getColumn(5).width = 28;
    missBSheet.getColumn(10).width = 24;

    const matchedSheet = out.addWorksheet('매칭됨_참고');
    matchedSheet.addRow(['매칭방식', '비고', '취득일자', 'A금액', 'A단가', 'A수량', 'A자산명', 'B자산명들', 'B건수']);
    styleHeader(matchedSheet.getRow(1));
    matched.forEach((m) => {
        matchedSheet.addRow([
            m.type,
            m.note,
            m.a.date,
            m.a.amount,
            m.a.unitPrice,
            m.a.qty,
            m.a.name,
            [...new Set(m.bList.map((b) => b.name))].join(' / '),
            m.bList.length
        ]);
    });
    matchedSheet.views = [{ state: 'frozen', ySplit: 1 }];
    matchedSheet.getColumn(2).width = 48;
    matchedSheet.getColumn(7).width = 24;
    matchedSheet.getColumn(8).width = 28;

    const stamp = new Date().toISOString().slice(0, 10);
    const outName = `바이오식품소재_없는물품_${stamp}.xlsx`;
    await out.xlsx.writeFile(path.join(desktop, outName));

    console.log(JSON.stringify({
        rowsA: rowsA.length,
        rowsB: rowsB.length,
        matchedA: matched.length,
        usedB: usedB.size,
        missingA: missingA.length,
        missingB: missingB.length,
        out: outName,
        missingAList: missingA.map((a) => `${a.date} / ${a.amount} / ${a.name} (수량${a.qty})`),
        missingBList: missingB.map((b) => `${b.date} / ${b.amount} / ${b.name}`),
        renameSample: matched.filter((m) => m.note.includes('이름변경')).slice(0, 8).map((m) => m.note)
    }, null, 2));
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
