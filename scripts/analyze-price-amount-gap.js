/**
 * 자산대장 단가 vs 취득가액 합계 불일치 원인 분석
 *   node scripts/analyze-price-amount-gap.js
 */
const path = require('path');
const ExcelJS = require('exceljs');

const desktop = path.join(process.env.USERPROFILE, 'Desktop');
const fileName = '전북대학교 산학협력단 자산대장_2026_10_28(변동사항, 내용연수 반영).xlsx';
const filePath = path.join(desktop, fileName);

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

function parseNum(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value && typeof value === 'object' && value.result != null) return parseNum(value.result);
    const text = cellText(value).replace(/,/g, '').replace(/원/g, '').trim();
    if (!text) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
}

function styleHeader(row) {
    row.font = { bold: true };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
}

function findHeader(sheet) {
    for (let r = 1; r <= 20; r += 1) {
        const cols = {};
        sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
            const t = cellText(cell.value).replace(/\s+/g, '');
            if (t === '순번') cols.seq = c;
            if (t === '자산명') cols.name = c;
            if (t === '취득일자' || t === '취득일') cols.date = c;
            if (t === '취득수량') cols.qty = c;
            if (t === '단가') cols.unit = c;
            if (t === '취득가액' || t === '취득금액' || t === '취득가격') cols.amount = c;
            if (t === '자산번호') cols.assetNo = c;
            if (t === '식별번호') cols.ident = c;
            if (t === '운영여부') cols.status = c;
        });
        if (cols.unit && cols.amount && cols.qty) return { headerRow: r, ...cols };
    }
    return null;
}

