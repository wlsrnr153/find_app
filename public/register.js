// 대장 대조 / 자산번호 중복 / 바코드 스캔
let registerItems = window.registerItems || [];
let registerFilter = 'all';
let assetCheckTimer = null;
let html5Scanner = null;
let pendingAssetOverride = false;

function setRegisterItems(list) {
    registerItems = Array.isArray(list) ? list : [];
    window.registerItems = registerItems;
}

function normalizeAsset(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s\-_.]/g, '');
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
    return getRegisterForSurvey(surveyId).find((record) => normalizeAsset(record.assetNumber) === key) || null;
}

function findItemByAsset(assetNumber, excludeId) {
    const key = normalizeAsset(assetNumber);
    if (!key || typeof getItemsForView !== 'function') return null;
    return getItemsForView().find((item) =>
        normalizeAsset(item.assetNumber) === key && item.id !== excludeId
    ) || null;
}

// 조사된 자산번호를 한 번만 Map으로 만들어 대장 행마다 전체 목록을 훑지 않도록 한다
function buildSurveyedIndex() {
    const map = new Map();
    const surveyed = typeof getItemsForView === 'function' ? getItemsForView() : [];
    surveyed.forEach((item) => {
        const key = normalizeAsset(item.assetNumber);
        if (key && !map.has(key)) map.set(key, item);
    });
    return map;
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
    'assetNumber', 'itemName', 'organization', 'location', 'building', 'floor', 'room',
    'category', 'goodsClNo', 'quantity', 'acquiredAt', 'manufacturer', 'model', 'condition'
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

async function updateRegisterRecord(registerId, patch) {
    const current = registerItems.find((record) => record.id === registerId);
    if (current) {
        setRegisterItems(registerItems.map((record) => (
            record.id === registerId ? { ...record, ...patch } : record
        )));
    }

    try {
        const snapshot = await db.collection('users').get();
        for (const doc of snapshot.docs) {
            const data = doc.data() || {};
            for (const key of registerFieldKeys(data)) {
                const list = Array.isArray(data[key]) ? data[key] : [];
                const index = list.findIndex((record) => record.id === registerId);
                if (index === -1) continue;
                const next = [...list];
                next[index] = { ...next[index], ...patch };
                await doc.ref.set({ [key]: next }, { merge: true });
                return;
            }
        }
    } catch (error) {
        console.warn('사용자 문서 대장 수정 실패:', error);
    }

    if (current?.surveyId) {
        try {
            const metaSnap = await db.collection('users').doc(currentUser.uid).get();
            const count = metaSnap.data()?.registerChunkMeta?.[current.surveyId]?.count || 0;
            for (let i = 0; i < count; i += 1) {
                const ref = db.collection('registerChunks').doc(`${current.surveyId}_${i}`);
                const snap = await ref.get();
                const list = snap.data()?.rows || [];
                const index = list.findIndex((record) => record.id === registerId);
                if (index === -1) continue;
                const next = [...list];
                next[index] = { ...next[index], ...patch };
                await ref.set({ rows: next }, { merge: true });
                return;
            }
        } catch (error) {
            console.warn('분할 대장 수정 실패:', error);
        }
    }

    await idbUpdateRegister(registerId, patch);
}

let unsubscribeRegisterChunks = null;

function listenRegisterChunks() {
    if (unsubscribeRegisterChunks) return;
    unsubscribeRegisterChunks = db.collection('registerChunks').onSnapshot((snapshot) => {
        const chunkRows = [];
        snapshot.docs.forEach((doc) => {
            (doc.data()?.rows || []).forEach((record) => {
                if (record && record.id) chunkRows.push(record);
            });
        });
        const existing = registerItems.filter((record) => !chunkRows.some((row) => row.id === record.id));
        setRegisterItems(mergeRegisterLists(existing, chunkRows));
        if (typeof refreshRegisterViews === 'function') refreshRegisterViews();
    }, (error) => {
        console.warn('분할 대장 구독 실패:', error);
        unsubscribeRegisterChunks = null;
        idbReadRegisters().then((localRows) => {
            if (!localRows.length) return;
            setRegisterItems(mergeRegisterLists(registerItems, localRows));
            if (typeof refreshRegisterViews === 'function') refreshRegisterViews();
        });
    });
}

async function markRegisterFound(assetNumber, itemId, extra = {}) {
    const record = findRegisterByAsset(assetNumber);
    if (!record) return;
    const nextStatus = extra.condition && record.condition && extra.condition !== record.condition
        ? 'changed'
        : 'found';
    await updateRegisterRecord(record.id, {
        status: nextStatus,
        foundItemId: itemId || record.foundItemId || '',
        checkedBy: currentUser?.uid || '',
        checkedByEmail: currentUser?.email || '',
        checkedAt: new Date().toISOString(),
        actualCondition: extra.condition || record.actualCondition || ''
    });
}

function applyRegisterToForm(record) {
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el && value) el.value = value;
    };
    setValue('itemName', record.itemName);
    setValue('organization', record.organization);
    setValue('location', record.location);
    setValue('building', record.building);
    setValue('floor', record.floor);
    setValue('room', record.room);
    setValue('category', record.category);
    setValue('quantity', record.quantity || '1');
    setValue('manufacturer', record.manufacturer);
    setValue('model', record.model);
    setValue('condition', record.condition);
    if (record.organization && typeof selectOrganization === 'function') {
        const orgSelect = document.getElementById('organizationSelect');
        if (orgSelect) orgSelect.value = record.organization;
        currentOrganization = record.organization;
    }
    if (typeof updateLocationPreview === 'function') updateLocationPreview();
}

