// 대장 대조 / 자산번호 중복 / 바코드 스캔
let registerItems = window.registerItems || [];
let registerFilter = 'all';
let assetCheckTimer = null;
let html5Scanner = null;
let scanTorchOn = false;
let scanZoom = 1;
let scanEnhanceTimers = [];
/** Android 등에서 AF가 잠기거나 흐린 채 유지될 때 주기적으로 재유도 */
let scanFocusKeepAliveTimer = null;
let scanCameraList = [];
let scanCameraIndex = 0;
/** 'environment' = 후면, 'user' = 전면 — deviceId보다 facingMode가 기기 호환성이 높음 */
let scanFacingMode = 'environment';
let scanActiveDeviceId = '';
/** 세션 중 후면 deviceId 캐시 — 매번 프로브/다중 오픈 방지 */
let cachedRearDeviceId = '';
let scanSwitching = false;
let pendingAssetOverride = false;
let unsubscribeRegisterChunks = null;
let registerChunkSurveyId = '';
let refreshRegisterViewsTimer = null;
let assetSearchIndex = null;
let itemAssetIndex = null;
let itemAssetIndexSurveyId = '';
/** 같은 자산번호로 기준/대장 자동채움을 반복하지 않기 위한 가드 */
let lastAutofilledAssetNorm = '';
/** 자동채움이 기록한 필드값 — 사용자가 고친 칸은 다시 덮지 않음 */
let assetAutofillSnapshot = Object.create(null);

function invalidateAssetSearchIndex() {
    assetSearchIndex = null;
}

function invalidateItemAssetIndex() {
    itemAssetIndex = null;
    itemAssetIndexSurveyId = '';
}

function resetAssetAutofillGuard() {
    lastAutofilledAssetNorm = '';
    assetAutofillSnapshot = Object.create(null);
}

function markAssetAutofilled(assetNumber) {
    lastAutofilledAssetNorm = normalizeAsset(assetNumber);
}

function setRegisterItems(list) {
    registerItems = Array.isArray(list) ? list : [];
    window.registerItems = registerItems;
    invalidateAssetSearchIndex();
}

function replaceRegisterSurveyRows(surveyId, chunkRows) {
    if (!surveyId) return;
    const chunkById = new Map();
    (chunkRows || []).forEach((record) => {
        if (record?.id) chunkById.set(record.id, { ...record, _fromChunk: true });
    });
    const kept = registerItems.filter((record) => {
        if (record.surveyId !== surveyId) return true;
        // 같은 회차: 청크에 없는 유저문서 행만 유지
        if (record._fromChunk) return false;
        return !chunkById.has(record.id);
    });
    setRegisterItems(kept.concat(Array.from(chunkById.values())));
}

const ASSET_PARTIAL_MIN_LEN = 3;
const ASSET_CANDIDATE_LIMIT = 12;

function normalizeAsset(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s\-_.]/g, '');
}

function assetDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function scoreAssetMatch(query, assetNumber) {
    const q = normalizeAsset(query);
    const a = normalizeAsset(assetNumber);
    if (!q || !a) return null;
    if (a === q) return { rank: 0, type: 'exact' };

    const qd = assetDigits(q);
    const ad = assetDigits(a);
    if (qd.length >= ASSET_PARTIAL_MIN_LEN && ad.endsWith(qd)) {
        return { rank: 1, type: 'suffix' };
    }
    if (q.length >= ASSET_PARTIAL_MIN_LEN && a.includes(q)) {
        return { rank: 2, type: 'contains' };
    }
    if (qd.length >= ASSET_PARTIAL_MIN_LEN && ad.includes(qd)) {
        return { rank: 3, type: 'digits' };
    }
    return null;
}

function buildAssetSearchIndex(surveyId) {
    const sid = surveyId || getRegisterSurveyId();
    if (assetSearchIndex?.surveyId === sid && Array.isArray(assetSearchIndex.entries)) {
        return assetSearchIndex;
    }
    const entries = [];
    const registerByNorm = new Map();
    const baselineByNorm = new Map();
    getRegisterForSurvey(sid).forEach((record) => {
        if (!record?.assetNumber) return;
        const norm = normalizeAsset(record.assetNumber);
        if (!norm) return;
        if (!registerByNorm.has(norm)) registerByNorm.set(norm, record);
        entries.push({
            record,
            source: 'register',
            norm,
            digits: assetDigits(record.assetNumber)
        });
    });
    if (typeof getBaselineForSurvey === 'function') {
        getBaselineForSurvey(sid).forEach((record) => {
            if (!record?.assetNumber) return;
            const norm = normalizeAsset(record.assetNumber);
            if (!norm) return;
            if (!baselineByNorm.has(norm)) baselineByNorm.set(norm, record);
            entries.push({
                record,
                source: 'baseline',
                norm,
                digits: assetDigits(record.assetNumber)
            });
        });
    }
    assetSearchIndex = { surveyId: sid, entries, registerByNorm, baselineByNorm };
    return assetSearchIndex;
}

function buildItemAssetIndex() {
    const sid = typeof currentSurveyId !== 'undefined' ? currentSurveyId : '';
    if (itemAssetIndex && itemAssetIndexSurveyId === sid) return itemAssetIndex;
    const map = new Map();
    const surveyed = typeof getItemsForView === 'function' ? getItemsForView() : [];
    surveyed.forEach((item) => {
        const key = normalizeAsset(item.assetNumber);
        if (key && !map.has(key)) map.set(key, item);
    });
    itemAssetIndex = map;
    itemAssetIndexSurveyId = sid;
    return map;
}

function collectAssetCandidates(query, options = {}) {
    const limit = options.limit || ASSET_CANDIDATE_LIMIT;
    const q = normalizeAsset(query);
    if (!q || q.length < ASSET_PARTIAL_MIN_LEN) return [];

    const qd = assetDigits(q);
    const index = buildAssetSearchIndex(options.surveyId);
    const results = [];
    const seen = new Set();

    for (let i = 0; i < index.entries.length; i += 1) {
        const entry = index.entries[i];
        if (!entry.norm || seen.has(entry.norm)) continue;
        let rank = -1;
        let type = '';
        if (entry.norm === q) {
            rank = 0;
            type = 'exact';
        } else if (qd.length >= ASSET_PARTIAL_MIN_LEN && entry.digits.endsWith(qd)) {
            rank = 1;
            type = 'suffix';
        } else if (entry.norm.includes(q)) {
            rank = 2;
            type = 'contains';
        } else if (qd.length >= ASSET_PARTIAL_MIN_LEN && entry.digits.includes(qd)) {
            rank = 3;
            type = 'digits';
        }
        if (rank < 0) continue;
        seen.add(entry.norm);
        const record = entry.record;
        results.push({
            record,
            source: entry.source,
            assetNumber: record.assetNumber,
            itemName: record.itemName || '',
            location: record.location
                || [record.building, record.floor, record.room].filter(Boolean).join(' ')
                || '',
            rank,
            type
        });
    }

    results.sort((a, b) => (
        a.rank - b.rank
        || String(a.assetNumber).localeCompare(String(b.assetNumber), 'ko', { numeric: true })
    ));
    return results.slice(0, limit);
}

function clearAssetMatchCandidates() {
    const box = document.getElementById('assetMatchCandidates');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
}

function renderAssetMatchCandidates(candidates, query) {
    const box = document.getElementById('assetMatchCandidates');
    if (!box) return;
    if (!candidates.length) {
        clearAssetMatchCandidates();
        return;
    }
    const sourceLabel = (source) => (source === 'baseline' ? '기준' : '금년');
    box.hidden = false;
    box.innerHTML = `
        <div class="asset-match-head">${candidates.length}건 후보 · "${escapeHtml(query)}" 부분일치</div>
        <div class="asset-match-list">
            ${candidates.map((item, index) => `
                <button type="button" class="asset-match-item" data-asset-pick="${index}">
                    <strong>${escapeHtml(item.assetNumber)}</strong>
                    <span>${escapeHtml(item.itemName || '이름 없음')}</span>
                    <small>${escapeHtml(sourceLabel(item.source))}${item.location ? ` · ${escapeHtml(item.location)}` : ''}</small>
                </button>
            `).join('')}
        </div>
    `;
    box.querySelectorAll('[data-asset-pick]').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
            const picked = candidates[Number(btn.dataset.assetPick)];
            if (!picked) return;
            selectAssetCandidate(picked.assetNumber);
        });
    });
}

function selectAssetCandidate(assetNumber) {
    const input = document.getElementById('assetNumber');
    if (!input) return;
    input.value = String(assetNumber || '').trim();
    clearAssetMatchCandidates();
    resetAssetAutofillGuard();
    updateAssetCheckBanner({ allowAutofill: false, forceFill: true });
    showToast(`자산번호 ${input.value} 선택`, 'success');
}

function getRegisterSurveyId() {
    if (typeof currentSurveyId === 'undefined' || currentSurveyId === '__all__' || currentSurveyId === '__unassigned__') {
        const writable = typeof getWritableSurvey === 'function' ? getWritableSurvey() : null;
        return writable && !writable.isFallback ? writable.id : '';
    }
    return currentSurveyId;
}

function getRegisterForSurvey(surveyId) {
    const sid = surveyId || getRegisterSurveyId();
    if (!sid) return [];
    return registerItems.filter((record) => record.surveyId === sid);
}

function findRegisterByAsset(assetNumber, surveyId) {
    const key = normalizeAsset(assetNumber);
    if (!key) return null;
    const sid = surveyId || getRegisterSurveyId();
    const index = buildAssetSearchIndex(sid);
    if (index.registerByNorm?.has(key)) return index.registerByNorm.get(key);
    return null;
}

function findItemByAsset(assetNumber, excludeId) {
    const key = normalizeAsset(assetNumber);
    if (!key) return null;
    const item = buildItemAssetIndex().get(key);
    if (!item) return null;
    if (excludeId && item.id === excludeId) return null;
    return item;
}

// 조사된 자산번호를 한 번만 Map으로 만들어 대장 행마다 전체 목록을 훑지 않도록 한다
function buildSurveyedIndex() {
    return buildItemAssetIndex();
}

const REGISTER_STATUS = {
    pending: { label: '미조사', cls: 'is-pending' },
    found: { label: '찾음', cls: 'is-found' },
    changed: { label: '상태변경', cls: 'is-changed' },
    missing: { label: '미발견', cls: 'is-missing' },
    new: { label: '신규', cls: 'is-new' }
};

function resolveRegisterStatus(record, surveyedIndex) {
    if (record.status === 'missing') return 'missing';
    if (record.status === 'changed') return 'changed';
    if (record.status === 'found') return 'found';
    return surveyedIndex.has(normalizeAsset(record.assetNumber)) ? 'found' : 'pending';
}

function getRegisterProgress(surveyedIndex) {
    const register = getRegisterForSurvey();
    const surveyed = typeof getItemsForView === 'function' ? getItemsForView() : [];
    const index = surveyedIndex || buildSurveyedIndex();
    const registerKeys = new Set(register.map((record) => normalizeAsset(record.assetNumber)).filter(Boolean));

    let found = 0;
    let pending = 0;
    let missing = 0;
    let changed = 0;

    register.forEach((record) => {
        const status = resolveRegisterStatus(record, index);
        if (status === 'missing') missing += 1;
        else if (status === 'changed') changed += 1;
        else if (status === 'found') found += 1;
        else pending += 1;
    });

    const discovered = register.length === 0 ? 0 : surveyed.filter((item) => {
        const key = normalizeAsset(item.assetNumber);
        return !key || !registerKeys.has(key);
    }).length;

    const expected = register.length;
    const checked = found + missing + changed;
    const percent = expected > 0 ? Math.round((checked / expected) * 100) : 0;

    return { expected, found, pending, missing, changed, discovered, checked, percent };
}

const REGISTER_CHUNK_SIZE = 280;
const REGISTER_USERDOC_MAX_ROWS = 200;
const REGISTER_LEAN_KEYS = [
    'id', 'surveyId', 'surveyName', 'status', 'createdBy', 'createdAt', 'sourceFile',
    'checkedBy', 'checkedByEmail', 'checkedAt', 'itemId', 'foundItemId',
    'assetNumber', 'itemName', 'organization', 'holder', 'location', 'building', 'floor', 'room',
    'category', 'goodsClNo', 'goodsClNm', 'usefulLife', 'usefulLifeMatch',
    'quantity', 'acquiredAt', 'manufacturer', 'model', 'condition'
];

function leanRegisterRecord(row) {
    const out = {};
    REGISTER_LEAN_KEYS.forEach((key) => {
        if (row[key] != null && row[key] !== '') out[key] = row[key];
    });
    return out;
}

function registerFieldKeys(data) {
    return ['registers', ...Object.keys(data || {}).filter((key) => key.startsWith('registerChunk_'))];
}

