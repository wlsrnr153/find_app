/**
 * 나라장터 품목 식별번호(8자리) → 분류번호
 * 로컬 캐시 우선, miss는 /api/goods-idntfc 로 조회·저장
 */

const GOODS_IDNTFC_CACHE_URL = 'goods-idntfc-cache.json';
const GOODS_IDNTFC_API_CACHE = '/api/goods-idntfc/cache';
const GOODS_IDNTFC_API_RESOLVE = '/api/goods-idntfc/resolve';
const GOODS_IDNTFC_LS_KEY = 'goodsIdntfcCacheV1';

let goodsIdntfcByNo = new Map();
let goodsIdntfcLoading = null;

function normalizeGoodsIdntfcNo(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 8 ? digits : '';
}

function goodsIdntfcRemember(entry) {
    if (!entry) return;
    const key = normalizeGoodsIdntfcNo(entry.goodsIdntfcNo || entry.id);
    if (!key) return;
    if (entry.miss) {
        goodsIdntfcByNo.set(key, { miss: true, fetchedAt: entry.fetchedAt || '' });
        return;
    }
    if (!entry.goodsClNo) return;
    goodsIdntfcByNo.set(key, {
        goodsIdntfcNo: key,
        goodsClNo: String(entry.goodsClNo || '').replace(/\D/g, '').slice(0, 8),
        goodsClDetailNo: String(entry.goodsClDetailNo || '').replace(/\D/g, '').slice(0, 10),
        goodsClNm: String(entry.goodsClNm || '').trim(),
        goodsNm: String(entry.goodsNm || '').trim(),
        fetchedAt: entry.fetchedAt || '',
        via: entry.via || 'idntfc-cache'
    });
}

function applyGoodsIdntfcSnapshot(snapshot) {
    const entries = snapshot && snapshot.entries ? snapshot.entries : snapshot;
    if (!entries || typeof entries !== 'object') return 0;
    let n = 0;
    Object.keys(entries).forEach((key) => {
        const entry = entries[key];
        if (!entry) return;
        goodsIdntfcRemember({ ...entry, goodsIdntfcNo: entry.goodsIdntfcNo || key });
        n += 1;
    });
    return n;
}

function persistGoodsIdntfcLocal() {
    try {
        const entries = {};
        goodsIdntfcByNo.forEach((value, key) => {
            entries[key] = value;
        });
        localStorage.setItem(GOODS_IDNTFC_LS_KEY, JSON.stringify({
            updatedAt: new Date().toISOString(),
            entries
        }));
    } catch (error) {
        console.warn('식별번호 캐시 localStorage 저장 실패:', error);
    }
}

function loadGoodsIdntfcLocal() {
    try {
        const raw = localStorage.getItem(GOODS_IDNTFC_LS_KEY);
        if (!raw) return 0;
        return applyGoodsIdntfcSnapshot(JSON.parse(raw));
    } catch (error) {
        return 0;
    }
}

async function fetchGoodsIdntfcJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function ensureGoodsIdntfcCache() {
    if (goodsIdntfcByNo.size) return Promise.resolve(goodsIdntfcByNo.size);
    if (goodsIdntfcLoading) return goodsIdntfcLoading;

    goodsIdntfcLoading = (async () => {
        loadGoodsIdntfcLocal();
        try {
            const snap = await fetchGoodsIdntfcJson(GOODS_IDNTFC_API_CACHE);
            applyGoodsIdntfcSnapshot(snap);
        } catch (error) {
            try {
                const snap = await fetchGoodsIdntfcJson(GOODS_IDNTFC_CACHE_URL);
                applyGoodsIdntfcSnapshot(snap);
            } catch (inner) {
                console.warn('식별번호 캐시를 불러오지 못했습니다:', inner);
            }
        }
        return goodsIdntfcByNo.size;
    })().finally(() => {
        goodsIdntfcLoading = null;
    });

    return goodsIdntfcLoading;
}

/** 동기 조회 — prefetch 이후에만 히트 보장 */
function lookupGoodsIdntfcNo(id) {
    const key = normalizeGoodsIdntfcNo(id);
    if (!key) return null;
    const entry = goodsIdntfcByNo.get(key);
    if (!entry || entry.miss || !entry.goodsClNo) return null;
    return entry;
}

/**
 * 식별번호 목록을 캐시/목록정보에서 채운다.
 * @param {string[]} ids
 * @param {{ onProgress?: (done:number, total:number)=>void }} [options]
 */
async function prefetchGoodsIdntfcNos(ids, options = {}) {
    await ensureGoodsIdntfcCache();
    const unique = [...new Set((ids || []).map(normalizeGoodsIdntfcNo).filter(Boolean))];
    const missing = unique.filter((id) => {
        const hit = goodsIdntfcByNo.get(id);
        return !hit || (hit.miss !== true && !hit.goodsClNo);
    });

    if (!missing.length) {
        if (typeof options.onProgress === 'function') options.onProgress(unique.length, unique.length);
        return { total: unique.length, resolved: unique.filter((id) => lookupGoodsIdntfcNo(id)).length, fetched: 0 };
    }

    // API 일괄 조회 (서버가 G2B + 디스크 캐시 담당)
    try {
        const res = await fetch(GOODS_IDNTFC_API_RESOLVE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: missing, concurrency: 4 })
        });
        if (!res.ok) throw new Error(`resolve HTTP ${res.status}`);
        const payload = await res.json();
        const results = payload.results || {};
        Object.keys(results).forEach((key) => {
            if (key.endsWith('__error')) return;
            const entry = results[key];
            if (entry) goodsIdntfcRemember({ ...entry, goodsIdntfcNo: key });
            else goodsIdntfcRemember({ goodsIdntfcNo: key, miss: true, fetchedAt: new Date().toISOString() });
        });
        persistGoodsIdntfcLocal();
        if (typeof options.onProgress === 'function') options.onProgress(unique.length, unique.length);
        return {
            total: unique.length,
            resolved: unique.filter((id) => lookupGoodsIdntfcNo(id)).length,
            fetched: missing.length
        };
    } catch (error) {
        console.warn('식별번호 일괄 조회 실패, 단건 폴백:', error);
    }

    // 폴백: 단건 API
    let done = unique.length - missing.length;
    for (const id of missing) {
        try {
            const res = await fetch(`/api/goods-idntfc/${encodeURIComponent(id)}`);
            if (res.ok) {
                const payload = await res.json();
                if (payload.entry) goodsIdntfcRemember(payload.entry);
            } else {
                goodsIdntfcRemember({ goodsIdntfcNo: id, miss: true, fetchedAt: new Date().toISOString() });
            }
        } catch (error) {
            goodsIdntfcRemember({ goodsIdntfcNo: id, miss: true, fetchedAt: new Date().toISOString() });
        }
        done += 1;
        if (typeof options.onProgress === 'function') options.onProgress(done, unique.length);
    }
    persistGoodsIdntfcLocal();
    return {
        total: unique.length,
        resolved: unique.filter((id) => lookupGoodsIdntfcNo(id)).length,
        fetched: missing.length
    };
}
