// 기준(작년) 대장 — 금년 회차에 붙는 비교용 데이터 (실사 입력에서 조회)
let baselineItems = window.baselineItems || [];
let activeBaselineRecord = null;
let unsubscribeBaselineChunks = null;

const BASELINE_COMPARE_FIELDS = [
    { key: 'holder', label: '사용자', formId: 'holder' },
    { key: 'organization', label: '기관/부서', formId: 'organization' },
    { key: 'location', label: '사용위치', formId: 'location' },
    { key: 'building', label: '건물', formId: 'building' },
    { key: 'floor', label: '층', formId: 'floor' },
    { key: 'room', label: '실/호', formId: 'room' },
    { key: 'itemName', label: '물품명', formId: 'itemName' },
    { key: 'goodsClNm', label: '분류명', formId: 'goodsClNm' },
    { key: 'condition', label: '상태', formId: 'condition' },
    { key: 'manufacturer', label: '제조사', formId: 'manufacturer' },
    { key: 'model', label: '규격', formId: 'model' },
    { key: 'quantity', label: '수량', formId: 'quantity' },
    { key: 'category', label: '계정과목', formId: 'category' }
];

function setBaselineItems(list) {
    baselineItems = Array.isArray(list) ? list : [];
    window.baselineItems = baselineItems;
    updateBaselineStatusUi();
}

function getBaselineSurveyId() {
    if (typeof getRegisterSurveyId === 'function') return getRegisterSurveyId();
    if (typeof currentSurveyId !== 'undefined'
        && currentSurveyId
        && currentSurveyId !== '__all__'
        && currentSurveyId !== '__unassigned__') {
        return currentSurveyId;
    }
    return '';
}

function getBaselineForSurvey(surveyId) {
    const sid = surveyId || getBaselineSurveyId();
    if (!sid) return [];
    return baselineItems.filter((record) => record.surveyId === sid);
}

function findBaselineByAsset(assetNumber, surveyId) {
    const key = typeof normalizeAsset === 'function'
        ? normalizeAsset(assetNumber)
        : String(assetNumber || '').trim().toLowerCase().replace(/[\s\-_.]/g, '');
    if (!key) return null;
    return getBaselineForSurvey(surveyId).find((record) => {
        const recordKey = typeof normalizeAsset === 'function'
            ? normalizeAsset(record.assetNumber)
            : String(record.assetNumber || '').trim().toLowerCase().replace(/[\s\-_.]/g, '');
        return recordKey === key;
    }) || null;
}

function normalizeBaselineValue(value) {
    if (value == null) return '';
    return String(value).trim().replace(/\s+/g, ' ');
}

function updateBaselineStatusUi() {
    const el = document.getElementById('baselineStatus');
    if (!el) return;
    const sid = getBaselineSurveyId();
    if (!sid) {
        el.textContent = '회차를 선택하면 기준 대장 상태를 표시합니다.';
        return;
    }
    const count = getBaselineForSurvey(sid).length;
    el.textContent = count
        ? `현재 회차 기준 대장 ${count.toLocaleString()}건 (입력 탭에서 자산번호로 조회)`
        : '이 회차에 올린 기준 대장이 없습니다.';
}

function baselineFieldKeys(data) {
    return ['baselines', ...Object.keys(data || {}).filter((key) => key.startsWith('baselineChunk_'))];
}

function openBaselineIdb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('find-app-baselines', 1);
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