function openRegisterIdb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('find-app-registers', 1);
        request.onupgradeneeded = () => {
            const dbx = request.result;
            if (!dbx.objectStoreNames.contains('rows')) {
                const store = dbx.createObjectStore('rows', { keyPath: 'id' });
                store.createIndex('surveyId', 'surveyId', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function idbWriteRegisters(surveyId, rows) {
    const dbx = await openRegisterIdb();
    await new Promise((resolve, reject) => {
        const tx = dbx.transaction('rows', 'readwrite');
        const store = tx.objectStore('rows');
        const index = store.index('surveyId');
        const req = index.getAllKeys(surveyId);
        req.onsuccess = () => {
            (req.result || []).forEach((key) => store.delete(key));
            rows.forEach((row) => store.put(row));
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function idbReadRegisters() {
    try {
        const dbx = await openRegisterIdb();
        return await new Promise((resolve, reject) => {
            const tx = dbx.transaction('rows', 'readonly');
            const req = tx.objectStore('rows').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch (error) {
        console.warn('로컬 대장 읽기 실패:', error);
        return [];
    }
}

async function idbUpdateRegister(registerId, patch) {
    const dbx = await openRegisterIdb();
    return new Promise((resolve, reject) => {
        const tx = dbx.transaction('rows', 'readwrite');
        const store = tx.objectStore('rows');
        const req = store.get(registerId);
        req.onsuccess = () => {
            if (!req.result) {
                resolve(false);
                return;
            }
            store.put({ ...req.result, ...patch });
            resolve(true);
        };
        tx.onerror = () => reject(tx.error);
    });
}

function mergeRegisterLists(...lists) {
    const byId = new Map();
    lists.flat().forEach((record) => {
        if (record && record.id && !byId.has(record.id)) byId.set(record.id, record);
    });
    return Array.from(byId.values());
}

async function clearRegistersForSurvey(surveyId) {
    const snapshot = await db.collection('users').get();
    for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        const update = {};
        registerFieldKeys(data).forEach((key) => {
            const list = Array.isArray(data[key]) ? data[key] : [];
            const filtered = list.filter((record) => record.surveyId !== surveyId);
            if (filtered.length !== list.length) {
                update[key] = filtered.length ? filtered : firebase.firestore.FieldValue.delete();
            }
        });
        const meta = data.registerChunkMeta || {};
        if (meta[surveyId]) {
            update.registerChunkMeta = { ...meta, [surveyId]: firebase.firestore.FieldValue.delete() };
        }
        if (Object.keys(update).length) {
            try {
                await doc.ref.set(update, { merge: true });
            } catch (error) {
                console.warn('기존 대장 정리 건너뜀:', error);
            }
        }
    }
}

async function saveRegisterChunkDocs(surveyId, rows) {
    const userRef = db.collection('users').doc(currentUser.uid);
    const prevCount = (await userRef.get()).data()?.registerChunkMeta?.[surveyId]?.count || 0;
    const count = Math.ceil(rows.length / REGISTER_CHUNK_SIZE) || 0;
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
        if (!ops) return;
        await batch.commit();
        batch = db.batch();
        ops = 0;
    };
    for (let i = 0; i < Math.max(count, prevCount); i += 1) {
        const ref = db.collection('registerChunks').doc(`${surveyId}_${i}`);
        if (i < count) {
            batch.set(ref, {
                surveyId,
                index: i,
                rows: rows.slice(i * REGISTER_CHUNK_SIZE, (i + 1) * REGISTER_CHUNK_SIZE),
                createdBy: currentUser.uid,
                createdAt: new Date().toISOString()
            });
        } else {
            batch.delete(ref);
        }
        ops += 1;
        if (ops >= 400) await flush();
    }
    await flush();
    await userRef.set({
        registerChunkMeta: { [surveyId]: { count, total: rows.length } }
    }, { merge: true });
}

async function saveRegistersForSurvey(surveyId, rows) {
    if (!currentUser) throw new Error('로그인이 필요합니다');
    const lean = rows.map(leanRegisterRecord);
    await clearRegistersForSurvey(surveyId);

    if (lean.length <= REGISTER_USERDOC_MAX_ROWS) {
        const userRef = db.collection('users').doc(currentUser.uid);
        const latest = ((await userRef.get()).data()?.registers || []).filter((record) => record.surveyId !== surveyId);
        await userRef.set({ registers: latest.concat(lean) }, { merge: true });
        listenUserMasters();
        return { stored: 'shared' };
    }

    try {
        await saveRegisterChunkDocs(surveyId, lean);
        listenRegisterChunks();
        return { stored: 'shared' };
    } catch (error) {
        console.warn('공용 대장 저장 실패, 이 기기에 보관:', error);
        await idbWriteRegisters(surveyId, lean);
        const remote = typeof window.registerItems === 'object' ? window.registerItems : registerItems;
        setRegisterItems(mergeRegisterLists(
            (remote || []).filter((record) => record.surveyId !== surveyId),
            lean
        ));
        return { stored: 'local', reason: error.code || error.message };
    }
}

async function resolveRegisterChunkCount(surveyId) {
    if (!surveyId || !currentUser) return 0;
    try {
        const metaSnap = await db.collection('users').doc(currentUser.uid).get();
        const metaCount = metaSnap.data()?.registerChunkMeta?.[surveyId]?.count || 0;
        if (metaCount) return metaCount;
    } catch (error) {
        console.warn('대장 청크 메타 조회 실패:', error);
    }

    // 메타가 없거나 다른 계정 업로드분이면 문서를 직접 센다
    try {
        const snap = await db.collection('registerChunks').where('surveyId', '==', surveyId).get();
        if (!snap.empty) return snap.size;
    } catch (error) {
        console.warn('대장 청크 조회 실패, 순차 탐색:', error);
        let count = 0;
        while (count < 500) {
            const doc = await db.collection('registerChunks').doc(`${surveyId}_${count}`).get();
            if (!doc.exists) break;
            count += 1;
        }
        return count;
    }
    return 0;
}

async function patchRegisterInChunks(surveyId, patchesById) {
    if (!surveyId || !currentUser || !patchesById?.size) return 0;
    const count = await resolveRegisterChunkCount(surveyId);
    if (!count) return 0;

    let updated = 0;
    for (let i = 0; i < count; i += 1) {
        const ref = db.collection('registerChunks').doc(`${surveyId}_${i}`);
        const snap = await ref.get();
        if (!snap.exists) continue;
        const list = snap.data()?.rows || [];
        let changed = false;
        const next = list.map((record) => {
            const patch = patchesById.get(record.id);
            if (!patch) return record;
            changed = true;
            updated += 1;
            return { ...record, ...patch };
        });
        if (changed) await ref.set({ rows: next }, { merge: true });
        if (updated >= patchesById.size) break;
    }
    return updated;
}

/** users.registers / registerChunk_* 배열에 들어 있는 소량 대장을 일괄 수정 */
async function patchRegisterInUserDocs(patchesById) {
    if (!currentUser || !patchesById?.size) return 0;
    const ownRef = db.collection('users').doc(currentUser.uid);
    const ownSnap = await ownRef.get();
    const data = ownSnap.data() || {};
    let updated = 0;
    const update = {};

    for (const key of registerFieldKeys(data)) {
        const list = Array.isArray(data[key]) ? data[key] : [];
        let changed = false;
        const next = list.map((record) => {
            const patch = patchesById.get(record.id);
            if (!patch) return record;
            changed = true;
            updated += 1;
            return { ...record, ...patch };
        });
        if (changed) update[key] = next;
    }

    if (Object.keys(update).length) {
        await ownRef.set(update, { merge: true });
    }
    return updated;
}

async function updateRegisterRecord(registerId, patch) {
    const current = registerItems.find((record) => record.id === registerId);
    if (current) {
        setRegisterItems(registerItems.map((record) => (
            record.id === registerId ? { ...record, ...patch } : record
        )));
    }

    // 대용량 대장은 registerChunks에만 있다. users 전체 get보다 청크를 먼저 본다.
    if (current?.surveyId) {
        try {
            const patched = await patchRegisterInChunks(
                current.surveyId,
                new Map([[registerId, patch]])
            );
            if (patched) {
                try { await idbUpdateRegister(registerId, patch); } catch (_) { /* ignore */ }
                return;
            }
        } catch (error) {
            console.warn('분할 대장 수정 실패:', error);
        }
    }

    try {
        const ownRef = currentUser ? db.collection('users').doc(currentUser.uid) : null;
        if (ownRef) {
            const ownSnap = await ownRef.get();
            const data = ownSnap.data() || {};
            for (const key of registerFieldKeys(data)) {
                const list = Array.isArray(data[key]) ? data[key] : [];
                const index = list.findIndex((record) => record.id === registerId);
                if (index === -1) continue;
                const next = [...list];
                next[index] = { ...next[index], ...patch };
                await ownRef.set({ [key]: next }, { merge: true });
                try { await idbUpdateRegister(registerId, patch); } catch (_) { /* ignore */ }
                return;
            }
        }
    } catch (error) {
        console.warn('사용자 문서 대장 수정 실패:', error);
    }

    try {
        await idbUpdateRegister(registerId, patch);
    } catch (error) {
        console.warn('로컬 대장 수정 실패:', error);
    }
}

// 엑셀 일괄 반영용 — 같은 회차 청크를 한 번씩만 읽고 쓴다
async function updateRegisterRecordsBulk(entries) {
    if (!Array.isArray(entries) || !entries.length) return { updated: 0 };

    const bySurvey = new Map();
    const memoryPatches = new Map();
    entries.forEach(({ registerId, patch }) => {
        if (!registerId || !patch) return;
        memoryPatches.set(registerId, patch);
        const current = registerItems.find((record) => record.id === registerId);
        const surveyId = current?.surveyId || '';
        if (!bySurvey.has(surveyId)) bySurvey.set(surveyId, new Map());
        bySurvey.get(surveyId).set(registerId, patch);
    });

    if (memoryPatches.size) {
        setRegisterItems(registerItems.map((record) => (
            memoryPatches.has(record.id) ? { ...record, ...memoryPatches.get(record.id) } : record
        )));
    }

    let firestoreHits = 0;
    for (const [surveyId, patchesById] of bySurvey.entries()) {
        let hits = 0;
        if (surveyId) {
            try {
                hits = await patchRegisterInChunks(surveyId, patchesById);
            } catch (error) {
                console.warn('분할 대장 일괄 수정 실패:', error);
            }
        }
        // 청크 메타 없음·소량 대장(users.registers)이면 사용자 문서로 폴백
        if (hits < patchesById.size) {
            try {
                const userHits = await patchRegisterInUserDocs(patchesById);
                hits = Math.max(hits, userHits);
            } catch (error) {
                console.warn('사용자 문서 대장 일괄 수정 실패:', error);
            }
        }
        // 그래도 부족하면 건별 저장(청크/문서/로컬 경로를 모두 탄다)
        if (hits < patchesById.size) {
            for (const [registerId, patch] of patchesById.entries()) {
                await updateRegisterRecord(registerId, patch);
                hits += 1;
            }
        }
        firestoreHits += hits;
    }

    for (const [registerId, patch] of memoryPatches.entries()) {
        try { await idbUpdateRegister(registerId, patch); } catch (_) { /* ignore */ }
    }

    return { updated: memoryPatches.size, firestoreHits };
}

window.updateRegisterRecordsBulk = updateRegisterRecordsBulk;

function stopRegisterChunkListener() {
    if (unsubscribeRegisterChunks) {
        unsubscribeRegisterChunks();
        unsubscribeRegisterChunks = null;
    }
    registerChunkSurveyId = '';
}

function listenRegisterChunks(forceSurveyId) {
    const surveyId = forceSurveyId || getRegisterSurveyId();
    if (!surveyId) {
        stopRegisterChunkListener();
        return;
    }
    if (unsubscribeRegisterChunks && registerChunkSurveyId === surveyId) return;

    stopRegisterChunkListener();
    registerChunkSurveyId = surveyId;

    // 다른 회차 청크 데이터는 메모리에서 내려 앱을 가볍게 유지
    const trimmed = registerItems.filter((record) => record.surveyId === surveyId || !record._fromChunk);
    if (trimmed.length !== registerItems.length) setRegisterItems(trimmed);

    unsubscribeRegisterChunks = db.collection('registerChunks')
        .where('surveyId', '==', surveyId)
        .onSnapshot((snapshot) => {
            const byId = new Map();
            snapshot.docs.forEach((doc) => {
                (doc.data()?.rows || []).forEach((record) => {
                    if (record?.id) byId.set(record.id, record);
                });
            });
            replaceRegisterSurveyRows(surveyId, Array.from(byId.values()));
            scheduleRefreshRegisterViews();
        }, (error) => {
            console.warn('분할 대장 구독 실패:', error);
            stopRegisterChunkListener();
            idbReadRegisters().then((localRows) => {
                if (!localRows.length) return;
                const scoped = localRows.filter((row) => row.surveyId === surveyId);
                if (!scoped.length) return;
                replaceRegisterSurveyRows(surveyId, scoped);
                scheduleRefreshRegisterViews();
            });
        });
}

async function markRegisterFound(assetNumber, itemId, extra = {}) {
    const record = findRegisterByAsset(assetNumber);
    if (!record) return;
    const nextStatus = extra.condition && record.condition && extra.condition !== record.condition
        ? 'changed'
        : 'found';
    const patch = {
        status: nextStatus,
        foundItemId: itemId || record.foundItemId || '',
        checkedBy: currentUser?.uid || '',
        checkedByEmail: currentUser?.email || '',
        checkedAt: new Date().toISOString(),
        actualCondition: extra.condition || record.actualCondition || ''
    };
    // 입력한 사용자·위치 등 실사값을 대장에도 반영
    ['holder', 'location', 'itemName', 'organization', 'quantity', 'category', 'model', 'manufacturer'].forEach((key) => {
        if (extra[key] != null && String(extra[key]).trim() !== '') {
            patch[key] = extra[key];
            if (String(record[key] || '').trim() !== String(extra[key]).trim() && nextStatus === 'found') {
                patch.status = 'changed';
            }
        }
    });
    await updateRegisterRecord(record.id, patch);
}

function clearItemEntryFields(options = {}) {
    const keepAssetNumber = options.keepAssetNumber === true;
    const keepContext = options.keepContext !== false;
    const form = document.getElementById('itemForm');
    if (!form) return;

    const preserve = new Set();
    if (keepAssetNumber) preserve.add('assetNumber');
    if (keepContext) {
        ['surveyor', 'organization'].forEach((key) => preserve.add(key));
    }

    form.querySelectorAll('input, select, textarea').forEach((el) => {
        if (!el.name && !el.id) return;
        const key = el.name || el.id;
        if (preserve.has(key)) return;
        if (el.type === 'hidden' && ['goodsClNo', 'goodsClNm', 'usefulLife'].includes(el.id || key)) {
            el.value = '';
            return;
        }
        if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = false;
            return;
        }
        if (el.tagName === 'SELECT') {
            el.selectedIndex = 0;
            return;
        }
        el.value = '';
    });

    const quantity = document.getElementById('quantity');
    if (quantity && !preserve.has('quantity')) quantity.value = '1';

    if (!keepAssetNumber) resetAssetAutofillGuard();

    if (typeof refreshUsefulLifeUi === 'function') refreshUsefulLifeUi({ force: true });
    if (typeof syncChoiceChips === 'function') syncChoiceChips();
    if (typeof updateLocationPreview === 'function') updateLocationPreview();
    if (typeof updateFieldContextChips === 'function') updateFieldContextChips();
    if (typeof clearAssetMatchCandidates === 'function') clearAssetMatchCandidates();
}

function applyRegisterToForm(record, options = {}) {
    // 모바일 입력 끊김 방지: 기본은 덮어쓰기만 하고 전체 clear/내용연수 force는 옵션
    const light = options.light !== false;
    const protectEdits = options.protectEdits === true;
    const recordSnapshot = options.recordSnapshot !== false;
    if (options.clearFirst && !light) {
        clearItemEntryFields({
            keepAssetNumber: options.keepAssetNumber !== false,
            keepContext: options.keepContext === true
        });
    }
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        const next = value != null ? String(value) : '';
        if (options.clearFirst && !light) {
            el.value = next;
            if (recordSnapshot) assetAutofillSnapshot[id] = next;
            return;
        }
        if (!next.trim()) return;
        if (protectEdits) {
            const current = el.value;
            const snapped = assetAutofillSnapshot[id];
            // 사용자가 자동채움 값과 다르게 고친 칸은 유지
            if (current.trim() !== '' && snapped !== undefined && current !== snapped) {
                return;
            }
        }
        el.value = next;
        if (recordSnapshot) assetAutofillSnapshot[id] = next;
    };
    const source = typeof flattenMappedExtras === 'function'
        ? flattenMappedExtras(record, typeof getSurveyFormSchema === 'function' ? getSurveyFormSchema() : null)
        : record;
    const composedLocation = source.location
        || [source.building, source.floor, source.room].map((v) => String(v || '').trim()).filter(Boolean).join(' ')
        || '';
    setValue('itemName', source.itemName || '');
    setValue('location', composedLocation);
    if (!options.keepContext || options.overwriteContext) {
        setValue('organization', source.organization || '');
    } else {
        // keepContext: 기관은 유지, 비어 있을 때만 채움
        const orgEl = document.getElementById('organization');
        if (orgEl && !orgEl.value.trim() && source.organization) orgEl.value = source.organization;
    }
    setValue('holder', source.holder || '');
    setValue('category', source.category || '');
    setValue('quantity', source.quantity || '1');
    setValue('manufacturer', source.manufacturer || '');
    setValue('model', source.model || '');
    setValue('condition', source.condition || '');
    setValue('acquiredAt', source.acquiredAt || '');
    setValue('goodsClNo', source.goodsClNo || '');
    setValue('goodsClNm', source.goodsClNm || '');
    setValue('usefulLife', source.usefulLife != null && source.usefulLife !== '' ? source.usefulLife : '');
    Object.keys(source).forEach((key) => {
        if (!key.startsWith('custom_')) return;
        setValue(key, source[key] || '');
    });
    if (source.extra && typeof source.extra === 'object') {
        Object.keys(source.extra).forEach((header) => {
            const key = typeof customFieldKeyFromHeader === 'function'
                ? customFieldKeyFromHeader(header)
                : '';
            if (key) setValue(key, source.extra[header] || '');
        });
    }
    if (source.organization && typeof selectOrganization === 'function' && (!options.keepContext || options.overwriteContext)) {
        const orgSelect = document.getElementById('organizationSelect');
        if (orgSelect) orgSelect.value = source.organization;
        currentOrganization = source.organization;
    }
    if (typeof updateLocationPreview === 'function') updateLocationPreview();
    if (typeof syncChoiceChips === 'function') syncChoiceChips();
    if (typeof updateFieldContextChips === 'function') updateFieldContextChips();
    // 내용연수 UI는 다음 프레임에 가볍게 갱신 (입력 중 메인스레드 양보)
    if (typeof refreshUsefulLifeUi === 'function' && options.refreshUsefulLife !== false) {
        const runUl = () => refreshUsefulLifeUi({ force: !!options.forceUsefulLife });
        if (light && typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => setTimeout(runUl, 0));
        } else {
            runUl();
        }
    }
}

function updateAssetCheckBanner(options = {}) {
    const banner = document.getElementById('assetCheckBanner');
    const input = document.getElementById('assetNumber');
    if (!banner || !input) return;

    const assetNumber = input.value.trim();
    const wantFill = options.fillForm !== false;
    const forceFill = options.forceFill === true;
    pendingAssetOverride = false;
    banner.className = 'asset-check-banner';
    banner.style.display = 'none';
    banner.textContent = '';

    if (!assetNumber) {
        resetAssetAutofillGuard();
        clearAssetMatchCandidates();
        if (typeof clearBaselineComparePanel === 'function') clearBaselineComparePanel();
        return;
    }

    const assetNorm = normalizeAsset(assetNumber);
    // 같은 자산번호면 배너만 갱신하고 폼은 다시 덮지 않음 (수정값 되돌아감 방지)
    const shouldFill = wantFill && (forceFill || assetNorm !== lastAutofilledAssetNorm);

    let baseline = typeof findBaselineByAsset === 'function' ? findBaselineByAsset(assetNumber) : null;
    let register = findRegisterByAsset(assetNumber);
    const existing = findItemByAsset(assetNumber);
    const expectedCount = getRegisterForSurvey().length;
    const baselineCount = typeof getBaselineForSurvey === 'function' ? getBaselineForSurvey().length : 0;
    const hasExact = !!(baseline || register || existing);

    // 완전 일치가 없으면 끝자리/부분일치 후보만 제시.
    // 입력값을 대장 번호로 자동 덮어쓰지 않음 — 오타·번호 변경이 필요한 현장에서 직접 수정 가능해야 함.
    if (!hasExact) {
        if (typeof clearBaselineComparePanel === 'function') clearBaselineComparePanel();
        const candidates = collectAssetCandidates(assetNumber);
        if (candidates.length > 1) {
            renderAssetMatchCandidates(candidates, assetNumber);
            banner.style.display = 'block';
            banner.classList.add('is-info');
            banner.textContent = `부분 일치 ${candidates.length}건입니다. 맞으면 아래에서 선택하고, 다르면 입력값을 그대로 두세요.`;
            return;
        }
        if (candidates.length === 1) {
            renderAssetMatchCandidates(candidates, assetNumber);
            banner.style.display = 'block';
            banner.classList.add('is-info');
            banner.textContent = '부분 일치 1건입니다. 맞으면 아래에서 선택하고, 자산번호가 다르면 입력값을 수정하세요.';
            return;
        }
        clearAssetMatchCandidates();
    } else {
        clearAssetMatchCandidates();
    }

    if (existing) {
        if (typeof clearBaselineComparePanel === 'function') clearBaselineComparePanel();
        banner.style.display = 'block';
        banner.classList.add('is-danger');
        banner.textContent = `이미 등록된 자산번호입니다. (${existing.itemName || '물품'}) 저장하면 중복으로 남습니다.`;
        pendingAssetOverride = true;
        return;
    }

    const fillOptions = {
        light: true,
        keepAssetNumber: true,
        keepContext: true,
        overwriteContext: false,
        refreshUsefulLife: true,
        forceUsefulLife: false,
        // 이미 채워진 뒤 재호출되면 사용자 수정칸은 건너뜀
        protectEdits: true,
        recordSnapshot: true
    };

    // 기준(작년) 대장이 있으면 입력 양식에 작년 정보를 먼저 채우고 비교 패널을 연다
    if (baseline) {
        if (shouldFill) {
            applyRegisterToForm(baseline, fillOptions);
            markAssetAutofilled(assetNumber);
        }
        if (typeof renderBaselineComparePanel === 'function') {
            renderBaselineComparePanel(baseline, { yearRegister: register });
        }
        banner.style.display = 'block';
        if (register) {
            banner.classList.add('is-success');
            banner.textContent = `기준 대장·금년 대장에 있는 자산입니다. 작년 정보를 채웠으니 현장을 확인한 뒤 저장하세요. (${baseline.itemName || '이름 없음'})`;
        } else {
            banner.classList.add('is-info');
            banner.textContent = `기준(작년) 대장에서 찾았습니다. 정보를 확인·수정한 뒤 저장하세요. (${baseline.itemName || '이름 없음'})`;
        }
        return;
    }

    if (typeof clearBaselineComparePanel === 'function') clearBaselineComparePanel();

    if (register) {
        banner.style.display = 'block';
        if (register.status === 'found' || register.status === 'changed') {
            banner.classList.add('is-warning');
            banner.textContent = `대장에 있고 이미 실사된 자산입니다. 상태: ${register.status === 'changed' ? '상태변경' : '찾음'}`;
        } else if (register.status === 'missing') {
            banner.classList.add('is-warning');
            banner.textContent = '대장에는 있으나 미발견으로 표시된 자산입니다. 저장하면 찾음으로 바뀝니다.';
        } else {
            banner.classList.add('is-success');
            banner.textContent = `금년 대장에 있는 예정 자산입니다. 저장하면 "찾음"으로 처리됩니다. (${register.itemName || '이름 없음'})`;
        }
        if (shouldFill) {
            applyRegisterToForm(register, fillOptions);
            markAssetAutofilled(assetNumber);
        }
        return;
    }

    if (normalizeAsset(assetNumber).length < ASSET_PARTIAL_MIN_LEN) {
        banner.style.display = 'block';
        banner.classList.add('is-info');
        banner.textContent = `부분 검색은 ${ASSET_PARTIAL_MIN_LEN}자 이상 입력하세요.`;
        return;
    }

    if (baselineCount > 0) {
        banner.style.display = 'block';
        banner.classList.add('is-info');
        banner.textContent = '기준(작년) 대장에 없는 자산번호입니다. 신규로 저장됩니다.';
        return;
    }

    if (expectedCount > 0) {
        banner.style.display = 'block';
        banner.classList.add('is-info');
        banner.textContent = '금년 대장에 없는 자산번호입니다. 저장하면 신규 발견으로 집계됩니다.';
    }
}

function scheduleAssetCheck() {
    clearTimeout(assetCheckTimer);
    const input = document.getElementById('assetNumber');
    const scheduledNorm = normalizeAsset(input?.value || '');
    // 모바일 타이핑 끊김 완화: 디바운스를 조금 더 길게
    const delay = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 767px)').matches)
        ? 450
        : 280;
    assetCheckTimer = setTimeout(() => {
        assetCheckTimer = null;
        const currentNorm = normalizeAsset(document.getElementById('assetNumber')?.value || '');
        // 입력 중 값이 바뀌었거나, 이미 같은 자산으로 채운 뒤에는 폼을 다시 덮지 않음
        if (!currentNorm || currentNorm !== scheduledNorm) {
            updateAssetCheckBanner({ fillForm: false });
            return;
        }
        updateAssetCheckBanner({
            fillForm: currentNorm !== lastAutofilledAssetNorm
        });
    }, delay);
}

function handleAssetNumberBlur() {
    // 포커스를 다른 칸으로 옮긴 뒤 늦게 도착하는 fillForm:true 타이머가 수정값을 덮어쓰는 것이 핵심 원인
    clearTimeout(assetCheckTimer);
    assetCheckTimer = null;
    const norm = normalizeAsset(document.getElementById('assetNumber')?.value || '');
    updateAssetCheckBanner({
        fillForm: !!(norm && norm !== lastAutofilledAssetNorm)
    });
}

async function confirmAssetDuplicate() {
    const input = document.getElementById('assetNumber');
    const assetNumber = input?.value.trim();
    if (!assetNumber) return true;
    const existing = findItemByAsset(assetNumber);
    if (!existing) return true;
    return confirm(`자산번호 "${assetNumber}"는 이미 "${existing.itemName || '다른 물품'}"으로 등록되어 있습니다.\n그래도 저장할까요?`);
}

const REGISTER_SYSTEM_FIELDS = [
    { key: 'assetNumber', label: '자산번호', required: true, aliases: ['자산번호', '관리번호', '자산no', '자산코드', '자산id', '식별번호', 'rfid번호', '태그', '바코드', '일련번호', 'asset', 'tag', 'barcode'] },
    // 자산명=현장 표기, 품명=대장 분류명. 둘 다 있어야 사람이 분류를 가릴 수 있다
    { key: 'itemName', label: '물품명', required: true, aliases: ['자산명', '물품명', '물품', '명칭', '품목명', '품목', 'name', 'item'] },
    { key: 'goodsClNm', label: '분류명', aliases: ['품명', '분류명', '물품분류명', '세부품명', '고시품명', '물품분류', 'goodsclnm', 'classname'] },
    { key: 'organization', label: '기관명', aliases: ['기관명', '기관', '조사부서', '소속', '부서', '관리부서', '사용부서', 'organization'] },
    { key: 'holder', label: '사용자', aliases: ['사용자', '사용인', '관리책임자', '보관자', '담당자', '사용자명', 'holder', 'user', 'custodian'] },
    { key: 'location', label: '사용위치', aliases: ['사용위치', '현 사용위치', '위치', '설치위치', '보관위치', '장소', 'location'] },
    { key: 'building', label: '건물', aliases: ['건물', '동', '건물명', '단과대학', 'building'] },
    { key: 'floor', label: '층', aliases: ['층', '층수', 'floor'] },
    { key: 'room', label: '실/호', aliases: ['실', '호', '호실', '실명', '학과', 'room'] },
    // 카테고리보다 먼저 둬야 전용 분류번호 열을 이쪽이 가져간다
    { key: 'goodsClNo', label: '물품분류번호', aliases: ['물품분류번호', '세부품명번호', '품명번호', '분류번호', '물품코드', 'goodsclno'] },
    { key: 'category', label: '계정과목', aliases: ['계정과목명', '계정과목', '카테고리', '분류', '품목분류', '자산분류', '계정', 'category'] },
    { key: 'quantity', label: '갯수', aliases: ['취득수량', '갯수', '수량', '수량(개)', 'qty', 'quantity'] },
    { key: 'acquiredAt', label: '취득일자', aliases: ['취득일자', '취득년월일', '취득일', '취득년월', '구입일자', '구입일', '구매일자', '구매일', '등록일자', 'acquired', 'acquisitiondate'] },
    { key: 'usefulLife', label: '내용연수', aliases: ['내용연수', '내용연수(년)', '내용년수', '내용년수(년)', 'usefulife', 'usefullife', 'life'] },
    { key: 'manufacturer', label: '제조사', aliases: ['제조사', '제작사', '메이커', '브랜드', 'manufacturer'] },
    { key: 'model', label: '규격', aliases: ['규격', '모델명', '모델', '사양', '규격및모델', 'model'] },
    { key: 'condition', label: '상태', aliases: ['상태', '물품상태', '현재상태', '보유여부', 'condition'] }
];

let pendingRegisterImport = null;

function normalizeHeader(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s\-_.()\[\]]/g, '');
}

function headerSignature(headers) {
    return headers.map(normalizeHeader).filter(Boolean).sort().join('|');
}

// 값이 없으면 1로 채우지만, 값이 있는데 범위를 벗어나면 날짜를 지어내지 않고 포기한다
function toDateKey(year, month, day) {
    if (!(year >= 1900 && year <= 2100)) return '';
    const m = month === undefined ? 1 : month;
    if (!(m >= 1 && m <= 12)) return '';
    const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const d = day === undefined ? 1 : day;
    if (!(d >= 1 && d <= lastDay)) return '';
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 엑셀은 취득일자를 2018-03-15, 2018. 3. 15, 2018년 3월, 20180315, 날짜 시리얼 등 제각각으로 준다.
// 연·월만 있으면 1일로, 연도만 있으면 1월 1일로 채운다
function parseAcquiredDate(value) {
    if (value == null || value === '') return '';
    // XLSX가 Date 객체를 줄 수도 있다. instanceof는 realm이 다르면 실패하므로 쓰지 않는다
    if (Object.prototype.toString.call(value) === '[object Date]') {
        return Number.isNaN(value.getTime()) ? '' : toDateKey(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }

    const text = String(value).trim();
    if (!text) return '';
    const parts = text.match(/\d+/g) || [];
    if (!parts.length) return '';

    if (parts.length >= 2 && parts[0].length === 4) {
        return toDateKey(Number(parts[0]), Number(parts[1]), parts.length >= 3 ? Number(parts[2]) : undefined);
    }

    const digits = parts.join('');
    if (parts.length === 1) {
        if (digits.length === 8) return toDateKey(+digits.slice(0, 4), +digits.slice(4, 6), +digits.slice(6, 8));
        if (digits.length === 6) return toDateKey(+digits.slice(0, 4), +digits.slice(4, 6));
        if (digits.length === 4) return toDateKey(+digits);
    }

    // 서식이 안 걸린 날짜 셀은 1899-12-30 기준 일련번호로 넘어온다
    const serial = Number(text);
    if (Number.isFinite(serial) && serial >= 367 && serial <= 73415) {
        const parsed = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
        return toDateKey(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
    }
    return '';
}

// 세부품명번호 10자리로 들어오면 앞 8자리가 물품분류번호다
function normalizeGoodsClNo(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 8 ? digits.slice(0, 8) : '';
}

function headerMatchesAlias(header, alias) {
    const normalized = normalizeHeader(header);
    const key = normalizeHeader(alias);
    if (!normalized || !key) return false;
    if (normalized === key) return true;
    if (key.length < 2) return false;
    if (normalized.startsWith(key) || (normalized.length >= 2 && key.startsWith(normalized))) return true;
    if (key.length >= 3 && (normalized.includes(key) || (normalized.length >= 3 && key.includes(normalized)))) return true;
    return false;
}

const LIST_HEADER_HINTS = ['자산번호', '자산명', '품명', '물품명', '관리번호', '사용위치', '취득', '수량', '규격', '분류', '소속', '순번', 'rfid', '식별', '취득일자', '조사부서'];

function filledCells(row) {
    return (row || []).map((cell) => String(cell ?? '').trim()).filter(Boolean);
}

function isEmptyRow(row) {
    return filledCells(row).length === 0;
}

function isTitleOrMemoRow(row) {
    const cells = filledCells(row);
    if (cells.length === 0) return true;
    if (cells.length <= 2 && cells.some((cell) => cell.length >= 18)) return true;
    if (cells.some((cell) => /기준\s*:|작성일|메모|참고|합계|총계/.test(cell))) return true;
    return false;
}

function looksLikeSeqNumber(row) {
    const first = String(row?.[0] ?? '').trim().replace(/,/g, '');
    return /^\d+$/.test(first);
}

function isHeaderLike(row) {
    if (looksLikeSeqNumber(row)) return false;
    const cells = filledCells(row);
    if (cells.length < 4) return false;
    const labels = cells.filter((cell) => /[가-힣a-zA-Z]/.test(cell) && !/^\d[\d,]*$/.test(cell) && cell.length <= 24);
    const hints = cells.filter((cell) => LIST_HEADER_HINTS.some((hint) => normalizeHeader(cell).includes(normalizeHeader(hint)))).length;
    return labels.length >= 4 && hints >= 1;
}

function isDataLike(row, headerFillCount) {
    const cells = filledCells(row);
    if (cells.length < 2) return false;
    const first = String(row?.[0] ?? '').trim().replace(/,/g, '');
    const sequential = /^\d+$/.test(first);
    const wideEnough = cells.length >= Math.max(2, Math.floor((headerFillCount || 4) * 0.25));
    return sequential || wideEnough;
}

function countConsecutiveDataRows(table, headerIndex) {
    const headerFill = filledCells(table[headerIndex]).length;
    let run = 0;
    let skippedEmpty = 0;
    for (let i = headerIndex + 1; i < table.length; i += 1) {
        if (isEmptyRow(table[i])) {
            if (run === 0) continue;
            skippedEmpty += 1;
            if (skippedEmpty > 2) break;
            continue;
        }
        skippedEmpty = 0;
        if (isHeaderLike(table[i]) && run > 20) break;
        if (isDataLike(table[i], headerFill)) run += 1;
        else if (run > 5) break;
        else if (isTitleOrMemoRow(table[i]) && run === 0) continue;
        else break;
    }
    return run;
}

function findListStart(table) {
    let best = { index: 0, score: -1, run: 0 };
    const limit = Math.min(table.length, 40);
    for (let i = 0; i < limit; i += 1) {
        if (!isHeaderLike(table[i])) continue;
        const run = countConsecutiveDataRows(table, i);
        const hints = filledCells(table[i]).filter((cell) =>
            LIST_HEADER_HINTS.some((hint) => normalizeHeader(cell).includes(normalizeHeader(hint)))
        ).length;
        const score = run * 3 + hints * 25;
        if (score > best.score) best = { index: i, score, run };
    }
    if (best.score < 0) {
        return { index: detectHeaderRowFallback(table), run: 0 };
    }
    return best;
}

function detectHeaderRowFallback(table) {
    let best = { index: 0, score: -1 };
    const limit = Math.min(table.length, 20);
    for (let i = 0; i < limit; i += 1) {
        const cells = filledCells(table[i]);
        const unique = new Set(cells.map(normalizeHeader));
        const textLike = cells.filter((cell) => /[가-힣a-zA-Z]/.test(cell)).length;
        const score = unique.size * 2 + textLike;
        if (score > best.score) best = { index: i, score };
    }
    return best.index;
}

function rowsFromHeader(table, headerIndex) {
    const uniqueHeaders = [];
    (table[headerIndex] || []).forEach((cell, index) => {
        const raw = String(cell || '').trim();
        const name = raw || `열${index + 1}`;
        uniqueHeaders[index] = uniqueHeaders.includes(name) ? `${name}_${index + 1}` : name;
    });
    const rows = table.slice(headerIndex + 1).map((line) => {
        const row = {};
        uniqueHeaders.forEach((header, index) => {
            row[header] = String(line?.[index] ?? '').trim();
        });
        return row;
    }).filter((row) => Object.values(row).some((value) => value));
    return {
        headers: uniqueHeaders.filter(Boolean),
        rows
    };
}

function analyzeRegisterSheet(workbook, preferredSheet) {
    const sheetNames = workbook.SheetNames || [];
    const analyses = sheetNames.map((sheetName) => {
        const table = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
        const start = table.length ? findListStart(table) : { index: 0, run: 0, score: -1 };
        const extracted = table.length ? rowsFromHeader(table, start.index) : { headers: [], rows: [] };
        const hintScore = extracted.headers.filter((header) =>
            LIST_HEADER_HINTS.some((hint) => normalizeHeader(header).includes(normalizeHeader(hint)))
        ).length;
        return {
            sheetName,
            headerIndex: start.index,
            run: start.run || extracted.rows.length,
            score: extracted.rows.length * 2 + (start.run || 0) * 2 + hintScore * 30,
            headers: extracted.headers,
            rows: extracted.rows
        };
    }).filter((sheet) => sheet.headers.length && sheet.rows.length);

    if (!analyses.length) throw new Error('목록으로 볼 시트를 찾지 못했습니다');

    const selected = analyses.find((sheet) => sheet.sheetName === preferredSheet)
        || analyses.slice().sort((a, b) => b.score - a.score)[0];

    return {
        ...selected,
        analyses,
        sheets: analyses.map((sheet) => ({
            name: sheet.sheetName,
            rows: sheet.rows.length,
            headerIndex: sheet.headerIndex,
            score: sheet.score
        }))
    };
}

function headerFillRate(rows, header) {
    if (!header || !rows.length) return 0;
    const sample = rows.slice(0, 80);
    let filled = 0;
    sample.forEach((row) => {
        if (String(row[header] || '').trim()) filled += 1;
    });
    return filled / sample.length;
}

function suggestRegisterMapping(headers, savedProfile, rows = []) {
    const mapping = {};
    const used = new Set();
    if (savedProfile?.mapping) {
        REGISTER_SYSTEM_FIELDS.forEach((field) => {
            const saved = savedProfile.mapping[field.key];
            if (saved && headers.includes(saved)) {
                mapping[field.key] = saved;
                used.add(saved);
            }
        });
    }
    REGISTER_SYSTEM_FIELDS.forEach((field) => {
        if (mapping[field.key]) return;
        const candidates = headers.filter((header) => {
            if (used.has(header)) return false;
            return field.aliases.some((alias) => headerMatchesAlias(header, alias));
        });
        if (!candidates.length) return;
        const aliasRank = (header) => {
            const index = field.aliases.findIndex((alias) => headerMatchesAlias(header, alias));
            return index === -1 ? 99 : index;
        };
        const hit = candidates.slice().sort((a, b) => {
            const fillDiff = headerFillRate(rows, b) - headerFillRate(rows, a);
            if (Math.abs(fillDiff) > 0.1) return fillDiff;
            return aliasRank(a) - aliasRank(b);
        })[0];
        mapping[field.key] = hit;
        used.add(hit);
    });
    return mapping;
}

function applyRegisterMapping(rows, mapping, formSchema = null) {
    const keepExtra = rows.length <= 400;
    const schema = formSchema
        || (typeof pendingRegisterImport !== 'undefined' ? pendingRegisterImport?.formSchema : null)
        || (typeof getSurveyFormSchema === 'function' ? getSurveyFormSchema() : null);
    const customFields = (schema?.fields || []).filter((field) => field.custom && field.excelHeader);
    return rows.map((row) => {
        const mapped = {};
        REGISTER_SYSTEM_FIELDS.forEach((field) => {
            const header = mapping[field.key];
            mapped[field.key] = header ? String(row[header] || '').trim() : '';
        });
        if (keepExtra) {
            const extra = {};
            Object.keys(row).forEach((header) => {
                if (!Object.values(mapping).includes(header) && row[header]) {
                    extra[header] = row[header];
                }
            });
            if (Object.keys(extra).length) mapped.extra = extra;
        }
        customFields.forEach((field) => {
            const raw = row[field.excelHeader];
            if (raw != null && String(raw).trim() !== '') {
                mapped[field.key] = String(raw).trim();
            }
        });
        if (!mapped.location) {
            mapped.location = [mapped.building, mapped.floor, mapped.room].filter(Boolean).join(' ');
        }
        if (!mapped.quantity) mapped.quantity = '1';
        // 품명만 있고 자산명이 비면 물품명으로 쓴다. 반대는 하지 않아 두 정보를 지킨다
        if (!mapped.itemName && mapped.goodsClNm) mapped.itemName = mapped.goodsClNm;
        const rawGoodsCl = mapped.goodsClNo;
        mapped.goodsClNo = normalizeGoodsClNo(rawGoodsCl);
        // 분류번호 열을 goodsClNo가 가져가도 기존 분류 표시가 비지 않게 한다
        if (!mapped.category && rawGoodsCl) mapped.category = rawGoodsCl;
        mapped.acquiredAt = parseAcquiredDate(mapped.acquiredAt);
        // 내용연수: 숫자 / 「미고시」 / 공란
        const lifeRaw = String(mapped.usefulLife || '').trim();
        if (!lifeRaw) {
            delete mapped.usefulLife;
        } else if (lifeRaw === '미고시') {
            mapped.usefulLife = 0;
            mapped.usefulLifeMatch = 'import-unnotified';
        } else if (/^\d+(\.\d+)?$/.test(lifeRaw)) {
            mapped.usefulLife = Number(lifeRaw);
            mapped.usefulLifeMatch = mapped.usefulLifeMatch || 'import';
        } else {
            delete mapped.usefulLife;
        }
        return mapped;
    }).filter((row) => row.assetNumber || row.itemName);
}

async function loadMappingProfiles() {
    if (!currentUser) return [];
    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        return Array.isArray(doc.data()?.registerMappings) ? doc.data().registerMappings : [];
    } catch (error) {
        console.warn('매핑 프로필 로드 실패:', error);
        return JSON.parse(localStorage.getItem('registerMappings') || '[]');
    }
}

async function saveMappingProfile(profile) {
    const existing = await loadMappingProfiles();
    const previous = existing.find((item) => item.headerSignature === profile.headerSignature);
    const next = [
        {
            ...profile,
            usedCount: (previous?.usedCount || 0) + 1,
            lastUsed: new Date().toISOString()
        },
        ...existing.filter((item) => item.headerSignature !== profile.headerSignature)
    ].slice(0, 20);
    try {
        await db.collection('users').doc(currentUser.uid).set({ registerMappings: next }, { merge: true });
    } catch (error) {
        console.warn('매핑 프로필 저장 실패, 로컬에 보관:', error);
        localStorage.setItem('registerMappings', JSON.stringify(next));
    }
}

function applyPendingSheet(sheetName) {
    const pending = pendingRegisterImport;
    if (!pending?.analyses) return;
    const sheet = pending.analyses.find((item) => item.sheetName === sheetName);
    if (!sheet) return;
    pending.sheetName = sheet.sheetName;
    pending.headerIndex = sheet.headerIndex;
    pending.headers = sheet.headers;
    pending.rows = sheet.rows;
    pending.run = sheet.run;
    const signature = headerSignature(sheet.headers);
    pending.profile = (pending.profiles || []).find((item) => item.headerSignature === signature) || null;
    pending.mapping = suggestRegisterMapping(sheet.headers, pending.profile, sheet.rows);
    pending.formSchema = pending.profile?.formSchema || null;
    renderRegisterMappingModal();
}

function renderRegisterMappingModal() {
    const pending = pendingRegisterImport;
    if (!pending) return;
    const summary = document.getElementById('registerMapSummary');
    const profileEl = document.getElementById('registerMapProfile');
    const fields = document.getElementById('registerMapFields');
    const preview = document.getElementById('registerMapPreview');
    const sheetWrap = document.getElementById('registerSheetWrap');
    const sheetSelect = document.getElementById('registerSheetSelect');
    const titleEl = document.getElementById('registerMapTitle');
    const confirmBtn = document.getElementById('confirmRegisterMapBtn');
    if (!summary || !fields || !preview) return;

    const isBaseline = pending.purpose === 'baseline';
    if (titleEl) titleEl.textContent = isBaseline ? '기준(작년) 대장 열 맞추기' : '대장 열 맞추기';
    if (confirmBtn) confirmBtn.textContent = isBaseline ? '✅ 기준 대장으로 저장' : '✅ 이 매핑으로 가져오기';

    const startHint = pending.run > 20
        ? `연속 목록 ${pending.run}행`
        : `목록 ${pending.rows.length}행`;
    const purposeHint = isBaseline ? ' · 입력 탭 비교용 기준 대장' : '';
    summary.textContent = `"${pending.fileName}" · ${pending.sheetName} · 제목행 ${pending.headerIndex + 1}번째 · ${startHint} · 열 ${pending.headers.length}개${purposeHint}`;

    if (sheetWrap && sheetSelect && pending.analyses?.length > 1) {
        sheetWrap.style.display = 'flex';
        sheetSelect.innerHTML = pending.analyses.map((sheet) =>
            `<option value="${escapeHtml(sheet.sheetName)}">${escapeHtml(sheet.sheetName)} (${sheet.rows.length}건)</option>`
        ).join('');
        sheetSelect.value = pending.sheetName;
        sheetSelect.onchange = () => applyPendingSheet(sheetSelect.value);
    } else if (sheetWrap) {
        sheetWrap.style.display = 'none';
    }

    if (pending.profile) {
        profileEl.style.display = 'block';
        profileEl.textContent = `이전에 같은 열 구성의 대장을 ${pending.profile.usedCount || 1}번 맞춘 기록이 있어 그대로 제안합니다.`;
    } else {
        profileEl.style.display = 'none';
    }

    const options = ['<option value="">맞추지 않음</option>']
        .concat(pending.headers.map((header) => `<option value="${escapeHtml(header)}">${escapeHtml(header)}</option>`))
        .join('');

    fields.innerHTML = REGISTER_SYSTEM_FIELDS.map((field) => {
        const sampleHeader = pending.mapping[field.key];
        const sample = sampleHeader ? pending.rows.find((row) => row[sampleHeader])?.[sampleHeader] : '';
        return `
            <div class="register-map-row">
                <label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>
                <select data-map-field="${field.key}">${options}</select>
                <span class="register-map-sample">${sample ? `예: ${escapeHtml(sample)}` : '샘플 없음'}</span>
            </div>
        `;
    }).join('');

    fields.querySelectorAll('select[data-map-field]').forEach((select) => {
        select.value = pending.mapping[select.dataset.mapField] || '';
        select.addEventListener('change', (e) => {
            pending.mapping[e.target.dataset.mapField] = e.target.value;
            // 매핑이 바뀌면 입력폼 항목 후보를 다시 계산
            pending.formSchema = null;
            renderRegisterMappingModal();
        });
    });

    if (typeof renderRegisterFormSchemaSection === 'function') {
        renderRegisterFormSchemaSection();
    }

    if (typeof syncPendingFormFieldSelections === 'function') {
        syncPendingFormFieldSelections();
    }

    const mappedRows = applyRegisterMapping(pending.rows.slice(0, 3), pending.mapping, pending.formSchema);
    if (mappedRows.length === 0) {
        preview.innerHTML = '<p class="register-empty">자산번호 또는 물품명이 연결된 행이 없습니다.</p>';
        return;
    }
    preview.innerHTML = `
        <table class="register-preview-table">
            <thead>
                <tr>
                    <th>자산번호</th>
                    <th>물품명</th>
                    <th>위치</th>
                    <th>상태</th>
                </tr>
            </thead>
            <tbody>
                ${mappedRows.map((row) => `
                    <tr>
                        <td>${escapeHtml(row.assetNumber || '-')}</td>
                        <td>${escapeHtml(row.itemName || '-')}</td>
                        <td>${escapeHtml(row.location || '-')}</td>
                        <td>${escapeHtml(row.condition || '-')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function openRegisterMapModal() {
    const modal = document.getElementById('registerMapModal');
    if (!modal) return;
    renderRegisterMappingModal();
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeRegisterMapModal() {
    const modal = document.getElementById('registerMapModal');
    if (modal) modal.classList.remove('show');
    document.body.style.overflow = 'auto';
    pendingRegisterImport = null;
}

async function handleRegisterImport(file, purpose = 'import') {
    const survey = typeof getWritableSurvey === 'function' ? getWritableSurvey() : getCurrentSurvey();
    if (!survey || survey.isFallback || !survey.id) {
        showToast(purpose === 'baseline'
            ? '기준 대장을 올리려면 진행 중인 조사 회차를 먼저 선택하세요'
            : '대장을 올리려면 진행 중인 조사 회차를 먼저 선택하세요', 'error');
        return;
    }
    if (!file) return;

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const analyzed = analyzeRegisterSheet(workbook);
        if (!analyzed.headers.length || analyzed.rows.length === 0) {
            showToast('제목 행이나 데이터 행을 찾지 못했습니다', 'error');
            return;
        }
        const profiles = await loadMappingProfiles();
        const signature = headerSignature(analyzed.headers);
        const profile = profiles.find((item) => item.headerSignature === signature);
        pendingRegisterImport = {
            purpose: purpose === 'baseline' ? 'baseline' : 'import',
            fileName: file.name,
            survey,
            analyses: analyzed.analyses,
            sheets: analyzed.sheets,
            sheetName: analyzed.sheetName,
            headerIndex: analyzed.headerIndex,
            headers: analyzed.headers,
            rows: analyzed.rows,
            run: analyzed.run,
            profiles,
            mapping: suggestRegisterMapping(analyzed.headers, profile, analyzed.rows),
            profile,
            formSchema: profile?.formSchema || null
        };
        openRegisterMapModal();
    } catch (error) {
        console.error('대장 분석 실패:', error);
        showToast('대장 파일을 분석하지 못했습니다', 'error');
    }
}


async function confirmRegisterMapping() {
    const pending = pendingRegisterImport;
    if (!pending) return;
    if (!pending.mapping.assetNumber && !pending.mapping.itemName) {
        showToast('자산번호 또는 물품명 열은 반드시 맞춰 주세요', 'error');
        return;
    }
    if (typeof syncPendingFormFieldSelections === 'function') {
        syncPendingFormFieldSelections();
    }
    if (!pending.formSchema && typeof buildFormSchemaFromMapping === 'function') {
        pending.formSchema = buildFormSchemaFromMapping(
            pending.mapping,
            pending.headers,
            pending.rows,
            null
        );
    }
    const rows = applyRegisterMapping(pending.rows, pending.mapping, pending.formSchema);
    if (rows.length === 0) {
        showToast('맞춘 열 기준으로 가져올 행이 없습니다', 'error');
        return;
    }

    const persistSchemaAndProfile = async () => {
        if (typeof saveFormSchemaToSurvey === 'function' && pending.formSchema) {
            await saveFormSchemaToSurvey(pending.survey.id, pending.formSchema);
        }
        await saveMappingProfile({
            id: newMasterId('map'),
            headerSignature: headerSignature(pending.headers),
            headers: pending.headers,
            mapping: pending.mapping,
            formSchema: pending.formSchema || null,
            fileName: pending.fileName,
            sheetName: pending.sheetName
        });
        if (typeof applyFormSchemaForCurrentSurvey === 'function') {
            applyFormSchemaForCurrentSurvey();
        }
    };

    if (pending.purpose === 'baseline') {
        if (!pending.mapping.assetNumber) {
            showToast('기준 대장에는 자산번호 열이 필요합니다', 'error');
            return;
        }
        const baselineRecords = rows.map((row) => ({
            id: newMasterId('bl'),
            surveyId: pending.survey.id,
            surveyName: pending.survey.name,
            status: 'baseline',
            createdBy: currentUser.uid,
            createdAt: new Date().toISOString(),
            sourceFile: pending.fileName,
            isBaseline: true,
            ...row
        }));
        try {
            if (typeof saveBaselinesForSurvey !== 'function') {
                showToast('기준 대장 모듈을 불러오지 못했습니다', 'error');
                return;
            }
            const saved = await saveBaselinesForSurvey(pending.survey.id, baselineRecords);
            await persistSchemaAndProfile();
            closeRegisterMapModal();
            if (saved?.stored === 'local') {
                showToast(`기준 대장 ${baselineRecords.length}건을 이 기기에 저장했습니다`, 'success');
            } else {
                showToast(`기준(작년) 대장 ${baselineRecords.length}건을 현재 회차에 저장했습니다. 입력 탭에서 자산번호로 조회하세요`, 'success');
            }
            if (typeof updateBaselineStatusUi === 'function') updateBaselineStatusUi();
            if (typeof switchTab === 'function') {
                setTimeout(() => {
                    if (confirm('기준 대장을 저장했습니다.\n입력 탭으로 이동해 실사를 시작할까요?')) {
                        switchTab('input');
                    }
                }, 300);
            }
        } catch (error) {
            console.error('기준 대장 저장 실패:', error);
            showToast('기준 대장 저장에 실패했습니다', 'error');
        }
        return;
    }

    const records = rows.map((row) => ({
        id: newMasterId('rg'),
        surveyId: pending.survey.id,
        surveyName: pending.survey.name,
        status: 'pending',
        createdBy: currentUser.uid,
        createdAt: new Date().toISOString(),
        sourceFile: pending.fileName,
        ...row
    }));

    try {
        const saved = await saveRegistersForSurvey(pending.survey.id, records);
        await persistSchemaAndProfile();
        closeRegisterMapModal();
        if (saved?.stored === 'local') {
            showToast(`${pending.survey.name} 대장 ${records.length}건을 이 기기에 가져왔습니다. 다른 사용자와 공유하려면 서버 권한 배포가 필요합니다`, 'success');
        } else {
            showToast(`${pending.survey.name} 대장 ${records.length}건을 열 매핑 후 가져왔습니다`, 'success');
        }
        refreshRegisterViews();
        if (typeof switchTab === 'function' && records.length) {
            setTimeout(() => {
                if (confirm(`대장 ${records.length}건을 가져왔습니다.\n입력 항목이 엑셀 매핑에 맞춰졌습니다. 입력 탭으로 이동할까요?`)) {
                    switchTab('input');
                }
            }, 300);
        }
    } catch (error) {
        console.error('대장 저장 실패:', error);
        showToast('대장 저장에 실패했습니다. 파일이 매우 크면 잠시 후 다시 시도해 주세요', 'error');
    }
}

// 대장 전체를 내용연수 매칭 결과와 함께 내보낸다. 화면을 만들기 전에 결과를 눈으로 확인하는 용도다
async function exportRegisterUsefulLife() {
    if (typeof describeUsefulLife !== 'function') {
        showToast('내용연수 모듈을 불러오지 못했습니다', 'error');
        return;
    }
    const scoped = getRegisterForSurvey(getRegisterSurveyId());
    if (!scoped.length) {
        showToast('내보낼 대장이 없습니다. 먼저 대장 엑셀을 올려 주세요', 'error');
        return;
    }
    if (!(await ensureUsefulLifeTable())) {
        showToast('내용연수 표를 불러오지 못했습니다', 'error');
        return;
    }

    try {
        const surveyedIndex = buildSurveyedIndex();
        const today = isoDateKey(new Date());
        const verdicts = { resolved: 0, unnotified: 0, ambiguous: 0, missing: 0 };
        const statuses = { expired: 0, due: 0, ok: 0, unknown: 0 };
        const uniqueNames = new Set();
        const needsCheck = new Map();
        let withDate = 0;

        const detail = scoped.map((record) => {
            const className = String(record.goodsClNm || '').trim();
            const specHead = String(record.model || '').split(',')[0].trim();
            const itemName = String(record.itemName || '').trim();
            const info = describeUsefulLife({
                itemName: className || specHead || itemName,
                goodsClNo: record.goodsClNo,
                acquiredAt: record.acquiredAt
            }, today);

            verdicts[info.verdict] += 1;
            statuses[info.status] += 1;
            if (record.acquiredAt) withDate += 1;

            const nameKey = normalizeGoodsName(record.itemName);
            const classKey = normalizeGoodsName(record.goodsClNm);
            const checkKey = [nameKey, classKey].filter(Boolean).join('|') || nameKey;
            if (nameKey) uniqueNames.add(nameKey);
            // 확인이 필요한 건 물품명+분류명 단위로 묶는다. 같은 자산명이라도 품명이 다르면 따로 본다
            if (checkKey && (info.verdict === 'ambiguous' || info.verdict === 'missing')) {
                const bucket = needsCheck.get(checkKey);
                if (bucket) {
                    bucket.count += 1;
                    if (!bucket.specSample && record.model) bucket.specSample = record.model;
                } else {
                    needsCheck.set(checkKey, {
                        itemName: record.itemName,
                        goodsClNm: record.goodsClNm || '',
                        category: record.category || '',
                        specSample: record.model || '',
                        count: 1,
                        info
                    });
                }
            }

            return {
                '자산번호': record.assetNumber || '',
                '물품명': record.itemName || '',
                '분류명': record.goodsClNm || '',
                '분류번호': record.goodsClNo || '',
                '규격': record.model || '',
                '계정과목': record.category || '',
                '대조상태': REGISTER_STATUS[resolveRegisterStatus(record, surveyedIndex)]?.label || '',
                '취득일자': record.acquiredAt || '',
                '매칭판정': USEFUL_LIFE_VERDICT_LABEL[info.verdict] || '',
                '매칭경로': USEFUL_LIFE_MATCH_LABEL[info.match] || '',
                '고시분류번호': info.goodsClNo,
                '고시품명': info.goodsClNm,
                '내용연수': info.usefulLife || '',
                '만료일': info.expiry,
                '내구연한': USEFUL_LIFE_STATUS_LABEL[info.status] || '',
                // 미산정이면 비고에 이유가 적히므로 같은 말을 두 번 쓰지 않는다
                '경과·남은기간': info.status === 'unknown' ? '' : info.label,
                '비고': info.note,
                '후보': usefulLifeCandidateText(info.candidates),
                '위치': registerRowLocation(record),
                '수량': record.quantity || ''
            };
        });

        const checkList = [...needsCheck.values()]
            .sort((a, b) => b.count - a.count)
            .map((entry) => ({
                '물품명': entry.itemName,
                '분류명': entry.goodsClNm || '',
                '규격 예시': entry.specSample || '',
                '계정과목': entry.category || '',
                '대장 건수': entry.count,
                '판정': USEFUL_LIFE_VERDICT_LABEL[entry.info.verdict] || '',
                '후보 수': entry.info.candidates.length,
                '후보': usefulLifeCandidateText(entry.info.candidates, 12)
            }));

        const meta = getUsefulLifeMeta() || {};
        const summary = [
            ['대장 총 건수', scoped.length],
            ['고유 물품명', uniqueNames.size],
            ['', ''],
            ['매칭 확정', verdicts.resolved],
            ['매칭 미고시', verdicts.unnotified],
            ['매칭 확인필요', verdicts.ambiguous],
            ['매칭 못찾음', verdicts.missing],
            ['', ''],
            ['내구연한 경과', statuses.expired],
            ['내구연한 임박(1년 이내)', statuses.due],
            ['내구연한 정상', statuses.ok],
            ['내구연한 미산정', statuses.unknown],
            ['', ''],
            ['취득일자 있음', withDate],
            ['취득일자 없음', scoped.length - withDate],
            ['', ''],
            ['사람이 확인할 고유 물품명', checkList.length],
            ['학습된 사전 항목', typeof getUsefulLifeAliases === 'function' ? getUsefulLifeAliases().length : 0],
            ['', ''],
            ['내용연수 표 기준일', meta.기준일 || ''],
            ['내용연수 표 건수', meta.건수 || 0],
            ['그중 고시 건수', meta.고시건수 || 0],
            ['내보낸 날짜', today]
        ].map(([항목, 값]) => ({ 항목, 값 }));

        const workbook = XLSX.utils.book_new();
        const detailSheet = XLSX.utils.json_to_sheet(detail);
        detailSheet['!cols'] = [
            { wch: 16 }, { wch: 24 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
            { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 24 }, { wch: 9 },
            { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 24 }, { wch: 50 },
            { wch: 20 }, { wch: 6 }
        ];
        XLSX.utils.book_append_sheet(workbook, detailSheet, '대조결과');

        const checkSheet = XLSX.utils.json_to_sheet(checkList.length ? checkList : [{ '물품명': '확인이 필요한 물품명이 없습니다' }]);
        checkSheet['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 90 }];
        XLSX.utils.book_append_sheet(workbook, checkSheet, '확인필요');

        const summarySheet = XLSX.utils.json_to_sheet(summary);
        summarySheet['!cols'] = [{ wch: 26 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(workbook, summarySheet, '요약');

        const surveyLabel = (typeof getCurrentSurvey === 'function' && getCurrentSurvey()?.name) || '선택회차';
        XLSX.writeFile(workbook, `내용연수대조_${surveyLabel}_${today}.xlsx`);
        showToast(`${scoped.length}건을 내보냈습니다. 확인 필요 ${checkList.length}개 물품명`, 'success');
    } catch (error) {
        console.error('내용연수 대조 내보내기 실패:', error);
        showToast('엑셀 생성 중 오류가 발생했습니다', 'error');
    }
}

function downloadRegisterTemplate() {
    const worksheet = XLSX.utils.json_to_sheet([
        {
            '자산번호': 'ASSET-001',
            '물품명': '사무용 책상',
            '기관명': '본사',
            '건물': '본관',
            '층': '3층',
            '실/호': '회의실',
            '사용위치': '본관 3층 회의실',
            '카테고리': '가구',
            '갯수': 1,
            '제조사': '퍼시스',
            '모델명': 'ABC-123',
            '상태': '좋음'
        }
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '자산대장');
    XLSX.writeFile(workbook, '자산대장_양식.xlsx');
}

async function markRegisterMissing(registerId) {
    if (!confirm('이 자산을 미발견으로 표시할까요?')) return;
    await updateRegisterRecord(registerId, {
        status: 'missing',
        checkedBy: currentUser?.uid || '',
        checkedByEmail: currentUser?.email || '',
        checkedAt: new Date().toISOString()
    });
    showToast('미발견으로 표시했습니다', 'success');
    refreshRegisterViews();
}

function fillFromRegister(registerId) {
    const record = registerItems.find((entry) => entry.id === registerId);
    if (!record) return;
    if (typeof switchTab === 'function') switchTab('input');
    const assetInput = document.getElementById('assetNumber');
    if (assetInput) assetInput.value = record.assetNumber || '';
    resetAssetAutofillGuard();
    applyRegisterToForm(record, { protectEdits: false, recordSnapshot: true });
    markAssetAutofilled(record.assetNumber);
    updateAssetCheckBanner({ fillForm: false });
    showToast('대장 항목을 입력 폼에 채웠습니다', 'success');
}

function updateRegisterDashboard(surveyedIndex) {
    const card = document.getElementById('registerProgressCard');
    if (!card) return;
    const progress = getRegisterProgress(surveyedIndex);
    if (progress.expected === 0) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    setText('registerExpected', progress.expected);
    setText('registerFound', progress.found);
    setText('registerPending', progress.pending);
    setText('registerMissing', progress.missing);
    setText('registerDiscovered', progress.discovered);
    setText('registerPercent', `${progress.percent}%`);
    const bar = document.getElementById('registerProgressBar');
    if (bar) bar.style.width = `${progress.percent}%`;
}

const REGISTER_PAGE_SIZE = 100;
const REGISTER_STATUS_ORDER = { pending: 0, missing: 1, changed: 2, found: 3, new: 4 };

let registerSearchTerm = '';
let registerSort = 'default';
let registerSearchTimer = null;
let registerRows = [];
let registerVisibleCount = REGISTER_PAGE_SIZE;
let registerRenderedSurveyId = null;
let registerSentinelObserver = null;

function registerRowLocation(source) {
    return source.location
        || [source.building, source.floor, source.room].filter(Boolean).join(' ')
        || source.organization
        || '';
}

function buildRegisterRow(source, statusKey, kind, surveyedItem = null) {
    const live = surveyedItem || null;
    const row = {
        id: source.id,
        kind,
        statusKey,
        assetNumber: source.assetNumber || '',
        itemName: (live?.itemName || source.itemName || ''),
        holder: (live?.holder || source.holder || ''),
        location: live?.location || registerRowLocation(source),
        quantity: live?.quantity || source.quantity || '',
        category: live?.category || source.category || '',
        model: live?.model || source.model || '',
        checkedBy: String(source.checkedByEmail || '').split('@')[0]
    };
    row.haystack = [
        row.assetNumber, row.itemName, row.holder, row.location, row.category, row.model,
        row.checkedBy, source.organization, REGISTER_STATUS[statusKey]?.label
    ].filter(Boolean).join(' ').toLowerCase();
    return row;
}

function collectRegisterRows(surveyedIndex) {
    const scoped = getRegisterForSurvey(getRegisterSurveyId());

    if (registerFilter === 'new') {
        const registerKeys = new Set(scoped.map((record) => normalizeAsset(record.assetNumber)).filter(Boolean));
        const surveyed = typeof getItemsForView === 'function' ? getItemsForView() : [];
        return surveyed
            .filter((item) => {
                const key = normalizeAsset(item.assetNumber);
                return !key || !registerKeys.has(key);
            })
            .map((item) => buildRegisterRow(item, 'new', 'item'));
    }

    const rows = scoped.map((record) => {
        const key = normalizeAsset(record.assetNumber);
        const surveyedItem = key && surveyedIndex?.get ? surveyedIndex.get(key) : null;
        return buildRegisterRow(
            record,
            resolveRegisterStatus(record, surveyedIndex),
            'register',
            surveyedItem
        );
    });
    if (registerFilter === 'pending') return rows.filter((row) => row.statusKey === 'pending');
    if (registerFilter === 'found') return rows.filter((row) => row.statusKey === 'found' || row.statusKey === 'changed');
    if (registerFilter === 'missing') return rows.filter((row) => row.statusKey === 'missing');
    return rows;
}

function searchRegisterRows(rows) {
    const term = registerSearchTerm.trim().toLowerCase();
    if (!term) return rows;
    const parts = term.split(/\s+/).filter(Boolean);
    return rows.filter((row) => {
        const normAsset = normalizeAsset(row.assetNumber);
        const digitAsset = assetDigits(row.assetNumber);
        return parts.every((part) => {
            if (row.haystack.includes(part)) return true;
            const np = normalizeAsset(part);
            const dp = assetDigits(part);
            if (np && normAsset.includes(np)) return true;
            if (dp.length >= ASSET_PARTIAL_MIN_LEN && digitAsset.includes(dp)) return true;
            return false;
        });
    });
}

function sortRegisterRows(rows) {
    if (registerSort === 'default') return rows;
    const compare = (a, b, key, numeric) =>
        String(a[key]).localeCompare(String(b[key]), 'ko', numeric ? { numeric: true } : undefined);
    const sorted = rows.slice();
    if (registerSort === 'asset') sorted.sort((a, b) => compare(a, b, 'assetNumber', true));
    else if (registerSort === 'name') sorted.sort((a, b) => compare(a, b, 'itemName'));
    else if (registerSort === 'location') sorted.sort((a, b) => compare(a, b, 'location'));
    else if (registerSort === 'status') {
        sorted.sort((a, b) =>
            (REGISTER_STATUS_ORDER[a.statusKey] ?? 9) - (REGISTER_STATUS_ORDER[b.statusKey] ?? 9)
            || compare(a, b, 'assetNumber', true));
    }
    return sorted;
}

function registerRowHtml(row) {
    const status = REGISTER_STATUS[row.statusKey] || REGISTER_STATUS.pending;
    const id = escapeHtml(row.id);
    const actions = row.kind !== 'register' ? '' : [
        `<button type="button" class="btn btn-secondary btn-small" data-register-action="fill" data-register-id="${id}">실사</button>`,
        row.statusKey === 'pending'
            ? `<button type="button" class="btn btn-danger btn-small" data-register-action="missing" data-register-id="${id}">미발견</button>`
            : ''
    ].join('');
    return `
        <tr>
            <td><span class="register-status ${status.cls}">${status.label}</span></td>
            <td class="register-cell-asset">${escapeHtml(row.assetNumber || '-')}</td>
            <td class="register-cell-name">${escapeHtml(row.itemName || '이름 없음')}</td>
            <td>${escapeHtml(row.holder || '-')}</td>
            <td>${escapeHtml(row.location || '-')}</td>
            <td class="col-optional">${escapeHtml(row.quantity || '-')}</td>
            <td class="col-optional">${escapeHtml(row.category || '-')}</td>
            <td class="col-optional">${escapeHtml(row.model || '-')}</td>
            <td class="col-optional">${escapeHtml(row.checkedBy || '-')}</td>
            <td class="register-cell-actions">${actions}</td>
        </tr>
    `;
}

function renderRegisterRows(append) {
    const tbody = document.getElementById('registerTableBody');
    if (!tbody) return;
    const from = append ? tbody.children.length : 0;
    const html = registerRows.slice(from, registerVisibleCount).map(registerRowHtml).join('');
    if (append) tbody.insertAdjacentHTML('beforeend', html);
    else tbody.innerHTML = html;
}

function registerEmptyMessage(surveyId) {
    if (!surveyId) return '대장을 보려면 조사 회차를 선택하세요.';
    if (registerSearchTerm.trim()) return '검색 결과가 없습니다.';
    if (registerFilter === 'new') return '신규 발견 물품이 없습니다.';
    if (getRegisterForSurvey(surveyId).length === 0) return '이 회차에 올라온 대장이 없습니다. 관리 탭에서 엑셀을 올리세요.';
    return '이 조건에 해당하는 항목이 없습니다.';
}

function updateRegisterListStatus() {
    const wrap = document.getElementById('registerTableWrap');
    const empty = document.getElementById('registerEmpty');
    const count = document.getElementById('registerCount');
    const total = registerRows.length;
    const shown = Math.min(registerVisibleCount, total);

    if (wrap) wrap.style.display = total === 0 ? 'none' : 'block';
    if (empty) {
        empty.style.display = total === 0 ? 'block' : 'none';
        if (total === 0) empty.textContent = registerEmptyMessage(getRegisterSurveyId());
    }
    if (count) {
        count.textContent = total === 0 ? ''
            : shown >= total ? `${total}건 모두 표시`
            : `${total}건 중 ${shown}건 표시 · 아래로 스크롤하면 계속 불러옵니다`;
    }
}

function appendRegisterPage() {
    if (registerVisibleCount >= registerRows.length) return;
    registerVisibleCount = Math.min(registerVisibleCount + REGISTER_PAGE_SIZE, registerRows.length);
    renderRegisterRows(true);
    updateRegisterListStatus();
    syncRegisterSentinel();

    // 채운 뒤에도 sentinel이 계속 보이면 교차 상태가 그대로여서 관찰자가 다시 발화하지 않는다
    requestAnimationFrame(() => {
        const wrap = document.getElementById('registerTableWrap');
        const sentinel = document.getElementById('registerSentinel');
        if (!wrap || !sentinel || registerVisibleCount >= registerRows.length) return;
        if (sentinel.getBoundingClientRect().top <= wrap.getBoundingClientRect().bottom) appendRegisterPage();
    });
}

function syncRegisterSentinel() {
    const sentinel = document.getElementById('registerSentinel');
    if (!sentinel) return;
    const hasMore = registerVisibleCount < registerRows.length;
    sentinel.style.display = hasMore ? 'block' : 'none';
    if (!hasMore || registerSentinelObserver) return;
    registerSentinelObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) appendRegisterPage();
    }, { root: document.getElementById('registerTableWrap'), rootMargin: '150px' });
    registerSentinelObserver.observe(sentinel);
}

function updateRegisterList(options = {}) {
    if (!document.getElementById('registerTableBody')) return;
    const surveyId = getRegisterSurveyId();
    const surveyedIndex = options.surveyedIndex || buildSurveyedIndex();

    registerRows = sortRegisterRows(searchRegisterRows(collectRegisterRows(surveyedIndex)));
    if (!options.preserveWindow || surveyId !== registerRenderedSurveyId) {
        registerVisibleCount = REGISTER_PAGE_SIZE;
    }
    registerRenderedSurveyId = surveyId;

    renderRegisterRows(false);
    updateRegisterListStatus();
    syncRegisterSentinel();
}

function isTabActive(tabId) {
    return !!document.getElementById(tabId)?.classList.contains('active');
}

function scheduleRefreshRegisterViews(delay = 120) {
    clearTimeout(refreshRegisterViewsTimer);
    refreshRegisterViewsTimer = setTimeout(() => {
        refreshRegisterViewsTimer = null;
        refreshRegisterViews();
    }, delay);
}

function refreshRegisterViews() {
    const surveyedIndex = buildSurveyedIndex();
    const showRegisterUi = isTabActive('register') || isTabActive('dashboard');
    if (showRegisterUi) {
        updateRegisterDashboard(surveyedIndex);
        updateRegisterList({ preserveWindow: true, surveyedIndex });
    }
    if (isTabActive('input') || document.getElementById('assetNumber')?.value) {
        // 대장 실시간 갱신 때는 배너만 갱신 (입력 중인 수정값 보호)
        updateAssetCheckBanner({ allowAutofill: false, fillForm: false });
    }
    if (typeof refreshUsefulLifeRegisterTab === 'function' && isTabActive('usefullife')) {
        refreshUsefulLifeRegisterTab();
    }
}

function stopScanFocusKeepAlive() {
    if (scanFocusKeepAliveTimer) {
        clearInterval(scanFocusKeepAliveTimer);
        scanFocusKeepAliveTimer = null;
    }
}

function clearScanEnhanceTimers() {
    scanEnhanceTimers.forEach((id) => clearTimeout(id));
    scanEnhanceTimers = [];
    stopScanFocusKeepAlive();
}

function scheduleScanEnhance(delayMs, preferredZoom) {
    const id = setTimeout(() => {
        enhanceScanCamera(preferredZoom).catch(() => {});
    }, delayMs);
    scanEnhanceTimers.push(id);
}

/** Chrome Android: 스트림 직후 getCapabilities()가 {}인 경우가 많아 짧게 재시도 */
async function waitForScanCapabilities(maxWaitMs = 1400) {
    const started = Date.now();
    let caps = getScanTrackCapabilities();
    while (Date.now() - started < maxWaitMs) {
        if (caps && (
            caps.focusMode
            || caps.zoom
            || Object.prototype.hasOwnProperty.call(caps, 'torch')
            || Object.prototype.hasOwnProperty.call(caps, 'pointsOfInterest')
            || Object.keys(caps).length > 2
        )) {
            return caps;
        }
        await delayScan(200);
        caps = getScanTrackCapabilities();
    }
    return caps || {};
}

function getScanFocusModes(caps = getScanTrackCapabilities()) {
    return Array.isArray(caps.focusMode) ? caps.focusMode : [];
}

function buildScanVideoConstraints(base = {}) {
    const apple = isAppleMobileBrowser();
    return {
        ...base,
        width: { ideal: apple ? 1920 : 1280 },
        height: { ideal: apple ? 1080 : 720 },
        // 미지원 UA는 무시. 시작 시부터 continuous를 요청하면 Samsung 등에서 흐림이 줄어드는 사례가 많음
        focusMode: 'continuous'
    };
}

function startScanFocusKeepAlive() {
    stopScanFocusKeepAlive();
    // iOS는 focusMode가 거의 안 먹고, 주기 적용만 배터리 소모
    if (isAppleMobileBrowser()) return;
    scanFocusKeepAliveTimer = setInterval(() => {
        if (!html5Scanner) {
            stopScanFocusKeepAlive();
            return;
        }
        pulseScanAutofocus({ quiet: true }).catch(() => {});
    }, 4500);
}

/** iPhone/iPad — Safari·Chrome 모두 WebKit라 웹 초점 API가 약함 */
function isAppleMobileBrowser() {
    const ua = navigator.userAgent || '';
    const iOS = /iPad|iPhone|iPod/.test(ua);
    const iPadOS = navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1;
    return iOS || iPadOS;
}

function updateScanHelpForPlatform() {
    const help = document.getElementById('scanHelp');
    const hint = document.getElementById('scanPhotoHint');
    if (isAppleMobileBrowser()) {
        if (help) {
            help.innerHTML = '후면 카메라로 스캔합니다. Safari는 라이브 초점이 약할 수 있으니 흐리면 <strong>사진으로 스캔</strong>을 쓰세요. 약 15~25cm.';
        }
        if (hint) hint.classList.add('is-emphasis');
    } else {
        if (help) {
            help.innerHTML = '후면 카메라로 코드를 프레임 안에 맞추세요. 흐리면 <strong>초점</strong>·<strong>확대</strong>·<strong>플래시</strong> 또는 <strong>사진으로 스캔</strong>. 약 15~25cm.';
        }
        if (hint) hint.classList.remove('is-emphasis');
    }
}

function getScanTrackCapabilities() {
    try {
        return html5Scanner?.getRunningTrackCapabilities?.() || {};
    } catch (_) {
        return {};
    }
}

function getScanTrackSettings() {
    try {
        return html5Scanner?.getRunningTrackSettings?.() || {};
    } catch (_) {
        return {};
    }
}

function isScanTorchSupported(caps = getScanTrackCapabilities(), settings = getScanTrackSettings()) {
    return caps.torch === true || Object.prototype.hasOwnProperty.call(caps, 'torch')
        || Object.prototype.hasOwnProperty.call(settings, 'torch');
}

function isScanZoomSupported(caps = getScanTrackCapabilities()) {
    return !!(caps.zoom && Number(caps.zoom.max) > Number(caps.zoom.min));
}

function isScanFrontCamera(cam) {
    return /front|user|전면|selfie|face/i.test(String(cam?.label || ''));
}

function isScanBackCamera(cam) {
    return /back|rear|environment|후면|후방|world/i.test(String(cam?.label || ''));
}

function describeFacingMode(mode) {
    return mode === 'user' ? '전면' : '후면';
}

function findScanCameraById(deviceId) {
    if (!deviceId) return null;
    return scanCameraList.find((cam) => cam.id === deviceId) || null;
}

function inferFacingFromCamera(cam) {
    if (!cam) return null;
    if (isScanFrontCamera(cam)) return 'user';
    if (isScanBackCamera(cam)) return 'environment';
    return null;
}

function syncScanFacingFromTrack() {
    const settings = getScanTrackSettings();
    if (settings.deviceId) scanActiveDeviceId = settings.deviceId;

    if (settings.facingMode === 'user' || settings.facingMode === 'environment') {
        scanFacingMode = settings.facingMode;
        return scanFacingMode;
    }

    const cam = findScanCameraById(settings.deviceId || scanActiveDeviceId);
    const fromList = inferFacingFromCamera(cam);
    if (fromList) {
        scanFacingMode = fromList;
        return scanFacingMode;
    }

    // facingMode·라벨이 없으면 추정하지 않음 (요청값으로 착각해 전환이 먹통이 됨)
    const label = String(settings.label || cam?.label || '');
    if (/front|user|전면|selfie|face/i.test(label)) {
        scanFacingMode = 'user';
        return scanFacingMode;
    }
    if (/back|rear|environment|후면|후방/i.test(label)) {
        scanFacingMode = 'environment';
        return scanFacingMode;
    }
    return scanFacingMode;
}

function delayScan(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateScanControlUi(caps = getScanTrackCapabilities()) {
    const controls = document.getElementById('scanControls');
    const torchBtn = document.getElementById('scanTorchBtn');
    const zoomGroup = document.getElementById('scanZoomGroup');
    const zoomLabel = document.getElementById('scanZoomLabel');
    const switchBtn = document.getElementById('scanSwitchCameraBtn');
    if (controls) controls.hidden = false;

    const torchOk = isScanTorchSupported(caps);
    if (torchBtn) {
        torchBtn.hidden = !torchOk;
        torchBtn.setAttribute('aria-pressed', scanTorchOn ? 'true' : 'false');
        torchBtn.textContent = scanTorchOn ? '플래시 끄기' : '플래시';
    }

    const zoomOk = isScanZoomSupported(caps);
    if (zoomGroup) zoomGroup.hidden = !zoomOk;
    if (zoomLabel) zoomLabel.textContent = `${Number(scanZoom || 1).toFixed(1)}×`;

    if (switchBtn) {
        // 현장 실사: 전면 전환 없음. 라벨된 후면 렌즈가 2개 이상일 때만 순환
        const rearIds = listRearCameraDeviceIds('');
        switchBtn.hidden = rearIds.length < 2;
        switchBtn.textContent = '다른 후면 렌즈';
        switchBtn.title = '초광각/망원 등 다른 후면 카메라로 전환';
    }
}

function setScanLoading(on, message) {
    const el = document.getElementById('scanLoading');
    if (!el) return;
    if (message) el.textContent = message;
    el.hidden = !on;
}

function rememberRearDeviceId(deviceId) {
    if (!deviceId) return;
    cachedRearDeviceId = deviceId;
    scanActiveDeviceId = deviceId;
    try {
        sessionStorage.setItem('findScanRearDeviceId', deviceId);
    } catch (_) {}
}

function loadCachedRearDeviceId() {
    if (cachedRearDeviceId) return cachedRearDeviceId;
    try {
        const saved = sessionStorage.getItem('findScanRearDeviceId') || '';
        if (saved) cachedRearDeviceId = saved;
    } catch (_) {}
    return cachedRearDeviceId;
}

async function loadScanCameraList() {
    try {
        const cameras = await Html5Qrcode.getCameras();
        scanCameraList = Array.isArray(cameras) ? cameras.slice() : [];
    } catch (_) {
        scanCameraList = [];
    }
    return scanCameraList;
}

/**
 * 후면(환경) 카메라 deviceId만 — 전면·셀카 제외.
 * allowUnlabeledHeuristic: 라벨 없을 때만 목록 역순 후보(시작 폴백용). 전환 버튼에는 쓰지 않음.
 */
function listRearCameraDeviceIds(excludeId = '', options = {}) {
    if (!scanCameraList.length) return [];
    const labeled = scanCameraList.filter((cam) => String(cam.label || '').trim());
    let pool = [];

    if (labeled.length) {
        const backs = scanCameraList.filter((cam) => isScanBackCamera(cam));
        if (backs.length) {
            pool = backs;
        } else {
            // back 라벨은 없고 front만 구분되면, 전면이 아닌 것만
            pool = scanCameraList.filter((cam) => !isScanFrontCamera(cam));
        }
    } else if (options.allowUnlabeledHeuristic && scanCameraList.length >= 2) {
        // 라벨 없음: 끝쪽이 후면인 기기가 많아 역순 (facingMode 실패 시 최후 수단)
        pool = scanCameraList.slice().reverse();
    }

    return pool.map((cam) => cam.id).filter((id) => id && id !== excludeId);
}

/**
 * 캐시가 없고 facingMode 시작이 실패/전면일 때만 1회 프로브.
 * (예전엔 권한+프로브+스캔으로 카메라를 2~3번 열었음)
 */
async function probeRearCameraDevice() {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    let stream = null;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { exact: 'environment' } }
        });
    } catch (_) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: 'environment' }
            });
        } catch (error) {
            console.warn('후면 프로브 실패:', error);
            return null;
        }
    }
    try {
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings?.() || {};
        const label = String(track?.label || settings.label || '');
        const facing = settings.facingMode || '';
        const deviceId = settings.deviceId || '';
        if (facing === 'user' || /front|user|전면|selfie|face/i.test(label)) {
            return null;
        }
        if (deviceId) rememberRearDeviceId(deviceId);
        return { deviceId, facingMode: 'environment', label };
    } finally {
        stream.getTracks().forEach((t) => t.stop());
        await delayScan(120);
    }
}

