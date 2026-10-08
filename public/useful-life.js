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
const USEFUL_LIFE_MIN_CONTAIN_LEN = 2;
const USEFUL_LIFE_MIN_CONTAIN_RATIO = 0.4;
const USEFUL_LIFE_MAX_CANDIDATES = 12;
const USEFUL_LIFE_MIN_SIMILARITY = 0.4;
// 비정상적으로 긴 물품명이 부분 문자열 탐색을 폭주시키지 않게 자른다
const USEFUL_LIFE_MAX_KEY_LEN = 40;
// 만료 1년 전부터 임박으로 본다. 교체 예산을 다음 해에 잡아야 하기 때문이다
const USEFUL_LIFE_DUE_SOON_DAYS = 365;
const USEFUL_LIFE_SEARCH_LIMIT = 20;
const USEFUL_LIFE_EXPAND_LIMIT = 24;

// 현장에서 자주 쓰는 약칭/영문 → 나라장터 정식 품명(자동 확정). 값은 normalize 전 표기이며 표에 있어야 한다.
const USEFUL_LIFE_SYNONYMS = {
    '노트북': '노트북컴퓨터',
    '노트북pc': '노트북컴퓨터',
    '노트북피씨': '노트북컴퓨터',
    '랩탑': '노트북컴퓨터',
    '랩톱': '노트북컴퓨터',
    'laptop': '노트북컴퓨터',
    'notebook': '노트북컴퓨터',
    'notebookpc': '노트북컴퓨터',
    '데스크탑': '데스크톱컴퓨터',
    '데스크톱': '데스크톱컴퓨터',
    '데스크탑컴퓨터': '데스크톱컴퓨터',
    '데스크탑pc': '데스크톱컴퓨터',
    'desktop': '데스크톱컴퓨터',
    'desktoppc': '데스크톱컴퓨터',
    'pc본체': '데스크톱컴퓨터',
    '본체': '데스크톱컴퓨터',
    '빔프로젝터': '비디오프로젝터',
    '빔프로젝타': '비디오프로젝터',
    '프로젝타': '비디오프로젝터',
    '프로젝터기': '비디오프로젝터',
    'beamprojector': '비디오프로젝터',
    'projector': '비디오프로젝터',
    '팩스': '팩스기기',
    '팩스기': '팩스기기',
    '팩시밀리': '팩스기기',
    'fax': '팩스기기',
    'facsimile': '팩스기기',
    '승용차': '승용자동차',
    'sedan': '승용자동차',
    '서버': '컴퓨터서버',
    '서버컴퓨터': '컴퓨터서버',
    'server': '컴퓨터서버',
    'lcd모니터': 'LCD패널또는모니터',
    '엘시디모니터': 'LCD패널또는모니터',
    'lcdmonitor': 'LCD패널또는모니터',
    'led모니터': 'LCD패널또는모니터',
    'ledmonitor': 'LCD패널또는모니터',
    '에어컨': '냉방기',
    '에어콘': '냉방기',
    '에어콘디셔너': '냉방기',
    'airconditioner': '냉방기',
    'aircon': '냉방기',
    '레이저프린트': '레이저프린터',
    '레이져프린터': '레이저프린터',
    'laserprinter': '레이저프린터',
    '파티션': '패널시스템용칸막이',
    'partition': '패널시스템용칸막이',
    'officepartition': '패널시스템용칸막이',
    '칸막이파티션': '패널시스템용칸막이',
    '화이트보드': '화이트보드',
    'whiteboard': '화이트보드',
    '복사기': '복사기',
    'copier': '복사기',
    'photocopier': '복사기',
    '스캐너': '스캐너',
    'scanner': '스캐너',
    '공기청정기': '공기청정기',
    'airpurifier': '공기청정기',
    '정수기': '정수기',
    'waterpurifier': '정수기'
};

