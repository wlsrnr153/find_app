// 조사 회차 / 공유 기관 / 위치 마스터
const SURVEY_ALL = '__all__';
const SURVEY_UNASSIGNED = '__unassigned__';
const SURVEY_STORAGE_KEY = 'currentSurveyId';

let surveys = [];
let currentSurveyId = localStorage.getItem(SURVEY_STORAGE_KEY) || SURVEY_ALL;
let organizationRecords = [];
let locations = [];
let mastersInitialized = false;
let unsubscribeSurveys = null;
let unsubscribeOrganizations = null;
let unsubscribeLocations = null;
let unsubscribeUserMasters = null;
let useUserDocMasters = false;
let creatingDefaultSurvey = false;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getSafeDate(value) {
    if (!value) return new Date(0);
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    if (value instanceof Date) return value;
    return new Date(0);
}

function composeLocation(building, floor, room, fallback) {
    const parts = [building, floor, room].map(part => String(part || '').trim()).filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
    return String(fallback || '').trim();
}

function getCurrentSurvey() {
    return surveys.find(survey => survey.id === currentSurveyId) || null;
}

function itemBelongsToSurvey(item, surveyId) {
    if (!surveyId || surveyId === SURVEY_ALL) return true;
    if (surveyId === SURVEY_UNASSIGNED) return !item.surveyId;
    if (item.surveyId === surveyId) return true;
    const survey = surveys.find(entry => entry.id === surveyId);
    return !!(survey && survey.isDefault && !item.surveyId);
}

function getVisibleItems(source) {
    const list = source || items || [];
    return list.filter(item => itemBelongsToSurvey(item, currentSurveyId));
}

function getWritableSurvey() {
    if (currentSurveyId === SURVEY_ALL || currentSurveyId === SURVEY_UNASSIGNED) {
        const active = surveys.find(survey => survey.status === 'active');
        if (active) return active;
        return surveys.length === 0 ? { id: '', name: '', status: 'active', isFallback: true } : null;
    }
    const selected = getCurrentSurvey();
    if (selected && selected.status === 'closed') return null;
    if (selected) return selected;
    return surveys.length === 0 ? { id: '', name: '', status: 'active', isFallback: true } : null;
}

function getOrganizationNames() {
    const names = new Set(organizationRecords.map(org => org.name));
    (items || []).forEach(item => {
        if (item.organization) names.add(item.organization);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ko'));
}

function refreshVisibleViews() {
    if (typeof filterItems === 'function') {
        filterItems();
    } else if (typeof displayItems === 'function') {
        const sorted = typeof sortItems === 'function'
            ? sortItems(getVisibleItems(), currentSort || 'newest')
            : getVisibleItems();
        displayItems(sorted);
    }
    if (typeof updateItemCount === 'function') updateItemCount();
    if (typeof updateDashboard === 'function') updateDashboard();
    updateSurveySelect();
    updateSurveyBanner();
    updateOrganizationSelect();
    updateLocationDatalists();
    updateLocationPreview();
    if (typeof refreshRegisterViews === 'function') refreshRegisterViews();
}

async function initMasters() {
    if (mastersInitialized) {
        refreshVisibleViews();
        return;
    }
    mastersInitialized = true;

    bindMasterEvents();
    listenSurveys();
    listenOrganizations();
    listenLocations();
    await migrateLocalOrganizations();
}

function bindMasterEvents() {
    const surveySelect = document.getElementById('surveySelect');
    if (surveySelect) {
        surveySelect.addEventListener('change', (e) => {
            selectSurvey(e.target.value);
        });
    }

    ['manageSurveysBtn', 'manageSurveysBtn2'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', openManageSurveysModal);
    });

    const closeSurveys = document.getElementById('closeManageSurveys');
    if (closeSurveys) closeSurveys.addEventListener('click', closeManageSurveysModal);

    const manageSurveysModal = document.getElementById('manageSurveysModal');
    if (manageSurveysModal) {
        manageSurveysModal.addEventListener('click', (e) => {
            if (e.target.id === 'manageSurveysModal') closeManageSurveysModal();
        });
    }

    const saveSurveyBtn = document.getElementById('saveSurveyBtn');
    if (saveSurveyBtn) saveSurveyBtn.addEventListener('click', saveNewSurvey);

    const newSurveyName = document.getElementById('newSurveyName');
    if (newSurveyName) {
        newSurveyName.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') saveNewSurvey();
        });
    }

    ['building', 'floor', 'room'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.addEventListener('input', updateLocationPreview);
    });
}