function buildRearCameraConfigs(excludeDeviceId = '') {
    const configs = [];
    const cached = loadCachedRearDeviceId();
    if (cached && cached !== excludeDeviceId) configs.push(cached);
    // facingMode를 deviceId보다 앞에 두면 캐시 미스 시에도 1회 시도로 끝나는 경우가 많음
    configs.push({ facingMode: { exact: 'environment' } });
    configs.push({ facingMode: 'environment' });
    listRearCameraDeviceIds(excludeDeviceId, { allowUnlabeledHeuristic: true }).forEach((id) => {
        if (id !== cached) configs.push(id);
    });
    return configs;
}

function buildScanQrbox(viewfinderWidth, viewfinderHeight) {
    // 1D 바코드는 가로로 넓은 프레임이 인식에 유리
    const width = Math.max(220, Math.min(Math.floor(viewfinderWidth * 0.9), 360));
    const height = Math.max(100, Math.min(Math.floor(viewfinderHeight * 0.34), 160));
    return { width, height };
}

async function applyScanConstraints(partial) {
    if (!html5Scanner?.applyVideoConstraints) return false;
    try {
        await html5Scanner.applyVideoConstraints(partial);
        return true;
    } catch (_) {
        return false;
    }
}

async function enhanceScanCamera(preferredZoom, options = {}) {
    if (!html5Scanner) return;
    const apple = isAppleMobileBrowser();
    let caps = getScanTrackCapabilities();
    // 스트림 직후 caps가 비어 continuous를 스킵하는 기기 보완
    if (options.waitCaps !== false && Object.keys(caps).length < 2) {
        caps = await waitForScanCapabilities(apple ? 900 : 1500);
    }

    const advanced = [];
    const constraints = {};
    const focusModes = getScanFocusModes(caps);
    const supportsContinuous = focusModes.includes('continuous');
    const supportsSingle = focusModes.includes('single-shot');
    // iOS: capability에 있어도 무시되는 경우가 많아 확인된 continuous만
    // Android: caps가 비어 있어도 continuous 요청(삼성 등에서 유효한 사례)
    const wantContinuous = supportsContinuous || (!apple && focusModes.length === 0);

    if (wantContinuous) {
        constraints.focusMode = 'continuous';
        advanced.push({ focusMode: 'continuous' });
    } else if (supportsSingle) {
        constraints.focusMode = 'single-shot';
        advanced.push({ focusMode: 'single-shot' });
    }

    if (Object.prototype.hasOwnProperty.call(caps, 'pointsOfInterest')) {
        const settings = getScanTrackSettings();
        const w = Number(settings.width) || 0;
        const h = Number(settings.height) || 0;
        const poi = (w > 0 && h > 0)
            ? [{ x: w / 2, y: h / 2 }]
            : [{ x: 0.5, y: 0.5 }];
        advanced.push({ pointsOfInterest: poi });
    }

    if (caps.zoom) {
        const min = Number(caps.zoom.min) || 1;
        const max = Number(caps.zoom.max) || 1;
        // 디지털 줌으로 모듈을 키우면 AF가 약한 기기에서도 인식률이 나아짐
        const fallbackZoom = apple ? 2.0 : 2.0;
        const target = Math.min(
            max,
            Math.max(min, preferredZoom != null ? preferredZoom : Math.min(max, Math.max(min, fallbackZoom)))
        );
        scanZoom = target;
        constraints.zoom = target;
        advanced.push({ zoom: target });
    }

    if (advanced.length) constraints.advanced = advanced;
    if (!(await applyScanConstraints(constraints)) && advanced.length) {
        await applyScanConstraints({ advanced });
    }

    // 일부 Android는 advanced만, 일부는 top-level만 받음
    if (constraints.focusMode) {
        await applyScanConstraints({ focusMode: constraints.focusMode });
        await applyScanConstraints({ advanced: [{ focusMode: constraints.focusMode }] });
    }
    if (constraints.zoom != null) {
        await applyScanConstraints({ zoom: constraints.zoom });
        await applyScanConstraints({ advanced: [{ zoom: constraints.zoom }] });
    }

    // continuous를 못 켠 기기: single-shot으로 한 번 스윕
    if (!wantContinuous && supportsSingle) {
        await pulseScanAutofocus({ quiet: true, zoomNudge: false });
    }

    updateScanControlUi(getScanTrackCapabilities());
}

