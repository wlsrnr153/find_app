// 「미고시」칸만, 로컬 반영 분류로 고시 연수·품명·분류번호를 반영한다.
//   node scripts/update-unnotified-from-aliases.js

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
    console.error('대상 파일을 바탕화면에서 찾지 못했습니다.');
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

const catalogEngine = path.join(publicDir, 'goods-catalog.js');
if (fs.existsSync(catalogEngine)) {
    vm.runInContext(fs.readFileSync(catalogEngine, 'utf8'), sandbox, { filename: 'goods-catalog.js' });
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
let aliasCount = 0;
let aliasItems = [];
if (fs.existsSync(aliasPath)) {
    const aliasFile = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
    aliasItems = aliasFile.items || aliasFile;
    aliasCount = sandbox.setUsefulLifeAliases(aliasItems) || 0;
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
        const row = sheet.getRow(rowNumber);
        const cols = {};
        row.eachCell({ includeEmpty: false }, (cell, col) => {
            const text = cellText(cell.value).replace(/\s+/g, '');
            if (text === '내용연수') cols.life = col;
            if (text === '분류번호') cols.code = col;
            if (text === '품명') cols.item = col;
            if (text === '자산명') cols.assetName = col;
            if (text === '규격') cols.model = col;
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

/** 고시 연수 확정 결과. 미고시 유지면 null */
function resolveHit({ code, itemName, assetName, model }) {
    const names = [itemName, assetName, String(model || '').split(',')[0].trim()].filter(Boolean);

    if (code) {
        const match = sandbox.matchUsefulLife({ goodsClNo: code, itemName: '' });
        if (match?.verdict === 'resolved' && Number(match.entry?.usefulLife) > 0) {
            return {
                years: Number(match.entry.usefulLife),
                goodsClNm: match.entry.goodsClNm || '',
                goodsClNo: match.entry.goodsClNo || code,
                via: 'code'
            };
        }
    }

    for (const name of names) {
        const alias = aliasLookup(name);
        if (alias && Number(alias.usefulLife) > 0) {
            return {
                years: Number(alias.usefulLife),
                goodsClNm: alias.goodsClNm || '',
                goodsClNo: alias.goodsClNo || '',
                via: 'alias-life'
            };
        }
        if (alias?.goodsClNo) {
            const byAliasCode = sandbox.lookupUsefulLifeByCode?.(alias.goodsClNo)
                || sandbox.matchUsefulLife({ goodsClNo: alias.goodsClNo, itemName: '' })?.entry;
            if (byAliasCode && Number(byAliasCode.usefulLife) > 0) {
                return {
                    years: Number(byAliasCode.usefulLife),
                    goodsClNm: byAliasCode.goodsClNm || alias.goodsClNm || '',
                    goodsClNo: byAliasCode.goodsClNo || alias.goodsClNo,
                    via: 'alias-code'
                };
            }
        }

        const match = sandbox.matchUsefulLife({ itemName: name, goodsClNo: code });
        if (match?.verdict === 'resolved' && Number(match.entry?.usefulLife) > 0) {
            return {
                years: Number(match.entry.usefulLife),
                goodsClNm: match.entry.goodsClNm || '',
                goodsClNo: match.entry.goodsClNo || '',
                via: match.entry.match || 'match'
            };
        }
    }
    return null;
}

async function main() {
    const sourcePath = path.join(desktop, sourceName);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(sourcePath);
    const sheet = workbook.getWorksheet('물품관리대장-제출자료') || workbook.worksheets[0];
    const header = findHeader(sheet);
    if (!header?.life) throw new Error('내용연수 열을 찾지 못했습니다');

    const stats = {
        scanned: 0,
        updatedYears: 0,
        updatedClass: 0,
        keptUnnotified: 0,
        samples: []
    };
    const lastRow = sheet.actualRowCount || sheet.rowCount;

    for (let rowNumber = header.headerRow + 1; rowNumber <= lastRow; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const current = cellText(row.getCell(header.life).value);
        if (current !== '미고시') continue;

        const assetName = header.assetName ? cellText(row.getCell(header.assetName).value) : '';
        const itemName = header.item ? cellText(row.getCell(header.item).value) : '';
        const code = header.code ? cellText(row.getCell(header.code).value) : '';
        const model = header.model ? cellText(row.getCell(header.model).value) : '';
        if (!assetName && !itemName && !code) continue;

        stats.scanned += 1;
        const hit = resolveHit({ code, itemName, assetName, model });
        if (!hit) {
            stats.keptUnnotified += 1;
            continue;
        }

        row.getCell(header.life).value = hit.years;
        stats.updatedYears += 1;

        if (header.item && hit.goodsClNm && !cellText(row.getCell(header.item).value)) {
            row.getCell(header.item).value = hit.goodsClNm;
            stats.updatedClass += 1;
        }
        if (header.code && hit.goodsClNo && !cellText(row.getCell(header.code).value)) {
            row.getCell(header.code).value = hit.goodsClNo;
        }

        if (stats.samples.length < 15) {
            stats.samples.push({
                row: rowNumber,
                assetName,
                years: hit.years,
                class: hit.goodsClNm,
                via: hit.via
            });
        }
    }

    let outName = sourceName;
    let outPath = sourcePath;
    try {
        await workbook.xlsx.writeFile(outPath);
    } catch (error) {
        outName = sourceName.replace(/\.xlsx$/i, '_미고시반영.xlsx');
        outPath = path.join(desktop, outName);
        await workbook.xlsx.writeFile(outPath);
        console.error('원본이 열려 있어 별도 파일로 저장:', error.message);
    }

    console.log(JSON.stringify({
        source: sourceName,
        out: outName,
        aliases: aliasCount,
        ...stats
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
