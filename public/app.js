// Firebase 기반 물품 조사 시스템

// 전역 상태
let items = [];
let currentUser = null;
let currentUserRole = 'user'; // 'user' 또는 'admin'
let currentEditId = null;
let unsubscribe = null;
let currentSort = 'newest';
let continuousMode = false;
let selectedFields = ['surveyor', 'organization', 'location', 'itemName', 'assetNumber', 'quantity'];
let organizations = [];
let currentOrganization = '';

// 🔥 리스너 등록 추적 (중복 방지)
let isListenerRegistered = false;
let initialLoadComplete = false;

// 📊 읽기 횟수 추적 (디버깅용)
let totalReads = 0;
let sessionStart = Date.now();

// 📄 페이지네이션 (관리자용)
let currentPage = 1;
let lastVisible = null;
const ADMIN_PAGE_SIZE = 50; // 관리자는 50개씩
let hasMorePages = true;
let totalItemCount = 0; // 전체 데이터 개수 (페이지와 무관)

// 🚀 Firebase 오프라인 지속성 활성화 (읽기 최적화)
db.enablePersistence({ synchronizeTabs: true })
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            console.warn('여러 탭이 열려 있어 오프라인 지속성이 비활성화됩니다.');
        } else if (err.code == 'unimplemented') {
            console.warn('브라우저가 오프라인 지속성을 지원하지 않습니다.');
        }
    });

// DOM 요소
const itemForm = document.getElementById('itemForm');
const editForm = document.getElementById('editForm');
const itemList = document.getElementById('itemList');
const searchInput = document.getElementById('searchInput');
const filterCategory = document.getElementById('filterCategory');
const sortBy = document.getElementById('sortBy');
const itemCount = document.getElementById('itemCount');
const toast = document.getElementById('toast');
const editModal = document.getElementById('editModal');
const userName = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const darkModeToggle = document.getElementById('darkModeToggle');

// 인증 상태 확인
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        
        console.log('✅ 사용자 인증 완료:', user.email);
        
        try {
            // 사용자 역할 확인 및 초기화
            await initUserRole();
            
            const roleEmoji = currentUserRole === 'admin' ? '👑' : '👤';
            const roleText = currentUserRole === 'admin' ? ' (관리자)' : '';
            userName.textContent = `${roleEmoji} ${user.displayName || user.email}${roleText}`;
            
            // 🔥 initApp()을 await로 호출하여 완료될 때까지 대기
            await initApp();
            
            console.log('✅ 앱 로딩 완전히 완료');
        } catch (error) {
            console.error('❌ 앱 초기화 중 오류:', error);
            showToast('앱 초기화에 실패했습니다. 페이지를 새로고침해주세요.', 'error');
        }
    } else {
        // 로그인 페이지로 리다이렉트
        console.log('⚠️ 미인증 사용자 - 로그인 페이지로 이동');
        window.location.href = 'login.html';
    }
});

// 사용자 역할 초기화 (Custom Claims 사용 - 읽기 최적화)
async function initUserRole() {
    try {
        // 🔥 1순위: Custom Claims에서 역할 확인 (읽기 0회!)
        const idTokenResult = await currentUser.getIdTokenResult();
        
        if (idTokenResult.claims.role) {
            // Custom Claims에 role이 있으면 바로 사용
            currentUserRole = idTokenResult.claims.role;
            console.log('✅ Custom Claims에서 역할 로드 (읽기 0회):', currentUserRole);
            return;
        }
        
        // 🔄 Custom Claims가 없는 경우 (기존 사용자 또는 신규 가입)
        console.log('⚠️ Custom Claims 없음 - Firestore 확인...');
        
        const userDoc = await db.collection('users').doc(currentUser.uid).get({ source: 'default' });
        totalReads += 1;
        console.log(`📊 총 읽기 횟수: ${totalReads}회 (사용자 역할 확인)`);
        
        if (userDoc.exists) {
            // 기존 사용자 - Firestore에는 있지만 Custom Claims가 없음
            currentUserRole = userDoc.data().role || 'user';
            console.log(`📝 기존 사용자 역할: ${currentUserRole}`);
            
            // 🔧 Custom Claims 마이그레이션 시도
            console.log('🔄 Custom Claims 설정 시도 (마이그레이션)...');
            try {
                const setRole = firebase.functions().httpsCallable('setUserRole');
                await setRole({ userId: currentUser.uid, role: currentUserRole });
                
                // 토큰 강제 갱신하여 Custom Claims 즉시 적용
                await currentUser.getIdToken(true);
                
                console.log('✅ Custom Claims 마이그레이션 완료');
                showToast('사용자 정보가 업데이트되었습니다', 'success');
            } catch (functionError) {
                console.warn('⚠️ Custom Claims 설정 실패 (Functions 미배포 또는 권한 없음):', functionError);
                // 실패해도 계속 진행 (Firestore 역할 사용)
            }
        } else {
            // 신규 사용자
            console.log('🆕 신규 사용자 감지');
            
            // Cloud Function의 onUserCreate가 자동으로 처리하므로
            // 여기서는 기본값만 설정 (Functions가 처리 완료되면 다음 로그인 시 Custom Claims 적용됨)
            const usersSnapshot = await db.collection('users').limit(1).get();
            totalReads += 1;
            const isFirstUser = usersSnapshot.empty;
            
            currentUserRole = isFirstUser ? 'admin' : 'user';
            
            // Firestore에 저장 (Cloud Function의 onUserCreate와 중복될 수 있으나 안전장치)
            await db.collection('users').doc(currentUser.uid).set({
                email: currentUser.email,
                displayName: currentUser.displayName || currentUser.email,
                role: currentUserRole,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`✅ 신규 사용자 등록: ${currentUserRole}`);
            
            if (isFirstUser) {
                showToast('첫 번째 사용자로 관리자 권한이 부여되었습니다', 'success');
            }
            
            // 다음 로그인 때 Custom Claims가 적용되도록 안내
            console.log('ℹ️ 다음 로그인 시 Custom Claims가 자동으로 적용됩니다');
        }
    } catch (error) {
        console.error('사용자 역할 초기화 오류:', error);
        currentUserRole = 'user'; // 기본값
    }
}

// 로그아웃
logoutBtn.addEventListener('click', async () => {
    if (confirm('로그아웃 하시겠습니까?')) {
        try {
            // 캐시 삭제
            const cacheKey = `userRole_${currentUser.uid}`;
            const cacheTimeKey = `userRole_${currentUser.uid}_time`;
            localStorage.removeItem(cacheKey);
            localStorage.removeItem(cacheTimeKey);
            
            await auth.signOut();
            window.location.href = 'login.html';
        } catch (error) {
            console.error('로그아웃 오류:', error);
            showToast('로그아웃에 실패했습니다', 'error');
        }
    }
});

// 앱 초기화 (async 지원)
async function initApp() {
    console.log('🚀 앱 초기화 시작');
    
    initDarkMode();
    initOrganizations();
    initTabs();
    initEventListeners();
    initRoleBasedUI();
    
    // 🚀 최적화: 캐시에서 먼저 로드 (즉시 표시, 5초 타임아웃)
    if (typeof loadItemsFromCache === 'function') {
        try {
            const cacheResult = await loadItemsFromCache();
            
            if (cacheResult.success && cacheResult.data.length > 0) {
                // 캐시 데이터를 items에 할당
                items = cacheResult.data;
                
                // 🔥 중요: 캐시에서 로드했으므로 초기 로드 완료로 표시
                initialLoadComplete = true;
                
                // 즉시 화면에 표시 (정렬 적용)
                const sortedItems = sortItems(items, currentSort);
                displayItems(sortedItems);
                updateItemCount();
                
                console.log('✅ 캐시 데이터 표시 완료 - Firebase 동기화 시작 (변경사항만 감지)');
            } else {
                console.log('ℹ️ 캐시 없음 - Firebase에서 전체 로드');
            }
        } catch (cacheError) {
            console.warn('⚠️ 캐시 로드 중 오류 (무시하고 계속):', cacheError);
        }
    }
    
    // Firebase 실시간 리스너 시작 (항상 실행)
    loadItems();
    
    // 조사자 이름 자동완성 (사용자 이름으로)
    document.getElementById('surveyor').value = currentUser.displayName || '';
    // 갯수 기본값 설정
    document.getElementById('quantity').value = '1';
    
    console.log('✅ 앱 초기화 완료');
}

// 역할별 UI 초기화
function initRoleBasedUI() {
    const userManagementSection = document.getElementById('userManagementSection');
    const dangerZoneSection = document.getElementById('dangerZoneSection');
    
    if (currentUserRole === 'admin') {
        // 관리자는 사용자 관리 섹션과 위험 영역 표시
        if (userManagementSection) {
            userManagementSection.style.display = 'block';
        }
        if (dangerZoneSection) {
            dangerZoneSection.style.display = 'block';
        }
    } else {
        // 일반 사용자는 사용자 관리 섹션과 위험 영역 숨김
        if (userManagementSection) {
            userManagementSection.style.display = 'none';
        }
        if (dangerZoneSection) {
            dangerZoneSection.style.display = 'none';
        }
    }
}

// 기관 관리 초기화
function initOrganizations() {
    // localStorage에서 기관 목록 로드
    loadOrganizations();
    
    // 기관 선택 이벤트
    const organizationSelect = document.getElementById('organizationSelect');
    organizationSelect.addEventListener('change', (e) => {
        selectOrganization(e.target.value);
    });
    
    // 기관 추가 버튼
    document.getElementById('addOrganizationBtn').addEventListener('click', openAddOrganizationModal);
    
    // 기관 관리 버튼
    document.getElementById('manageOrganizationsBtn').addEventListener('click', openManageOrganizationsModal);
    
    // 기관 해제 버튼
    document.getElementById('clearOrganizationBtn').addEventListener('click', clearOrganization);
    
    // 추가 모달
    document.getElementById('closeAddOrganization').addEventListener('click', closeAddOrganizationModal);
    document.getElementById('cancelAddOrganizationBtn').addEventListener('click', closeAddOrganizationModal);
    document.getElementById('saveOrganizationBtn').addEventListener('click', saveNewOrganization);
    
    // 관리 모달
    document.getElementById('closeManageOrganizations').addEventListener('click', closeManageOrganizationsModal);
    
    // 모달 외부 클릭
    document.getElementById('addOrganizationModal').addEventListener('click', (e) => {
        if (e.target.id === 'addOrganizationModal') closeAddOrganizationModal();
    });
    document.getElementById('manageOrganizationsModal').addEventListener('click', (e) => {
        if (e.target.id === 'manageOrganizationsModal') closeManageOrganizationsModal();
    });
    
    // Enter 키로 기관 추가
    document.getElementById('newOrganizationName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveNewOrganization();
    });
}