// 토큰 단위 영↔한 / 유사어 치환. 자동 확정하지 않고 질의어를 늘려 후보를 넓힌다.
const USEFUL_LIFE_TOKEN_MAP = {
    laptop: ['노트북', '노트북컴퓨터'],
    notebook: ['노트북', '노트북컴퓨터'],
    desktop: ['데스크톱', '데스크톱컴퓨터', '데스크탑'],
    computer: ['컴퓨터'],
    pc: ['컴퓨터', '데스크톱컴퓨터'],
    monitor: ['모니터', '영상모니터', 'LCD패널또는모니터'],
    display: ['모니터', '영상모니터'],
    projector: ['프로젝터', '비디오프로젝터'],
    printer: ['프린터', '레이저프린터'],
    copier: ['복사기'],
    scanner: ['스캐너'],
    server: ['서버', '컴퓨터서버'],
    fax: ['팩스', '팩스기기'],
    facsimile: ['팩스기기'],
    refrigerator: ['냉장고', '대형냉장고', '김치냉장고'],
    fridge: ['냉장고', '대형냉장고'],
    freezer: ['냉동고', '실험실용일반냉장고또는냉동고'],
    airconditioner: ['에어컨', '냉방기', '공기조화기'],
    aircon: ['에어컨', '냉방기'],
    partition: ['파티션', '칸막이', '패널시스템용칸막이'],
    divider: ['칸막이', '패널시스템용칸막이'],
    panel: ['패널', '패널시스템용칸막이'],
    whiteboard: ['화이트보드'],
    blackboard: ['칠판'],
    desk: ['책상'],
    table: ['탁자', '책상'],
    chair: ['의자'],
    sofa: ['소파'],
    cabinet: ['캐비닛', '보관함'],
    locker: ['사물함', '보관함'],
    shelf: ['선반'],
    '노트북': ['laptop', 'notebook', '노트북컴퓨터'],
    '데스크탑': ['desktop', '데스크톱컴퓨터'],
    '데스크톱': ['desktop', '데스크톱컴퓨터'],
    '컴퓨터': ['computer', 'pc'],
    '모니터': ['monitor', 'display', '영상모니터', 'LCD패널또는모니터'],
    '프로젝터': ['projector', '비디오프로젝터'],
    '프린터': ['printer', '레이저프린터'],
    '복사기': ['copier'],
    '스캐너': ['scanner'],
    '서버': ['server', '컴퓨터서버'],
    '팩스': ['fax', '팩스기기'],
    '냉장고': ['refrigerator', 'fridge', '대형냉장고', '김치냉장고'],
    '에어컨': ['airconditioner', 'aircon', '냉방기'],
    '파티션': ['partition', '칸막이', '패널시스템용칸막이'],
    '칸막이': ['partition', '파티션', '패널시스템용칸막이', '화장실칸막이'],
    '화이트보드': ['whiteboard'],
    '책상': ['desk', 'table'],
    '의자': ['chair'],
    '소파': ['sofa']
};