function newMasterId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function flattenUserMasters(docs) {
    const nextSurveys = [];
    const nextOrgs = [];
    const nextLocations = [];
    const nextRegisters = [];
    docs.forEach((doc) => {
        const data = doc.data() || {};
        (data.surveys || []).forEach((survey) => {
            if (survey && survey.id) nextSurveys.push({ ...survey, createdBy: survey.createdBy || doc.id });
        });
        (data.organizations || []).forEach((org) => {
            if (org && org.name) nextOrgs.push({ ...org, id: org.id || org.name, createdBy: org.createdBy || doc.id });
        });
        (data.locations || []).forEach((location) => {
            if (location && location.label) nextLocations.push({ ...location, createdBy: location.createdBy || doc.id });
        });
        const registerLists = [data.registers, ...Object.keys(data)
            .filter((key) => key.startsWith('registerChunk_'))
            .map((key) => data[key])];
        registerLists.forEach((list) => {
            (list || []).forEach((record) => {
                if (record && record.id) nextRegisters.push({ ...record, createdBy: record.createdBy || doc.id });
            });
        });
    });
    surveys = nextSurveys.sort((a, b) => getSafeDate(b.createdAt) - getSafeDate(a.createdAt));
    organizationRecords = nextOrgs.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
    organizations = organizationRecords.map((org) => org.name);
    locations = nextLocations;
    if (typeof setRegisterItems === 'function') {
        setRegisterItems(nextRegisters);
    } else {
        window.registerItems = nextRegisters;
    }
    if (typeof idbReadRegisters === 'function') {
        idbReadRegisters().then((localRows) => {
            if (!localRows.length) return;
            const merged = typeof mergeRegisterLists === 'function'
                ? mergeRegisterLists(nextRegisters, localRows)
                : nextRegisters.concat(localRows);
            if (typeof setRegisterItems === 'function') setRegisterItems(merged);
            else window.registerItems = merged;
            if (typeof refreshRegisterViews === 'function') refreshRegisterViews();
        });
    }
}

function listenUserMasters() {
    if (unsubscribeUserMasters) return;
    useUserDocMasters = true;
    unsubscribeUserMasters = db.collection('users').onSnapshot(async (snapshot) => {
        flattenUserMasters(snapshot.docs);
        if (surveys.length === 0 && currentUser) {
            await createDefaultSurvey();
            return;
        }
        if (!surveys.some(survey => survey.id === currentSurveyId)
            && currentSurveyId !== SURVEY_ALL
            && currentSurveyId !== SURVEY_UNASSIGNED) {
            const active = surveys.find(survey => survey.status === 'active');
            currentSurveyId = active ? active.id : SURVEY_ALL;
            localStorage.setItem(SURVEY_STORAGE_KEY, currentSurveyId);
        }
        refreshVisibleViews();
        updateSurveyList();
        updateOrganizationList();
        updateFilterOrganization();
        updateLocationDatalists();
        if (typeof refreshRegisterViews === 'function') refreshRegisterViews();
    }, (error) => {
        console.warn('사용자 문서 마스터 로드 실패:', error);
    });
}

async function addToUserMaster(field, record) {
    if (!currentUser) throw new Error('로그인이 필요합니다');
    await db.collection('users').doc(currentUser.uid).set({
        [field]: firebase.firestore.FieldValue.arrayUnion(record)
    }, { merge: true });
}