// 기관 목록 로드
function loadOrganizations() {
    const saved = localStorage.getItem('organizations');
    organizations = saved ? JSON.parse(saved) : [];
    updateOrganizationSelect();
}

// 기관 목록 저장
function saveOrganizations() {
    localStorage.setItem('organizations', JSON.stringify(organizations));
}

// 기관 선택 드롭다운 업데이트
function updateOrganizationSelect() {
    const select = document.getElementById('organizationSelect');
    select.innerHTML = '<option value="">기관을 선택하세요</option>';
    
    organizations.forEach(org => {
        const option = document.createElement('option');
        option.value = org;
        option.textContent = org;
        select.appendChild(option);
    });
}

// 기관 선택
function selectOrganization(orgName) {
    if (orgName) {
        currentOrganization = orgName;
        document.getElementById('organization').value = orgName;
        document.getElementById('selectedOrgName').textContent = orgName;
        document.getElementById('selectedOrganizationInfo').style.display = 'flex';
        showToast(`"${orgName}" 기관이 선택되었습니다`, 'success');
    } else {
        clearOrganization();
    }
}

// 기관 선택 해제
function clearOrganization() {
    currentOrganization = '';
    document.getElementById('organizationSelect').value = '';
    document.getElementById('organization').value = '';
    document.getElementById('selectedOrganizationInfo').style.display = 'none';
}

// 기관 추가 모달 열기
function openAddOrganizationModal() {
    document.getElementById('newOrganizationName').value = '';
    document.getElementById('addOrganizationModal').classList.add('show');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('newOrganizationName').focus(), 100);
}

// 기관 추가 모달 닫기
function closeAddOrganizationModal() {
    document.getElementById('addOrganizationModal').classList.remove('show');
    document.body.style.overflow = 'auto';
}

// 새 기관 저장
function saveNewOrganization() {
    const input = document.getElementById('newOrganizationName');
    const orgName = input.value.trim();
    
    if (!orgName) {
        showToast('기관명을 입력하세요', 'error');
        return;
    }
    
    if (organizations.includes(orgName)) {
        showToast('이미 등록된 기관입니다', 'error');
        return;
    }
    
    organizations.push(orgName);
    organizations.sort();
    saveOrganizations();
    updateOrganizationSelect();
    closeAddOrganizationModal();
    
    // 자동 선택
    document.getElementById('organizationSelect').value = orgName;
    selectOrganization(orgName);
    
    showToast(`"${orgName}" 기관이 추가되었습니다`, 'success');
}

// 기관 관리 모달 열기
function openManageOrganizationsModal() {
    updateOrganizationList();
    document.getElementById('manageOrganizationsModal').classList.add('show');
    document.body.style.overflow = 'hidden';
}

// 기관 관리 모달 닫기
function closeManageOrganizationsModal() {
    document.getElementById('manageOrganizationsModal').classList.remove('show');
    document.body.style.overflow = 'auto';
}

// 기관 목록 표시
function updateOrganizationList() {
    const list = document.getElementById('organizationList');
    
    if (organizations.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">등록된 기관이 없습니다</p>';
        return;
    }
    
    // 각 기관의 사용 횟수 계산
    const orgCounts = {};
    items.forEach(item => {
        if (item.organization) {
            orgCounts[item.organization] = (orgCounts[item.organization] || 0) + 1;
        }
    });
    
    list.innerHTML = organizations.map(org => `
        <div class="organization-item">
            <div>
                <span class="organization-item-name">${org}</span>
                <span class="organization-item-count">(${orgCounts[org] || 0}개 물품)</span>
            </div>
            <button class="organization-item-delete" onclick="deleteOrganization('${org}')">✕ 삭제</button>
        </div>
    `).join('');
}

// 기관 삭제
function deleteOrganization(orgName) {
    if (!confirm(`"${orgName}" 기관을 삭제하시겠습니까?\n\n※ 주의: 이미 등록된 물품의 기관명은 삭제되지 않습니다.`)) {
        return;
    }
    
    organizations = organizations.filter(org => org !== orgName);
    saveOrganizations();
    updateOrganizationSelect();
    updateOrganizationList();
    
    if (currentOrganization === orgName) {
        clearOrganization();
    }
    
    showToast(`"${orgName}" 기관이 삭제되었습니다`, 'success');
}