// 제품군 힌트 — 토큰이 보이면 대표 후보를 강제로 올려 준다(자동 확정은 하지 않음)
const USEFUL_LIFE_FAMILIES = [
    {
        tokens: ['파티션', '칸막이', 'partition', 'divider'],
        prefer: ['패널시스템용칸막이', '화장실칸막이', '패널시스템용보관함', '낮은칸막이가구또는놀이용패널', '칸막이형열람대']
    },
    {
        tokens: ['모니터', 'monitor', 'display', 'lcd'],
        prefer: ['LCD패널또는모니터', '영상모니터', 'CRT모니터', '오디오모니터']
    },
    {
        tokens: ['프로젝터', 'projector', '빔프로젝'],
        prefer: ['비디오프로젝터', '오버헤드프로젝터', '홀로그램프로젝터']
    },
    {
        tokens: ['냉장고', 'refrigerator', 'fridge'],
        prefer: ['대형냉장고', '김치냉장고', '의료용냉장고', '실험실용일반냉장고또는냉동고']
    },
    {
        tokens: ['의자', 'chair'],
        prefer: ['작업용의자', '미용의자', '라운지용의자', '이발용의자']
    },
    {
        tokens: ['책상', 'desk'],
        prefer: ['책상', '컴퓨터책상', '학생용책상', '제도용책상']
    },
    {
        tokens: ['프린터', 'printer'],
        prefer: ['레이저프린터', '업무용인쇄지열전도프린터', '점자프린터']
    },
    {
        tokens: ['서버', 'server'],
        prefer: ['컴퓨터서버', 'AI서버', '프린트서버']
    },
    {
        tokens: ['에어컨', '냉방', 'aircon', 'airconditioner'],
        prefer: ['냉방기', '공기조화기', '차량용냉방기', '증발냉방장치']
    },
    {
        tokens: ['카메라', 'camera', '디카', '디지탈카메라', '디지털카메라'],
        prefer: ['디지털카메라', '스틸카메라', '즉석카메라', '디지털캠코더또는비디오카메라', '웹카메라']
    },
    {
        tokens: ['전화기', '전화', 'phone', 'telephone'],
        prefer: ['유선전화기', '디지털전화기', 'IP전화기', '화상전화기', '휴대전화기', '공중전화기']
    },
    {
        tokens: ['세단기', '파쇄', 'shredder'],
        prefer: ['문서세단기및보조용품']
    },
    {
        tokens: ['녹화', '녹화기', '녹음기', 'dvr'],
        prefer: ['감시용녹화기또는녹음기', '개인용비디오녹화기PVR', '콤팩트디스크재생또는녹음기']
    },
    {
        tokens: ['서랍', '서랍장', '파일서랍'],
        prefer: ['이동형파일서랍', '서랍형수납장', '파일링캐비닛또는액세서리']
    },
    {
        tokens: ['탁자', '테이블', 'table'],
        prefer: ['응접탁자', '회의용탁자', '책상', '컴퓨터책상']
    }
];

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
        || ((b.reason === 'family') - (a.reason === 'family'))
        || ((b.reason === 'locale') - (a.reason === 'locale'))
        || ((b.reason === 'synonym') - (a.reason === 'synonym'))
        || (a.goodsClNm.length - b.goodsClNm.length)
        || String(a.goodsClNo).localeCompare(String(b.goodsClNo)));
}

function resolveUsefulLifeSynonym(key) {
    const mapped = USEFUL_LIFE_SYNONYMS[key];
    if (!mapped || !usefulLifeByName) return null;
    const targetKey = normalizeGoodsName(mapped);
    const row = usefulLifeByName.get(targetKey);
    return row ? { row, name: targetKey } : null;
}

// 영↔한·유사 토큰을 치환해 같은 물품을 여러 표기로 다시 찾는다
function expandUsefulLifeKeys(itemName) {
    const original = normalizeGoodsName(itemName);
    if (!original) return [];

    const keys = new Set([original]);
    const tokenEntries = Object.keys(USEFUL_LIFE_TOKEN_MAP)
        .map((token) => [token, normalizeGoodsName(token)])
        .filter(([, norm]) => norm.length >= 2)
        .sort((a, b) => b[1].length - a[1].length);

    let wave = [original];
    for (let depth = 0; depth < 2 && wave.length; depth += 1) {
        const next = [];
        wave.forEach((key) => {
            tokenEntries.forEach(([token, normToken]) => {
                if (!key.includes(normToken)) return;
                (USEFUL_LIFE_TOKEN_MAP[token] || []).forEach((rep) => {
                    const repKey = normalizeGoodsName(rep);
                    if (!repKey) return;
                    const replaced = key.split(normToken).join(repKey);
                    if (replaced && !keys.has(replaced)) {
                        keys.add(replaced);
                        next.push(replaced);
                    }
                    if (!keys.has(repKey)) {
                        keys.add(repKey);
                        next.push(repKey);
                    }
                });
            });
        });
        wave = next.slice(0, USEFUL_LIFE_EXPAND_LIMIT);
        if (keys.size >= USEFUL_LIFE_EXPAND_LIMIT) break;
    }

    return [...keys].slice(0, USEFUL_LIFE_EXPAND_LIMIT);
}