/**
 * AF 재유도: single-shot 펄스 → continuous 복귀 → (선택) 줌 살짝 올렸다 내림
 */
async function pulseScanAutofocus(options = {}) {
    if (!html5Scanner) return;
    const quiet = !!options.quiet;
    const zoomNudge = options.zoomNudge !== false;
    const apple = isAppleMobileBrowser();
    let caps = getScanTrackCapabilities();
    if (Object.keys(caps).length < 2) {
        caps = await waitForScanCapabilities(apple ? 600 : 1000);
    }
    const focusModes = getScanFocusModes(caps);
    const canSingle = focusModes.includes('single-shot');
    const canContinuous = focusModes.includes('continuous') || (!apple && focusModes.length === 0);

    if (!quiet) showToast('초점을 다시 맞추는 중…', 'info');

    if (canSingle) {
        (await applyScanConstraints({ advanced: [{ focusMode: 'single-shot' }] }))
            || (await applyScanConstraints({ focusMode: 'single-shot' }));
        await delayScan(apple ? 260 : 200);
    }
    if (canContinuous) {
        (await applyScanConstraints({ advanced: [{ focusMode: 'continuous' }] }))
            || (await applyScanConstraints({ focusMode: 'continuous' }));
    }

    if (Object.prototype.hasOwnProperty.call(caps, 'pointsOfInterest')) {
        const settings = getScanTrackSettings();
        const w = Number(settings.width) || 0;
        const h = Number(settings.height) || 0;
        const poi = (w > 0 && h > 0)
            ? [{ x: w / 2, y: h / 2 }]
            : [{ x: 0.5, y: 0.5 }];
        await applyScanConstraints({ advanced: [{ pointsOfInterest: poi }] });
    }

    if (zoomNudge && isScanZoomSupported(caps)) {
        const min = Number(caps.zoom.min) || 1;
        const max = Number(caps.zoom.max) || 1;
        const base = Math.min(max, Math.max(min, scanZoom));
        const bump = Math.min(max, base + (apple ? 0.35 : 0.15));
        await applyScanConstraints({ advanced: [{ zoom: bump }] });
        await delayScan(apple ? 280 : 160);
        await applyScanConstraints({ advanced: [{ zoom: base }] });
        scanZoom = base;
    }

    updateScanControlUi(getScanTrackCapabilities());
}