// 다크 모드 초기화
function initDarkMode() {
    const savedMode = localStorage.getItem('darkMode');
    if (savedMode === 'true') {
        document.body.classList.add('dark-mode');
        darkModeToggle.textContent = '☀️';
    }
    
    darkModeToggle.addEventListener('click', toggleDarkMode);
}

// 다크 모드 토글
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);
    darkModeToggle.textContent = isDark ? '☀️' : '🌙';
    showToast(isDark ? '다크 모드 활성화' : '라이트 모드 활성화', 'success');
}

// 탭 초기화
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });
}

// 탭 전환 함수
function switchTab(tabName) {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(tabName).classList.add('active');
    
    if (tabName === 'dashboard') {
        updateDashboard();
    } else if (tabName === 'list') {
        // 🔥 핵심: loadItems()가 알아서 중복 체크함
        loadItems(); // 내부에서 이미 등록되어 있으면 데이터만 표시 (읽기 0회)
    }
}

// 이벤트 리스너 초기화
function initEventListeners() {
    // 연속 등록 모드
    initContinuousMode();
    
    // 물품 추가 폼
    itemForm.addEventListener('submit', handleAddItem);
    document.getElementById('resetBtn').addEventListener('click', () => {
        if (continuousMode) {
            resetFormKeepCommon();
        } else {
            itemForm.reset();
            document.getElementById('surveyor').value = currentUser.displayName || '';
            document.getElementById('quantity').value = '1'; // 갯수 기본값 1
        }
        showToast('폼이 초기화되었습니다', 'success');
    });
    
    // 물품 수정 폼
    editForm.addEventListener('submit', handleEditItem);
    document.getElementById('closeModal').addEventListener('click', closeEditModal);
    document.getElementById('cancelEdit').addEventListener('click', closeEditModal);
    
    // 검색 및 필터
    searchInput.addEventListener('input', filterItems);
    filterCategory.addEventListener('change', filterItems);
    sortBy.addEventListener('change', (e) => {
        currentSort = e.target.value;
        filterItems();
    });
    
    // 데이터 관리
    document.getElementById('exportExcel').addEventListener('click', exportExcel);
    document.getElementById('exportJson').addEventListener('click', exportJson);
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', handleImport);
    document.getElementById('clearAllBtn').addEventListener('click', clearAllData);
    
    // 사용자 관리 (관리자만)
    const loadUsersBtn = document.getElementById('loadUsersBtn');
    if (loadUsersBtn) {
        loadUsersBtn.addEventListener('click', loadUsers);
    }
    
    // 모달 외부 클릭 시 닫기
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) {
            closeEditModal();
        }
    });
}

// 전체 데이터 개수 가져오기 (count 쿼리 사용 - 효율적)
async function loadTotalCount() {
    try {
        let countQuery = db.collection('items');
        
        // 일반 사용자는 본인 데이터만 카운트
        if (currentUserRole !== 'admin') {
            countQuery = countQuery.where('userId', '==', currentUser.uid);
        }
        
        // count() 사용: 실제 문서를 읽지 않고 개수만 가져옴 (읽기 1회만 발생)
        const snapshot = await countQuery.count().get();
        totalItemCount = snapshot.data().count;
        
        console.log(`📊 전체 데이터 개수: ${totalItemCount}개 (count 쿼리 - 읽기 1회)`);
        totalReads += 1; // count 쿼리는 읽기 1회로 계산됨
        
        updateItemCount();
    } catch (error) {
        console.error('전체 개수 로드 오류:', error);
        // count() API를 지원하지 않는 경우 폴백
        totalItemCount = items.length;
        updateItemCount();
    }
}