async function rewriteUserMaster(field, mutate) {
    const snapshot = await db.collection('users').get();
    for (const doc of snapshot.docs) {
        const list = Array.isArray(doc.data()?.[field]) ? doc.data()[field] : [];
        const next = mutate(list);
        if (next === list) continue;
        await doc.ref.set({ [field]: next }, { merge: true });
        return true;
    }
    return false;
}

function listenSurveys() {
    if (unsubscribeSurveys) unsubscribeSurveys();
    unsubscribeSurveys = db.collection('surveys').onSnapshot(async (snapshot) => {
        surveys = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => getSafeDate(b.createdAt) - getSafeDate(a.createdAt));
        if (surveys.length === 0 && currentUser) {
            await createDefaultSurvey();
            return;
        }
        if (!surveys.some(survey => survey.id === currentSurveyId)
            && currentSurveyId !== SURVEY_ALL
            && currentSurveyId !== SURVEY_UNASSIGNED) {
            const active = surveys.find(survey => survey.status === 'active');
            currentSurveyId = active ? active.id : SURVEY_ALL;
            localStorage.setItem(SURVEY_STORAGE_KEY, currentSurveyId);
        }
        refreshVisibleViews();
        updateSurveyList();
    }, (error) => {
        console.warn('조사 회차 컬렉션 권한 없음, users 문서로 대체:', error);
        listenUserMasters();
        updateSurveySelect();
    });
}

function listenOrganizations() {
    if (unsubscribeOrganizations) unsubscribeOrganizations();
    unsubscribeOrganizations = db.collection('organizations').onSnapshot((snapshot) => {
        organizationRecords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
        organizations = organizationRecords.map(org => org.name);
        updateOrganizationSelect();
        updateOrganizationList();
        updateFilterOrganization();
    }, (error) => {
        console.warn('기관 컬렉션 권한 없음, users 문서로 대체:', error);
        listenUserMasters();
        const saved = localStorage.getItem('organizations');
        if (saved) {
            try {
                organizations = JSON.parse(saved);
                organizationRecords = organizations.map(name => ({ id: name, name }));
                updateOrganizationSelect();
                updateFilterOrganization();
            } catch (parseError) {
                console.warn('로컬 기관 복원 실패:', parseError);
            }
        }
    });
}

function listenLocations() {
    if (unsubscribeLocations) unsubscribeLocations();
    unsubscribeLocations = db.collection('locations').onSnapshot((snapshot) => {
        locations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateLocationDatalists();
    }, (error) => {
        console.warn('위치 컬렉션 권한 없음, users 문서로 대체:', error);
        listenUserMasters();
    });
}

