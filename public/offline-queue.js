// 오프라인 입력 큐 — 연결이 끊겨도 저장하고, 다시 온라인일 때 업로드
const OFFLINE_DB_NAME = 'find-app-outbox';
const OFFLINE_DB_VERSION = 1;
const OFFLINE_STORE = 'ops';

let offlineDb = null;
let offlineSyncing = false;

function isLocalItemId(id) {
    return String(id || '').startsWith('local_');
}

function isOfflineError(error) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const code = error?.code || '';
    const message = String(error?.message || '').toLowerCase();
    return code === 'unavailable'
        || code === 'internal'
        || code === 'deadline-exceeded'
        || message.includes('offline')
        || message.includes('network')
        || message.includes('failed to fetch');
}

function newLocalItemId() {
    return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function openOfflineDb() {
    if (offlineDb) return Promise.resolve(offlineDb);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
        request.onupgradeneeded = () => {
            const dbx = request.result;
            if (!dbx.objectStoreNames.contains(OFFLINE_STORE)) {
                const store = dbx.createObjectStore(OFFLINE_STORE, { keyPath: 'id' });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };
        request.onsuccess = () => {
            offlineDb = request.result;
            resolve(offlineDb);
        };
        request.onerror = () => reject(request.error);
    });
}

function offlineTx(mode, work) {
    return openOfflineDb().then((dbx) => new Promise((resolve, reject) => {
        const tx = dbx.transaction(OFFLINE_STORE, mode);
        const store = tx.objectStore(OFFLINE_STORE);
        const result = work(store);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
    }));
}

async function enqueueOfflineOp(op) {
    const record = {
        id: op.id || newLocalItemId(),
        type: op.type,
        localId: op.localId || '',
        itemId: op.itemId || '',
        payload: op.payload || {},
        createdAt: op.createdAt || new Date().toISOString(),
        status: 'pending'
    };
    await offlineTx('readwrite', (store) => store.put(record));
    updateOfflineStatus();
    return record;
}

