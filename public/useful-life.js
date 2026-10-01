// 내용연수 스냅샷 — 나라장터 물품분류 전체를 로컬에 두고 오프라인에서도 조회한다
// 스냅샷은 scripts/fetch-useful-life.js로 갱신한다

const USEFUL_LIFE_URL = 'useful-life.json';
const USEFUL_LIFE_DB = 'find-app-usefullife';
const USEFUL_LIFE_STORE = 'snapshot';
const USEFUL_LIFE_KEY = 'current';
const USEFUL_LIFE_ALIAS_CACHE_KEY = 'usefulLifeAliases';
// 고시는 자주 바뀌지 않으므로 일주일에 한 번만 배경 갱신한다
const USEFUL_LIFE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// 대장 물품명이 고시 품명을 통째로 품고 있을 때만 자동 확정한다(실체현미경 SZ61 ⊃ 실체현미경).
// 너무 짧거나 이름의 일부만 겹치면 회의자료 ⊃ 의자 같은 오탐이 생기므로 길이와 비율로 막는다
const USEFUL_LIFE_MIN_CONTAIN_LEN = 3;
const USEFUL_LIFE_MIN_CONTAIN_RATIO = 0.4;
const USEFUL_LIFE_MAX_CANDIDATES = 12;
const USEFUL_LIFE_MIN_SIMILARITY = 0.4;
// 비정상적으로 긴 물품명이 부분 문자열 탐색을 폭주시키지 않게 자른다
const USEFUL_LIFE_MAX_KEY_LEN = 40;
// 만료 1년 전부터 임박으로 본다. 교체 예산을 다음 해에 잡아야 하기 때문이다
const USEFUL_LIFE_DUE_SOON_DAYS = 365;

let usefulLifeTable = null;
let usefulLifeByCode = null;
let usefulLifeByName = null;
let usefulLifeBigramIndex = null;
let usefulLifeAliasMap = new Map();
let usefulLifeAliasRecords = [];
let usefulLifeLoading = null;

// scripts/fetch-useful-life.js의 normalizeGoodsName과 같은 규칙이어야 한다
function normalizeGoodsName(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s\-_.()[\]{}<>·ㆍ,/\\'"`~!@#$%^&*+=|?:;]/g, '');
}