async function persistSurvey(payload) {
    const data = {
        ...payload,
        createdBy: currentUser.uid,
        createdByEmail: currentUser.email
    };
    try {
        const docRef = await db.collection('surveys').add({
            ...data,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return docRef.id;
    } catch (error) {
        if (error.code !== 'permission-denied') throw error;
        listenUserMasters();
        const id = newMasterId('sv');
        await addToUserMaster('surveys', {
            ...data,
            id,
            createdAt: new Date().toISOString()
        });
        return id;
    }
}

async function createDefaultSurvey() {
    if (!currentUser || creatingDefaultSurvey) return;
    creatingDefaultSurvey = true;
    try {
        await persistSurvey({
            name: '기본 조사',
            description: '기존 데이터를 포함한 기본 조사 회차',
            status: 'active',
            isDefault: true
        });
    } catch (error) {
        console.error('기본 회차 생성 실패:', error);
    } finally {
        creatingDefaultSurvey = false;
    }
}

async function migrateLocalOrganizations() {
    const saved = localStorage.getItem('organizations');
    if (!saved) return;
    try {
        const localOrgs = JSON.parse(saved);
        if (!Array.isArray(localOrgs) || localOrgs.length === 0) return;
        const existing = new Set(organizationRecords.map(org => org.name));
        for (const name of localOrgs) {
            const trimmed = String(name || '').trim();
            if (!trimmed || existing.has(trimmed)) continue;
            await db.collection('organizations').add({
                name: trimmed,
                createdBy: currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                migratedFromLocal: true
            });
            existing.add(trimmed);
        }
        localStorage.removeItem('organizations');
    } catch (error) {
        console.warn('로컬 기관 이전 실패:', error);
    }
}

function selectSurvey(surveyId) {
    currentSurveyId = surveyId || SURVEY_ALL;
    localStorage.setItem(SURVEY_STORAGE_KEY, currentSurveyId);
    refreshVisibleViews();
}

function updateSurveySelect() {
    const select = document.getElementById('surveySelect');
    if (!select) return;
    const previous = currentSurveyId;
    const unassignedCount = (items || []).filter(item => !item.surveyId).length;

    const options = [
        `<option value="${SURVEY_ALL}">전체 회차</option>`
    ];

    surveys.forEach(survey => {
        const status = survey.status === 'closed' ? ' (마감)' : '';
        options.push(`<option value="${escapeHtml(survey.id)}">${escapeHtml(survey.name)}${status}</option>`);
    });

    if (unassignedCount > 0) {
        options.push(`<option value="${SURVEY_UNASSIGNED}">미분류 (기존 ${unassignedCount}건)</option>`);
    }

    select.innerHTML = options.join('');
    if ([...select.options].some(option => option.value === previous)) {
        select.value = previous;
    } else {
        select.value = SURVEY_ALL;
        currentSurveyId = SURVEY_ALL;
    }

    const badge = document.getElementById('surveyStatusBadge');
    if (!badge) return;
    if (currentSurveyId === SURVEY_ALL) {
        badge.textContent = '전체';
        badge.className = 'survey-badge';
    } else if (currentSurveyId === SURVEY_UNASSIGNED) {
        badge.textContent = '미분류';
        badge.className = 'survey-badge';
    } else {
        const survey = getCurrentSurvey();
        badge.textContent = survey?.status === 'closed' ? '마감' : '진행중';
        badge.className = `survey-badge ${survey?.status === 'closed' ? 'is-closed' : 'is-active'}`;
    }
}

function updateSurveyBanner() {
    const banner = document.getElementById('surveyInputBanner');
    if (!banner) return;
    const writable = getWritableSurvey();
    const selected = getCurrentSurvey();

    banner.classList.remove('is-warning', 'is-closed');
    if (selected && selected.status === 'closed') {
        banner.className = 'survey-input-banner is-closed';
        banner.textContent = `"${selected.name}" 회차는 마감되어 조회만 가능합니다. 새 물품은 진행 중인 회차를 선택하세요.`;
        return;
    }
    if (currentSurveyId === SURVEY_ALL || currentSurveyId === SURVEY_UNASSIGNED) {
        if (writable && writable.isFallback) {
            banner.className = 'survey-input-banner is-warning';
            banner.textContent = '조사 회차를 불러오지 못했습니다. 지금은 기존 방식처럼 등록되며, Firestore 규칙 배포 후 회차 기능이 활성화됩니다.';
        } else if (writable) {
            banner.className = 'survey-input-banner is-warning';
            banner.textContent = `전체/미분류 보기입니다. 새로 등록하면 "${writable.name}" 회차에 저장됩니다.`;
        } else {
            banner.className = 'survey-input-banner is-warning';
            banner.textContent = '진행 중인 조사 회차가 없습니다. 회차 관리에서 새 회차를 만들어 주세요.';
        }
        return;
    }
    banner.className = 'survey-input-banner';
    banner.textContent = `"${selected?.name || '선택한 회차'}"에 물품이 등록됩니다.`;
}

function openManageSurveysModal() {
    updateSurveyList();
    const modal = document.getElementById('manageSurveysModal');
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeManageSurveysModal() {
    const modal = document.getElementById('manageSurveysModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = 'auto';
    }
}

function updateSurveyList() {
    const list = document.getElementById('surveyList');
    if (!list) return;
    if (surveys.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">등록된 회차가 없습니다</p>';
        return;
    }

    list.innerHTML = surveys.map(survey => {
        const count = (items || []).filter(item => itemBelongsToSurvey(item, survey.id)).length;
        const canManage = currentUserRole === 'admin' || survey.createdBy === currentUser?.uid;
        const nextStatus = survey.status === 'closed' ? 'active' : 'closed';
        const nextLabel = survey.status === 'closed' ? '재개' : '마감';
        return `
            <div class="organization-item">
                <div>
                    <span class="organization-item-name">${escapeHtml(survey.name)}</span>
                    <span class="survey-item-status ${survey.status === 'closed' ? 'closed' : 'active'}">${survey.status === 'closed' ? '마감' : '진행중'}</span>
                    <div class="organization-item-count">${count}개 물품${survey.description ? ` · ${escapeHtml(survey.description)}` : ''}</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-secondary btn-small" onclick="selectSurvey('${survey.id}'); closeManageSurveysModal();">선택</button>
                    ${canManage ? `<button class="btn btn-secondary btn-small" onclick="toggleSurveyStatus('${survey.id}', '${nextStatus}')">${nextLabel}</button>` : ''}
                    ${currentUserRole === 'admin' ? `<button class="organization-item-delete" onclick="deleteSurvey('${survey.id}')">✕</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function saveNewSurvey() {
    const nameInput = document.getElementById('newSurveyName');
    const descInput = document.getElementById('newSurveyDescription');
    const startInput = document.getElementById('newSurveyStart');
    const endInput = document.getElementById('newSurveyEnd');
    const name = nameInput?.value.trim();

    if (!name) {
        showToast('회차 이름을 입력하세요', 'error');
        return;
    }
    if (surveys.some(survey => survey.name === name)) {
        showToast('이미 같은 이름의 회차가 있습니다', 'error');
        return;
    }

    try {
        const surveyId = await persistSurvey({
            name,
            description: descInput?.value.trim() || '',
            startDate: startInput?.value || '',
            endDate: endInput?.value || '',
            status: 'active',
            isDefault: false
        });
        if (nameInput) nameInput.value = '';
        if (descInput) descInput.value = '';
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        selectSurvey(surveyId);
        showToast(`"${name}" 회차가 추가되었습니다`, 'success');
    } catch (error) {
        console.error('회차 추가 실패:', error);
        const reason = error.code === 'permission-denied'
            ? '저장 권한이 없습니다. Firestore 규칙 배포가 필요합니다.'
            : (error.message || '회차 추가에 실패했습니다');
        showToast(reason, 'error');
    }
}

async function toggleSurveyStatus(surveyId, status) {
    try {
        try {
            await db.collection('surveys').doc(surveyId).update({
                status,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            if (error.code !== 'permission-denied' && error.code !== 'not-found') throw error;
            const updated = await rewriteUserMaster('surveys', (list) => {
                const index = list.findIndex((survey) => survey.id === surveyId);
                if (index === -1) return list;
                const next = [...list];
                next[index] = { ...next[index], status, updatedAt: new Date().toISOString() };
                return next;
            });
            if (!updated) throw error;
        }
        showToast(status === 'closed' ? '회차를 마감했습니다' : '회차를 다시 진행 중으로 바꿨습니다', 'success');
    } catch (error) {
        console.error('회차 상태 변경 실패:', error);
        showToast('회차 상태 변경에 실패했습니다', 'error');
    }
}

async function deleteSurvey(surveyId) {
    const survey = surveys.find(entry => entry.id === surveyId);
    if (!survey) return;
    if (!confirm(`"${survey.name}" 회차를 삭제할까요?\n이미 등록된 물품은 미분류로 남습니다.`)) return;
    try {
        try {
            await db.collection('surveys').doc(surveyId).delete();
        } catch (error) {
            if (error.code !== 'permission-denied' && error.code !== 'not-found') throw error;
            const updated = await rewriteUserMaster('surveys', (list) => {
                const next = list.filter((survey) => survey.id !== surveyId);
                return next.length === list.length ? list : next;
            });
            if (!updated) throw error;
        }
        if (currentSurveyId === surveyId) selectSurvey(SURVEY_ALL);
        showToast('회차가 삭제되었습니다', 'success');
    } catch (error) {
        console.error('회차 삭제 실패:', error);
        showToast('회차 삭제에 실패했습니다', 'error');
    }
}

function updateOrganizationSelect() {
    const select = document.getElementById('organizationSelect');
    if (!select) return;
    const names = getOrganizationNames();
    select.innerHTML = '<option value="">기관을 선택하세요</option>' + names.map(name =>
        `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
    ).join('');
    if (currentOrganization && names.includes(currentOrganization)) {
        select.value = currentOrganization;
    }
    updateFilterOrganization();
}

function updateFilterOrganization() {
    const select = document.getElementById('filterOrganization');
    if (!select) return;
    const current = select.value;
    const names = getOrganizationNames();
    select.innerHTML = '<option value="">전체 기관</option>' + names.map(name =>
        `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
    ).join('');
    if ([...select.options].some(option => option.value === current)) {
        select.value = current;
    }
    updateFilterSurveyor();
}

function updateFilterSurveyor() {
    const select = document.getElementById('filterSurveyor');
    if (!select) return;
    const current = select.value;
    const names = Array.from(new Set(
        (typeof getItemsForView === 'function' ? getItemsForView() : items || [])
            .map((item) => String(item.surveyor || '').trim())
            .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'ko'));
    select.innerHTML = '<option value="">전체 조사자</option>' + names.map((name) =>
        `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
    ).join('');
    if ([...select.options].some((option) => option.value === current)) {
        select.value = current;
    }
}

function selectOrganization(orgName) {
    if (orgName) {
        currentOrganization = orgName;
        const orgInput = document.getElementById('organization');
        const selectedName = document.getElementById('selectedOrgName');
        const selectedInfo = document.getElementById('selectedOrganizationInfo');
        if (orgInput) orgInput.value = orgName;
        if (selectedName) selectedName.textContent = orgName;
        if (selectedInfo) selectedInfo.style.display = 'flex';
        updateLocationDatalists();
        showToast(`"${orgName}" 기관이 선택되었습니다`, 'success');
    } else {
        clearOrganization();
    }
}

function clearOrganization() {
    currentOrganization = '';
    const select = document.getElementById('organizationSelect');
    const orgInput = document.getElementById('organization');
    const selectedInfo = document.getElementById('selectedOrganizationInfo');
    if (select) select.value = '';
    if (orgInput) orgInput.value = '';
    if (selectedInfo) selectedInfo.style.display = 'none';
    updateLocationDatalists();
}

function openAddOrganizationModal() {
    const input = document.getElementById('newOrganizationName');
    const modal = document.getElementById('addOrganizationModal');
    if (input) input.value = '';
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        setTimeout(() => input?.focus(), 100);
    }
}

function closeAddOrganizationModal() {
    const modal = document.getElementById('addOrganizationModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = 'auto';
    }
}

async function saveNewOrganization() {
    const input = document.getElementById('newOrganizationName');
    const orgName = input?.value.trim();
    if (!orgName) {
        showToast('기관명을 입력하세요', 'error');
        return;
    }
    if (getOrganizationNames().includes(orgName)) {
        showToast('이미 등록된 기관입니다', 'error');
        selectOrganization(orgName);
        closeAddOrganizationModal();
        return;
    }
    try {
        try {
            await db.collection('organizations').add({
                name: orgName,
                createdBy: currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            if (error.code !== 'permission-denied') throw error;
            listenUserMasters();
            await addToUserMaster('organizations', {
                id: newMasterId('org'),
                name: orgName,
                createdBy: currentUser.uid,
                createdAt: new Date().toISOString()
            });
        }
        closeAddOrganizationModal();
        selectOrganization(orgName);
        showToast(`"${orgName}" 기관이 공유 목록에 추가되었습니다`, 'success');
    } catch (error) {
        console.error('기관 추가 실패:', error);
        showToast('기관 추가에 실패했습니다', 'error');
    }
}

function openManageOrganizationsModal() {
    updateOrganizationList();
    const modal = document.getElementById('manageOrganizationsModal');
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function closeManageOrganizationsModal() {
    const modal = document.getElementById('manageOrganizationsModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = 'auto';
    }
}

function updateOrganizationList() {
    const list = document.getElementById('organizationList');
    if (!list) return;
    const names = getOrganizationNames();
    if (names.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">등록된 기관이 없습니다</p>';
        return;
    }
    const orgCounts = {};
    getVisibleItems().forEach(item => {
        if (item.organization) {
            orgCounts[item.organization] = (orgCounts[item.organization] || 0) + 1;
        }
    });
    list.innerHTML = names.map(org => {
        const record = organizationRecords.find(entry => entry.name === org);
        const canDelete = record && (currentUserRole === 'admin' || record.createdBy === currentUser?.uid);
        return `
            <div class="organization-item">
                <div>
                    <span class="organization-item-name">${escapeHtml(org)}</span>
                    <span class="organization-item-count">(${orgCounts[org] || 0}개 물품)</span>
                </div>
                ${canDelete ? `<button class="organization-item-delete" onclick="deleteOrganization(${JSON.stringify(org)})">✕ 삭제</button>` : ''}
            </div>
        `;
    }).join('');
}

async function deleteOrganization(orgName) {
    if (!confirm(`"${orgName}" 기관을 삭제하시겠습니까?\n이미 등록된 물품의 기관명은 그대로 남습니다.`)) return;
    const record = organizationRecords.find(entry => entry.name === orgName);
    try {
        if (record?.id && !String(record.id).startsWith('org_')) {
            try {
                await db.collection('organizations').doc(record.id).delete();
            } catch (error) {
                if (error.code !== 'permission-denied' && error.code !== 'not-found') throw error;
            }
        }
        await rewriteUserMaster('organizations', (list) => {
            const next = list.filter((org) => org.name !== orgName);
            return next.length === list.length ? list : next;
        });
        if (currentOrganization === orgName) clearOrganization();
        showToast(`"${orgName}" 기관이 삭제되었습니다`, 'success');
    } catch (error) {
        console.error('기관 삭제 실패:', error);
        showToast('기관 삭제에 실패했습니다', 'error');
    }
}

function updateLocationDatalists() {
    const orgName = document.getElementById('organization')?.value || currentOrganization;
    const matched = locations.filter(location => !orgName || location.organization === orgName);
    const fill = (id, values) => {
        const list = document.getElementById(id);
        if (!list) return;
        const unique = Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'));
        list.innerHTML = unique.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
    };
    fill('buildingList', matched.map(location => location.building));
    fill('floorList', matched.map(location => location.floor));
    fill('roomList', matched.map(location => location.room));
}

function updateLocationPreview() {
    const preview = document.getElementById('locationPreview');
    if (!preview) return;
    const label = composeLocation(
        document.getElementById('building')?.value,
        document.getElementById('floor')?.value,
        document.getElementById('room')?.value
    );
    preview.textContent = label ? `선택된 위치: ${label}` : '선택된 위치: 미입력';
}

async function upsertLocationFromItem(data) {
    const organization = (data.organization || '').trim();
    const building = (data.building || '').trim();
    const floor = (data.floor || '').trim();
    const room = (data.room || '').trim();
    const label = composeLocation(building, floor, room, data.location);
    if (!organization || !label) return label;
    const exists = locations.some(location =>
        location.organization === organization &&
        location.building === building &&
        location.floor === floor &&
        location.room === room
    );
    if (!exists) {
        try {
            await db.collection('locations').add({
                organization,
                building,
                floor,
                room,
                label,
                createdBy: currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            if (error.code === 'permission-denied') {
                listenUserMasters();
                try {
                    await addToUserMaster('locations', {
                        id: newMasterId('loc'),
                        organization,
                        building,
                        floor,
                        room,
                        label,
                        createdBy: currentUser.uid,
                        createdAt: new Date().toISOString()
                    });
                } catch (fallbackError) {
                    console.warn('위치 마스터 저장 실패:', fallbackError);
                }
            } else {
                console.warn('위치 마스터 저장 실패:', error);
            }
        }
    }
    return label;
}

function applyItemLocationFields(data) {
    const location = composeLocation(data.building, data.floor, data.room, data.location);
    if (location) data.location = location;
    return data;
}

function initOrganizations() {
    if (typeof initMasters === 'function') {
        initMasters();
    }

    const organizationSelect = document.getElementById('organizationSelect');
    if (organizationSelect && !organizationSelect.dataset.bound) {
        organizationSelect.dataset.bound = 'true';
        organizationSelect.addEventListener('change', (e) => selectOrganization(e.target.value));
    }
    const addOrganizationBtn = document.getElementById('addOrganizationBtn');
    if (addOrganizationBtn && !addOrganizationBtn.dataset.bound) {
        addOrganizationBtn.dataset.bound = 'true';
        addOrganizationBtn.addEventListener('click', openAddOrganizationModal);
    }
    const manageOrganizationsBtn = document.getElementById('manageOrganizationsBtn');
    if (manageOrganizationsBtn && !manageOrganizationsBtn.dataset.bound) {
        manageOrganizationsBtn.dataset.bound = 'true';
        manageOrganizationsBtn.addEventListener('click', openManageOrganizationsModal);
    }
    const clearOrganizationBtn = document.getElementById('clearOrganizationBtn');
    if (clearOrganizationBtn && !clearOrganizationBtn.dataset.bound) {
        clearOrganizationBtn.dataset.bound = 'true';
        clearOrganizationBtn.addEventListener('click', clearOrganization);
    }
    const closeAddOrganization = document.getElementById('closeAddOrganization');
    if (closeAddOrganization) closeAddOrganization.addEventListener('click', closeAddOrganizationModal);
    const cancelAddOrganizationBtn = document.getElementById('cancelAddOrganizationBtn');
    if (cancelAddOrganizationBtn) cancelAddOrganizationBtn.addEventListener('click', closeAddOrganizationModal);
    const saveOrganizationBtn = document.getElementById('saveOrganizationBtn');
    if (saveOrganizationBtn) saveOrganizationBtn.addEventListener('click', saveNewOrganization);
    const closeManageOrganizations = document.getElementById('closeManageOrganizations');
    if (closeManageOrganizations) closeManageOrganizations.addEventListener('click', closeManageOrganizationsModal);
    const addOrganizationModal = document.getElementById('addOrganizationModal');
    if (addOrganizationModal) {
        addOrganizationModal.addEventListener('click', (e) => {
            if (e.target.id === 'addOrganizationModal') closeAddOrganizationModal();
        });
    }
    const manageOrganizationsModal = document.getElementById('manageOrganizationsModal');
    if (manageOrganizationsModal) {
        manageOrganizationsModal.addEventListener('click', (e) => {
            if (e.target.id === 'manageOrganizationsModal') closeManageOrganizationsModal();
        });
    }
    const newOrganizationName = document.getElementById('newOrganizationName');
    if (newOrganizationName) {
        newOrganizationName.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') saveNewOrganization();
        });
    }
}

window.getCurrentSurvey = getCurrentSurvey;
window.selectSurvey = selectSurvey;
window.closeManageSurveysModal = closeManageSurveysModal;
window.toggleSurveyStatus = toggleSurveyStatus;
window.deleteSurvey = deleteSurvey;
window.deleteOrganization = deleteOrganization;
window.getVisibleItems = getVisibleItems;
window.getWritableSurvey = getWritableSurvey;
window.composeLocation = composeLocation;
window.getSafeDate = getSafeDate;
window.upsertLocationFromItem = upsertLocationFromItem;
window.applyItemLocationFields = applyItemLocationFields;
window.refreshVisibleViews = refreshVisibleViews;
window.updateLocationPreview = updateLocationPreview;
window.initMasters = initMasters;
window.initOrganizations = initOrganizations;