async function idbWriteBaselines(surveyId, rows) {
    const dbx = await openBaselineIdb();
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

async function idbReadBaselines() {
    try {
        const dbx = await openBaselineIdb();
        return await new Promise((resolve, reject) => {
            const tx = dbx.transaction('rows', 'readonly');
            const req = tx.objectStore('rows').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch (error) {
        console.warn('로컬 기준 대장 읽기 실패:', error);
        return [];
    }
}

async function clearBaselinesForSurvey(surveyId) {
    const snapshot = await db.collection('users').get();
    for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        const update = {};
        baselineFieldKeys(data).forEach((key) => {
            const list = Array.isArray(data[key]) ? data[key] : [];
            const filtered = list.filter((record) => record.surveyId !== surveyId);
            if (filtered.length !== list.length) {
                update[key] = filtered.length ? filtered : firebase.firestore.FieldValue.delete();
            }
        });
        const meta = data.baselineChunkMeta || {};
        if (meta[surveyId]) {
            update.baselineChunkMeta = { ...meta, [surveyId]: firebase.firestore.FieldValue.delete() };
        }
        if (Object.keys(update).length) {
            try {
                await doc.ref.set(update, { merge: true });
            } catch (error) {
                console.warn('기존 기준 대장 정리 건너뜀:', error);
            }
        }
    }

    try {
        let i = 0;
        while (i < 500) {
            const ref = db.collection('baselineChunks').doc(`${surveyId}_${i}`);
            const snap = await ref.get();
            if (!snap.exists) break;
            await ref.delete();
            i += 1;
        }
    } catch (error) {
        console.warn('기준 대장 청크 삭제 실패:', error);
    }
}

async function saveBaselineChunkDocs(surveyId, rows) {
    const userRef = db.collection('users').doc(currentUser.uid);
    const prevCount = (await userRef.get()).data()?.baselineChunkMeta?.[surveyId]?.count || 0;
    const chunkSize = typeof REGISTER_CHUNK_SIZE === 'number' ? REGISTER_CHUNK_SIZE : 280;
    const count = Math.ceil(rows.length / chunkSize) || 0;
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
        if (!ops) return;
        await batch.commit();
        batch = db.batch();
        ops = 0;
    };
    for (let i = 0; i < Math.max(count, prevCount); i += 1) {
        const ref = db.collection('baselineChunks').doc(`${surveyId}_${i}`);
        if (i < count) {
            batch.set(ref, {
                surveyId,
                index: i,
                rows: rows.slice(i * chunkSize, (i + 1) * chunkSize),
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
        baselineChunkMeta: { [surveyId]: { count, total: rows.length } }
    }, { merge: true });
}

async function saveBaselinesForSurvey(surveyId, rows) {
    if (!currentUser) throw new Error('로그인이 필요합니다');
    const leanFn = typeof leanRegisterRecord === 'function' ? leanRegisterRecord : ((row) => row);
    const lean = rows.map(leanFn);
    await clearBaselinesForSurvey(surveyId);

    const maxRows = typeof REGISTER_USERDOC_MAX_ROWS === 'number' ? REGISTER_USERDOC_MAX_ROWS : 200;
    if (lean.length <= maxRows) {
        const userRef = db.collection('users').doc(currentUser.uid);
        const latest = ((await userRef.get()).data()?.baselines || []).filter((record) => record.surveyId !== surveyId);
        await userRef.set({ baselines: latest.concat(lean) }, { merge: true });
        if (typeof listenUserMasters === 'function') listenUserMasters();
        setBaselineItems(mergeBaselineLists(
            baselineItems.filter((record) => record.surveyId !== surveyId),
            lean
        ));
        try { await idbWriteBaselines(surveyId, lean); } catch (_) { /* ignore */ }
        return { stored: 'shared' };
    }

    try {
        await saveBaselineChunkDocs(surveyId, lean);
        setBaselineItems(mergeBaselineLists(
            baselineItems.filter((record) => record.surveyId !== surveyId),
            lean
        ));
        try { await idbWriteBaselines(surveyId, lean); } catch (_) { /* ignore */ }
        return { stored: 'chunks' };
    } catch (error) {
        console.warn('기준 대장 서버 저장 실패, 로컬 보관:', error);
        try { await idbWriteBaselines(surveyId, lean); } catch (_) { /* ignore */ }
        setBaselineItems(mergeBaselineLists(
            baselineItems.filter((record) => record.surveyId !== surveyId),
            lean
        ));
        return { stored: 'local', reason: error.code || error.message };
    }
}

function mergeBaselineLists(...lists) {
    const byId = new Map();
    lists.flat().forEach((record) => {
        if (record && record.id && !byId.has(record.id)) byId.set(record.id, record);
    });
    return Array.from(byId.values());
}

function listenBaselineChunks() {
    if (unsubscribeBaselineChunks) return;
    unsubscribeBaselineChunks = db.collection('baselineChunks').onSnapshot((snapshot) => {
        const chunkRows = [];
        snapshot.docs.forEach((doc) => {
            (doc.data()?.rows || []).forEach((record) => {
                if (record && record.id) chunkRows.push(record);
            });
        });
        const existing = baselineItems.filter((record) => !chunkRows.some((row) => row.id === record.id));
        setBaselineItems(mergeBaselineLists(existing, chunkRows));
    }, (error) => {
        console.warn('기준 대장 구독 실패:', error);
        unsubscribeBaselineChunks = null;
        idbReadBaselines().then((localRows) => {
            if (!localRows.length) return;
            setBaselineItems(mergeBaselineLists(baselineItems, localRows));
        });
    });
}

function clearBaselineComparePanel() {
    activeBaselineRecord = null;
    const panel = document.getElementById('baselineComparePanel');
    if (panel) {
        panel.style.display = 'none';
        panel.innerHTML = '';
    }
}

function applyBaselineToForm(record) {
    if (typeof applyRegisterToForm === 'function') {
        applyRegisterToForm(record);
    }
    const holder = document.getElementById('holder');
    if (holder && record.holder) holder.value = record.holder;
}

function renderBaselineComparePanel(record, options = {}) {
    const panel = document.getElementById('baselineComparePanel');
    if (!panel || !record) return;
    activeBaselineRecord = record;
    const yearReg = options.yearRegister || null;
    const rows = BASELINE_COMPARE_FIELDS
        .map((field) => {
            const value = normalizeBaselineValue(record[field.key]);
            if (!value && field.key !== 'itemName' && field.key !== 'organization') return '';
            return `<div class="baseline-compare-row"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(value || '-')}</strong></div>`;
        })
        .filter(Boolean)
        .join('');

    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="baseline-compare-head">
            <strong>기준(작년) 대장</strong>
            <span>${escapeHtml(record.assetNumber || '')}</span>
        </div>
        <p class="baseline-compare-help">아래는 작년 등록 정보입니다. 현장과 다르면 <em>입력란을 수정</em>한 뒤 저장하세요. 저장 시 금년 대장이 있으면 변경분이 반영됩니다.</p>
        <div class="baseline-compare-grid">${rows || '<p class="register-empty">표시할 기준 정보가 없습니다.</p>'}</div>
        ${yearReg ? '<p class="baseline-compare-note">금년 대장에도 같은 자산번호가 있습니다.</p>' : ''}
        <button type="button" class="btn btn-secondary btn-small" id="baselineRefillBtn">기준 정보로 다시 채우기</button>
    `;
    const refill = document.getElementById('baselineRefillBtn');
    if (refill) {
        refill.addEventListener('click', () => {
            applyBaselineToForm(record);
            if (typeof syncChoiceChips === 'function') syncChoiceChips();
            showToast('기준 대장 정보로 다시 채웠습니다', 'info');
        });
    }
}

function collectBaselineFormChanges(formData) {
    if (!activeBaselineRecord) return [];
    const changes = [];
    BASELINE_COMPARE_FIELDS.forEach((field) => {
        const fromBaseline = normalizeBaselineValue(activeBaselineRecord[field.key]);
        let fromForm = '';
        if (formData && formData[field.key] != null) {
            fromForm = normalizeBaselineValue(formData[field.key]);
        } else if (field.formId) {
            fromForm = normalizeBaselineValue(document.getElementById(field.formId)?.value);
        }
        // location은 건물/층/실 조합일 수 있음
        if (field.key === 'location' && !fromForm) {
            fromForm = normalizeBaselineValue([
                document.getElementById('building')?.value,
                document.getElementById('floor')?.value,
                document.getElementById('room')?.value
            ].filter(Boolean).join(' '));
        }
        if (!fromForm && !fromBaseline) return;
        if (fromForm === fromBaseline) return;
        changes.push({
            field: field.key,
            label: field.label,
            from: fromBaseline,
            to: fromForm
        });
    });
    return changes;
}

async function applyBaselineSurveyResult(assetNumber, itemId, formData = {}) {
    const changes = collectBaselineFormChanges(formData);
    const changePatch = {};
    changes.forEach((change) => {
        if (change.to) changePatch[change.field] = change.to;
    });

    const yearRegister = typeof findRegisterByAsset === 'function'
        ? findRegisterByAsset(assetNumber)
        : null;

    if (yearRegister) {
        const patch = {
            ...changePatch,
            status: changes.length ? 'changed' : 'found',
            foundItemId: itemId || yearRegister.foundItemId || '',
            checkedBy: currentUser?.uid || '',
            checkedByEmail: currentUser?.email || '',
            checkedAt: new Date().toISOString(),
            actualCondition: formData.condition || yearRegister.actualCondition || '',
            baselineCompared: true,
            baselineChangedFields: changes.map((c) => c.field)
        };
        if (typeof updateRegisterRecord === 'function') {
            await updateRegisterRecord(yearRegister.id, patch);
        }
    } else if (typeof markRegisterFound === 'function') {
        await markRegisterFound(assetNumber, itemId, { condition: formData.condition });
    }

    return { changes, matchedBaseline: !!activeBaselineRecord };
}

function initBaselineRegister() {
    const importBtn = document.getElementById('importBaselineBtn');
    const importFile = document.getElementById('importBaselineFile');
    if (importBtn && importFile && !importBtn.dataset.bound) {
        importBtn.dataset.bound = 'true';
        importBtn.addEventListener('click', () => importFile.click());
        importFile.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (typeof handleRegisterImport === 'function') {
                handleRegisterImport(file, 'baseline');
            } else {
                showToast('대장 모듈을 불러오지 못했습니다', 'error');
            }
            e.target.value = '';
        });
    }

    listenBaselineChunks();
    idbReadBaselines().then((localRows) => {
        if (!localRows.length) return;
        setBaselineItems(mergeBaselineLists(baselineItems, localRows));
    });
    updateBaselineStatusUi();

    if (typeof window !== 'undefined') {
        const originalSelect = window.selectSurvey;
        // selectSurvey는 masters에 있음 — 상태 갱신만 훅
        document.getElementById('surveySelect')?.addEventListener('change', () => {
            setTimeout(updateBaselineStatusUi, 0);
        });
    }
}

window.setBaselineItems = setBaselineItems;
window.mergeBaselineLists = mergeBaselineLists;
window.idbReadBaselines = idbReadBaselines;
window.getBaselineForSurvey = getBaselineForSurvey;
window.findBaselineByAsset = findBaselineByAsset;
window.saveBaselinesForSurvey = saveBaselinesForSurvey;
window.clearBaselineComparePanel = clearBaselineComparePanel;
window.applyBaselineToForm = applyBaselineToForm;
window.renderBaselineComparePanel = renderBaselineComparePanel;
window.collectBaselineFormChanges = collectBaselineFormChanges;
window.applyBaselineSurveyResult = applyBaselineSurveyResult;
window.initBaselineRegister = initBaselineRegister;
window.updateBaselineStatusUi = updateBaselineStatusUi;
window.activeBaselineRecordRef = () => activeBaselineRecord;
