/**
 * 같은 순번인데 자산명이 다른 행만 추출한다.
 * 상태내역서의 품명 = 자산대장의 자산명
 *   node scripts/export-name-mismatch-by-seq.js
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
    for (let r = 7; r <= registerSheet.rowCount; r += 1) {
        const row = registerSheet.getRow(r);
        const seq = cellText(row.getCell(1).value);
        if (!seq) continue;
        if (!regBySeq.has(seq)) regBySeq.set(seq, []);
        regBySeq.get(seq).push({
            excelRow: r,
            name: cellText(row.getCell(2).value),
            acquiredAt: cellText(row.getCell(3).value),
            assetNo: cellText(row.getCell(18).value)
        });
    }

    const statusBySeq = new Map();
    for (let r = 4; r <= statusSheet.rowCount; r += 1) {
        const row = statusSheet.getRow(r);
        const seq = cellText(row.getCell(1).value);
        if (!seq || statusBySeq.has(seq)) continue;
        statusBySeq.set(seq, {
            excelRow: r,
            name: cellText(row.getCell(4).value),
            acquiredAt: cellText(row.getCell(16).value),
            assetNo: cellText(row.getCell(3).value)
        });
    }

    const mismatches = [];
    [...new Set([...regBySeq.keys(), ...statusBySeq.keys()])]
        .sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)))
        .forEach((seq) => {
            const regs = regBySeq.get(seq) || [];
            const status = statusBySeq.get(seq);
            if (!regs.length || !status) return;
            const names = [...new Set(regs.map((row) => row.name))];
            const differs = names.some((name) => nameKey(name) !== nameKey(status.name));
            if (!differs) return;
            mismatches.push({
                seq,
                registerName: names.join(' / '),
                statusName: status.name,
                registerAcquired: [...new Set(regs.map((row) => row.acquiredAt).filter(Boolean))].join(' / '),
                statusAcquired: status.acquiredAt,
                registerAssetNo: [...new Set(regs.map((row) => row.assetNo).filter(Boolean))].join(' / '),
                statusAssetNo: status.assetNo
            });
        });

    const out = new ExcelJS.Workbook();
    const sheet = out.addWorksheet('자산명불일치');
    sheet.addRow(['순번', '자산대장_자산명', '물품상태분류_품명', '자산대장_취득일자', '물품상태분류_취득일자', '자산대장_자산번호', '물품상태분류_자산번호']);
    styleHeader(sheet.getRow(1));
    mismatches.forEach((row) => {
        sheet.addRow([
            row.seq,
            row.registerName,
            row.statusName,
            row.registerAcquired,
            row.statusAcquired,
            row.registerAssetNo,
            row.statusAssetNo
        ]);
    });
    sheet.autoFilter = { from: 'A1', to: 'G1' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    [12, 32, 32, 22, 24, 24, 24].forEach((width, index) => {
        sheet.getColumn(index + 1).width = width;
    });

    const outName = '순번비교_자산명불일치_2026-10-20.xlsx';
    await out.xlsx.writeFile(path.join(desktop, outName));
    console.log(`${mismatches.length}건 → ${outName}`);
    mismatches.slice(0, 8).forEach((row) => {
        console.log(row.seq, row.registerName, '||', row.statusName);
    });
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