function findFamilyCandidates(itemName, key, limit) {
    if (!usefulLifeByName) return [];
    const haystack = `${normalizeGoodsName(itemName)} ${key}`;
    const hits = [];

    USEFUL_LIFE_FAMILIES.forEach((family) => {
        const matched = (family.tokens || []).some((token) => {
            const norm = normalizeGoodsName(token);
            return norm && haystack.includes(norm);
        });
        if (!matched) return;

        (family.prefer || []).forEach((name, index) => {
            const row = usefulLifeByName.get(normalizeGoodsName(name));
            if (!row) return;
            // 앞에 적은 대표 후보일수록 점수를 조금 더 준다
            hits.push(candidateFrom(row, 0.78 - index * 0.03, 'family'));
        });

        // 토큰이 이름에 들어간 표 항목도 소량 보강
        (family.tokens || []).forEach((token) => {
            const norm = normalizeGoodsName(token);
            if (!norm || norm.length < 2) return;
            usefulLifeTable.normNames.forEach((name, rowIndex) => {
                if (!name.includes(norm) || name === key) return;
                hits.push(candidateFrom(
                    usefulLifeTable.rows[rowIndex],
                    Math.min(0.7, norm.length / Math.max(name.length, 1)),
                    'family'
                ));
            });
        });
    });

    return sortUsefulLifeCandidates(dedupeUsefulLifeCandidates(hits)).slice(0, Number(limit) || USEFUL_LIFE_MAX_CANDIDATES);
}

function usefulLifeDetailText(row) {
    return String((row && row[3]) || '');
}

// 직접 검색용 — 품명·분류번호·설명문(있으면)을 느슨하게 찾는다
function searchUsefulLifeClasses(query, limit) {
    if (!usefulLifeTable) return [];
    const raw = String(query || '').trim();
    const key = normalizeGoodsName(raw);
    const codeKey = raw.replace(/\D/g, '');
    if (!key && codeKey.length < 4) return [];

    const max = Math.max(1, Number(limit) || USEFUL_LIFE_SEARCH_LIMIT);
    const hits = [];
    usefulLifeTable.rows.forEach((row, index) => {
        const name = usefulLifeTable.normNames[index];
        const code = String(row[0] || '');
        const detail = normalizeGoodsName(usefulLifeDetailText(row));
        let score = 0;
        if (key) {
            if (name === key) score = 1;
            else if (name.startsWith(key)) score = 0.92;
            else if (name.includes(key)) score = 0.75 * (key.length / Math.max(name.length, 1));
            else if (detail.includes(key)) score = 0.55;
        }
        if (codeKey && code.startsWith(codeKey)) score = Math.max(score, 0.88);
        if (score <= 0) return;
        hits.push(candidateFrom(row, score, 'search'));
    });
    return sortUsefulLifeCandidates(hits).slice(0, max);
}