(async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const sheet = wb.worksheets[0];
    console.log('sheet', sheet.name, 'rows', sheet.rowCount);

    // summary row often around 5
    for (let r = 1; r <= 6; r += 1) {
        const vals = [];
        sheet.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
            const t = cellText(cell.value);
            if (t) vals.push(`${c}:${t.slice(0, 40)}`);
        });
        if (vals.length) console.log('row', r, vals.join(' | '));
    }

    const header = findHeader(sheet);
    if (!header) throw new Error('헤더를 찾지 못했습니다');
    console.log('header', header);

    const rows = [];
    let sumUnit = 0;
    let sumAmount = 0;
    let sumQty = 0;
    let sumUnitTimesQty = 0;
    let blankUnit = 0;
    let blankAmount = 0;
    let blankQty = 0;
    let mismatch = [];
    let unitEqualsAmountWhenQty1 = 0;
    let hidden = 0;
    let visible = 0;

    for (let r = header.headerRow + 1; r <= sheet.rowCount; r += 1) {
        const row = sheet.getRow(r);
        const name = cellText(row.getCell(header.name).value);
        const seq = cellText(row.getCell(header.seq).value);
        if (!name && !seq) continue;

        const qty = parseNum(row.getCell(header.qty).value);
        const unit = parseNum(row.getCell(header.unit).value);
        const amount = parseNum(row.getCell(header.amount).value);
        const isHidden = Boolean(row.hidden);
        if (isHidden) hidden += 1;
        else visible += 1;

        if (qty == null) blankQty += 1;
        if (unit == null) blankUnit += 1;
        if (amount == null) blankAmount += 1;

        if (unit != null) sumUnit += unit;
        if (amount != null) sumAmount += amount;
        if (qty != null) sumQty += qty;
        if (unit != null && qty != null) sumUnitTimesQty += unit * qty;

        const expected = (unit != null && qty != null) ? unit * qty : null;
        let gap = null;
        let reason = '';
        if (expected != null && amount != null) {
            gap = amount - expected;
            if (Math.abs(gap) > 0.5) {
                if (qty === 1 && Math.abs(amount - unit) < 0.5) {
                    // fine
                } else if (qty > 1 && Math.abs(amount - unit) < 0.5) {
                    reason = '취득가액이 단가와 같음(수량미반영)';
                } else if (qty > 1 && Math.abs(amount - unit * qty) > 0.5) {
                    reason = '단가×수량 ≠ 취득가액';
                } else {
                    reason = '단가×수량 ≠ 취득가액';
                }
                mismatch.push({
                    excelRow: r,
                    seq,
                    name,
                    date: cellText(row.getCell(header.date)?.value),
                    qty,
                    unit,
                    amount,
                    expected,
                    gap,
                    reason,
                    hidden: isHidden,
                    assetNo: cellText(row.getCell(header.assetNo)?.value),
                    status: cellText(row.getCell(header.status)?.value)
                });
            }
        } else if (unit != null && amount != null && qty == null) {
            reason = '수량 없음';
            mismatch.push({
                excelRow: r, seq, name, date: cellText(row.getCell(header.date)?.value),
                qty, unit, amount, expected: null, gap: null, reason, hidden: isHidden,
                assetNo: cellText(row.getCell(header.assetNo)?.value),
                status: cellText(row.getCell(header.status)?.value)
            });
        }

        if (qty === 1 && unit != null && amount != null && Math.abs(unit - amount) < 0.5) {
            unitEqualsAmountWhenQty1 += 1;
        }

        rows.push({ seq, name, qty, unit, amount, hidden: isHidden });
    }

    // reason buckets
    const byReason = {};
    mismatch.forEach((m) => {
        byReason[m.reason] = (byReason[m.reason] || 0) + 1;
    });

    // If user compared SUM(단가) vs SUM(취득가액), explain:
    const gapSumUnitVsAmount = sumAmount - sumUnit;
    const gapSumUnitQtyVsAmount = sumAmount - sumUnitTimesQty;

    const out = new ExcelJS.Workbook();
    const summary = out.addWorksheet('요약');
    [
        ['파일', fileName],
        ['시트', sheet.name],
        ['분석일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
        ['데이터 행수', rows.length],
        ['필터 숨김 행', hidden],
        ['보이는 행', visible],
        ['취득수량 합계', sumQty],
        ['단가 합계 Σ단가', sumUnit],
        ['취득가액 합계 Σ취득가액', sumAmount],
        ['단가×수량 합계 Σ(단가×수량)', sumUnitTimesQty],
        ['Σ취득가액 − Σ단가', gapSumUnitVsAmount],
        ['Σ취득가액 − Σ(단가×수량)', gapSumUnitQtyVsAmount],
        ['단가 공란', blankUnit],
        ['취득가액 공란', blankAmount],
        ['수량 공란', blankQty],
        ['단가×수량≠취득가액 행수', mismatch.length],
        ['설명', '단가 열 합계와 취득가액 열 합계는 원래 다를 수 있음. 수량이 2 이상이면 취득가액=단가×수량'],
        ['원인요약', Math.abs(gapSumUnitQtyVsAmount) < 1
            ? '행별 단가×수량은 취득가액과 일치. 총액 차이는 Σ단가(수량미반영)와 Σ취득가액 비교 때문'
            : '일부 행에서 단가×수량과 취득가액이 불일치']
    ].forEach((row) => summary.addRow(row));
    summary.addRow([]);
    summary.addRow(['불일치 유형', '건수']);
    styleHeader(summary.getRow(summary.rowCount));
    Object.entries(byReason).forEach(([k, v]) => summary.addRow([k, v]));
    summary.getColumn(1).width = 36;
    summary.getColumn(2).width = 88;

    const detail = out.addWorksheet('단가×수량_불일치');
    detail.addRow(['엑셀행', '순번', '자산명', '취득일자', '취득수량', '단가', '단가×수량', '취득가액', '차이(가액-단가×수량)', '원인', '숨김', '자산번호', '운영여부']);
    styleHeader(detail.getRow(1));
    mismatch
        .sort((a, b) => Math.abs(b.gap || 0) - Math.abs(a.gap || 0))
        .forEach((m) => {
            detail.addRow([
                m.excelRow, m.seq, m.name, m.date, m.qty, m.unit, m.expected, m.amount, m.gap,
                m.reason, m.hidden ? 'Y' : '', m.assetNo, m.status
            ]);
        });
    detail.autoFilter = { from: 'A1', to: 'M1' };
    detail.views = [{ state: 'frozen', ySplit: 1 }];
    detail.getColumn(3).width = 28;
    detail.columns.forEach((c, i) => {
        if (![2].includes(i)) c.width = c.width || 14;
    });

    // 수량이 2 이상인 행: Σ단가와 Σ취득가액이 달라지는 주원인
    const multi = out.addWorksheet('수량2이상_참고');
    multi.addRow(['엑셀행', '순번', '자산명', '수량', '단가', '단가×수량', '취득가액', '취득가액-단가']);
    styleHeader(multi.getRow(1));
    for (let r = header.headerRow + 1; r <= sheet.rowCount; r += 1) {
        const row = sheet.getRow(r);
        const name = cellText(row.getCell(header.name).value);
        const seq = cellText(row.getCell(header.seq).value);
        if (!name && !seq) continue;
        const qty = parseNum(row.getCell(header.qty).value);
        if (!(qty > 1)) continue;
        const unit = parseNum(row.getCell(header.unit).value);
        const amount = parseNum(row.getCell(header.amount).value);
        multi.addRow([
            r, seq, name, qty, unit,
            unit != null ? unit * qty : '',
            amount,
            unit != null && amount != null ? amount - unit : ''
        ]);
    }
    multi.views = [{ state: 'frozen', ySplit: 1 }];
    multi.getColumn(3).width = 28;

    const stamp = new Date().toISOString().slice(0, 10);
    const outName = `단가_취득가액_차이원인_${stamp}.xlsx`;
    await out.xlsx.writeFile(path.join(desktop, outName));

    console.log(JSON.stringify({
        rows: rows.length,
        hidden,
        visible,
        sumQty,
        sumUnit,
        sumAmount,
        sumUnitTimesQty,
        gapUnitVsAmount: gapSumUnitVsAmount,
        gapUnitQtyVsAmount: gapSumUnitQtyVsAmount,
        mismatch: mismatch.length,
        byReason,
        multiQtyRows: multi.rowCount - 1,
        out: outName,
        mismatchSample: mismatch.slice(0, 8)
    }, null, 2));
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