// Firestore에서 물품 목록 실시간 로드 (역할별 최적화)
function loadItems() {
    // 🔥 핵심: 리스너가 이미 등록되어 있으면 절대 재등록하지 않음!
    if (isListenerRegistered) {
        console.log('✅ 리스너가 이미 등록되어 있음 (읽기 0회)');
        // 데이터만 다시 표시 (정렬 적용)
        if (items.length > 0) {
            const sortedItems = sortItems(items, currentSort);
            displayItems(sortedItems);
            updateItemCount();
        }
        return;
    }
    
    // 전체 개수 로드 (페이지네이션과 무관)
    loadTotalCount();
    
    console.log('🔄 실시간 리스너 등록 중... (역할별 필터링)');
    
    // 로딩 표시
    const listLoading = document.getElementById('listLoading');
    if (listLoading) {
        listLoading.style.display = 'block';
        itemList.innerHTML = '';
    }
    
    // 🔥 역할별 쿼리 생성
    let query = db.collection('items');
    
    if (currentUserRole === 'admin') {
        // 👑 관리자: 전체 물품 (페이지네이션)
        console.log(`👑 관리자: 전체 물품 로드 (${ADMIN_PAGE_SIZE}개씩)`);
        query = query
            .orderBy('timestamp', 'desc')
            .limit(ADMIN_PAGE_SIZE);
        
        // 페이지네이션 UI 표시
        showPaginationControls();
    } else {
        // 👤 일반 사용자: 본인 물품만 (전체)
        console.log('👤 일반 사용자: 본인 물품만 로드');
        query = query
            .where('userId', '==', currentUser.uid)
            .orderBy('timestamp', 'desc');
        
        // 페이지네이션 UI 숨김
        hidePaginationControls();
    }
    
    // 🚀 최적화된 실시간 리스너 (변경된 문서만 처리)
    unsubscribe = query.onSnapshot((snapshot) => {
            // 🔥 초기 로드 체크: 플래그 기반으로 정확하게 판단
            const isInitialLoad = !initialLoadComplete;
            
            if (isInitialLoad) {
                // 초기 로드: 모든 문서 (앱 실행 후 최초 1회만)
                // 🔥 주의: 캐시 데이터가 있을 수 있으므로 기존 items 유지하고 병합
                const existingIds = new Set(items.map(item => item.id));
                let newItemsCount = 0;
                
                snapshot.forEach((doc) => {
                    if (!existingIds.has(doc.id)) {
                        items.push({
                            id: doc.id,
                            ...doc.data()
                        });
                        newItemsCount++;
                    }
                });
                
                initialLoadComplete = true; // 🔥 플래그 설정 - 다시는 전체 읽기 안 함!
                totalReads += snapshot.docs.length;
                
                if (newItemsCount > 0) {
                    console.log(`📥 초기 로드 완료: ${newItemsCount}개 새 문서 추가 (캐시: ${items.length - newItemsCount}개, 전체: ${items.length}개)`);
                } else {
                    console.log(`📥 초기 로드 완료: 새 문서 없음 (캐시: ${items.length}개 유지)`);
                }
                console.log(`📊 총 읽기 횟수: ${totalReads}회 (세션 시작 후 ${Math.floor((Date.now() - sessionStart) / 1000)}초)`);
                
                // 관리자 페이지네이션: 마지막 문서 저장
                if (currentUserRole === 'admin' && snapshot.docs.length > 0) {
                    lastVisible = snapshot.docs[snapshot.docs.length - 1];
                    hasMorePages = snapshot.docs.length === ADMIN_PAGE_SIZE;
                    updatePaginationUI();
                }
            } else {
                // 🔥 핵심 최적화: 변경된 문서만 처리 (읽기 최소화!)
                let addedCount = 0, modifiedCount = 0, removedCount = 0;
                
                snapshot.docChanges().forEach((change) => {
                    const docData = { id: change.doc.id, ...change.doc.data() };
                    
                    if (change.type === 'added') {
                        // 새 문서 추가 (중복 방지)
                        const existingIndex = items.findIndex(item => item.id === docData.id);
                        if (existingIndex === -1) {
                            items.unshift(docData);
                            addedCount++;
                            console.log(`➕ 새 물품 추가: "${docData.itemName}" (ID: ${docData.id}, userId: ${docData.userId})`);
                            console.log(`   현재 items 배열 크기: ${items.length}개`);
                        } else {
                            console.log(`⚠️ 이미 존재하는 물품: "${docData.itemName}" (중복 방지)`);
                        }
                    } else if (change.type === 'modified') {
                        // 문서 수정
                        const index = items.findIndex(item => item.id === docData.id);
                        if (index !== -1) {
                            items[index] = docData;
                            modifiedCount++;
                            console.log(`✏️ 물품 수정: "${docData.itemName}"`);
                        }
                    } else if (change.type === 'removed') {
                        // 문서 삭제
                        const beforeLength = items.length;
                        items = items.filter(item => item.id !== docData.id);
                        if (items.length < beforeLength) {
                            removedCount++;
                            console.log(`🗑️ 물품 삭제: "${docData.itemName}"`);
                        }
                    }
                });
                
                if (addedCount > 0 || modifiedCount > 0 || removedCount > 0) {
                    const changeReads = addedCount + modifiedCount + removedCount;
                    totalReads += changeReads;
                    console.log(`🔄 변경사항 총계: ➕${addedCount} ✏️${modifiedCount} 🗑️${removedCount} (읽기 ${changeReads}회)`);
                    console.log(`📊 총 읽기 횟수: ${totalReads}회 (세션 시작 후 ${Math.floor((Date.now() - sessionStart) / 1000)}초)`);
                    console.log(`📦 현재 items 배열: ${items.length}개 항목`);
                    
                    // 데이터 변경 시 전체 개수 업데이트 (추가/삭제만)
                    if (addedCount > 0 || removedCount > 0) {
                        loadTotalCount();
                    }
                }
            }
            
            // 🚀 캐시 저장 (디바운스)
            if (typeof debouncedSaveCache === 'function') {
                debouncedSaveCache(items);
            }
            
            // 로딩 숨기기
            if (listLoading) listLoading.style.display = 'none';
            
            // 🔥 검색 상태 유지: 검색어가 있으면 필터링 적용
            console.log(`🖼️ 화면 업데이트 시작... (items: ${items.length}개)`);
            if (searchInput && (searchInput.value || filterCategory.value)) {
                console.log(`🔍 검색 필터 적용 중...`);
                filterItems(); // 검색 필터 유지
            } else {
                console.log(`📋 전체 목록 표시 중... (정렬: ${currentSort})`);
                // 🔥 정렬 적용: 최신순으로 표시
                const sortedItems = sortItems(items, currentSort);
                displayItems(sortedItems);
            }
            updateItemCount();
            updateDashboard();
            console.log(`✅ 화면 업데이트 완료!`);
        }, (error) => {
            console.error('❌ 데이터 로드 오류:', error);
            console.error('오류 상세:', {
                code: error.code,
                message: error.message,
                name: error.name
            });
            
            if (listLoading) listLoading.style.display = 'none';
            
            // 더 상세한 오류 메시지
            let errorMessage = '데이터를 불러오는데 실패했습니다';
            
            if (error.code === 'permission-denied') {
                errorMessage = '권한이 없습니다. 관리자에게 문의하세요.';
            } else if (error.code === 'unavailable') {
                errorMessage = '네트워크 연결을 확인해주세요.';
            } else if (error.code === 'failed-precondition') {
                errorMessage = '인덱스 생성 중입니다. 잠시 후 다시 시도해주세요.';
            } else if (error.message && error.message.includes('toDate')) {
                errorMessage = '데이터 형식 오류 - 캐시를 삭제하고 다시 시도해주세요.';
                // 자동으로 캐시 삭제
                localStorage.removeItem('items_cache');
                localStorage.removeItem('items_cache_timestamp');
                console.log('🔄 캐시 자동 삭제 완료');
            }
            
            showToast(errorMessage, 'error');
        });
    
    // 🔥 리스너 등록 플래그 설정 - 절대 재등록 안 함!
    isListenerRegistered = true;
    console.log('✅ 실시간 리스너 등록 완료 (앱 종료 전까지 유지)');
}