async function setScanTorch(on) {
    if (!html5Scanner) return;
    const ok = (await applyScanConstraints({ advanced: [{ torch: !!on }] }))
        || (await applyScanConstraints({ torch: !!on }));
    if (!ok) {
        showToast('이 기기에서는 플래시를 사용할 수 없습니다', 'info');
        return;
    }
    scanTorchOn = !!on;
    updateScanControlUi();
}

async function nudgeScanZoom(direction) {
    if (!html5Scanner) return;
    const caps = getScanTrackCapabilities();
    if (!isScanZoomSupported(caps)) {
        showToast('이 기기에서는 줌을 조절할 수 없습니다', 'info');
        return;
    }
    const min = Number(caps.zoom.min) || 1;
    const max = Number(caps.zoom.max) || 1;
    const step = Math.max(Number(caps.zoom.step) || 0.2, 0.15);
    const next = Math.min(max, Math.max(min, scanZoom + (direction * step * 2)));
    const ok = (await applyScanConstraints({ advanced: [{ zoom: next }] }))
        || (await applyScanConstraints({ zoom: next }));
    if (!ok) return;
    scanZoom = next;
    updateScanControlUi(caps);
}

async function refocusScanCamera() {
    if (!html5Scanner) return;
    const apple = isAppleMobileBrowser();
    let caps = getScanTrackCapabilities();
    if (Object.keys(caps).length < 2) {
        caps = await waitForScanCapabilities(apple ? 600 : 1000);
    }
    const focusModes = getScanFocusModes(caps);
    const canZoom = isScanZoomSupported(caps);
    const canFocus = focusModes.includes('continuous')
        || focusModes.includes('single-shot')
        || (!apple && focusModes.length === 0);

    if (apple && !canZoom && !canFocus) {
        showToast('이 iPhone에서는 웹 초점을 조절할 수 없습니다. 사진으로 스캔해 보세요.', 'info');
        document.getElementById('scanPhotoBtn')?.focus();
        return;
    }

    await enhanceScanCamera(scanZoom, { waitCaps: false });
    await pulseScanAutofocus({ quiet: false, zoomNudge: canZoom });
}