function updateAssetCheckBanner() {
    const banner = document.getElementById('assetCheckBanner');
    const input = document.getElementById('assetNumber');
    if (!banner || !input) return;

    const assetNumber = input.value.trim();
    pendingAssetOverride = false;
    banner.className = 'asset-check-banner';
    banner.style.display = 'none';
    banner.textContent = '';

    if (!assetNumber) return;

    const register = findRegisterByAsset(assetNumber);
    const existing = findItemByAsset(assetNumber);
    const expectedCount = getRegisterForSurvey().length;

    if (existing) {
        banner.style.display = 'block';
        banner.classList.add('is-danger');
        banner.textContent = `이미 등록된 자산번호입니다. (${existing.itemName || '물품'}) 저장하면 중복으로 남습니다.`;
        pendingAssetOverride = true;
        return;
    }

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
            banner.textContent = `대장에 있는 예정 자산입니다. 저장하면 "찾음"으로 처리됩니다. (${register.itemName || '이름 없음'})`;
        }
        applyRegisterToForm(register);
        return;
    }

    if (expectedCount > 0) {
        banner.style.display = 'block';
        banner.classList.add('is-info');
        banner.textContent = '대장에 없는 자산번호입니다. 저장하면 신규 발견으로 집계됩니다.';
    }
}