// 물품 목록 표시
function displayItems(itemsToShow) {
    // 🔥 중요: currentUser 확인
    if (!currentUser) {
        console.error('⚠️ displayItems 호출 시 currentUser가 없습니다!');
        itemList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <div class="empty-state-text">사용자 정보를 불러오는 중...</div>
            </div>
        `;
        return;
    }
    
    console.log(`📋 물품 목록 표시: ${itemsToShow.length}개 | 현재 사용자: ${currentUser.uid} | 역할: ${currentUserRole}`);
    
    if (itemsToShow.length === 0) {
        itemList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <div class="empty-state-text">조사된 물품이 없습니다</div>
            </div>
        `;
        return;
    }
    
    itemList.innerHTML = itemsToShow.map(item => {
        // 권한 체크: 관리자이거나 본인이 작성한 물품만 수정 가능
        const isOwner = currentUser && item.userId && item.userId === currentUser.uid;
        // userId가 없는 기존 물품은 모든 사용자가 수정 가능 (하위 호환성)
        const hasNoOwner = !item.userId;
        const canEdit = currentUserRole === 'admin' || isOwner || hasNoOwner;
        const canDelete = currentUserRole === 'admin'; // 관리자만 삭제 가능
        
        // 🔧 개선된 Timestamp 처리 (방어적 코딩)
        const timestamp = (() => {
            if (!item.timestamp) return new Date();
            
            // Firestore Timestamp 객체인 경우
            if (item.timestamp.toDate && typeof item.timestamp.toDate === 'function') {
                return item.timestamp.toDate();
            }
            
            // ISO 문자열인 경우 (캐시에서 로드)
            if (typeof item.timestamp === 'string') {
                return new Date(item.timestamp);
            }
            
            // Date 객체인 경우
            if (item.timestamp instanceof Date) {
                return item.timestamp;
            }
            
            // 그 외 (숫자, 객체 등)
            console.warn('⚠️ 알 수 없는 timestamp 형식:', item.timestamp);
            return new Date();
        })();
        
        // 🔍 항상 권한 체크 로그 출력 (문제 해결용)
        console.log(`[권한체크] 물품: "${item.itemName}" | 물품userId: "${item.userId}" | 현재사용자: "${currentUser?.uid}" | 역할: "${currentUserRole}" | 작성자: ${isOwner} | 소유자없음: ${hasNoOwner} | 수정가능: ${canEdit}`);
        
        return `
        <div class="item-card" data-id="${item.id}">
            <div class="item-header">
                <div class="item-title">${item.itemName || '미지정'}</div>
                ${item.category ? `<span class="item-category">${item.category}</span>` : ''}
            </div>
            
            <div class="item-info">
                <div class="info-item">
                    <span class="info-label">조사자:</span> ${item.surveyor || '-'}
                </div>
                ${item.organization ? `
                    <div class="info-item">
                        <span class="info-label">기관명:</span> ${item.organization}
                    </div>
                ` : ''}
                ${item.location ? `
                    <div class="info-item">
                        <span class="info-label">사용위치:</span> ${item.location}
                    </div>
                ` : ''}
                ${item.assetNumber ? `
                    <div class="info-item">
                        <span class="info-label">자산번호:</span> ${item.assetNumber}
                    </div>
                ` : ''}
                ${item.quantity ? `
                    <div class="info-item">
                        <span class="info-label">갯수:</span> ${item.quantity}개
                    </div>
                ` : ''}
                ${item.manufacturer ? `
                    <div class="info-item">
                        <span class="info-label">제조사:</span> ${item.manufacturer}
                    </div>
                ` : ''}
                ${item.model ? `
                    <div class="info-item">
                        <span class="info-label">모델:</span> ${item.model}
                    </div>
                ` : ''}
                ${item.color ? `
                    <div class="info-item">
                        <span class="info-label">색상:</span> ${item.color}
                    </div>
                ` : ''}
                ${item.material ? `
                    <div class="info-item">
                        <span class="info-label">재질:</span> ${item.material}
                    </div>
                ` : ''}
                ${item.condition ? `
                    <div class="info-item">
                        <span class="info-label">상태:</span> ${item.condition}
                    </div>
                ` : ''}
            </div>
            
            ${item.width || item.height || item.depth ? `
                <div class="item-dimensions">
                    ${item.width ? `
                        <div class="dimension">
                            <span class="dimension-label">가로</span>
                            <span class="dimension-value">${item.width}cm</span>
                        </div>
                    ` : ''}
                    ${item.height ? `
                        <div class="dimension">
                            <span class="dimension-label">세로</span>
                            <span class="dimension-value">${item.height}cm</span>
                        </div>
                    ` : ''}
                    ${item.depth ? `
                        <div class="dimension">
                            <span class="dimension-label">깊이</span>
                            <span class="dimension-value">${item.depth}cm</span>
                        </div>
                    ` : ''}
                </div>
            ` : ''}
            
            ${item.notes ? `
                <div class="item-notes">
                    💬 ${item.notes}
                </div>
            ` : ''}
            
            <div class="item-footer">
                <div class="item-meta">
                    ${timestamp.toLocaleString('ko-KR')}
                    <!-- 🔍 디버그 정보 (임시) -->
                    <div style="font-size: 10px; color: var(--gray-500); margin-top: 5px;">
                        작성자ID: ${item.userId || '없음'} | 내ID: ${currentUser?.uid || '없음'} | 역할: ${currentUserRole} | 수정가능: ${canEdit ? '✅' : '❌'}
                    </div>
                </div>
                <div class="item-actions">
                    ${canEdit ? `
                        <button class="btn btn-secondary btn-small" onclick="openEditModal('${item.id}')">✏️ 수정</button>
                    ` : `
                        <span style="font-size: 12px; color: var(--gray-600);">다른 사용자의 물품</span>
                    `}
                    ${canDelete ? `
                        <button class="btn btn-danger btn-small" onclick="deleteItem('${item.id}')">🗑️ 삭제</button>
                    ` : ''}
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// 물품 수 업데이트
function updateItemCount() {
    if (totalItemCount > 0) {
        // 관리자/일반 사용자 모두: 전체 개수만 표시
        itemCount.textContent = `총 ${totalItemCount}개 물품`;
    } else {
        // 로딩 중이거나 데이터가 없는 경우
        itemCount.textContent = `총 ${items.length}개 물품`;
    }
}

// 연속 등록 모드 초기화
function initContinuousMode() {
    const toggle = document.getElementById('continuousModeToggle');
    const configBtn = document.getElementById('configureFieldsBtn');
    const fieldConfigModal = document.getElementById('fieldConfigModal');
    const closeFieldConfig = document.getElementById('closeFieldConfig');
    const applyFieldConfig = document.getElementById('applyFieldConfig');
    const cancelFieldConfig = document.getElementById('cancelFieldConfig');
    
    // 토글 이벤트
    toggle.addEventListener('change', (e) => {
        continuousMode = e.target.checked;
        configBtn.style.display = continuousMode ? 'block' : 'none';
        
        if (continuousMode) {
            showToast('연속 등록 모드 활성화', 'success');
            applyFieldVisibility();
        } else {
            showToast('연속 등록 모드 비활성화', 'success');
            showAllFields();
        }
    });
    
    // 항목 선택 버튼
    configBtn.addEventListener('click', () => {
        openFieldConfigModal();
    });
    
    // 모달 닫기
    closeFieldConfig.addEventListener('click', closeFieldConfigModal);
    cancelFieldConfig.addEventListener('click', closeFieldConfigModal);
    
    // 적용 버튼
    applyFieldConfig.addEventListener('click', () => {
        saveFieldConfig();
        closeFieldConfigModal();
        applyFieldVisibility();
        showToast('항목 설정이 적용되었습니다', 'success');
    });
    
    // 모달 외부 클릭
    fieldConfigModal.addEventListener('click', (e) => {
        if (e.target === fieldConfigModal) {
            closeFieldConfigModal();
        }
    });
}

// 항목 선택 모달 열기
function openFieldConfigModal() {
    const modal = document.getElementById('fieldConfigModal');
    const checkboxes = modal.querySelectorAll('.field-checkbox');
    
    // 현재 선택된 항목 체크
    checkboxes.forEach(checkbox => {
        if (!checkbox.disabled) {
            checkbox.checked = selectedFields.includes(checkbox.value);
        }
    });
    
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

// 항목 선택 모달 닫기
function closeFieldConfigModal() {
    const modal = document.getElementById('fieldConfigModal');
    modal.classList.remove('show');
    document.body.style.overflow = 'auto';
}

// 선택된 항목 저장
function saveFieldConfig() {
    const checkboxes = document.querySelectorAll('.field-checkbox:not(:disabled)');
    selectedFields = ['surveyor', 'itemName']; // 필수 항목
    
    checkboxes.forEach(checkbox => {
        if (checkbox.checked && !checkbox.disabled) {
            if (!selectedFields.includes(checkbox.value)) {
                selectedFields.push(checkbox.value);
            }
        }
    });
}

// 필드 표시/숨김 적용
function applyFieldVisibility() {
    const allFields = document.querySelectorAll('[data-field]');
    
    allFields.forEach(field => {
        const fieldName = field.getAttribute('data-field');
        if (selectedFields.includes(fieldName)) {
            field.classList.remove('hidden');
        } else {
            field.classList.add('hidden');
        }
    });
}

// 모든 필드 표시
function showAllFields() {
    const allFields = document.querySelectorAll('[data-field]');
    allFields.forEach(field => {
        field.classList.remove('hidden');
    });
}

// 연속 등록 시 공통 항목 유지하고 초기화
function resetFormKeepCommon() {
    const formData = new FormData(itemForm);
    const commonValues = {};
    
    // 공통 항목 값 저장
    selectedFields.forEach(field => {
        const value = formData.get(field);
        if (value && field !== 'itemName') { // 물품명은 제외
            commonValues[field] = value;
        }
    });
    
    // 폼 초기화
    itemForm.reset();
    
    // 공통 항목 값 복원
    Object.keys(commonValues).forEach(field => {
        const input = document.getElementById(field);
        if (input) {
            input.value = commonValues[field];
        }
    });
    
    // 갯수가 복원되지 않았으면 기본값 1 설정
    if (!commonValues['quantity']) {
        document.getElementById('quantity').value = '1';
    }
    
    // 물품명 포커스
    document.getElementById('itemName').focus();
}

// 물품 추가
async function handleAddItem(e) {
    e.preventDefault();
    
    const formData = new FormData(itemForm);
    const data = {};
    formData.forEach((value, key) => {
        if (value) data[key] = value;
    });
    
    // 사용자 정보 추가
    data.userId = currentUser.uid;
    data.userEmail = currentUser.email;
    data.timestamp = firebase.firestore.FieldValue.serverTimestamp();
    
    // 🔍 디버깅: 등록할 데이터 확인
    console.log('📝 물품 등록 시도:', {
        물품명: data.itemName,
        userId: data.userId,
        userEmail: data.userEmail,
        현재사용자: currentUser.uid,
        현재역할: currentUserRole
    });
    
    try {
        const docRef = await db.collection('items').add(data);
        console.log('✅ 물품 등록 완료! 문서ID:', docRef.id);
        console.log('⏳ 실시간 리스너가 곧 이 변경사항을 감지합니다...');
        console.log('   리스너 등록 상태:', isListenerRegistered ? '✅ 등록됨' : '❌ 미등록');
        console.log('   초기 로드 완료:', initialLoadComplete ? '✅ 완료' : '❌ 미완료');
        
        // 🎉 물품 등록 알림 (더 명확하게)
        showToast(`✅ "${data.itemName || '물품'}" 등록 완료!`, 'success');
        
        // 브라우저 알림 (선택사항 - 권한 있을 경우)
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('물품 등록 완료', {
                body: `${data.itemName || '물품'}이(가) 등록되었습니다.`,
                icon: '/favicon.ico'
            });
        }
        
        if (continuousMode) {
            // 연속 등록 모드: 공통 항목 유지
            resetFormKeepCommon();
        } else {
            // 일반 모드: 전체 초기화
            itemForm.reset();
            document.getElementById('surveyor').value = currentUser.displayName || '';
            document.getElementById('quantity').value = '1'; // 갯수 기본값 1
        }
    } catch (error) {
        console.error('등록 오류:', error);
        showToast('등록 중 오류가 발생했습니다', 'error');
    }
}

// 수정 모달 열기
function openEditModal(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    
    // 권한 확인: 관리자이거나 본인이 작성한 물품만 수정 가능
    const isOwner = currentUser && item.userId && item.userId === currentUser.uid;
    const hasNoOwner = !item.userId; // 기존 물품 (userId 없음)
    
    // 디버깅 정보
    console.log('수정 시도:', {
        물품: item.itemName,
        물품userId: item.userId,
        현재사용자: currentUser?.uid,
        역할: currentUserRole,
        작성자: isOwner,
        소유자없음: hasNoOwner
    });
    
    if (currentUserRole !== 'admin' && !isOwner && !hasNoOwner) {
        showToast('본인이 작성한 물품만 수정할 수 있습니다', 'error');
        return;
    }
    
    currentEditId = id;
    
    // 폼에 데이터 채우기
    document.getElementById('editId').value = item.id;
    document.getElementById('editSurveyor').value = item.surveyor || '';
    document.getElementById('editOrganization').value = item.organization || '';
    document.getElementById('editLocation').value = item.location || '';
    document.getElementById('editItemName').value = item.itemName || '';
    document.getElementById('editAssetNumber').value = item.assetNumber || '';
    document.getElementById('editQuantity').value = item.quantity || '';
    document.getElementById('editCategory').value = item.category || '';
    document.getElementById('editManufacturer').value = item.manufacturer || '';
    document.getElementById('editModel').value = item.model || '';
    document.getElementById('editWidth').value = item.width || '';
    document.getElementById('editHeight').value = item.height || '';
    document.getElementById('editDepth').value = item.depth || '';
    document.getElementById('editColor').value = item.color || '';
    document.getElementById('editMaterial').value = item.material || '';
    document.getElementById('editCondition').value = item.condition || '';
    document.getElementById('editNotes').value = item.notes || '';
    
    editModal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

// 수정 모달 닫기
function closeEditModal() {
    editModal.classList.remove('show');
    document.body.style.overflow = 'auto';
    currentEditId = null;
}

// 물품 수정
async function handleEditItem(e) {
    e.preventDefault();
    
    const formData = new FormData(editForm);
    const data = {};
    formData.forEach((value, key) => {
        if (value) data[key] = value;
    });
    
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    
    try {
        await db.collection('items').doc(currentEditId).update(data);
        showToast('물품이 수정되었습니다', 'success');
        closeEditModal();
    } catch (error) {
        console.error('수정 오류:', error);
        showToast('수정 중 오류가 발생했습니다', 'error');
    }
}

// 물품 삭제
async function deleteItem(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    
    // 권한 확인 - 관리자만 삭제 가능
    if (currentUserRole !== 'admin') {
        showToast('관리자만 삭제할 수 있습니다', 'error');
        return;
    }
    
    if (!confirm('정말 삭제하시겠습니까?')) return;
    
    try {
        await db.collection('items').doc(id).delete();
        showToast('물품이 삭제되었습니다', 'success');
    } catch (error) {
        console.error('삭제 오류:', error);
        showToast('삭제 중 오류가 발생했습니다', 'error');
    }
}

// 검색 및 필터
function filterItems() {
    const searchTerm = searchInput.value.toLowerCase();
    const category = filterCategory.value;
    
    let filtered = items.filter(item => {
        const matchesSearch = !searchTerm || 
            (item.itemName && item.itemName.toLowerCase().includes(searchTerm)) ||
            (item.surveyor && item.surveyor.toLowerCase().includes(searchTerm)) ||
            (item.manufacturer && item.manufacturer.toLowerCase().includes(searchTerm)) ||
            (item.model && item.model.toLowerCase().includes(searchTerm)) ||
            (item.notes && item.notes.toLowerCase().includes(searchTerm));
        
        const matchesCategory = !category || item.category === category;
        
        return matchesSearch && matchesCategory;
    });
    
    // 정렬 적용
    filtered = sortItems(filtered, currentSort);
    
    displayItems(filtered);
}

// 정렬 함수
function sortItems(itemsToSort, sortType) {
    const sorted = [...itemsToSort];
    
    switch(sortType) {
        case 'newest':
            sorted.sort((a, b) => {
                const timeA = a.timestamp ? a.timestamp.toDate() : new Date(0);
                const timeB = b.timestamp ? b.timestamp.toDate() : new Date(0);
                return timeB - timeA;
            });
            break;
        case 'oldest':
            sorted.sort((a, b) => {
                const timeA = a.timestamp ? a.timestamp.toDate() : new Date(0);
                const timeB = b.timestamp ? b.timestamp.toDate() : new Date(0);
                return timeA - timeB;
            });
            break;
        case 'name-asc':
            sorted.sort((a, b) => {
                const nameA = a.itemName || '';
                const nameB = b.itemName || '';
                return nameA.localeCompare(nameB, 'ko');
            });
            break;
        case 'name-desc':
            sorted.sort((a, b) => {
                const nameA = a.itemName || '';
                const nameB = b.itemName || '';
                return nameB.localeCompare(nameA, 'ko');
            });
            break;
        case 'category':
            sorted.sort((a, b) => {
                const catA = a.category || '';
                const catB = b.category || '';
                return catA.localeCompare(catB, 'ko');
            });
            break;
    }
    
    return sorted;
}

// 엑셀 다운로드 (클라이언트 사이드)
function exportExcel() {
    if (items.length === 0) {
        showToast('다운로드할 데이터가 없습니다', 'error');
        return;
    }
    
    try {
        const worksheetData = items.map(item => {
            const timestamp = item.timestamp ? item.timestamp.toDate() : new Date();
            return {
                '조사자': item.surveyor || '',
                '기관명': item.organization || '',
                '사용위치': item.location || '',
                '물품명': item.itemName || '',
                '자산번호': item.assetNumber || '',
                '갯수': item.quantity || '',
                '카테고리': item.category || '',
                '제조사': item.manufacturer || '',
                '모델명': item.model || '',
                '가로(cm)': item.width || '',
                '세로(cm)': item.height || '',
                '깊이(cm)': item.depth || '',
                '색상': item.color || '',
                '재질': item.material || '',
                '상태': item.condition || '',
                '비고': item.notes || '',
                '조사일시': timestamp.toLocaleString('ko-KR'),
                '작성자': item.userEmail || ''
            };
        });
        
        const worksheet = XLSX.utils.json_to_sheet(worksheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '물품조사');
        
        // 컬럼 너비 설정
        worksheet['!cols'] = [
            { wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 15 },
            { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
            { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 20 }, 
            { wch: 18 }, { wch: 20 }
        ];
        
        XLSX.writeFile(workbook, `물품조사_${new Date().toISOString().split('T')[0]}.xlsx`);
        showToast('엑셀 파일이 다운로드되었습니다', 'success');
    } catch (error) {
        console.error('다운로드 오류:', error);
        showToast('다운로드 중 오류가 발생했습니다', 'error');
    }
}

// JSON 다운로드
function exportJson() {
    if (items.length === 0) {
        showToast('다운로드할 데이터가 없습니다', 'error');
        return;
    }
    
    try {
        const exportData = items.map(item => {
            const timestamp = item.timestamp ? item.timestamp.toDate().toISOString() : new Date().toISOString();
            return { ...item, timestamp };
        });
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `물품조사_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('JSON 파일이 다운로드되었습니다', 'success');
    } catch (error) {
        console.error('다운로드 오류:', error);
        showToast('다운로드 중 오류가 발생했습니다', 'error');
    }
}

// 파일 업로드 (JSON 또는 엑셀)
async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const fileName = document.getElementById('fileName');
    fileName.textContent = file.name;
    
    const fileExt = file.name.split('.').pop().toLowerCase();
    
    try {
        let importedItems = [];
        
        if (fileExt === 'json') {
            const text = await file.text();
            importedItems = JSON.parse(text);
        } else if (fileExt === 'xlsx' || fileExt === 'xls') {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            
            importedItems = jsonData.map(row => ({
                surveyor: row['조사자'] || '',
                organization: row['기관명'] || '',
                location: row['사용위치'] || '',
                itemName: row['물품명'] || '',
                assetNumber: row['자산번호'] || '',
                quantity: row['갯수'] || '',
                category: row['카테고리'] || '',
                manufacturer: row['제조사'] || '',
                model: row['모델명'] || '',
                width: row['가로(cm)'] || '',
                height: row['세로(cm)'] || '',
                depth: row['깊이(cm)'] || '',
                color: row['색상'] || '',
                material: row['재질'] || '',
                condition: row['상태'] || '',
                notes: row['비고'] || ''
            }));
        } else {
            showToast('지원하지 않는 파일 형식입니다', 'error');
            return;
        }
        
        // Firestore에 일괄 추가
        const batch = db.batch();
        let count = 0;
        
        for (const item of importedItems) {
            const docRef = db.collection('items').doc();
            batch.set(docRef, {
                ...item,
                userId: currentUser.uid,
                userEmail: currentUser.email,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                imported: true
            });
            count++;
        }
        
        await batch.commit();
        showToast(`${count}개 항목을 가져왔습니다`, 'success');
        fileName.textContent = '';
        e.target.value = '';
    } catch (error) {
        console.error('업로드 오류:', error);
        showToast('파일 처리 중 오류가 발생했습니다', 'error');
    }
}

