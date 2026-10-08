// 원본 자산대장의 빈 내용연수 칸만 채운 새 파일을 만든다.
// 이미 숫자가 있는 칸·「미고시」는 그대로 둔다.
// 고시 연수가 있으면 숫자, 분류는 찾았으나 미고시면 「미고시」.
//   node scripts/fill-original-useful-life.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ExcelJS = require('exceljs');

const desktop = path.join(process.env.USERPROFILE, 'Desktop');
const allXlsx = fs.readdirSync(desktop).filter((name) =>
    name.includes('2026_10_01')
    && name.endsWith('.xlsx')
    && !name.startsWith('~')
);

// 진짜 원본(빈 내용연수)부터 다시 채운다. 없으면 현재 대장.
const backupName = allXlsx.find((name) => name.includes('백업'));
const sourceName = backupName
    || allXlsx.find((name) => !name.includes('내용연수') && !name.includes('백업'));
if (!sourceName) {
    console.error('원본 자산대장을 바탕화면에서 찾지 못했습니다.');
    process.exit(1);
}

const outNamePreferred = allXlsx.find((name) =>
    !name.includes('내용연수') && !name.includes('백업')
) || sourceName.replace(/_백업\.xlsx$/i, '.xlsx');

const publicDir = path.join(__dirname, '..', 'public');
const sandbox = {
    console,
    indexedDB: null,
    fetch: () => Promise.reject(new Error('네트워크 없음')),
    localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    }
};
vm.createContext(sandbox);

const catalogEnginePath = path.join(publicDir, 'goods-catalog.js');
if (fs.existsSync(catalogEnginePath)) {
    vm.runInContext(fs.readFileSync(catalogEnginePath, 'utf8'), sandbox, { filename: 'goods-catalog.js' });
}
vm.runInContext(fs.readFileSync(path.join(publicDir, 'useful-life.js'), 'utf8'), sandbox, { filename: 'useful-life.js' });

const snapshot = JSON.parse(fs.readFileSync(path.join(publicDir, 'useful-life.json'), 'utf8'));
sandbox.applyUsefulLifeSnapshot(snapshot);

const catalogPath = [
    path.join(publicDir, 'goods-catalog.json'),
    path.join(__dirname, '..', 'data', 'goods-catalog.json')
].find((p) => fs.existsSync(p));
if (catalogPath && typeof sandbox.applyGoodsCatalogSnapshot === 'function') {
    sandbox.applyGoodsCatalogSnapshot(JSON.parse(fs.readFileSync(catalogPath, 'utf8')));
}

const aliasPath = path.join(__dirname, '..', 'data', 'useful-life-aliases.json');
let aliasCount = 0;
if (fs.existsSync(aliasPath)) {
    const aliasFile = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
    aliasCount = sandbox.setUsefulLifeAliases(aliasFile.items || aliasFile) || 0;
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

/** @returns {number|'미고시'|null} */
function lifeFromMatch(match) {
    if (!match) return null;
    if (match.verdict === 'resolved' && Number(match.entry?.usefulLife) > 0) {
        return Number(match.entry.usefulLife);
    }
    if (match.verdict === 'unnotified') return '미고시';
    return null;
}

function resolveLife({ code, itemName, assetName }) {
    const byCode = sandbox.matchUsefulLife({ goodsClNo: code, itemName: '' });
    const fromCode = lifeFromMatch(byCode);
    if (fromCode != null) return { value: fromCode, via: 'code' };

    if (itemName) {
        const fromItem = lifeFromMatch(sandbox.matchUsefulLife({ itemName }));
        if (fromItem != null) return { value: fromItem, via: 'item' };
    }
    if (assetName && assetName !== itemName) {
        const fromAsset = lifeFromMatch(sandbox.matchUsefulLife({ itemName: assetName }));
        if (fromAsset != null) return { value: fromAsset, via: 'asset' };
    }
    return { value: null, via: null };
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

function alreadyFilled(text) {
    if (!text) return false;
    if (text === '미고시') return true;
    return Number(text) > 0 || /^\d+(\.\d+)?$/.test(text);
}

async function main() {
    const sourcePath = path.join(desktop, sourceName);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(sourcePath);
    const sheet = workbook.getWorksheet('물품관리대장-제출자료') || workbook.worksheets[0];
    const header = findHeader(sheet);
    if (!header?.lifeCol) throw new Error('내용연수 열을 찾지 못했습니다');

    const stats = {
        filledYears: 0,
        filledUnnotified: 0,
        kept: 0,
        blank: 0,
        byCode: 0,
        byItem: 0,
        byAsset: 0
    };
    const lastRow = sheet.actualRowCount || sheet.rowCount;
    for (let rowNumber = header.headerRow + 1; rowNumber <= lastRow; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const assetName = header.assetName ? cellText(row.getCell(header.assetName).value) : '';
        const itemName = header.item ? cellText(row.getCell(header.item).value) : '';
        if (!assetName && !itemName && !cellText(row.getCell(1).value)) continue;

        const current = cellText(row.getCell(header.lifeCol).value);
        if (alreadyFilled(current)) {
            stats.kept += 1;
            continue;
        }

        const code = header.code ? cellText(row.getCell(header.code).value) : '';
        const { value, via } = resolveLife({ code, itemName, assetName });
        if (value == null) {
            stats.blank += 1;
            continue;
        }

        row.getCell(header.lifeCol).value = value;
        if (value === '미고시') stats.filledUnnotified += 1;
        else stats.filledYears += 1;
        if (via === 'code') stats.byCode += 1;
        else if (via === 'item') stats.byItem += 1;
        else if (via === 'asset') stats.byAsset += 1;
    }

    let outName = outNamePreferred;
    let outPath = path.join(desktop, outName);
    try {
        await workbook.xlsx.writeFile(outPath);
    } catch (error) {
        outName = outNamePreferred.replace(/\.xlsx$/i, '_내용연수보완.xlsx');
        outPath = path.join(desktop, outName);
        await workbook.xlsx.writeFile(outPath);
        console.error('원본 파일이 열려 있어 보완 파일로 저장했습니다:', error.message);
    }
    console.log(JSON.stringify({
        source: sourceName,
        out: outName,
        aliases: aliasCount,
        catalog: !!catalogPath,
        ...stats
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