function scheduleAssetCheck() {
    clearTimeout(assetCheckTimer);
    assetCheckTimer = setTimeout(updateAssetCheckBanner, 250);
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
    { key: 'itemName', label: '물품명', required: true, aliases: ['자산명', '물품명', '품명', '물품', '명칭', '품목명', '품목', 'name', 'item'] },
    { key: 'organization', label: '기관명', aliases: ['기관명', '기관', '조사부서', '소속', '부서', '관리부서', '사용부서', 'organization'] },
    { key: 'location', label: '사용위치', aliases: ['사용위치', '현 사용위치', '위치', '설치위치', '보관위치', '장소', 'location'] },
    { key: 'building', label: '건물', aliases: ['건물', '동', '건물명', '단과대학', 'building'] },
    { key: 'floor', label: '층', aliases: ['층', '층수', 'floor'] },
    { key: 'room', label: '실/호', aliases: ['실', '호', '호실', '실명', '학과', 'room'] },
    // 카테고리보다 먼저 둬야 전용 분류번호 열을 이쪽이 가져간다
    { key: 'goodsClNo', label: '물품분류번호', aliases: ['물품분류번호', '세부품명번호', '품명번호', '분류번호', '물품코드', 'goodsclno'] },
    { key: 'category', label: '카테고리', aliases: ['카테고리', '계정과목명', '분류번호', '분류', '품목분류', '자산분류', '계정', 'category'] },
    { key: 'quantity', label: '갯수', aliases: ['취득수량', '갯수', '수량', '수량(개)', 'qty', 'quantity'] },
    { key: 'acquiredAt', label: '취득일자', aliases: ['취득일자', '취득년월일', '취득일', '취득년월', '구입일자', '구입일', '구매일자', '구매일', '등록일자', 'acquired', 'acquisitiondate'] },
    { key: 'manufacturer', label: '제조사', aliases: ['제조사', '제작사', '메이커', '브랜드', 'manufacturer'] },
    { key: 'model', label: '모델명', aliases: ['모델명', '모델', '규격', '사양', 'model'] },
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

function applyRegisterMapping(rows, mapping) {
    const keepExtra = rows.length <= 400;
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
        if (!mapped.location) {
            mapped.location = [mapped.building, mapped.floor, mapped.room].filter(Boolean).join(' ');
        }
        if (!mapped.quantity) mapped.quantity = '1';
        const rawGoodsCl = mapped.goodsClNo;
        mapped.goodsClNo = normalizeGoodsClNo(rawGoodsCl);
        // 분류번호 열을 goodsClNo가 가져가도 기존 분류 표시가 비지 않게 한다
        if (!mapped.category && rawGoodsCl) mapped.category = rawGoodsCl;
        mapped.acquiredAt = parseAcquiredDate(mapped.acquiredAt);
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
    if (!summary || !fields || !preview) return;

    const startHint = pending.run > 20
        ? `연속 목록 ${pending.run}행`
        : `목록 ${pending.rows.length}행`;
    summary.textContent = `"${pending.fileName}" · ${pending.sheetName} · 제목행 ${pending.headerIndex + 1}번째 · ${startHint} · 열 ${pending.headers.length}개`;

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
            renderRegisterMappingModal();
        });
    });

    const mappedRows = applyRegisterMapping(pending.rows.slice(0, 3), pending.mapping);
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