// 모든 데이터 삭제 (본인 데이터만)
async function clearAllData() {
    // 권한 확인 - 관리자만 삭제 가능
    if (currentUserRole !== 'admin') {
        showToast('관리자만 사용할 수 있습니다', 'error');
        return;
    }
    
    const confirmed = confirm('⚠️ 경고: 모든 물품 데이터를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 모든 사용자의 데이터가 삭제됩니다!');
    
    if (!confirmed) return;
    
    const doubleConfirm = confirm(`정말로 ${items.length}개의 모든 데이터를 삭제하시겠습니까?\n\n다시 한 번 확인합니다.`);
    
    if (!doubleConfirm) return;
    
    const tripleConfirm = prompt('정말 삭제하려면 "DELETE"를 입력하세요:');
    
    if (tripleConfirm !== 'DELETE') {
        showToast('삭제가 취소되었습니다', 'info');
        return;
    }
    
    try {
        if (items.length === 0) {
            showToast('삭제할 데이터가 없습니다', 'error');
            return;
        }
        
        // 모든 물품 삭제 (관리자 권한)
        const batch = db.batch();
        items.forEach(item => {
            batch.delete(db.collection('items').doc(item.id));
        });
        
        await batch.commit();
        showToast(`${items.length}개의 모든 항목이 삭제되었습니다`, 'success');
    } catch (error) {
        console.error('삭제 오류:', error);
        showToast('삭제 중 오류가 발생했습니다', 'error');
    }
}

