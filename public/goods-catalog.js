// 나라장터 목록정보(품명·세부품명·영문·분류해설) 로컬 스냅샷
// 스냅샷은 scripts/fetch-goods-catalog.js 로 갱신한다

const GOODS_CATALOG_URL = 'goods-catalog.json';
const GOODS_CATALOG_DETAIL_URL = 'https://goods.g2b.go.kr:8053/search/classificationSearchView.do?goodsClsfcNo=';
const GOODS_CATALOG_SEARCH_URL = 'https://goods.g2b.go.kr:8053/search/classificationSearch.do';

let goodsCatalogTable = null;
let goodsCatalogLoading = null;
let goodsCatalogByCode = new Map();
let goodsCatalogByName = new Map(); // normalizeName → goodsClNo[]
let goodsCatalogByEng = new Map();
let goodsCatalogByDetailNo = new Map(); // 세부품명번호(10) → { entry, detail }
let goodsCatalogNameKeys = []; // 검색용 정규화 키 목록
let goodsCatalogEngKeys = [];
let goodsCatalogCodes = []; // 코드 prefix 검색용
let goodsCatalogDetailNos = []; // 세부품명번호 prefix 검색용

function goodsCatalogNormalize(value) {
    if (typeof normalizeGoodsName === 'function') return normalizeGoodsName(value);
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s\-_.()[\]{}<>·ㆍ,/\\'"`~!@#$%^&*+=|?:;]/g, '');
}

function goodsCatalogAddNameIndex(map, name, code) {
    const key = goodsCatalogNormalize(name);
    if (!key || !code) return;
    const list = map.get(key) || [];
    if (!list.includes(code)) list.push(code);
    map.set(key, list);
}

function applyGoodsCatalogSnapshot(snapshot) {
    const rows = snapshot && Array.isArray(snapshot['표']) ? snapshot['표'] : [];
    if (!rows.length) throw new Error('목록정보 스냅샷이 비어 있습니다');

    const byCode = new Map();
    const byName = new Map();
    const byEng = new Map();
    const byDetail = new Map();

    rows.forEach((item) => {
        const code = String(item.goodsClNo || '').trim();
        if (!/^\d{8}$/.test(code)) return;
        const entry = {
            goodsClNo: code,
            goodsClNm: String(item.goodsClNm || '').trim(),
            engNm: String(item.engNm || '').trim(),
            explain: String(item.explain || '').trim(),
            details: Array.isArray(item.details) ? item.details : []
        };
        byCode.set(code, entry);
        goodsCatalogAddNameIndex(byName, entry.goodsClNm, code);
        goodsCatalogAddNameIndex(byEng, entry.engNm, code);
        entry.details.forEach((detail) => {
            goodsCatalogAddNameIndex(byName, detail.goodsClDetailNm, code);
            goodsCatalogAddNameIndex(byEng, detail.engNm, code);
            const detailNo = String(detail.goodsClDetailNo || '').replace(/\D/g, '');
            if (detailNo.length >= 8) {
                byDetail.set(detailNo, {
                    entry,
                    detail: {
                        goodsClDetailNo: detailNo,
                        goodsClDetailNm: String(detail.goodsClDetailNm || '').trim(),
                        engNm: String(detail.engNm || '').trim()
                    }
                });
            }
        });
    });

    goodsCatalogByCode = byCode;
    goodsCatalogByName = byName;
    goodsCatalogByEng = byEng;
    goodsCatalogByDetailNo = byDetail;
    goodsCatalogNameKeys = [...byName.keys()];
    goodsCatalogEngKeys = [...byEng.keys()];
    goodsCatalogCodes = [...byCode.keys()];
    goodsCatalogDetailNos = [...byDetail.keys()];
    goodsCatalogTable = {
        기준일: snapshot['기준일'] || '',
        분류건수: byCode.size,
        세부품명건수: byDetail.size || snapshot['세부품명건수'] || 0,
        해설건수: snapshot['해설건수'] || 0
    };
    return goodsCatalogTable;
}

async function refreshGoodsCatalogSnapshot() {
    const res = await fetch(GOODS_CATALOG_URL);
    if (!res.ok) throw new Error('목록정보 스냅샷 응답 ' + res.status);
    return applyGoodsCatalogSnapshot(await res.json());
}

function ensureGoodsCatalog() {
    if (goodsCatalogTable) return Promise.resolve(goodsCatalogTable);
    if (!goodsCatalogLoading) {
        goodsCatalogLoading = refreshGoodsCatalogSnapshot()
            .catch((error) => {
                console.warn('목록정보 스냅샷을 불러오지 못했습니다:', error);
                return null;
            })
            .finally(() => {
                goodsCatalogLoading = null;
            });
    }
    return goodsCatalogLoading;
}

function lookupGoodsCatalogByCode(code) {
    const digits = String(code || '').replace(/\D/g, '');
    if (!digits) return null;
    const eight = digits.length >= 8 ? digits.slice(0, 8) : digits;
    return goodsCatalogByCode.get(eight) || null;
}