function dedupeUsefulLifeCandidates(list) {
    const seen = new Set();
    return list.filter((item) => {
        const id = item.goodsClNo;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
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

function findSimilarNames(key, options = {}) {
    const minScore = Number(options.minScore) || USEFUL_LIFE_MIN_SIMILARITY;
    const limit = Number(options.limit) || USEFUL_LIFE_MAX_CANDIDATES;
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
        if (score >= minScore) {
            hits.push(candidateFrom(usefulLifeTable.rows[rowIndex], score, 'similar'));
        }
    });
    return sortUsefulLifeCandidates(hits).slice(0, limit);
}

// 엑셀 드롭다운용. 자동 확정은 건드리지 않고, 유사 표기·제품군·비슷한 이름을 최대 20개까지 모은다.
function collectUsefulLifeBroadCandidates(itemName, limit) {
    const max = Math.max(1, Number(limit) || 20);
    if (!usefulLifeTable) return [];
    const key = normalizeGoodsName(itemName);
    if (!key) return [];

    const hits = [];
    const pushRow = (row, score, reason) => {
        if (row) hits.push(candidateFrom(row, score, reason));
    };

    pushRow(usefulLifeByName.get(key), 1, 'exact');
    const synonym = resolveUsefulLifeSynonym(key);
    if (synonym) pushRow(synonym.row, 0.97, 'synonym');

    const expanded = expandUsefulLifeKeys(itemName);
    expanded.forEach((alt) => {
        if (!alt || alt === key) return;
        pushRow(usefulLifeByName.get(alt), 0.9, 'locale');
        const altSynonym = resolveUsefulLifeSynonym(alt);
        if (altSynonym) pushRow(altSynonym.row, 0.88, 'locale');
        findContainedNames(alt).slice(0, 8).forEach((hit) => {
            pushRow(hit.row, 0.8, 'contains');
        });
    });

    findContainedNames(key).forEach((hit) => {
        pushRow(hit.row, hit.name.length / Math.max(key.length, hit.name.length), 'contains');
    });
    findFamilyCandidates(itemName, key, max).forEach((hit) => hits.push(hit));
    findContainingNames(key).forEach((hit) => {
        pushRow(hit.row, key.length / Math.max(hit.name.length, 1), 'partial');
    });

    // 짧은 이름은 기준을 유지하고, 네 글자 이상만 비슷함을 조금 더 허용한다
    const similarFloor = key.length >= 4 ? 0.26 : USEFUL_LIFE_MIN_SIMILARITY;
    findSimilarNames(key, { minScore: similarFloor, limit: max }).forEach((hit) => hits.push(hit));
    expanded.slice(0, 6).forEach((alt) => {
        if (!alt || alt === key || alt.length < 3) return;
        findSimilarNames(alt, { minScore: Math.max(similarFloor, 0.3), limit: 8 }).forEach((hit) => {
            hits.push({ ...hit, score: Math.min(0.84, (hit.score || 0) + 0.04), reason: 'locale' });
        });
        findContainingNames(alt).slice(0, 6).forEach((hit) => {
            pushRow(hit.row, alt.length / Math.max(hit.name.length, 1), 'locale');
        });
    });
    searchUsefulLifeClasses(itemName, max).forEach((hit) => hits.push(hit));

    return sortUsefulLifeCandidates(dedupeUsefulLifeCandidates(hits)).slice(0, max);
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

    // 3. 정확 일치
    const exact = usefulLifeByName.get(key);
    if (exact) return usefulLifeMatchResult(usefulLifeEntry(exact, 'exact'), [], true);

    // 4. 현장 약칭/영문 동의어 → 정식 품명
    const synonym = resolveUsefulLifeSynonym(key);
    if (synonym) {
        return usefulLifeMatchResult(usefulLifeEntry(synonym.row, 'synonym'), [], true);
    }

    // 4.5 목록정보(영문·세부품명)에서 유일 매칭되면 그 분류번호를 쓴다
    if (typeof resolveUsefulLifeFromCatalog === 'function') {
        const catalogHit = resolveUsefulLifeFromCatalog(source.itemName);
        if (catalogHit?.auto && catalogHit.entry) {
            const life = lookupUsefulLifeByCode(catalogHit.entry.goodsClNo);
            if (life) {
                return usefulLifeMatchResult({ ...life, match: 'catalog' }, catalogHit.candidates || [], true);
            }
            return usefulLifeMatchResult({
                goodsClNo: catalogHit.entry.goodsClNo,
                goodsClNm: catalogHit.entry.goodsClNm,
                usefulLife: 0,
                notified: false,
                match: 'catalog'
            }, catalogHit.candidates || [], true);
        }
    }

    // 5. 영↔한·유사 토큰으로 늘린 질의어
    // 영문 질의는 한글 정식명으로 자동 확정하고, 한글 일반명→세부명 확장은 후보만 올린다
    const expandedKeys = expandUsefulLifeKeys(source.itemName);
    const mostlyLatin = /^[a-z0-9]+$/.test(key);
    const localeCandidates = [];
    for (let i = 0; i < expandedKeys.length; i += 1) {
        const alt = expandedKeys[i];
        if (!alt || alt === key) continue;
        const altSynonym = resolveUsefulLifeSynonym(alt);
        if (altSynonym && mostlyLatin) {
            return usefulLifeMatchResult(usefulLifeEntry(altSynonym.row, 'locale'), [], true);
        }
        const altExact = usefulLifeByName.get(alt);
        if (altExact) {
            if (mostlyLatin) {
                return usefulLifeMatchResult(usefulLifeEntry(altExact, 'locale'), [], true);
            }
            localeCandidates.push(candidateFrom(altExact, 0.86, 'locale'));
        } else if (altSynonym) {
            localeCandidates.push(candidateFrom(altSynonym.row, 0.84, 'locale'));
        }
    }

    // 6. 물품명이 고시 품명을 품는 경우 (원문 + 확장 질의)
    let contained = findContainedNames(key);
    expandedKeys.forEach((alt) => {
        if (!alt || alt === key) return;
        contained = contained.concat(findContainedNames(alt).map((hit) => ({
            ...hit,
            scoreBoost: 0.05
        })));
    });
    // 확장 질의로 같은 품명이 여러 번 잡히면 최장 유일 판정이 깨지므로 이름 기준으로 묶는다
    if (contained.length) {
        const byName = new Map();
        contained.forEach((hit) => {
            const prev = byName.get(hit.name);
            if (!prev || (hit.scoreBoost || 0) > (prev.scoreBoost || 0)) byName.set(hit.name, hit);
        });
        contained = [...byName.values()];
        const longest = Math.max(...contained.map((hit) => hit.name.length));
        const top = contained.filter((hit) => hit.name.length === longest);
        const candidates = sortUsefulLifeCandidates(dedupeUsefulLifeCandidates([
            ...contained.map((hit) => candidateFrom(
                hit.row,
                (hit.name.length / Math.max(key.length, hit.name.length)) + (hit.scoreBoost || 0),
                'contains'
            )),
            ...localeCandidates
        ])).slice(0, USEFUL_LIFE_MAX_CANDIDATES);
        if (top.length === 1 && longest / key.length >= USEFUL_LIFE_MIN_CONTAIN_RATIO) {
            return usefulLifeMatchResult(usefulLifeEntry(top[0].row, 'contains'), candidates, true);
        }
        return usefulLifeMatchResult(null, candidates, false);
    }

    // 7. 제품군 후보 + 부분포함 + 유사어 (확장 질의 포함)
    const family = findFamilyCandidates(source.itemName, key);
    const containing = findContainingNames(key);
    const similar = findSimilarNames(key);
    const localePartial = [];
    expandedKeys.slice(0, 8).forEach((alt) => {
        if (!alt || alt === key) return;
        findContainingNames(alt).forEach((hit) => {
            localePartial.push(candidateFrom(hit.row, alt.length / hit.name.length, 'locale'));
        });
        findSimilarNames(alt).slice(0, 4).forEach((hit) => {
            localePartial.push({ ...hit, reason: 'locale', score: Math.min(0.9, (hit.score || 0) + 0.05) });
        });
    });

    const merged = dedupeUsefulLifeCandidates([
        ...family,
        ...localeCandidates,
        ...containing.map((hit) => candidateFrom(hit.row, key.length / hit.name.length, 'partial')),
        ...similar,
        ...localePartial
    ]).slice(0, USEFUL_LIFE_MAX_CANDIDATES);

    if (merged.length) {
        return usefulLifeMatchResult(null, sortUsefulLifeCandidates(merged), false);
    }

    // 8. 목록정보 다중 정확일치만 후보로 (prefix/contain은 고르기 모달에서만)
    if (typeof lookupGoodsCatalogByName === 'function' && typeof usefulLifeCandidateFromCatalog === 'function') {
        const catalogHit = lookupGoodsCatalogByName(source.itemName);
        if (catalogHit.candidates?.length > 1) {
            const catalogCandidates = catalogHit.candidates
                .map((entry) => usefulLifeCandidateFromCatalog(entry, 0.82))
                .filter(Boolean);
            if (catalogCandidates.length) {
                return usefulLifeMatchResult(null, sortUsefulLifeCandidates(catalogCandidates), false);
            }
        }
    }

    return usefulLifeMatchResult(null, [], false);
}

const USEFUL_LIFE_VERDICT_LABEL = {
    resolved: '확정',
    unnotified: '미고시',
    ambiguous: '확인필요',
    missing: '못찾음'
};

const USEFUL_LIFE_STATUS_LABEL = {
    expired: '경과',
    due: '임박',
    ok: '정상',
    unknown: '미산정'
};

const USEFUL_LIFE_MATCH_LABEL = {
    code: '분류번호',
    alias: '학습사전',
    exact: '정확일치',
    contains: '품명포함',
    synonym: '동의어',
    locale: '언어변환',
    catalog: '목록정보',
    pick: '직접선택'
};

function usefulLifeCandidateText(candidates, limit = 5) {
    return (candidates || []).slice(0, limit)
        .map((candidate) => `${candidate.goodsClNm}=${candidate.notified ? candidate.usefulLife + '년' : '미고시'}`)
        .join(', ');
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
        entry: entry || null,
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