function openScanPhotoPicker() {
    const input = document.getElementById('scanPhotoInput');
    if (!input) return;
    input.value = '';
    input.click();
}

async function scanBarcodeFromPhotoFile(file) {
    if (!file || typeof Html5Qrcode === 'undefined') return;
    showToast('사진에서 코드 인식 중…', 'info');

    const tempId = 'qrReaderFileTemp';
    let temp = document.getElementById(tempId);
    if (!temp) {
        temp = document.createElement('div');
        temp.id = tempId;
        temp.hidden = true;
        temp.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
        document.body.appendChild(temp);
    }

    const reader = new Html5Qrcode(tempId, {
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false
    });

    try {
        // 두 번째 인자 true = 화면에도 그림(숨김 영역). 이미지 디코드
        const text = await reader.scanFile(file, /* showImage= */ true);
        try { await reader.clear(); } catch (_) {}
        const value = String(text || '').trim();
        if (!value) throw new Error('empty decode');
        applyScannedAsset(value);
        await stopAssetScan();
    } catch (error) {
        console.warn('사진 바코드 인식 실패:', error);
        try { await reader.clear(); } catch (_) {}
        showToast('사진에서 바코드/QR을 찾지 못했습니다. 코드를 크게·밝게 다시 찍어 보세요.', 'error');
    }
}