/**
 * 세부품명번호(식별에 가까운 10자리)로 조회.
 * 분류번호(8자리)보다 구체적이므로 ID 우선 매칭에 쓴다.
 */
function lookupGoodsCatalogByDetailNo(detailNo) {
    const digits = String(detailNo || '').replace(/\D/g, '');
    if (!digits) return null;
    if (goodsCatalogByDetailNo.has(digits)) {
        return goodsCatalogByDetailNo.get(digits);
    }
    // 앞자리만 온 경우 유일 prefix면 채택
    if (digits.length >= 8 && digits.length < 12) {
        const hits = goodsCatalogDetailNos.filter((no) => no.startsWith(digits));
        if (hits.length === 1) return goodsCatalogByDetailNo.get(hits[0]) || null;
    }
    return null;
}

/**
 * 목록정보 코드 해석.
 * - 세부품명번호(보통 10자리) → 분류(8자리) 유도
 * - 긴 RFID/자산번호(>12자리)는 앞자리 오인 매칭 금지
 * @param {string} code
 * @param {{ allowClassNo?: boolean }} [options]
 */
function resolveGoodsCatalogByAnyCode(code, options = {}) {
    const allowClassNo = options.allowClassNo !== false;
    const digits = String(code || '').replace(/\D/g, '');
    if (!digits) return null;

    // 기관 자산번호·RFID(매우 긴 숫자)는 목록정보 키가 아님
    if (digits.length > 12) return null;

    const byDetail = lookupGoodsCatalogByDetailNo(digits);
    if (byDetail?.entry) {
        return {
            goodsClNo: byDetail.entry.goodsClNo,
            goodsClNm: byDetail.entry.goodsClNm,
            goodsClDetailNo: byDetail.detail?.goodsClDetailNo || digits,
            goodsClDetailNm: byDetail.detail?.goodsClDetailNm || '',
            entry: byDetail.entry,
            via: 'detail-no'
        };
    }

    // 세부품명번호 형식(10자리)만 앞 8자리를 분류로 사용
    if (digits.length === 10) {
        const eight = digits.slice(0, 8);
        const entry = goodsCatalogByCode.get(eight);
        if (entry) {
            return {
                goodsClNo: entry.goodsClNo,
                goodsClNm: entry.goodsClNm,
                goodsClDetailNo: digits,
                goodsClDetailNm: '',
                entry,
                via: 'detail-prefix-class'
            };
        }
    }

    if (allowClassNo && digits.length === 8) {
        const entry = goodsCatalogByCode.get(digits);
        if (entry) {
            return {
                goodsClNo: entry.goodsClNo,
                goodsClNm: entry.goodsClNm,
                goodsClDetailNo: '',
                goodsClDetailNm: '',
                entry,
                via: 'class-no'
            };
        }
    }
    return null;
}

function goodsCatalogCodesForName(name) {
    const key = goodsCatalogNormalize(name);
    if (!key) return [];
    const fromKo = goodsCatalogByName.get(key) || [];
    const fromEng = goodsCatalogByEng.get(key) || [];
    return [...new Set([...fromKo, ...fromEng])];
}

function lookupGoodsCatalogByName(name) {
    const codes = goodsCatalogCodesForName(name);
    const entries = codes.map((code) => goodsCatalogByCode.get(code)).filter(Boolean);
    if (!entries.length) return { entry: null, candidates: [] };
    if (entries.length === 1) return { entry: entries[0], candidates: entries };
    return { entry: null, candidates: entries };
}

function goodsCatalogCollectFromKeys(keyMap, keys, queryKey, mode, scoreExact, scorePrefix, scoreContain, into) {
    if (!queryKey) return;
    keys.forEach((nameKey) => {
        let score = 0;
        if (nameKey === queryKey) score = scoreExact;
        else if (mode !== 'exact' && nameKey.startsWith(queryKey)) {
            score = scorePrefix * (queryKey.length / Math.max(nameKey.length, 1));
        } else if (mode === 'contain' && queryKey.length >= 2 && nameKey.includes(queryKey)) {
            score = scoreContain * (queryKey.length / Math.max(nameKey.length, 1));
        }
        if (score <= 0) return;
        (keyMap.get(nameKey) || []).forEach((code) => {
            const prev = into.get(code) || 0;
            if (score > prev) into.set(code, score);
        });
    });
}

/**
 * 목록정보 검색 — 이름/영문/코드 색인만 사용한다.
 * 해설 전체 순회는 하지 않는다(대장 일괄 매칭이 멈추지 않게).
 */
