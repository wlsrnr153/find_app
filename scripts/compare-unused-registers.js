const XLSX = require('xlsx');

const fileA =
  'C:\\Users\\bb\\Desktop\\전북대학교 산학협력단 완료보고\\붙임4. 불용물품 대상 내역_1.xlsx';
const fileB = 'C:\\Users\\bb\\Desktop\\불용대장(26.11.13).xlsx';
const outPath = 'C:\\Users\\bb\\Desktop\\불용_붙임4_vs_대장_차이_20261113.xlsx';

function normName(v) {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normAmt(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v);
  const n = Number(String(v).replace(/[,，\s원]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function key(name, amt) {
  return `${normName(name)}||${amt === null ? '' : String(amt)}`;
}

const wbA = XLSX.readFile(fileA, { cellDates: true });
const rowsA = XLSX.utils.sheet_to_json(wbA.Sheets[wbA.SheetNames[0]], {
  header: 1,
  defval: '',
});
const dataA = [];
for (let i = 6; i < rowsA.length; i++) {
  const r = rowsA[i];
  if (!r || (!r[1] && !r[9] && !r[5])) continue;
  const assetName = String(r[1] ?? '').trim();
  const itemName = String(r[9] ?? '').trim();
  dataA.push({
    row: i + 1,
    seq: r[0],
    assetName,
    itemName,
    name: itemName || assetName,
    amount: normAmt(r[5]),
    qty: r[3],
    unit: normAmt(r[4]),
    dept: String(r[6] ?? '').trim(),
    loc: String(r[7] ?? '').trim(),
  });
}

const wbB = XLSX.readFile(fileB, { cellDates: true });
const rowsB = XLSX.utils.sheet_to_json(wbB.Sheets[wbB.SheetNames[0]], {
  header: 1,
  defval: '',
});
const dataB = [];
for (let i = 1; i < rowsB.length; i++) {
  const r = rowsB[i];
  if (!r || (!r[1] && !r[5] && r[5] !== 0)) continue;
  const assetName = String(r[1] ?? '').trim();
  const seq = r[0];
  // 중복 헤더/빈 행 제외
  if (String(seq) === '순번' || assetName === '자산명' || !assetName) continue;
  dataB.push({
    row: i + 1,
    seq,
    assetName,
    itemName: '',
    name: assetName,
    amount: normAmt(r[5]),
    qty: r[3],
    unit: normAmt(r[4]),
    dept: String(r[6] ?? '').trim(),
    loc: String(r[7] ?? '').trim(),
  });
}

console.log('붙임4 rows', dataA.length, '불용대장 rows', dataB.length);

const byAssetAmt = new Map();
for (const row of dataA) {
  const k = key(row.assetName || row.name, row.amount);
  if (!byAssetAmt.has(k)) byAssetAmt.set(k, { a: [], b: [] });
  byAssetAmt.get(k).a.push(row);
}
for (const row of dataB) {
  const k = key(row.assetName || row.name, row.amount);
  if (!byAssetAmt.has(k)) byAssetAmt.set(k, { a: [], b: [] });
  byAssetAmt.get(k).b.push(row);
}

let matchedPairs = 0;
const onlyA = [];
const onlyB = [];
for (const { a, b } of byAssetAmt.values()) {
  const m = Math.min(a.length, b.length);
  matchedPairs += m;
  for (let i = m; i < a.length; i++) onlyA.push(a[i]);
  for (let i = m; i < b.length; i++) onlyB.push(b[i]);
}

console.log('exact 자산명+취득가액 matched', matchedPairs);
console.log('붙임4 leftover', onlyA.length, '불용대장 leftover', onlyB.length);

function indexByName(rows, pick) {
  const m = new Map();
  for (const r of rows) {
    const n = normName(pick(r));
    if (!n) continue;
    if (!m.has(n)) m.set(n, []);
    m.get(n).push(r);
  }
  return m;
}

const onlyBByName = indexByName(onlyB, (r) => r.assetName);
const usedB = new Set();
const amountDiff = [];
const stillOnlyA = [];

for (const a of onlyA) {
  const n = normName(a.assetName || a.name);
  const blist = onlyBByName.get(n) || [];
  let found = null;
  for (const b of blist) {
    if (usedB.has(b)) continue;
    found = b;
    usedB.add(b);
    break;
  }
  if (found) {
    if (a.amount !== found.amount) amountDiff.push({ a, b: found });
  } else {
    stillOnlyA.push(a);
  }
}

const stillOnlyB = onlyB.filter((b) => !usedB.has(b));

function tryItemNameMatch(leftA, leftB) {
  const bByName = indexByName(leftB, (r) => r.assetName);
  const used = new Set();
  const rematched = [];
  const remA = [];
  for (const a of leftA) {
    const candidates = [a.itemName, a.assetName, a.name].filter(Boolean);
    let hit = null;
    let sameAmtHit = null;
    for (const c of candidates) {
      const list = bByName.get(normName(c)) || [];
      sameAmtHit = list.find((x) => !used.has(x) && x.amount === a.amount);
      if (sameAmtHit) {
        hit = sameAmtHit;
        break;
      }
      if (!hit) hit = list.find((x) => !used.has(x));
    }
    if (hit) {
      used.add(hit);
      rematched.push({ a, b: hit, sameAmt: a.amount === hit.amount });
    } else {
      remA.push(a);
    }
  }
  const remB = leftB.filter((b) => !used.has(b));
  return { rematched, remA, remB };
}

const round2 = tryItemNameMatch(stillOnlyA, stillOnlyB);
const finalAmtDiff = [
  ...amountDiff,
  ...round2.rematched.filter((x) => !x.sameAmt),
];
finalAmtDiff.sort(
  (x, y) =>
    Math.abs((y.a.amount || 0) - (y.b.amount || 0)) -
    Math.abs((x.a.amount || 0) - (x.b.amount || 0))
);

console.log('same name different amount', finalAmtDiff.length);
console.log(
  '품명 재매칭',
  round2.rematched.length,
  '금액같음',
  round2.rematched.filter((x) => x.sameAmt).length
);
console.log('최종 붙임4에만', round2.remA.length, '불용대장에만', round2.remB.length);

const outRows = [
  [
    '구분',
    '붙임4_행',
    '붙임4_순번',
    '붙임4_자산명',
    '붙임4_품명',
    '붙임4_수량',
    '붙임4_취득가액',
    '불용대장_행',
    '불용대장_순번',
    '불용대장_자산명',
    '불용대장_수량',
    '불용대장_취득가액',
    '차액(붙임4-대장)',
    '비고',
  ],
];

for (const { a, b } of finalAmtDiff) {
  outRows.push([
    '금액불일치',
    a.row,
    a.seq,
    a.assetName,
    a.itemName,
    a.qty,
    a.amount,
    b.row,
    b.seq,
    b.assetName,
    b.qty,
    b.amount,
    (a.amount || 0) - (b.amount || 0),
    '동일 자산명·취득가액 상이',
  ]);
}
for (const a of round2.remA) {
  outRows.push([
    '붙임4에만',
    a.row,
    a.seq,
    a.assetName,
    a.itemName,
    a.qty,
    a.amount,
    '',
    '',
    '',
    '',
    '',
    '',
    '불용대장에 대응 없음',
  ]);
}
for (const b of round2.remB) {
  outRows.push([
    '불용대장에만',
    '',
    '',
    '',
    '',
    '',
    '',
    b.row,
    b.seq,
    b.assetName,
    b.qty,
    b.amount,
    '',
    '붙임4에 대응 없음',
  ]);
}

const outWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(outWb, XLSX.utils.aoa_to_sheet(outRows), '차이내역');
XLSX.utils.book_append_sheet(
  outWb,
  XLSX.utils.aoa_to_sheet([
    ['항목', '값'],
    ['붙임4 건수', dataA.length],
    ['불용대장 건수', dataB.length],
    ['자산명+취득가액 완전일치', matchedPairs],
    ['동일품명·금액불일치', finalAmtDiff.length],
    ['붙임4에만 있음', round2.remA.length],
    ['불용대장에만 있음', round2.remB.length],
  ]),
  '요약'
);
XLSX.writeFile(outWb, outPath);
console.log('wrote', outPath);

console.log('\n=== 금액불일치 TOP 25 ===');
for (const { a, b } of finalAmtDiff.slice(0, 25)) {
  console.log(
    `[${a.assetName || a.name}] 붙임4=${a.amount} / 대장=${b.amount} (차 ${(a.amount || 0) - (b.amount || 0)}) seq ${a.seq}↔${b.seq}`
  );
}
console.log('\n=== 붙임4에만 (최대 40) ===');
for (const a of round2.remA.slice(0, 40)) {
  console.log(
    `row${a.row} seq${a.seq} [${a.assetName}] 품명=${a.itemName || '-'} 금액=${a.amount}`
  );
}
console.log('\n=== 불용대장에만 (최대 40) ===');
for (const b of round2.remB.slice(0, 40)) {
  console.log(`row${b.row} seq${b.seq} [${b.assetName}] 금액=${b.amount}`);
}
