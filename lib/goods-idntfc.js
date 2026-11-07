/**
 * 나라장터 목록정보 품목검색 — 식별번호(goodsIdntfcNo, 8자리) → 분류/세부품명
 */
const fs = require('fs');
const path = require('path');

const G2B_PRODUCT_SEARCH = 'https://goods.g2b.go.kr:8053/search/productSearch.do';
const CACHE_PATH = path.join(__dirname, '..', 'data', 'goods-idntfc-cache.json');
const PUBLIC_CACHE_PATH = path.join(__dirname, '..', 'public', 'goods-idntfc-cache.json');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HIT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

let cacheState = null;
let writeTimer = null;
const inflight = new Map();

function emptyCache() {
    return { updatedAt: '', entries: {} };
}

function loadCache() {
    if (cacheState) return cacheState;
    try {
        if (fs.existsSync(CACHE_PATH)) {
            cacheState = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        } else if (fs.existsSync(PUBLIC_CACHE_PATH)) {
            cacheState = JSON.parse(fs.readFileSync(PUBLIC_CACHE_PATH, 'utf8'));
        }
    } catch (error) {
        console.warn('goods-idntfc cache load failed:', error.message);
    }
    if (!cacheState || typeof cacheState !== 'object') cacheState = emptyCache();
    if (!cacheState.entries || typeof cacheState.entries !== 'object') cacheState.entries = {};
    return cacheState;
}

function schedulePersist() {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
        writeTimer = null;
        persistCache();
    }, 400);
}

function persistCache() {
    const state = loadCache();
    state.updatedAt = new Date().toISOString();
    const json = JSON.stringify(state, null, 2);
    try {
        fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
        fs.writeFileSync(CACHE_PATH, json, 'utf8');
    } catch (error) {
        console.warn('goods-idntfc data cache write failed:', error.message);
    }
    try {
        fs.writeFileSync(PUBLIC_CACHE_PATH, json, 'utf8');
    } catch (error) {
        console.warn('goods-idntfc public cache write failed:', error.message);
    }
}

function normalizeIdntfcNo(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 8) return digits;
    return '';
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function cacheEntryFresh(entry) {
    if (!entry || !entry.fetchedAt) return false;
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (Number.isNaN(age) || age < 0) return false;
    if (entry.miss) return age < MISS_TTL_MS;
    return age < HIT_TTL_MS;
}

function getCached(id) {
    const key = normalizeIdntfcNo(id);
    if (!key) return null;
    const entry = loadCache().entries[key];
    if (!entry || !cacheEntryFresh(entry)) return null;
    return entry;
}

function putCache(id, entry) {
    const key = normalizeIdntfcNo(id);
    if (!key) return;
    loadCache().entries[key] = entry;
    schedulePersist();
}

function parseProductSearchHtml(html, wantedId) {
    const want = normalizeIdntfcNo(wantedId);
    const re = /productSearchView\.do\?goodsClsfcNo=(\d+)&goodsIdntfcNo=(\d+)[\s\S]{0,400}?<td class="txt-left">\s*([^<]*?)\s*<\/td>\s*<td class="txt-left[^"]*">\s*([\s\S]*?)\s*<\/td>/gi;
    let match;
    while ((match = re.exec(html))) {
        const goodsClsfcNo = String(match[1] || '').replace(/\D/g, '');
        const goodsIdntfcNo = String(match[2] || '').replace(/\D/g, '');
        if (want && goodsIdntfcNo !== want) continue;
        const goodsClNm = decodeHtml(match[3]);
        const goodsNm = decodeHtml(String(match[4] || '').replace(/<[^>]+>/g, ' '));
        const detailNo = goodsClsfcNo.length >= 10 ? goodsClsfcNo.slice(0, 10) : '';
        const classNo = goodsClsfcNo.length >= 8 ? goodsClsfcNo.slice(0, 8) : '';
        if (!classNo) continue;
        return {
            goodsIdntfcNo,
            goodsClNo: classNo,
            goodsClDetailNo: detailNo,
            goodsClNm,
            goodsNm,
            miss: false,
            fetchedAt: new Date().toISOString(),
            via: 'g2b-product'
        };
    }
    return null;
}

async function fetchFromG2b(id) {
    const key = normalizeIdntfcNo(id);
    if (!key) return { miss: true, fetchedAt: new Date().toISOString() };

    const body = new URLSearchParams({
        mode: 'search',
        pageNumber: '1',
        pageSize: '10',
        searchGoodsIdntfcNo: key
    });
    const res = await fetch(G2B_PRODUCT_SEARCH, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'text/html',
            Referer: G2B_PRODUCT_SEARCH,
            'User-Agent': USER_AGENT
        },
        body: body.toString()
    });
    if (!res.ok) throw new Error(`G2B productSearch HTTP ${res.status}`);
    const html = await res.text();
    const hit = parseProductSearchHtml(html, key);
    if (hit) return hit;
    return {
        goodsIdntfcNo: key,
        miss: true,
        fetchedAt: new Date().toISOString(),
        via: 'g2b-product-miss'
    };
}

async function resolveOne(id, options = {}) {
    const key = normalizeIdntfcNo(id);
    if (!key) return null;

    const cached = getCached(key);
    if (cached && !options.force) {
        return cached.miss ? null : cached;
    }

    if (inflight.has(key)) return inflight.get(key);

    const task = (async () => {
        try {
            const entry = await fetchFromG2b(key);
            putCache(key, entry);
            return entry.miss ? null : entry;
        } finally {
            inflight.delete(key);
        }
    })();

    inflight.set(key, task);
    return task;
}

async function resolveMany(ids, options = {}) {
    const concurrency = Math.max(1, Math.min(Number(options.concurrency) || 4, 8));
    const unique = [...new Set((ids || []).map(normalizeIdntfcNo).filter(Boolean))];
    const results = {};
    let cursor = 0;

    async function worker() {
        while (cursor < unique.length) {
            const index = cursor;
            cursor += 1;
            const id = unique[index];
            try {
                results[id] = await resolveOne(id, options);
            } catch (error) {
                results[id] = null;
                results[`${id}__error`] = error.message;
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()));
    persistCache();
    return {
        results,
        resolved: unique.filter((id) => results[id]?.goodsClNo).length,
        total: unique.length
    };
}

function getCacheSnapshot() {
    return loadCache();
}

module.exports = {
    normalizeIdntfcNo,
    getCached,
    resolveOne,
    resolveMany,
    getCacheSnapshot,
    persistCache,
    CACHE_PATH,
    PUBLIC_CACHE_PATH
};
