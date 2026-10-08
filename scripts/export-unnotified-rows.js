// 내용연수가 「미고시」인 행만 별도 엑셀로 뽑는다.
//   node scripts/export-unnotified-rows.js

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const desktop = path.join(process.env.USERPROFILE, 'Desktop');
const sourceName = fs.readdirSync(desktop).find((name) =>
    name.includes('2026_10_07')
    && name.includes('수량수정')
    && name.endsWith('.xlsx')
    && !name.startsWith('~')
);
if (!sourceName) {
    console.error('대상 파일을 바탕화면에서 찾지 못했습니다.');
    process.exit(1);
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
        let lifeCol = 0;
        let maxCol = 0;
        sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, col) => {
            maxCol = Math.max(maxCol, col);
            if (cellText(cell.value).replace(/\s+/g, '') === '내용연수') lifeCol = col;
        });
        if (lifeCol) return { headerRow: rowNumber, lifeCol, maxCol };
    }
    return null;
}

function rowMaxCol(row, floor = 1) {
    let max = floor;
    row.eachCell({ includeEmpty: false }, (_cell, col) => {
        max = Math.max(max, col);
    });
    return max;
}

async function main() {
    const sourcePath = path.join(desktop, sourceName);
    const workbookIn = new ExcelJS.Workbook();
    await workbookIn.xlsx.readFile(sourcePath);
    const sheetIn = workbookIn.getWorksheet('물품관리대장-제출자료') || workbookIn.worksheets[0];
    const header = findHeader(sheetIn);
    if (!header?.lifeCol) throw new Error('내용연수 열을 찾지 못했습니다');

    let maxCol = header.maxCol;
    const lastRow = sheetIn.actualRowCount || sheetIn.rowCount;
    for (let r = header.headerRow; r <= Math.min(header.headerRow + 30, lastRow); r += 1) {
        maxCol = Math.max(maxCol, rowMaxCol(sheetIn.getRow(r), maxCol));
    }

    const workbookOut = new ExcelJS.Workbook();
    workbookOut.creator = '물품 조사 시스템';
    const sheetOut = workbookOut.addWorksheet('미고시', {
        views: [{ state: 'frozen', ySplit: 1 }]
    });

    const headerRowIn = sheetIn.getRow(header.headerRow);
    const headerRowOut = sheetOut.getRow(1);
    for (let c = 1; c <= maxCol; c += 1) {
        const src = headerRowIn.getCell(c);
        const dst = headerRowOut.getCell(c);
        dst.value = src.value;
        dst.font = { bold: true };
        dst.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
        const width = sheetIn.getColumn(c).width;
        if (width) sheetOut.getColumn(c).width = width;
    }

    let copied = 0;
    for (let r = header.headerRow + 1; r <= lastRow; r += 1) {
        const row = sheetIn.getRow(r);
        if (cellText(row.getCell(header.lifeCol).value) !== '미고시') continue;
        copied += 1;
        const outRow = sheetOut.getRow(copied + 1);
        const colSpan = Math.max(maxCol, rowMaxCol(row, maxCol));
        for (let c = 1; c <= Math.min(colSpan, 200); c += 1) {
            const src = row.getCell(c);
            const dst = outRow.getCell(c);
            dst.value = src.value;
            if (c === header.lifeCol) {
                dst.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFDE68A' }
                };
            }
        }
    }

    const help = workbookOut.addWorksheet('안내');
    [
        ['미고시 전용 추출 파일'],
        [''],
        [`원본: ${sourceName}`],
        [`추출일: ${new Date().toISOString().slice(0, 10)}`],
        [`건수: ${copied}건`],
        [''],
        ['내용연수 열이 「미고시」인 행만 모았습니다.']
    ].forEach((line, index) => {
        const row = help.addRow(line);
        if (index === 0) row.font = { bold: true, size: 14 };
    });
    help.getColumn(1).width = 80;

    const outName = `미고시_목록_${new Date().toISOString().slice(0, 10)}.xlsx`;
    await workbookOut.xlsx.writeFile(path.join(desktop, outName));
    console.log(JSON.stringify({
        source: sourceName,
        out: outName,
        count: copied,
        lifeCol: header.lifeCol,
        maxCol
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