function bindScanControlButtons() {
    const torchBtn = document.getElementById('scanTorchBtn');
    const zoomIn = document.getElementById('scanZoomInBtn');
    const zoomOut = document.getElementById('scanZoomOutBtn');
    const refocus = document.getElementById('scanRefocusBtn');
    const switchBtn = document.getElementById('scanSwitchCameraBtn');
    const photoBtn = document.getElementById('scanPhotoBtn');
    const photoInput = document.getElementById('scanPhotoInput');
    if (torchBtn && !torchBtn.dataset.bound) {
        torchBtn.dataset.bound = 'true';
        torchBtn.addEventListener('click', () => setScanTorch(!scanTorchOn));
    }
    if (zoomIn && !zoomIn.dataset.bound) {
        zoomIn.dataset.bound = 'true';
        zoomIn.addEventListener('click', () => nudgeScanZoom(1));
    }
    if (zoomOut && !zoomOut.dataset.bound) {
        zoomOut.dataset.bound = 'true';
        zoomOut.addEventListener('click', () => nudgeScanZoom(-1));
    }
    if (refocus && !refocus.dataset.bound) {
        refocus.dataset.bound = 'true';
        refocus.addEventListener('click', () => refocusScanCamera());
    }
    if (switchBtn && !switchBtn.dataset.bound) {
        switchBtn.dataset.bound = 'true';
        switchBtn.addEventListener('click', () => switchScanCamera());
    }
    if (photoBtn && !photoBtn.dataset.bound) {
        photoBtn.dataset.bound = 'true';
        photoBtn.addEventListener('click', openScanPhotoPicker);
    }
    if (photoInput && !photoInput.dataset.bound) {
        photoInput.dataset.bound = 'true';
        photoInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) scanBarcodeFromPhotoFile(file);
            e.target.value = '';
        });
    }
}

function getScanFormats() {
    const formats = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.ITF
    ];
    if (Html5QrcodeSupportedFormats.CODABAR != null) formats.push(Html5QrcodeSupportedFormats.CODABAR);
    if (Html5QrcodeSupportedFormats.DATA_MATRIX != null) formats.push(Html5QrcodeSupportedFormats.DATA_MATRIX);
    return formats;
}

async function stopHtml5ScannerInstance(options = {}) {
    if (!html5Scanner) return;
    try {
        await html5Scanner.stop();
    } catch (_) {}
    try {
        html5Scanner.clear();
    } catch (_) {}
    html5Scanner = null;
    // 재시도 직전에만 짧게 대기 (모달 닫을 때는 0)
    const settleMs = options.settleMs == null ? 0 : Number(options.settleMs);
    if (settleMs > 0) await delayScan(settleMs);
}

function buildScannerStartConfig(apple) {
    return {
        fps: apple ? 10 : 12,
        qrbox: buildScanQrbox,
        aspectRatio: 1.777778,
        disableFlip: false,
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        },
        formatsToSupport: getScanFormats()
    };
}