async function handleRegisterImport(file) {
    const survey = typeof getWritableSurvey === 'function' ? getWritableSurvey() : getCurrentSurvey();
    if (!survey || survey.isFallback || !survey.id) {
        showToast('대장을 올리려면 진행 중인 조사 회차를 먼저 선택하세요', 'error');
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
            profile
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
    const rows = applyRegisterMapping(pending.rows, pending.mapping);
    if (rows.length === 0) {
        showToast('맞춘 열 기준으로 가져올 행이 없습니다', 'error');
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
        await saveMappingProfile({
            id: newMasterId('map'),
            headerSignature: headerSignature(pending.headers),
            headers: pending.headers,
            mapping: pending.mapping,
            fileName: pending.fileName,
            sheetName: pending.sheetName
        });
        closeRegisterMapModal();
        if (saved?.stored === 'local') {
            showToast(`${pending.survey.name} 대장 ${records.length}건을 이 기기에 가져왔습니다. 다른 사용자와 공유하려면 서버 권한 배포가 필요합니다`, 'success');
        } else {
            showToast(`${pending.survey.name} 대장 ${records.length}건을 열 매핑 후 가져왔습니다`, 'success');
        }
        refreshRegisterViews();
    } catch (error) {
        console.error('대장 저장 실패:', error);
        showToast('대장 저장에 실패했습니다. 파일이 매우 크면 잠시 후 다시 시도해 주세요', 'error');
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
    applyRegisterToForm(record);
    updateAssetCheckBanner();
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

function buildRegisterRow(source, statusKey, kind) {
    const row = {
        id: source.id,
        kind,
        statusKey,
        assetNumber: source.assetNumber || '',
        itemName: source.itemName || '',
        location: registerRowLocation(source),
        quantity: source.quantity || '',
        category: source.category || '',
        model: source.model || '',
        checkedBy: String(source.checkedByEmail || '').split('@')[0]
    };
    row.haystack = [
        row.assetNumber, row.itemName, row.location, row.category, row.model,
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

    const rows = scoped.map((record) =>
        buildRegisterRow(record, resolveRegisterStatus(record, surveyedIndex), 'register')
    );
    if (registerFilter === 'pending') return rows.filter((row) => row.statusKey === 'pending');
    if (registerFilter === 'found') return rows.filter((row) => row.statusKey === 'found' || row.statusKey === 'changed');
    if (registerFilter === 'missing') return rows.filter((row) => row.statusKey === 'missing');
    return rows;
}

function searchRegisterRows(rows) {
    const term = registerSearchTerm.trim().toLowerCase();
    if (!term) return rows;
    const parts = term.split(/\s+/);
    return rows.filter((row) => parts.every((part) => row.haystack.includes(part)));
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

function refreshRegisterViews() {
    const surveyedIndex = buildSurveyedIndex();
    updateRegisterDashboard(surveyedIndex);
    updateRegisterList({ preserveWindow: true, surveyedIndex });
    updateAssetCheckBanner();
}

async function startAssetScan() {
    const modal = document.getElementById('scanModal');
    const reader = document.getElementById('qrReader');
    if (!modal || !reader) return;
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    if (typeof Html5Qrcode === 'undefined') {
        document.getElementById('scanFallback')?.style && (document.getElementById('scanFallback').style.display = 'block');
        return;
    }

    try {
        html5Scanner = new Html5Qrcode('qrReader');
        await html5Scanner.start(
            { facingMode: 'environment' },
            {
                fps: 10,
                qrbox: { width: 230, height: 230 },
                formatsToSupport: [
                    Html5QrcodeSupportedFormats.QR_CODE,
                    Html5QrcodeSupportedFormats.CODE_128,
                    Html5QrcodeSupportedFormats.CODE_39,
                    Html5QrcodeSupportedFormats.EAN_13,
                    Html5QrcodeSupportedFormats.EAN_8,
                    Html5QrcodeSupportedFormats.ITF
                ]
            },
            (text) => {
                applyScannedAsset(text);
                stopAssetScan();
            }
        );
    } catch (error) {
        console.warn('카메라 스캔 시작 실패:', error);
        const fallback = document.getElementById('scanFallback');
        if (fallback) fallback.style.display = 'block';
        showToast('카메라를 열 수 없습니다. 자산번호를 직접 입력하세요.', 'error');
    }
}

async function stopAssetScan() {
    const modal = document.getElementById('scanModal');
    if (html5Scanner) {
        try {
            await html5Scanner.stop();
        } catch (error) {
            console.warn('스캐너 중지:', error);
        }
        try {
            html5Scanner.clear();
        } catch (error) {
            // ignore
        }
        html5Scanner = null;
    }
    if (modal) modal.classList.remove('show');
    document.body.style.overflow = 'auto';
}

function applyScannedAsset(text) {
    const input = document.getElementById('assetNumber');
    if (!input) return;
    input.value = String(text || '').trim();
    updateAssetCheckBanner();
    showToast(`자산번호 ${input.value}를 잡았습니다`, 'success');
}

function initRegister() {
    const assetInput = document.getElementById('assetNumber');
    if (assetInput && !assetInput.dataset.bound) {
        assetInput.dataset.bound = 'true';
        assetInput.addEventListener('input', scheduleAssetCheck);
        assetInput.addEventListener('blur', updateAssetCheckBanner);
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
            handleRegisterImport(file);
            e.target.value = '';
        });
    }
    const templateBtn = document.getElementById('downloadRegisterTemplateBtn');
    if (templateBtn) templateBtn.addEventListener('click', downloadRegisterTemplate);

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

    listenRegisterChunks();
    idbReadRegisters().then((localRows) => {
        if (!localRows.length) return;
        setRegisterItems(mergeRegisterLists(registerItems, localRows));
        refreshRegisterViews();
    });
    refreshRegisterViews();
}

window.setRegisterItems = setRegisterItems;
window.mergeRegisterLists = mergeRegisterLists;
window.idbReadRegisters = idbReadRegisters;
window.refreshRegisterViews = refreshRegisterViews;
window.confirmAssetDuplicate = confirmAssetDuplicate;
window.markRegisterFound = markRegisterFound;
window.fillFromRegister = fillFromRegister;
window.markRegisterMissing = markRegisterMissing;
window.initRegister = initRegister;
window.getRegisterProgress = getRegisterProgress;
window.findRegisterByAsset = findRegisterByAsset;