function searchGoodsCatalog(query, limit, options = {}) {
    if (!goodsCatalogTable) return [];
    const raw = String(query || '').trim();
    const key = goodsCatalogNormalize(raw);
    const codeKey = raw.replace(/\D/g, '');
    if (!key && codeKey.length < 4) return [];

    const max = Math.max(1, Number(limit) || 12);
    const mode = options.mode === 'exact' ? 'exact' : (options.mode === 'prefix' ? 'prefix' : 'contain');
    const scores = new Map();

    if (key) {
        (goodsCatalogByName.get(key) || []).forEach((code) => scores.set(code, 1));
        (goodsCatalogByEng.get(key) || []).forEach((code) => scores.set(code, Math.max(scores.get(code) || 0, 1)));

        if (mode !== 'exact') {
            goodsCatalogCollectFromKeys(
                goodsCatalogByName, goodsCatalogNameKeys, key, mode, 1, 0.9, 0.72, scores
            );
            goodsCatalogCollectFromKeys(
                goodsCatalogByEng, goodsCatalogEngKeys, key, mode, 1, 0.9, 0.72, scores
            );
        }
    }

    if (codeKey.length >= 4) {
        goodsCatalogCodes.forEach((code) => {
            if (!code.startsWith(codeKey)) return;
            scores.set(code, Math.max(scores.get(code) || 0, 0.88));
        });
        // 세부품명번호(식별)로도 검색 — 맞으면 상위 분류를 반환
        const detailHit = lookupGoodsCatalogByDetailNo(codeKey);
        if (detailHit?.entry?.goodsClNo) {
            scores.set(detailHit.entry.goodsClNo, Math.max(scores.get(detailHit.entry.goodsClNo) || 0, 0.98));
        } else if (codeKey.length >= 8) {
            goodsCatalogDetailNos.forEach((no) => {
                if (!no.startsWith(codeKey) && !codeKey.startsWith(no.slice(0, codeKey.length))) return;
                const hit = goodsCatalogByDetailNo.get(no);
                if (hit?.entry?.goodsClNo) {
                    scores.set(hit.entry.goodsClNo, Math.max(scores.get(hit.entry.goodsClNo) || 0, 0.95));
                }
            });
        }
    }

    return [...scores.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, max)
        .map(([code, score]) => {
            const entry = goodsCatalogByCode.get(code);
            return entry ? { ...entry, score } : null;
        })
        .filter(Boolean);
}

/** 일괄 매칭용 — 정확 일치(+짧은 prefix)만. 전체 contain 검색 금지 */
function suggestGoodsCatalogForMatch(itemName, limit) {
    if (!goodsCatalogTable) return [];
    const exact = lookupGoodsCatalogByName(itemName);
    if (exact.entry) return [{ ...exact.entry, score: 1 }];
    if (exact.candidates?.length) {
        return exact.candidates.slice(0, limit || 8).map((entry) => ({ ...entry, score: 0.9 }));
    }
    const key = goodsCatalogNormalize(itemName);
    if (!key || key.length < 3) return [];
    return searchGoodsCatalog(itemName, limit || 6, { mode: 'prefix' });
}

function goodsCatalogDetailUrl(code) {
    const digits = String(code || '').replace(/\D/g, '').slice(0, 8);
    if (!digits) return GOODS_CATALOG_SEARCH_URL;
    return `${GOODS_CATALOG_DETAIL_URL}${digits}`;
}

function goodsCatalogSearchUrl(query) {
    const text = String(query || '').trim();
    if (!text) return GOODS_CATALOG_SEARCH_URL;
    return `${GOODS_CATALOG_SEARCH_URL}?searchGoodsClsfcNm=${encodeURIComponent(text)}`;
}

// 내용연수 후보 형태로 바꾼다. 연수는 useful-life 표에서 가져온다.
function usefulLifeCandidateFromCatalog(entry, score) {
    if (!entry?.goodsClNo) return null;
    const life = typeof lookupUsefulLifeByCode === 'function'
        ? lookupUsefulLifeByCode(entry.goodsClNo)
        : null;
    if (life) {
        return {
            ...life,
            score: Number(score) || 0.8,
            reason: 'catalog',
            catalogExplain: entry.explain || '',
            catalogEngNm: entry.engNm || ''
        };
    }
    return {
        goodsClNo: entry.goodsClNo,
        goodsClNm: entry.goodsClNm,
        usefulLife: 0,
        notified: false,
        score: Number(score) || 0.75,
        reason: 'catalog',
        catalogExplain: entry.explain || '',
        catalogEngNm: entry.engNm || ''
    };
}

function resolveUsefulLifeFromCatalog(itemName) {
    if (!goodsCatalogTable) return null;
    const hit = lookupGoodsCatalogByName(itemName);
    if (hit.entry) {
        const candidate = usefulLifeCandidateFromCatalog(hit.entry, 0.95);
        return candidate ? { entry: candidate, candidates: [candidate], auto: true } : null;
    }
    if (hit.candidates?.length) {
        const candidates = hit.candidates
            .map((entry) => usefulLifeCandidateFromCatalog(entry, 0.82))
            .filter(Boolean);
        if (candidates.length) return { entry: null, candidates, auto: false };
    }
    return null;
}