async function startHtml5ScannerWithCamera(cameraConfig) {
    // qrReader 노드가 clear 후 비어 있어야 재시작 안정
    const readerEl = document.getElementById('qrReader');
    if (readerEl && !readerEl.innerHTML.trim()) {
        // ok
    }

    html5Scanner = new Html5Qrcode('qrReader', {
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        },
        verbose: false
    });

    const apple = isAppleMobileBrowser();
    const useFacing = !!(cameraConfig && typeof cameraConfig === 'object' && cameraConfig.facingMode);
    const onSuccess = (text) => {
        applyScannedAsset(text);
        stopAssetScan();
    };
    const config = buildScannerStartConfig(apple);

    // html5-qrcode: videoConstraints가 있으면 cameraIdOrConfig를 무시한다.
    // 해상도·focusMode·facingMode/deviceId를 같은 videoConstraints에 넣는다.
    if (typeof cameraConfig === 'string') {
        config.videoConstraints = buildScanVideoConstraints({
            deviceId: { exact: cameraConfig }
        });
        await html5Scanner.start(cameraConfig, config, onSuccess);
    } else if (useFacing) {
        config.videoConstraints = buildScanVideoConstraints({
            facingMode: cameraConfig.facingMode
        });
        await html5Scanner.start(cameraConfig, config, onSuccess);
    } else {
        await html5Scanner.start(cameraConfig, config, onSuccess);
    }

    scanTorchOn = false;
    scanZoom = 1;
    syncScanFacingFromTrack();
    if (apple) {
        scheduleScanEnhance(700, 2.0);
        scheduleScanEnhance(1800, 2.3);
        scheduleScanEnhance(3200, 2.3);
    } else {
        // 시작 직후 caps 지연 + continuous 재적용, 이후 keep-alive로 잠김 AF 완화
        scheduleScanEnhance(400, 2.0);
        scheduleScanEnhance(1200, 2.2);
        scheduleScanEnhance(2600, 2.2);
        const keepAliveId = setTimeout(() => {
            startScanFocusKeepAlive();
        }, 3000);
        scanEnhanceTimers.push(keepAliveId);
    }
    updateScanControlUi();
}

function isOpenedCameraFront() {
    const settings = getScanTrackSettings();
    if (settings.facingMode === 'user') return true;
    if (settings.facingMode === 'environment') return false;
    const cam = findScanCameraById(settings.deviceId || scanActiveDeviceId);
    if (cam && isScanFrontCamera(cam)) return true;
    if (cam && isScanBackCamera(cam)) return false;
    const label = String(settings.label || cam?.label || '');
    if (/front|user|전면|selfie|face/i.test(label)) return true;
    if (/back|rear|environment|후면|후방/i.test(label)) return false;
    return null; // 알 수 없음
}

/**
 * 후면만 연다. 빠른 경로: 캐시 deviceId → facingMode 1~2회 → (실패 시) 프로브 1회 후 deviceId.
 * 예전: 권한 오픈+프로브 오픈+스캔 오픈(+고정 sleep)으로 2~5초 지연.
 */
async function startRearScanner(options = {}) {
    const excludeId = options.excludeDeviceId || '';
    const previousDeviceId = scanActiveDeviceId;
    const previousFacing = scanFacingMode;
    let lastError = null;
    let openedFrontOnce = false;

    const tryStart = async (config) => {
        clearScanEnhanceTimers();
        await stopHtml5ScannerInstance({ settleMs: html5Scanner ? 100 : 0 });
        await startHtml5ScannerWithCamera(config);
        syncScanFacingFromTrack();
        const openedId = getScanTrackSettings().deviceId || scanActiveDeviceId || '';
        const front = isOpenedCameraFront();
        if (front === true) {
            openedFrontOnce = true;
            await stopHtml5ScannerInstance({ settleMs: 100 });
            return false;
        }
        if (options.requireDeviceChange && previousDeviceId && openedId && openedId === previousDeviceId) {
            await stopHtml5ScannerInstance({ settleMs: 100 });
            return false;
        }
        scanFacingMode = 'environment';
        if (openedId) rememberRearDeviceId(openedId);
        return true;
    };

    // 1) 캐시 / facingMode (프로브 없이 바로 프리뷰)
    for (const config of buildRearCameraConfigs(excludeId)) {
        try {
            if (await tryStart(config)) return true;
        } catch (error) {
            lastError = error;
            console.warn('후면 카메라 시작 실패:', config, error);
            await stopHtml5ScannerInstance({ settleMs: 80 });
        }
    }

    // 2) 그래도 안 되면 프로브 1회로 deviceId 확보 후 재시도
    setScanLoading(true, '후면 카메라 확인 중…');
    try {
        await loadScanCameraList();
        const probed = await probeRearCameraDevice();
        const fallbackIds = [];
        if (probed?.deviceId && probed.deviceId !== excludeId) fallbackIds.push(probed.deviceId);
        listRearCameraDeviceIds(excludeId, { allowUnlabeledHeuristic: true }).forEach((id) => {
            if (!fallbackIds.includes(id)) fallbackIds.push(id);
        });
        for (const id of fallbackIds) {
            try {
                if (await tryStart(id)) return true;
            } catch (error) {
                lastError = error;
                await stopHtml5ScannerInstance({ settleMs: 80 });
            }
        }
    } finally {
        setScanLoading(true, '후면 카메라 연결 중…');
    }

    scanFacingMode = previousFacing;
    if (openedFrontOnce && !lastError) {
        throw new Error('rear camera unavailable: front only');
    }
    throw lastError || new Error('rear camera start failed');
}

async function switchScanCamera() {
    if (scanSwitching) return;
    scanSwitching = true;
    const switchBtn = document.getElementById('scanSwitchCameraBtn');
    if (switchBtn) switchBtn.disabled = true;

    syncScanFacingFromTrack();
    const fromDeviceId = scanActiveDeviceId;
    const rearOthers = listRearCameraDeviceIds(fromDeviceId);

    try {
        clearScanEnhanceTimers();
        if (rearOthers.length) {
            // 다른 후면 렌즈 deviceId만 순회
            let switched = false;
            let lastError = null;
            for (const id of rearOthers) {
                try {
                    await stopHtml5ScannerInstance({ settleMs: 100 });
                    await startHtml5ScannerWithCamera(id);
                    syncScanFacingFromTrack();
                    if (isOpenedCameraFront() === true) continue;
                    scanFacingMode = 'environment';
                    rememberRearDeviceId(getScanTrackSettings().deviceId || id);
                    switched = true;
                    break;
                } catch (error) {
                    lastError = error;
                    await stopHtml5ScannerInstance({ settleMs: 80 });
                }
            }
            if (!switched) {
                await startRearScanner({ excludeDeviceId: fromDeviceId, requireDeviceChange: true });
            }
            showToast('다른 후면 렌즈로 전환했습니다', 'success');
        } else {
            await startRearScanner({ excludeDeviceId: fromDeviceId, requireDeviceChange: true });
            showToast('후면 카메라를 다시 연결했습니다', 'success');
        }
    } catch (error) {
        console.warn('후면 렌즈 전환 실패:', error);
        const msg = String(error?.name || error?.message || error || '');
        if (/NotAllowed|Permission/i.test(msg)) {
            showToast('카메라 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.', 'error');
        } else if (/front only|rear camera/i.test(msg)) {
            showToast('후면 카메라만 사용할 수 있습니다. 사진으로 스캔해 보세요.', 'error');
        } else if (/NotReadable|TrackStart|AbortError/i.test(msg)) {
            showToast('후면 카메라를 다른 앱이 사용 중이거나 열 수 없습니다.', 'error');
        } else {
            showToast('후면 카메라 전환에 실패했습니다', 'error');
        }
        try {
            await startRearScanner();
        } catch (_) {}
    } finally {
        scanSwitching = false;
        if (switchBtn) switchBtn.disabled = false;
        updateScanControlUi();
    }
}

async function startAssetScan() {
    const modal = document.getElementById('scanModal');
    const reader = document.getElementById('qrReader');
    if (!modal || !reader) return;
    // 모달·로딩을 먼저 보여 체감 대기 감소
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    setScanLoading(true, '후면 카메라 연결 중…');
    scanTorchOn = false;
    scanZoom = 1;
    scanFacingMode = 'environment';
    clearScanEnhanceTimers();
    bindScanControlButtons();
    updateScanHelpForPlatform();

    const fallback = document.getElementById('scanFallback');
    if (fallback) fallback.style.display = 'none';
    const controls = document.getElementById('scanControls');
    if (controls) controls.hidden = true;

    if (typeof Html5Qrcode === 'undefined') {
        setScanLoading(false);
        if (fallback) fallback.style.display = 'block';
        return;
    }

    try {
        loadCachedRearDeviceId();
        await stopHtml5ScannerInstance({ settleMs: 0 });
        await startRearScanner();
        syncScanFacingFromTrack();
        if (isOpenedCameraFront() === true) {
            await stopHtml5ScannerInstance({ settleMs: 0 });
            throw new Error('rear camera unavailable: front only');
        }
        if (isAppleMobileBrowser()) {
            showToast('흐리면 「사진으로 스캔」을 사용하세요', 'info');
        }
    } catch (error) {
        console.warn('카메라 스캔 시작 실패:', error);
        const msg = String(error?.name || error?.message || error || '');
        if (fallback) fallback.style.display = 'block';
        if (/NotAllowed|Permission/i.test(msg)) {
            showToast('카메라 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.', 'error');
        } else if (/front only|rear camera unavailable/i.test(msg)) {
            showToast('후면 카메라를 열지 못했습니다. 「사진으로 스캔」을 사용해 주세요.', 'error');
        } else if (isAppleMobileBrowser()) {
            showToast('라이브 카메라를 열 수 없습니다. 사진으로 스캔해 보세요.', 'error');
        } else {
            showToast('후면 카메라를 열 수 없습니다. 사진으로 스캔하거나 직접 입력하세요.', 'error');
        }
    } finally {
        setScanLoading(false);
        updateScanControlUi();
    }
}

async function stopAssetScan() {
    const modal = document.getElementById('scanModal');
    clearScanEnhanceTimers();
    scanTorchOn = false;
    scanSwitching = false;
    setScanLoading(false);
    await stopHtml5ScannerInstance({ settleMs: 0 });
    const controls = document.getElementById('scanControls');
    if (controls) controls.hidden = true;
    if (modal) modal.classList.remove('show');
    document.body.style.overflow = 'auto';
}

function applyScannedAsset(text) {
    const input = document.getElementById('assetNumber');
    if (!input) return;
    input.value = String(text || '').trim();
    resetAssetAutofillGuard();
    updateAssetCheckBanner({ forceFill: true });
    showToast(`자산번호 ${input.value}를 잡았습니다`, 'success');
    const itemName = document.getElementById('itemName');
    if (itemName && !itemName.value.trim()) {
        setTimeout(() => itemName.focus(), 150);
    } else {
        setTimeout(() => input.focus(), 150);
    }
}

function initRegister() {
    const assetInput = document.getElementById('assetNumber');
    if (assetInput && !assetInput.dataset.bound) {
        assetInput.dataset.bound = 'true';
        assetInput.addEventListener('input', scheduleAssetCheck);
        // blur 때 대기 중 fill 타이머를 취소하지 않으면 수정 중인 값이 기준정보로 덮임
        assetInput.addEventListener('blur', handleAssetNumberBlur);
    }

    const scanBtn = document.getElementById('scanAssetBtn');
    if (scanBtn) scanBtn.addEventListener('click', startAssetScan);
    const closeScan = document.getElementById('closeScanModal');
    if (closeScan) closeScan.addEventListener('click', stopAssetScan);
    const scanModal = document.getElementById('scanModal');
    if (scanModal) {
        scanModal.addEventListener('click', (e) => {
            if (e.target.id === 'scanModal') stopAssetScan();
        });
    }

    const importBtn = document.getElementById('importRegisterBtn');
    const importFile = document.getElementById('importRegisterFile');
    if (importBtn && importFile) {
        importBtn.addEventListener('click', () => importFile.click());
        importFile.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            handleRegisterImport(file, 'import');
            e.target.value = '';
        });
    }
    const templateBtn = document.getElementById('downloadRegisterTemplateBtn');
    if (templateBtn) templateBtn.addEventListener('click', downloadRegisterTemplate);

    const usefulLifeExportBtn = document.getElementById('exportRegisterUsefulLifeBtn');
    if (usefulLifeExportBtn && !usefulLifeExportBtn.dataset.bound) {
        usefulLifeExportBtn.dataset.bound = 'true';
        usefulLifeExportBtn.addEventListener('click', exportRegisterUsefulLife);
    }

    const closeMap = document.getElementById('closeRegisterMap');
    const cancelMap = document.getElementById('cancelRegisterMapBtn');
    const confirmMap = document.getElementById('confirmRegisterMapBtn');
    if (closeMap) closeMap.addEventListener('click', closeRegisterMapModal);
    if (cancelMap) cancelMap.addEventListener('click', closeRegisterMapModal);
    if (confirmMap) confirmMap.addEventListener('click', confirmRegisterMapping);
    const mapModal = document.getElementById('registerMapModal');
    if (mapModal) {
        mapModal.addEventListener('click', (e) => {
            if (e.target.id === 'registerMapModal') closeRegisterMapModal();
        });
    }

    document.querySelectorAll('[data-register-filter]').forEach((btn) => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = 'true';
        btn.addEventListener('click', () => {
            registerFilter = btn.dataset.registerFilter;
            document.querySelectorAll('[data-register-filter]').forEach((el) => el.classList.toggle('active', el === btn));
            updateRegisterList();
        });
    });

    const registerBody = document.getElementById('registerTableBody');
    if (registerBody && !registerBody.dataset.bound) {
        registerBody.dataset.bound = 'true';
        registerBody.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-register-action]');
            if (!btn) return;
            const id = btn.dataset.registerId;
            if (btn.dataset.registerAction === 'fill') fillFromRegister(id);
            else if (btn.dataset.registerAction === 'missing') markRegisterMissing(id);
        });
    }

    const registerSearch = document.getElementById('registerSearch');
    if (registerSearch && !registerSearch.dataset.bound) {
        registerSearch.dataset.bound = 'true';
        registerSearch.addEventListener('input', () => {
            clearTimeout(registerSearchTimer);
            registerSearchTimer = setTimeout(() => {
                registerSearchTerm = registerSearch.value;
                updateRegisterList();
            }, 200);
        });
    }

    const registerSortSelect = document.getElementById('registerSort');
    if (registerSortSelect && !registerSortSelect.dataset.bound) {
        registerSortSelect.dataset.bound = 'true';
        registerSortSelect.addEventListener('change', () => {
            registerSort = registerSortSelect.value;
            updateRegisterList();
        });
    }

    document.getElementById('surveySelect')?.addEventListener('change', () => {
        setTimeout(() => listenRegisterChunks(), 0);
    });

    listenRegisterChunks();
    idbReadRegisters().then((localRows) => {
        if (!localRows.length) return;
        const sid = getRegisterSurveyId();
        const scoped = sid ? localRows.filter((row) => row.surveyId === sid) : localRows;
        if (!scoped.length) return;
        if (sid) replaceRegisterSurveyRows(sid, scoped);
        else setRegisterItems(mergeRegisterLists(registerItems, scoped));
        scheduleRefreshRegisterViews();
    });
    scheduleRefreshRegisterViews(0);
}

window.setRegisterItems = setRegisterItems;
window.mergeRegisterLists = mergeRegisterLists;
window.idbReadRegisters = idbReadRegisters;
window.refreshRegisterViews = refreshRegisterViews;
window.scheduleRefreshRegisterViews = scheduleRefreshRegisterViews;
window.listenRegisterChunks = listenRegisterChunks;
window.invalidateAssetSearchIndex = invalidateAssetSearchIndex;
window.invalidateItemAssetIndex = invalidateItemAssetIndex;
window.buildAssetSearchIndex = buildAssetSearchIndex;
window.resetAssetAutofillGuard = resetAssetAutofillGuard;
window.markAssetAutofilled = markAssetAutofilled;
window.confirmAssetDuplicate = confirmAssetDuplicate;
window.markRegisterFound = markRegisterFound;
window.fillFromRegister = fillFromRegister;
window.markRegisterMissing = markRegisterMissing;
window.initRegister = initRegister;
window.startAssetScan = startAssetScan;
window.getRegisterProgress = getRegisterProgress;
window.findRegisterByAsset = findRegisterByAsset;
window.normalizeAsset = normalizeAsset;
window.assetDigits = assetDigits;
window.collectAssetCandidates = collectAssetCandidates;
window.clearAssetMatchCandidates = clearAssetMatchCandidates;
window.selectAssetCandidate = selectAssetCandidate;
window.updateAssetCheckBanner = updateAssetCheckBanner;
window.clearItemEntryFields = clearItemEntryFields;
window.applyRegisterToForm = applyRegisterToForm;
