// 원본 자산대장의 빈 내용연수 칸만 채운 새 파일을 만든다.
// 이미 숫자가 있는 칸은 그대로 둔다.
//   node scripts/fill-original-useful-life.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ExcelJS = require('exceljs');

const desktop = path.join(process.env.USERPROFILE, 'Desktop');
const sourceName = fs.readdirSync(desktop).find((name) =>
    name.includes('2026_10_01')
    && name.endsWith('.xlsx')
    && !name.startsWith('~')
    && !name.includes('내용연수')
    && !name.includes('백업')
);
if (!sourceName) {
    console.error('원본 자산대장을 바탕화면에서 찾지 못했습니다.');
    process.exit(1);
}

const publicDir = path.join(__dirname, '..', 'public');
const engine = fs.readFileSync(path.join(publicDir, 'useful-life.js'), 'utf8');
const snapshot = JSON.parse(fs.readFileSync(path.join(publicDir, 'useful-life.json'), 'utf8'));
const sandbox = { console, indexedDB: null, fetch: () => Promise.reject(new Error('네트워크 없음')) };
vm.createContext(sandbox);
vm.runInContext(engine, sandbox, { filename: 'useful-life.js' });
sandbox.applyUsefulLifeSnapshot(snapshot);

function cellText(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
        if (value.result != null) return cellText(value.result);
        if (value.text != null) return cellText(value.text);
        if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
    }
    return String(value).trim();
}

function yearsFromCode(code) {
    const digits = String(code || '').replace(/\D/g, '');
    if (!digits) return null;
    const entry = sandbox.lookupUsefulLifeByCode(digits);
    if (!entry || !entry.notified || !(Number(entry.usefulLife) > 0)) return null;
    return Number(entry.usefulLife);
}

function yearsFromName(name) {
    const text = String(name || '').trim();
    if (!text) return null;
    const match = sandbox.matchUsefulLife(text);
    if (match.verdict !== 'resolved' || !match.entry?.notified || !(Number(match.entry.usefulLife) > 0)) {
        return null;
    }
    return Number(match.entry.usefulLife);
}

function findHeader(sheet) {
    for (let rowNumber = 1; rowNumber <= 20; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        let lifeCol = 0;
        const cols = {};
        row.eachCell({ includeEmpty: true }, (cell, col) => {
            const text = cellText(cell.value).replace(/\s+/g, '');
            if (text === '내용연수') lifeCol = col;
            if (text === '분류번호') cols.code = col;
            if (text === '품명') cols.item = col;
            if (text === '자산명') cols.assetName = col;
        });
        if (lifeCol) return { headerRow: rowNumber, lifeCol, ...cols };
    }
    return null;
}

async function main() {
    const sourcePath = path.join(desktop, sourceName);
    const backupName = sourceName.replace(/\.xlsx$/i, '_백업.xlsx');
    const backupPath = path.join(desktop, backupName);
    if (!fs.existsSync(backupPath)) fs.copyFileSync(sourcePath, backupPath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(sourcePath);
    const sheet = workbook.getWorksheet('물품관리대장-제출자료') || workbook.worksheets[0];
    const header = findHeader(sheet);
    if (!header?.lifeCol) throw new Error('내용연수 열을 찾지 못했습니다');

    const stats = { filled: 0, kept: 0, blank: 0, byCode: 0, byName: 0 };
    const lastRow = sheet.actualRowCount || sheet.rowCount;
    for (let rowNumber = header.headerRow + 1; rowNumber <= lastRow; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const assetName = header.assetName ? cellText(row.getCell(header.assetName).value) : '';
        const itemName = header.item ? cellText(row.getCell(header.item).value) : '';
        if (!assetName && !itemName && !cellText(row.getCell(1).value)) continue;

        const current = cellText(row.getCell(header.lifeCol).value);
        if (current) {
            stats.kept += 1;
            continue;
        }

        const fromCode = yearsFromCode(header.code ? row.getCell(header.code).value : '');
        const fromName = yearsFromName(itemName || assetName);
        const years = fromCode || fromName;
        if (!years) {
            stats.blank += 1;
            continue;
        }
        row.getCell(header.lifeCol).value = years;
        stats.filled += 1;
        if (fromCode) stats.byCode += 1;
        else stats.byName += 1;
    }

    let outName = sourceName;
    let outPath = sourcePath;
    try {
        await workbook.xlsx.writeFile(outPath);
    } catch (error) {
        outName = sourceName.replace(/\.xlsx$/i, '_내용연수보완.xlsx');
        outPath = path.join(desktop, outName);
        await workbook.xlsx.writeFile(outPath);
        console.error('원본 파일이 열려 있어 보완 파일로 저장했습니다:', error.message);
    }
    console.log(JSON.stringify({ source: sourceName, backup: backupName, out: outName, ...stats }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