// 토스트 알림 표시
function showToast(message, type = 'success') {
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 대시보드 업데이트
function updateDashboard() {
    const dashboardLoading = document.getElementById('dashboardLoading');
    const dashboardContent = document.getElementById('dashboardContent');
    
    // 로딩 표시
    dashboardLoading.style.display = 'grid';
    dashboardContent.style.display = 'none';
    
    setTimeout(() => {
        // 통계 계산 - 전체 개수가 있으면 사용, 없으면 현재 items 사용
        const totalItems = totalItemCount > 0 ? totalItemCount : items.length;
        const goodCondition = items.filter(item => 
            item.condition === '매우 좋음' || item.condition === '좋음'
        ).length;
        const needsAttention = items.filter(item => 
            item.condition === '나쁨' || item.condition === '매우 나쁨'
        ).length;
        
        // 최근 7일 데이터
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recentItems = items.filter(item => {
            const itemDate = item.timestamp ? item.timestamp.toDate() : new Date(0);
            return itemDate >= sevenDaysAgo;
        }).length;
        
        // 통계 업데이트
        document.getElementById('totalItems').textContent = totalItems;
        document.getElementById('goodCondition').textContent = goodCondition;
        document.getElementById('needsAttention').textContent = needsAttention;
        document.getElementById('recentItems').textContent = recentItems;
        
        // 카테고리별 분포
        updateCategoryChart();
        
        // 최근 물품 목록
        updateRecentItemsList();
        
        // 로딩 숨기기
        dashboardLoading.style.display = 'none';
        dashboardContent.style.display = 'block';
    }, 500);
}

// 카테고리별 차트 업데이트
function updateCategoryChart() {
    const categoryCount = {};
    items.forEach(item => {
        const cat = item.category || '미분류';
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    });
    
    const maxCount = Math.max(...Object.values(categoryCount), 1);
    const categoryChart = document.getElementById('categoryChart');
    
    if (Object.keys(categoryCount).length === 0) {
        categoryChart.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">데이터가 없습니다</p>';
        return;
    }
    
    categoryChart.innerHTML = Object.entries(categoryCount)
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => {
            const percentage = (count / maxCount) * 100;
            return `
                <div class="category-bar">
                    <div class="category-name">${category}</div>
                    <div class="category-bar-container">
                        <div class="category-bar-fill" style="width: ${percentage}%">
                            ${count}개
                        </div>
                    </div>
                </div>
            `;
        }).join('');
}