function openUsefulLifeDb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined' || !indexedDB) {
            reject(new Error('IndexedDB를 쓸 수 없습니다'));
            return;
        }
        const request = indexedDB.open(USEFUL_LIFE_DB, 1);
        request.onupgradeneeded = () => {
            const dbx = request.result;
            if (!dbx.objectStoreNames.contains(USEFUL_LIFE_STORE)) {
                dbx.createObjectStore(USEFUL_LIFE_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function idbReadUsefulLife() {
    return openUsefulLifeDb().then((dbx) => new Promise((resolve, reject) => {
        const tx = dbx.transaction(USEFUL_LIFE_STORE, 'readonly');
        const req = tx.objectStore(USEFUL_LIFE_STORE).get(USEFUL_LIFE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => dbx.close();
    }));
}

function idbWriteUsefulLife(record) {
    return openUsefulLifeDb().then((dbx) => new Promise((resolve, reject) => {
        const tx = dbx.transaction(USEFUL_LIFE_STORE, 'readwrite');
        tx.objectStore(USEFUL_LIFE_STORE).put(record);
        tx.oncomplete = () => {
            dbx.close();
            resolve(true);
        };
        tx.onerror = () => reject(tx.error);
    }));
}

function applyUsefulLifeSnapshot(snapshot) {
    const rows = snapshot && Array.isArray(snapshot['표']) ? snapshot['표'] : [];
    if (!rows.length) throw new Error('내용연수 스냅샷이 비어 있습니다');

    const byCode = new Map();
    const byName = new Map();
    // 매칭할 때마다 11,591건을 다시 정규화하면 느려서 한 번만 해 둔다
    const normNames = new Array(rows.length);
    rows.forEach((row, index) => {
        const code = String(row[0] || '');
        if (code) byCode.set(code, row);
        // 정규화한 품명은 사실상 유일하다(연수 충돌 0건). 중복이 생기면 먼저 나온 쪽을 쓴다
        const key = normalizeGoodsName(row[1]);
        normNames[index] = key;
        if (key && !byName.has(key)) byName.set(key, row);
    });

    usefulLifeByCode = byCode;
    usefulLifeByName = byName;
    usefulLifeBigramIndex = null;
    usefulLifeTable = {
        기준일: snapshot['기준일'] || '',
        건수: rows.length,
        고시건수: snapshot['고시건수'] || 0,
        rows,
        normNames
    };
    return usefulLifeTable;
}

async function refreshUsefulLifeSnapshot() {
    const res = await fetch(USEFUL_LIFE_URL);
    if (!res.ok) throw new Error('내용연수 스냅샷 응답 ' + res.status);
    const text = await res.text();
    const table = applyUsefulLifeSnapshot(JSON.parse(text));
    idbWriteUsefulLife({
        id: USEFUL_LIFE_KEY,
        version: table.기준일,
        fetchedAt: Date.now(),
        text
    }).catch((err) => console.warn('내용연수 스냅샷 저장 실패:', err));
    return table;
}

async function loadUsefulLifeTable() {
    const cached = await idbReadUsefulLife().catch(() => null);
    if (cached && cached.text) {
        try {
            const table = applyUsefulLifeSnapshot(JSON.parse(cached.text));
            if (Date.now() - (cached.fetchedAt || 0) > USEFUL_LIFE_MAX_AGE) {
                refreshUsefulLifeSnapshot().catch(() => {});
            }
            return table;
        } catch (err) {
            console.warn('내용연수 캐시가 손상되어 다시 받습니다:', err);
        }
    }
    return refreshUsefulLifeSnapshot();
}

function ensureUsefulLifeTable() {
    if (usefulLifeTable) return Promise.resolve(usefulLifeTable);
    if (!usefulLifeLoading) {
        usefulLifeLoading = loadUsefulLifeTable()
            .catch((err) => {
                console.warn('내용연수 표를 불러오지 못했습니다:', err);
                return null;
            })
            .finally(() => { usefulLifeLoading = null; });
    }
    return usefulLifeLoading;
}

function isUsefulLifeReady() {
    return !!usefulLifeTable;
}

function getUsefulLifeMeta() {
    if (!usefulLifeTable) return null;
    return {
        기준일: usefulLifeTable.기준일,
        건수: usefulLifeTable.건수,
        고시건수: usefulLifeTable.고시건수
    };
}

// 연수 0은 "미고시"라는 뜻이고, null 반환은 "표에 없음"이라는 뜻이다. 둘을 구분해야 한다
function usefulLifeEntry(row, matchType) {
    if (!row) return null;
    const years = Number(row[2]) || 0;
    return {
        goodsClNo: row[0],
        goodsClNm: row[1],
        usefulLife: years,
        notified: years > 0,
        match: matchType
    };
}

function lookupUsefulLifeByCode(code) {
    if (!usefulLifeByCode) return null;
    const key = String(code || '').trim();
    return key ? usefulLifeEntry(usefulLifeByCode.get(key), 'code') : null;
}

function lookupUsefulLifeByName(name) {
    if (!usefulLifeByName) return null;
    const key = normalizeGoodsName(name);
    return key ? usefulLifeEntry(usefulLifeByName.get(key), 'exact') : null;
}

// 학습된 사전(물품명 → 분류번호)을 엔진에 물린다. masters.js 쪽에서 채워 준다
function setUsefulLifeAliases(pairs) {
    const byKey = new Map();
    (pairs || []).forEach((pair) => {
        const key = normalizeGoodsName(pair && pair.nameKey);
        const code = String((pair && pair.goodsClNo) || '').trim();
        if (!key || !code) return;
        const previous = byKey.get(key);
        // 같은 이름을 다르게 고른 사람이 있으면 가장 최근 결정을 따른다
        if (previous && String(previous.decidedAt || '') > String(pair.decidedAt || '')) return;
        byKey.set(key, { ...pair, nameKey: key, goodsClNo: code });
    });
    usefulLifeAliasRecords = [...byKey.values()];
    usefulLifeAliasMap = new Map(usefulLifeAliasRecords.map((record) => [record.nameKey, record.goodsClNo]));
    return usefulLifeAliasRecords.length;
}

function getUsefulLifeAliases() {
    return usefulLifeAliasRecords;
}

// 오프라인에서도 사전이 살아 있어야 해서 Firestore와 별개로 한 벌 남긴다
function cacheUsefulLifeAliases() {
    try {
        localStorage.setItem(USEFUL_LIFE_ALIAS_CACHE_KEY, JSON.stringify(usefulLifeAliasRecords));
    } catch (err) {
        console.warn('내용연수 사전 캐시 실패:', err);
    }
}

function restoreUsefulLifeAliases() {
    try {
        return setUsefulLifeAliases(JSON.parse(localStorage.getItem(USEFUL_LIFE_ALIAS_CACHE_KEY) || '[]'));
    } catch (err) {
        console.warn('내용연수 사전 복원 실패:', err);
        return 0;
    }
}

function bigramsOf(text) {
    const out = [];
    for (let i = 0; i < text.length - 1; i += 1) out.push(text.slice(i, i + 2));
    return out;
}

function buildUsefulLifeBigramIndex() {
    const index = new Map();
    usefulLifeTable.normNames.forEach((key, rowIndex) => {
        new Set(bigramsOf(key)).forEach((gram) => {
            const bucket = index.get(gram);
            if (bucket) bucket.push(rowIndex);
            else index.set(gram, [rowIndex]);
        });
    });
    return index;
}

function usefulLifeBigramHits(key) {
    if (!usefulLifeBigramIndex) usefulLifeBigramIndex = buildUsefulLifeBigramIndex();
    const grams = new Set(bigramsOf(key));
    const shared = new Map();
    grams.forEach((gram) => {
        const bucket = usefulLifeBigramIndex.get(gram);
        if (!bucket) return;
        bucket.forEach((rowIndex) => shared.set(rowIndex, (shared.get(rowIndex) || 0) + 1));
    });
    return { grams, shared };
}

function candidateFrom(row, score, reason) {
    const years = Number(row[2]) || 0;
    return {
        goodsClNo: row[0],
        goodsClNm: row[1],
        usefulLife: years,
        notified: years > 0,
        score: Math.round(score * 100) / 100,
        reason
    };
}

function sortUsefulLifeCandidates(list) {
    return list.sort((a, b) => (b.score - a.score)
        || (Number(b.notified) - Number(a.notified))
        || (a.goodsClNm.length - b.goodsClNm.length));
}

// 대장 물품명이 고시 품명을 품는 경우. 가장 긴 것 하나만 남으면 자동 확정 후보가 된다.
// 표를 훑는 대신 물품명의 부분 문자열을 이름 색인에서 찾는다 (11,591번 → 이름 길이의 제곱쯤)
function findContainedNames(key) {
    const limited = key.slice(0, USEFUL_LIFE_MAX_KEY_LEN);
    const seen = new Set();
    const hits = [];
    for (let start = 0; start < limited.length; start += 1) {
        for (let end = start + USEFUL_LIFE_MIN_CONTAIN_LEN; end <= limited.length; end += 1) {
            const part = limited.slice(start, end);
            if (part === key || seen.has(part)) continue;
            seen.add(part);
            const row = usefulLifeByName.get(part);
            if (row) hits.push({ row, name: part });
        }
    }
    return hits;
}

// 고시 품명이 대장 물품명을 품는 경우(냉장고 ⊂ 대형냉장고). 연수가 갈리므로 자동 확정하지 않는다.
// 부분 문자열이면 질의의 글자쌍을 빠짐없이 갖고 있으므로 색인으로 후보를 좁힐 수 있다
function findContainingNames(key) {
    const { grams, shared } = usefulLifeBigramHits(key);
    if (!grams.size) return [];

    const hits = [];
    shared.forEach((common, rowIndex) => {
        if (common !== grams.size) return;
        const name = usefulLifeTable.normNames[rowIndex];
        if (name === key || !name.includes(key)) return;
        hits.push({ row: usefulLifeTable.rows[rowIndex], name });
    });
    return hits;
}

function findSimilarNames(key) {
    const { grams, shared } = usefulLifeBigramHits(key);
    // 글자쌍이 둘뿐인 짧은 이름은 비슷함을 따져 봐야 무전기 → 전기로 같은 오답만 나온다
    if (grams.size < 3) return [];

    const hits = [];
    shared.forEach((common, rowIndex) => {
        // 글자쌍 하나만 겹치는 건 우연이다
        if (common < 2) return;
        const size = Math.max(1, usefulLifeTable.normNames[rowIndex].length - 1);
        // Dice 계수 — 짧은 이름이 무조건 유리해지지 않게 양쪽 길이를 함께 본다
        const score = (2 * common) / (grams.size + size);
        if (score >= USEFUL_LIFE_MIN_SIMILARITY) {
            hits.push(candidateFrom(usefulLifeTable.rows[rowIndex], score, 'similar'));
        }
    });
    return sortUsefulLifeCandidates(hits).slice(0, USEFUL_LIFE_MAX_CANDIDATES);
}

function usefulLifeVerdict(entry, candidates) {
    if (entry) return entry.notified ? 'resolved' : 'unnotified';
    return candidates.length ? 'ambiguous' : 'missing';
}

function usefulLifeMatchResult(entry, candidates, auto) {
    return {
        verdict: usefulLifeVerdict(entry, candidates),
        entry: entry || null,
        candidates: candidates || [],
        auto: !!auto
    };
}

/**
 * 물품명(과 있으면 분류번호)으로 내용연수를 찾는다.
 * verdict는 넷이다.
 *   resolved   연수까지 확정
 *   unnotified 분류는 찾았지만 고시 연수가 없음 (더 찾아도 소용없음)
 *   ambiguous  후보는 있는데 사람이 골라야 함
 *   missing    표에 없음 (이름을 바꿔 다시 찾아야 함)
 */
function matchUsefulLife(input) {
    const source = typeof input === 'string' ? { itemName: input } : (input || {});
    const empty = usefulLifeMatchResult(null, [], false);
    if (!usefulLifeTable) return empty;

    // 1. 대장에 분류번호가 있으면 그게 정답이다
    const byCode = lookupUsefulLifeByCode(source.goodsClNo);
    if (byCode) return usefulLifeMatchResult(byCode, [], true);

    const key = normalizeGoodsName(source.itemName);
    if (!key) return empty;

    // 2. 예전에 사람이 골라 둔 것
    const aliasCode = usefulLifeAliasMap.get(key);
    if (aliasCode) {
        const byAlias = lookupUsefulLifeByCode(aliasCode);
        if (byAlias) return usefulLifeMatchResult({ ...byAlias, match: 'alias' }, [], true);
    }

    // 3. 정확 일치. 정규화 품명은 유일하고 연수 충돌이 없어 애매함이 없다
    const exact = usefulLifeByName.get(key);
    if (exact) return usefulLifeMatchResult(usefulLifeEntry(exact, 'exact'), [], true);

    // 4. 물품명이 고시 품명을 품는 경우. 가장 긴 것이 하나뿐이면 확정한다
    const contained = findContainedNames(key);
    if (contained.length) {
        const longest = Math.max(...contained.map((hit) => hit.name.length));
        const top = contained.filter((hit) => hit.name.length === longest);
        const candidates = sortUsefulLifeCandidates(
            contained.map((hit) => candidateFrom(hit.row, hit.name.length / key.length, 'contains'))
        ).slice(0, USEFUL_LIFE_MAX_CANDIDATES);
        if (top.length === 1 && longest / key.length >= USEFUL_LIFE_MIN_CONTAIN_RATIO) {
            return usefulLifeMatchResult(usefulLifeEntry(top[0].row, 'contains'), candidates, true);
        }
        return usefulLifeMatchResult(null, candidates, false);
    }

    // 5. 고시 품명이 물품명을 품는 경우. 연수가 갈리므로 후보만 내놓는다
    const containing = findContainingNames(key);
    if (containing.length) {
        return usefulLifeMatchResult(null, sortUsefulLifeCandidates(
            containing.map((hit) => candidateFrom(hit.row, key.length / hit.name.length, 'partial'))
        ).slice(0, USEFUL_LIFE_MAX_CANDIDATES), false);
    }

    // 6. 마지막으로 글자쌍이 비슷한 것들
    return usefulLifeMatchResult(null, findSimilarNames(key), false);
}

function isoDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function splitDateKey(key) {
    const parts = String(key || '').split('-').map(Number);
    return parts.length === 3 && parts.every((part) => Number.isFinite(part)) ? parts : null;
}

// 취득일에 내용연수를 더한 날이 내구연한이 끝나는 날이다
function addYearsToDateKey(key, years) {
    const parts = splitDateKey(key);
    if (!parts) return '';
    const [year, month, day] = parts;
    const target = year + Number(years);
    // 2020-02-29에 1년을 더하면 없는 날이 되므로 그 달 마지막 날로 맞춘다
    const lastDay = new Date(Date.UTC(target, month, 0)).getUTCDate();
    return `${target}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function daysBetweenDateKeys(fromKey, toKey) {
    const from = splitDateKey(fromKey);
    const to = splitDateKey(toKey);
    if (!from || !to) return null;
    const ms = Date.UTC(to[0], to[1] - 1, to[2]) - Date.UTC(from[0], from[1] - 1, from[2]);
    return Math.round(ms / 86400000);
}

// 몇 년 몇 개월인지로 읽어 준다. 1년이 안 되면 개월, 한 달이 안 되면 일로 떨어진다
function durationLabel(fromKey, toKey) {
    const from = splitDateKey(fromKey);
    const to = splitDateKey(toKey);
    if (!from || !to) return '';
    let months = (to[0] - from[0]) * 12 + (to[1] - from[1]);
    if (to[2] < from[2]) months -= 1;
    if (months < 0) months = 0;
    const years = Math.floor(months / 12);
    const restMonths = months % 12;
    if (years && restMonths) return `${years}년 ${restMonths}개월`;
    if (years) return `${years}년`;
    if (restMonths) return `${restMonths}개월`;
    return `${Math.max(daysBetweenDateKeys(fromKey, toKey) || 0, 0)}일`;
}

function usefulLifeStatus(acquiredAt, years, today) {
    const todayKey = today || isoDateKey(new Date());
    if (!acquiredAt) return { status: 'unknown', reason: 'no-date', expiry: '', days: null, label: '취득일자 없음' };
    if (!(Number(years) > 0)) return { status: 'unknown', reason: 'no-life', expiry: '', days: null, label: '내용연수 없음' };

    const expiry = addYearsToDateKey(acquiredAt, years);
    const days = expiry ? daysBetweenDateKeys(todayKey, expiry) : null;
    if (days === null) return { status: 'unknown', reason: 'bad-date', expiry: '', days: null, label: '취득일자 형식 오류' };

    if (days === 0) return { status: 'expired', reason: null, expiry, days, label: '오늘 만료' };
    if (days < 0) return { status: 'expired', reason: null, expiry, days, label: `${durationLabel(expiry, todayKey)} 경과` };
    if (days <= USEFUL_LIFE_DUE_SOON_DAYS) {
        return { status: 'due', reason: null, expiry, days, label: `${durationLabel(todayKey, expiry)} 남음` };
    }
    return { status: 'ok', reason: null, expiry, days, label: `${durationLabel(todayKey, expiry)} 남음` };
}

// 매칭 결과와 취득일자를 합쳐 화면에 바로 쓸 형태로 만든다
function describeUsefulLife(input, today) {
    const source = input || {};
    const match = matchUsefulLife(source);
    const entry = match.entry;
    const years = entry ? entry.usefulLife : 0;
    const life = usefulLifeStatus(source.acquiredAt, years, today);

    let note = '';
    if (life.status === 'unknown') {
        if (life.reason === 'no-date') note = '취득일자가 없습니다';
        else if (life.reason === 'bad-date') note = '취득일자를 읽을 수 없습니다';
        else if (match.verdict === 'unnotified') note = '고시된 내용연수가 없습니다';
        else if (match.verdict === 'ambiguous') note = '물품명 확인이 필요합니다';
        else note = '내용연수 표에서 찾지 못했습니다';
    }

    return {
        verdict: match.verdict,
        auto: match.auto,
        candidates: match.candidates,
        goodsClNo: entry ? entry.goodsClNo : '',
        goodsClNm: entry ? entry.goodsClNm : '',
        usefulLife: years,
        notified: entry ? entry.notified : false,
        match: entry ? entry.match : '',
        acquiredAt: source.acquiredAt || '',
        expiry: life.expiry,
        status: life.status,
        days: life.days,
        label: life.label,
        note
    };
}
