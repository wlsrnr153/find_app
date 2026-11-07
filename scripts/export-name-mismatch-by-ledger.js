/**
 * 물품상태분류내역서의 대장번호 = 자산대장 순번 으로 맞추고,
 * 두 파일 모두 필터에 남아 보이는 행만 비교해 자산명이 다른 행을 추출한다.
 *   node scripts/export-name-mismatch-by-ledger.js
 */
const path = require('path');
const ExcelJS = require('exceljs');

const desktop = path.join(process.env.USERPROFILE, 'Desktop');
const registerPath = path.join(desktop, '전북대학교 산학협력단 자산대장_2026_10_16(변동사항, 내용연수 반영).xlsx');
const statusPath = path.join(desktop, '붙임2. (최종,공유)붙임1.물품상태분류내역서_산단.xlsx');

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

function seqKey(value) {
    const text = cellText(value).replace(/,/g, '');
    if (/^-?\d+(\.0+)?$/.test(text)) return String(Number(text));
    return text;
}

function nameKey(value) {
    return cellText(value).replace(/\s+/g, '').toLowerCase();
}

function styleHeader(row) {
    row.font = { bold: true };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
}

(async () => {
    const registerWb = new ExcelJS.Workbook();
    const statusWb = new ExcelJS.Workbook();
    await registerWb.xlsx.readFile(registerPath);
    await statusWb.xlsx.readFile(statusPath);

    const registerSheet = registerWb.getWorksheet('물품관리대장-제출자료');
    const statusSheet = statusWb.getWorksheet('총괄');

    const regBySeq = new Map();
    let registerVisible = 0;
    for (let r = 7; r <= registerSheet.rowCount; r += 1) {
        const row = registerSheet.getRow(r);
        const seq = seqKey(row.getCell(1).value);
        if (!seq) continue;
        if (!regBySeq.has(seq)) regBySeq.set(seq, []);
        const hidden = Boolean(row.hidden);
        if (!hidden) registerVisible += 1;
        regBySeq.get(seq).push({
            hidden,
            name: cellText(row.getCell(2).value),
            acquiredAt: cellText(row.getCell(3).value),
            assetNo: cellText(row.getCell(18).value)
        });
    }

    const mismatches = [];
    let missingLedger = 0;
    let blankLedger = 0;
    let hiddenStatus = 0;
    let statusVisible = 0;
    let compared = 0;
    const seenLedger = new Set();

    for (let r = 4; r <= statusSheet.rowCount; r += 1) {
        const row = statusSheet.getRow(r);
        if (row.hidden) {
            hiddenStatus += 1;
            continue;
        }
        const statusSeq = seqKey(row.getCell(1).value);
        if (!statusSeq) continue;
        const ledger = seqKey(row.getCell(20).value);
        statusVisible += 1;
        if (!ledger) {
            blankLedger += 1;
            continue;
        }
        seenLedger.add(ledger);
        const regs = (regBySeq.get(ledger) || []).filter((item) => !item.hidden);
        if (!regs.length) {
            missingLedger += 1;
            const hiddenOnly = (regBySeq.get(ledger) || []).some((item) => item.hidden);
            mismatches.push({
                statusSeq,
                ledger,
                registerName: '',
                statusName: cellText(row.getCell(4).value),
                registerAcquired: '',
                statusAcquired: cellText(row.getCell(16).value),
                registerAssetNo: '',
                statusAssetNo: cellText(row.getCell(3).value),
                note: hiddenOnly ? '자산대장은 필터에서 제외' : '대장에 해당 순번 없음'
            });
            continue;
        }
        compared += 1;
        const names = [...new Set(regs.map((item) => item.name))];
        const statusName = cellText(row.getCell(4).value);
        if (!names.some((name) => nameKey(name) !== nameKey(statusName))) continue;
        mismatches.push({
            statusSeq,
            ledger,
            registerName: names.join(' / '),
            statusName,
            registerAcquired: [...new Set(regs.map((item) => item.acquiredAt).filter(Boolean))].join(' / '),
            statusAcquired: cellText(row.getCell(16).value),
            registerAssetNo: [...new Set(regs.map((item) => item.assetNo).filter(Boolean))].join(' / '),
            statusAssetNo: cellText(row.getCell(3).value),
            note: ''
        });
    }

    const nameDiffs = mismatches.filter((row) => !row.note);
    const out = new ExcelJS.Workbook();
    const sheet = out.addWorksheet('자산명불일치');
    sheet.addRow([
        '상태분류_순번', '대장번호', '자산대장_자산명', '물품상태분류_품명',
        '자산대장_취득일자', '물품상태분류_취득일자', '자산대장_자산번호', '물품상태분류_자산번호', '비고'
    ]);
    styleHeader(sheet.getRow(1));
    nameDiffs.forEach((row) => {
        sheet.addRow([
            row.statusSeq, row.ledger, row.registerName, row.statusName,
            row.registerAcquired, row.statusAcquired, row.registerAssetNo, row.statusAssetNo, row.note
        ]);
    });
    sheet.autoFilter = { from: 'A1', to: 'I1' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    [14, 12, 32, 32, 22, 24, 24, 24, 22].forEach((width, index) => {
        sheet.getColumn(index + 1).width = width;
    });

    const missing = mismatches.filter((row) => row.note);
    if (missing.length) {
        const missSheet = out.addWorksheet('비교제외');
        missSheet.addRow(['상태분류_순번', '대장번호', '물품상태분류_품명', '취득일자', '자산번호', '비고']);
        styleHeader(missSheet.getRow(1));
        missing.forEach((row) => {
            missSheet.addRow([row.statusSeq, row.ledger, row.statusName, row.statusAcquired, row.statusAssetNo, row.note]);
        });
        missSheet.views = [{ state: 'frozen', ySplit: 1 }];
    }

    const outName = '순번비교_대장번호_필터_자산명불일치_2026-10-20.xlsx';
    await out.xlsx.writeFile(path.join(desktop, outName));
    console.log(JSON.stringify({
        registerVisible,
        statusVisible,
        hiddenStatus,
        compared,
        nameDiffs: nameDiffs.length,
        blankLedger,
        missingLedger,
        uniqueLedger: seenLedger.size,
        out: outName
    }));
    nameDiffs.slice(0, 8).forEach((row) => {
        console.log(row.ledger, row.registerName, '||', row.statusName);
    });
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