// 최근 물품 목록 업데이트
function updateRecentItemsList() {
    const recentItemsList = document.getElementById('recentItemsList');
    const recentItems = items.slice(0, 5);
    
    if (recentItems.length === 0) {
        recentItemsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">최근 추가된 물품이 없습니다</p>';
        return;
    }
    
    recentItemsList.innerHTML = recentItems.map(item => {
        const timestamp = item.timestamp ? item.timestamp.toDate() : new Date();
        const timeAgo = getTimeAgo(timestamp);
        
        return `
            <div class="recent-item">
                <div class="recent-item-info">
                    <h4>${item.itemName || '미지정'}</h4>
                    <div class="recent-item-meta">
                        ${item.surveyor || '-'} • ${timeAgo}
                    </div>
                </div>
                ${item.category ? `<span class="recent-item-badge">${item.category}</span>` : ''}
            </div>
        `;
    }).join('');
}

// 시간 경과 표시 함수
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return '방금 전';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}일 전`;
    
    return date.toLocaleDateString('ko-KR');
}

// 사용자 관리 (관리자 전용)
async function loadUsers() {
    if (currentUserRole !== 'admin') {
        showToast('관리자만 사용할 수 있습니다', 'error');
        return;
    }
    
    const userListDiv = document.getElementById('userList');
    userListDiv.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">불러오는 중...</p>';
    
    try {
        const usersSnapshot = await db.collection('users').orderBy('createdAt', 'desc').get();
        
        if (usersSnapshot.empty) {
            userListDiv.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">등록된 사용자가 없습니다</p>';
            return;
        }
        
        const usersHTML = usersSnapshot.docs.map(doc => {
            const user = doc.data();
            const userId = doc.id;
            const isCurrentUser = userId === currentUser.uid;
            
            return `
                <div class="user-item">
                    <div class="user-info">
                        <div class="user-name">
                            ${user.displayName || user.email}
                            ${isCurrentUser ? '<span style="color: var(--primary); font-size: 12px;"> (나)</span>' : ''}
                            <span class="user-role ${user.role}">${user.role === 'admin' ? '👑 관리자' : '👤 일반'}</span>
                        </div>
                        <div class="user-email">${user.email}</div>
                    </div>
                    <div class="user-actions">
                        ${!isCurrentUser ? `
                            <button class="role-toggle-btn ${user.role === 'admin' ? 'make-user' : 'make-admin'}" 
                                    onclick="toggleUserRole('${userId}', '${user.role}')">
                                ${user.role === 'admin' ? '일반 사용자로 변경' : '관리자로 지정'}
                            </button>
                        ` : '<span style="font-size: 12px; color: var(--text-secondary);">본인 계정</span>'}
                    </div>
                </div>
            `;
        }).join('');
        
        userListDiv.innerHTML = usersHTML;
        showToast('사용자 목록을 불러왔습니다', 'success');
    } catch (error) {
        console.error('사용자 목록 로드 오류:', error);
        userListDiv.innerHTML = '<p style="text-align: center; color: var(--danger);">불러오기 실패</p>';
        showToast('사용자 목록을 불러오는데 실패했습니다', 'error');
    }
}

async function toggleUserRole(userId, currentRole) {
    if (currentUserRole !== 'admin') {
        showToast('관리자만 사용할 수 있습니다', 'error');
        return;
    }
    
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    const roleText = newRole === 'admin' ? '관리자' : '일반 사용자';
    
    if (!confirm(`이 사용자를 ${roleText}로 변경하시겠습니까?`)) {
        return;
    }
    
    try {
        // 🔥 Cloud Function 호출 (Custom Claims 설정 포함)
        const setRole = firebase.functions().httpsCallable('setUserRole');
        const result = await setRole({ userId, role: newRole });
        
        console.log('✅ 역할 변경 완료:', result.data);
        showToast(`${roleText}로 변경되었습니다`, 'success');
        loadUsers(); // 목록 새로고침
    } catch (error) {
        console.error('권한 변경 오류:', error);
        
        // 오류 메시지 처리
        let errorMessage = '권한 변경에 실패했습니다';
        if (error.code === 'permission-denied') {
            errorMessage = '관리자 권한이 필요합니다';
        } else if (error.code === 'unauthenticated') {
            errorMessage = '로그인이 필요합니다';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        showToast(errorMessage, 'error');
    }
}

// ===============================================
// 📄 페이지네이션 함수 (관리자 전용)
// ===============================================

// 다음 페이지 로드
async function loadNextPage() {
    if (!lastVisible || !hasMorePages) {
        showToast('마지막 페이지입니다', 'info');
        return;
    }
    
    console.log(`📄 다음 페이지(${currentPage + 1}) 로드 중...`);
    
    try {
        const nextQuery = db.collection('items')
            .orderBy('timestamp', 'desc')
            .startAfter(lastVisible)
            .limit(ADMIN_PAGE_SIZE);
        
        const snapshot = await nextQuery.get();
        
        if (snapshot.empty) {
            showToast('더 이상 데이터가 없습니다', 'info');
            hasMorePages = false;
            updatePaginationUI();
            return;
        }
        
        // 데이터 교체 (이전 페이지 데이터는 제거)
        items = [];
        snapshot.forEach((doc) => {
            items.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        lastVisible = snapshot.docs[snapshot.docs.length - 1];
        hasMorePages = snapshot.docs.length === ADMIN_PAGE_SIZE;
        currentPage++;
        
        // 정렬 적용 후 표시
        const sortedItems = sortItems(items, currentSort);
        displayItems(sortedItems);
        updateItemCount();
        updatePaginationUI();
        
        totalReads += snapshot.docs.length;
        console.log(`📥 페이지 ${currentPage} 로드 완료: ${items.length}개 (총 읽기: ${totalReads}회)`);
        
        // 페이지 상단으로 스크롤
        document.getElementById('listTab')?.scrollIntoView({ behavior: 'smooth' });
        
    } catch (error) {
        console.error('다음 페이지 로드 오류:', error);
        showToast('페이지 로드에 실패했습니다', 'error');
    }
}

// 이전 페이지는 첫 페이지로 돌아가기
function goToFirstPage() {
    if (currentPage === 1) {
        showToast('이미 첫 페이지입니다', 'info');
        return;
    }
    
    console.log('📄 첫 페이지로 이동');
    
    // 리스너 해제 후 재등록
    if (unsubscribe) {
        unsubscribe();
    }
    
    // 상태 초기화
    items = [];
    currentPage = 1;
    lastVisible = null;
    hasMorePages = true;
    isListenerRegistered = false;
    initialLoadComplete = false;
    
    // 다시 로드
    loadItems();
}

// 페이지네이션 UI 업데이트
function updatePaginationUI() {
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');
    
    if (prevBtn) {
        prevBtn.disabled = currentPage === 1;
    }
    
    if (nextBtn) {
        nextBtn.disabled = !hasMorePages;
    }
    
    if (pageInfo) {
        pageInfo.textContent = `페이지 ${currentPage}`;
    }
}

// 페이지네이션 컨트롤 표시
function showPaginationControls() {
    const paginationDiv = document.getElementById('paginationControls');
    if (paginationDiv) {
        paginationDiv.style.display = 'flex';
    }
}

// 페이지네이션 컨트롤 숨김
function hidePaginationControls() {
    const paginationDiv = document.getElementById('paginationControls');
    if (paginationDiv) {
        paginationDiv.style.display = 'none';
    }
}

// 전역 함수로 노출
window.openEditModal = openEditModal;
window.deleteItem = deleteItem;
window.switchTab = switchTab;
window.deleteOrganization = deleteOrganization;
window.toggleUserRole = toggleUserRole;
window.loadNextPage = loadNextPage;
window.goToFirstPage = goToFirstPage;