async function listOfflineOps() {
    try {
        const dbx = await openOfflineDb();
        return await new Promise((resolve, reject) => {
            const tx = dbx.transaction(OFFLINE_STORE, 'readonly');
            const req = tx.objectStore(OFFLINE_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch (error) {
        console.warn('오프라인 큐 읽기 실패:', error);
        return [];
    }
}

async function removeOfflineOp(id) {
    await offlineTx('readwrite', (store) => store.delete(id));
}

async function updateOfflineOp(id, patch) {
    const dbx = await openOfflineDb();
    await new Promise((resolve, reject) => {
        const tx = dbx.transaction(OFFLINE_STORE, 'readwrite');
        const store = tx.objectStore(OFFLINE_STORE);
        const req = store.get(id);
        req.onsuccess = () => {
            if (req.result) store.put({ ...req.result, ...patch });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function firestorePayload(item) {
    const data = { ...item };
    ['id', '_pending', '_pendingOp', '_queueId', '_cachedAt'].forEach((key) => {
        delete data[key];
    });
    if (typeof firebase !== 'undefined') {
        data.timestamp = data.timestamp
            ? data.timestamp
            : firebase.firestore.FieldValue.serverTimestamp();
        if (typeof data.timestamp === 'string') {
            data.timestamp = firebase.firestore.Timestamp.fromDate(new Date(data.timestamp));
        }
    }
    return data;
}

async function mergeOfflineQueueIntoItems() {
    const ops = await listOfflineOps();
    if (!ops.length || typeof items === 'undefined') return;

    const deletes = new Set(ops.filter((op) => op.type === 'delete').map((op) => op.itemId));
    if (deletes.size) {
        items = items.filter((item) => !deletes.has(item.id));
    }

    ops.filter((op) => op.type === 'update').forEach((op) => {
        const index = items.findIndex((item) => item.id === op.itemId);
        if (index !== -1) {
            items[index] = { ...items[index], ...op.payload, _pending: true, _queueId: op.id };
        }
    });

    ops.filter((op) => op.type === 'create').forEach((op) => {
        const localId = op.localId || op.id;
        if (items.some((item) => item.id === localId || item._queueId === op.id)) return;
        items.unshift({
            ...op.payload,
            id: localId,
            _pending: true,
            _pendingOp: 'create',
            _queueId: op.id
        });
    });

    updateOfflineStatus();
}

function refreshAfterOfflineChange() {
    try {
        if (typeof getItemsForView === 'function' && typeof displayItems === 'function' && document.getElementById('itemList')) {
            const view = getItemsForView();
            const sorted = typeof sortItems === 'function'
                ? sortItems(view, typeof currentSort !== 'undefined' ? currentSort : 'newest')
                : view;
            displayItems(sorted);
        }
        if (typeof updateItemCount === 'function') updateItemCount();
        if (typeof updateDashboard === 'function') updateDashboard();
        if (typeof refreshRegisterViews === 'function') refreshRegisterViews();
    } catch (error) {
        console.warn('오프라인 화면 갱신 건너뜀:', error);
    }
    updateOfflineStatus();
}

async function saveItemOffline(payload) {
    const localId = newLocalItemId();
    const item = {
        ...payload,
        id: localId,
        timestamp: payload.timestamp || new Date().toISOString(),
        _pending: true,
        _pendingOp: 'create'
    };
    const op = await enqueueOfflineOp({
        type: 'create',
        localId,
        payload: item
    });
    item._queueId = op.id;
    if (typeof items !== 'undefined') items.unshift(item);
    refreshAfterOfflineChange();
    return item;
}

async function updateItemOffline(itemId, payload) {
    const ops = await listOfflineOps();
    const existingCreate = ops.find((op) => op.type === 'create' && (op.localId === itemId || op.id === itemId));
    if (existingCreate) {
        const nextPayload = { ...existingCreate.payload, ...payload, id: existingCreate.localId || itemId };
        await updateOfflineOp(existingCreate.id, { payload: nextPayload });
    } else {
        await enqueueOfflineOp({
            type: 'update',
            itemId,
            payload
        });
    }
    if (typeof items !== 'undefined') {
        const index = items.findIndex((item) => item.id === itemId);
        if (index !== -1) {
            items[index] = { ...items[index], ...payload, _pending: true };
        }
    }
    refreshAfterOfflineChange();
}

async function deleteItemOffline(itemId) {
    const ops = await listOfflineOps();
    const existingCreate = ops.find((op) => op.type === 'create' && (op.localId === itemId || op.id === itemId));
    if (existingCreate) {
        await removeOfflineOp(existingCreate.id);
    } else {
        await enqueueOfflineOp({ type: 'delete', itemId });
    }
    if (typeof items !== 'undefined') {
        items = items.filter((item) => item.id !== itemId);
    }
    refreshAfterOfflineChange();
}

async function syncOfflineQueue() {
    if (offlineSyncing || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        updateOfflineStatus();
        return { synced: 0, failed: 0 };
    }
    if (typeof db === 'undefined' || typeof currentUser === 'undefined' || !currentUser) {
        return { synced: 0, failed: 0 };
    }

    offlineSyncing = true;
    updateOfflineStatus();
    const ops = (await listOfflineOps()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    let synced = 0;
    let failed = 0;

    for (const op of ops) {
        try {
            if (op.type === 'create') {
                const payload = firestorePayload(op.payload);
                payload.userId = payload.userId || currentUser.uid;
                payload.userEmail = payload.userEmail || currentUser.email;
                const docRef = await db.collection('items').add(payload);
                if (typeof items !== 'undefined') {
                    items = items.filter((item) => item.id !== op.localId && item.id !== op.id);
                    if (!items.some((item) => item.id === docRef.id)) {
                        items.unshift({ ...op.payload, id: docRef.id, _pending: false });
                    }
                }
                if (typeof markRegisterFound === 'function' && op.payload.assetNumber) {
                    try {
                        await markRegisterFound(op.payload.assetNumber, docRef.id, { condition: op.payload.condition });
                    } catch (error) {
                        console.warn('대장 대조 표시 건너뜀:', error);
                    }
                }
            } else if (op.type === 'update' && op.itemId && !isLocalItemId(op.itemId)) {
                await db.collection('items').doc(op.itemId).update(firestorePayload(op.payload));
                if (typeof items !== 'undefined') {
                    const index = items.findIndex((item) => item.id === op.itemId);
                    if (index !== -1) items[index] = { ...items[index], ...op.payload, _pending: false };
                }
            } else if (op.type === 'delete' && op.itemId && !isLocalItemId(op.itemId)) {
                await db.collection('items').doc(op.itemId).delete();
            }
            await removeOfflineOp(op.id);
            synced += 1;
        } catch (error) {
            if (isOfflineError(error)) break;
            console.error('오프라인 큐 동기화 실패:', op, error);
            await updateOfflineOp(op.id, { status: 'error', error: error.message });
            failed += 1;
        }
    }

    offlineSyncing = false;
    refreshAfterOfflineChange();
    return { synced, failed };
}

function updateOfflineStatus() {
    const el = document.getElementById('offlineStatus');
    if (!el) return;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    listOfflineOps().then((ops) => {
        const pending = ops.length;
        if (!online) {
            el.hidden = false;
            el.className = 'offline-status is-offline';
            el.textContent = pending ? `오프라인 · 대기 ${pending}건` : '오프라인 · 조회/입력 가능';
            return;
        }
        if (offlineSyncing) {
            el.hidden = false;
            el.className = 'offline-status is-syncing';
            el.textContent = '대기 항목 업로드 중...';
            return;
        }
        if (pending) {
            el.hidden = false;
            el.className = 'offline-status is-pending';
            el.textContent = `업로드 대기 ${pending}건`;
            return;
        }
        el.hidden = true;
        el.textContent = '';
    });
}

function initOfflineQueue() {
    window.addEventListener('online', async () => {
        updateOfflineStatus();
        const result = await syncOfflineQueue();
        if (result.synced && typeof showToast === 'function') {
            showToast(`오프라인에 저장해 둔 ${result.synced}건을 업로드했습니다`, 'success');
        }
    });
    window.addEventListener('offline', () => {
        updateOfflineStatus();
        if (typeof showToast === 'function') {
            showToast('오프라인입니다. 입력한 내용은 이 기기에 저장됩니다', 'info');
        }
    });
    mergeOfflineQueueIntoItems().then(() => {
        refreshAfterOfflineChange();
        if (navigator.onLine) syncOfflineQueue();
        else updateOfflineStatus();
    });
}

window.isLocalItemId = isLocalItemId;
window.isOfflineError = isOfflineError;
window.saveItemOffline = saveItemOffline;
window.updateItemOffline = updateItemOffline;
window.deleteItemOffline = deleteItemOffline;
window.mergeOfflineQueueIntoItems = mergeOfflineQueueIntoItems;
window.syncOfflineQueue = syncOfflineQueue;
window.initOfflineQueue = initOfflineQueue;
window.updateOfflineStatus = updateOfflineStatus;
window.listOfflineOps = listOfflineOps;
