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

// 🔒 폼 제출 방지 플래그
let isSubmitting = false;
let formEventListenersAttached = false;

// 📊 읽기 횟수 추적 (디버깅용)
let totalReads = 0;
let sessionStart = Date.now();

// 📄 페이지네이션 (관리자용)
let currentPage = 1;
let lastVisible = null;
const ADMIN_PAGE_SIZE = 50; // 목록 화면 한 페이지
const ADMIN_FETCH_BATCH = 400;
let hasMorePages = true;
let totalItemCount = 0; // 전체 데이터 개수 (페이지와 무관)
let listPage = 1;
let lastFilteredItems = [];
let adminFullLoadDone = false;
let adminFullLoadPromise = null;

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
            
            // 역할 표시 업데이트
            updateUserRoleDisplay(user);
            
            // 🔥 initApp()을 await로 호출하여 완료될 때까지 대기
            await initApp();
            
            // 역할 기반 UI 다시 확인 (역할이 변경되었을 수 있음)
            initRoleBasedUI();
            
            console.log('✅ 앱 로딩 완전히 완료');
            console.log(`📊 최종 확인 - 사용자 역할: ${currentUserRole}`);
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
        console.log('🔄 사용자 역할 초기화 시작...');
        
        // 🔥 1순위: Custom Claims에서 역할 확인 (읽기 0회!)
        // 강제로 새 토큰 가져오기 (캐시 무시)
        const idTokenResult = await currentUser.getIdTokenResult(true);
        
        console.log('📋 Custom Claims 확인:', {
            claims: idTokenResult.claims,
            hasRole: !!idTokenResult.claims.role,
            role: idTokenResult.claims.role
        });
        
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
            const firestoreRole = userDoc.data().role || 'user';
            currentUserRole = firestoreRole;
            console.log(`📝 기존 사용자 역할 (Firestore): ${currentUserRole}`);
            
            // 🔧 Custom Claims 동기화 시도 (새 함수 사용)
            console.log('🔄 Custom Claims 동기화 시도...');
            try {
                // 🆕 자기 자신의 Custom Claims를 동기화하는 새 함수 사용
                const syncClaims = firebase.functions().httpsCallable('syncMyCustomClaims');
                const result = await syncClaims();
                
                console.log('✅ Custom Claims 동기화 결과:', result.data);
                
                // 토큰 강제 갱신하여 Custom Claims 즉시 적용
                await currentUser.getIdToken(true);
                
                // 다시 확인
                const newTokenResult = await currentUser.getIdTokenResult(true);
                if (newTokenResult.claims.role) {
                    currentUserRole = newTokenResult.claims.role;
                    console.log('✅ Custom Claims 동기화 완료, 역할:', currentUserRole);
                    
                    // 🎉 관리자 권한이 확인되면 알림
                    if (currentUserRole === 'admin') {
                        showToast('👑 관리자 권한이 활성화되었습니다', 'success');
                    } else {
                        showToast('사용자 정보가 업데이트되었습니다', 'success');
                    }
                } else {
                    console.warn('⚠️ Custom Claims가 아직 적용되지 않았습니다. 다음 로그인 시 적용됩니다.');
                }
            } catch (functionError) {
                console.warn('⚠️ Custom Claims 동기화 실패:', functionError);
                console.warn('   오류 코드:', functionError.code);
                console.warn('   오류 메시지:', functionError.message);
                
                // ⚠️ 권한 오류가 아닌 경우에만 계속 진행
                if (functionError.code !== 'permission-denied') {
                    showToast('⚠️ 권한 동기화 실패 - 일부 기능이 제한될 수 있습니다', 'warning');
                }
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
            
            console.log(`👤 첫 번째 사용자: ${isFirstUser}, 역할: ${currentUserRole}`);
            
            // Firestore에 저장 (Cloud Function의 onUserCreate와 중복될 수 있으나 안전장치)
            await db.collection('users').doc(currentUser.uid).set({
                email: currentUser.email,
                displayName: currentUser.displayName || currentUser.email,
                role: currentUserRole,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`✅ 신규 사용자 등록: ${currentUserRole}`);
            
            // Custom Claims도 즉시 동기화 시도 (새 함수 사용)
            try {
                const syncClaims = firebase.functions().httpsCallable('syncMyCustomClaims');
                await syncClaims();
                await currentUser.getIdToken(true);
                console.log('✅ 신규 사용자 Custom Claims 동기화 완료');
                
                // 다시 확인
                const newTokenResult = await currentUser.getIdTokenResult(true);
                if (newTokenResult.claims.role) {
                    currentUserRole = newTokenResult.claims.role;
                }
            } catch (error) {
                console.warn('⚠️ 신규 사용자 Custom Claims 동기화 실패:', error);
                // Cloud Function의 onUserCreate가 나중에 처리할 것임
            }
            
            if (isFirstUser) {
                showToast('첫 번째 사용자로 관리자 권한이 부여되었습니다', 'success');
            }
        }
        
        console.log(`🎯 최종 사용자 역할: ${currentUserRole}`);
    } catch (error) {
        console.error('❌ 사용자 역할 초기화 오류:', error);
        console.error('   오류 상세:', {
            code: error.code,
            message: error.message,
            stack: error.stack
        });
        currentUserRole = 'user'; // 기본값
        showToast('사용자 역할 확인 중 오류가 발생했습니다', 'error');
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
    if (typeof initOrganizations === 'function') {
        initOrganizations();
    }
    if (typeof initRegister === 'function') {
        initRegister();
    }
    if (typeof initOfflineQueue === 'function') {
        initOfflineQueue();
    }
    // 내용연수 표는 화면을 막을 이유가 없으니 배경에서 준비시킨다
    if (typeof ensureUsefulLifeTable === 'function') {
        ensureUsefulLifeTable();
    }
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
                if (typeof mergeOfflineQueueIntoItems === 'function') {
                    await mergeOfflineQueueIntoItems();
                }
                
                // 🔥 중요: 캐시에서 로드했으므로 초기 로드 완료로 표시
                initialLoadComplete = true;
                
                // 즉시 화면에 표시 (정렬 적용)
                const sortedItems = sortItems(getItemsForView(), currentSort);
                displayItems(sortedItems);
                updateItemCount();
                if (typeof refreshVisibleViews === 'function') {
                    updateSurveySelect();
                    updateSurveyBanner();
                    updateFilterOrganization();
                }
                
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

// 사용자 역할 표시 업데이트
function updateUserRoleDisplay(user) {
    const roleEmoji = currentUserRole === 'admin' ? '👑' : '👤';
    const roleText = currentUserRole === 'admin' ? ' (관리자)' : '';
    userName.textContent = `${roleEmoji} ${user.displayName || user.email}${roleText}`;
    console.log(`👤 사용자 역할 표시 업데이트: ${currentUserRole}`);
}

// 역할별 UI 초기화
function initRoleBasedUI() {
    console.log(`🔄 역할별 UI 초기화 시작 (현재 역할: ${currentUserRole})`);
    
    const userManagementSection = document.getElementById('userManagementSection');
    const migrationSection = document.getElementById('migrationSection');
    const dangerZoneSection = document.getElementById('dangerZoneSection');
    
    if (currentUserRole === 'admin') {
        // 관리자는 사용자 관리 섹션, 마이그레이션 섹션, 위험 영역 표시
        console.log('👑 관리자 UI 표시');
        if (userManagementSection) {
            userManagementSection.style.display = 'block';
        }
        if (migrationSection) {
            migrationSection.style.display = 'block';
        }
        if (dangerZoneSection) {
            dangerZoneSection.style.display = 'block';
        }
    } else {
        // 일반 사용자는 사용자 관리 섹션, 마이그레이션 섹션, 위험 영역 숨김
        console.log('👤 일반 사용자 UI 표시');
        if (userManagementSection) {
            userManagementSection.style.display = 'none';
        }
        if (migrationSection) {
            migrationSection.style.display = 'none';
        }
        if (dangerZoneSection) {
            dangerZoneSection.style.display = 'none';
        }
    }
    
    console.log('✅ 역할별 UI 초기화 완료');
}

// 기관/회차/위치 마스터는 masters.js에서 관리합니다.

function getItemsForView(source) {
    if (typeof getVisibleItems === 'function') {
        return getVisibleItems(source);
    }
    return source || items;
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
        if (typeof refreshRegisterViews === 'function') refreshRegisterViews();
    } else if (tabName === 'register') {
        if (typeof refreshRegisterViews === 'function') refreshRegisterViews();
    } else if (tabName === 'list') {
        // 🔥 핵심: loadItems()가 알아서 중복 체크함
        loadItems(); // 내부에서 이미 등록되어 있으면 데이터만 표시 (읽기 0회)
    }
}

// 이벤트 리스너 초기화
function initEventListeners() {
    // 🔒 중복 등록 방지
    if (formEventListenersAttached) {
        console.log('⚠️ 이벤트 리스너가 이미 등록되어 있습니다.');
        return;
    }
    
    // 연속 등록 모드
    initContinuousMode();
    
    // 물품 추가 폼 - 중복 방지 및 자동 제출 방지
    itemForm.addEventListener('submit', handleAddItem, { once: false });
    
    // iOS Safari 호환성: Enter 키로 자동 제출 방지
    const formInputs = itemForm.querySelectorAll('input, select, textarea');
    formInputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            // Enter 키가 눌렸을 때
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                // submit 버튼이 아닌 경우에만 preventDefault
                if (e.target.type !== 'submit' && !isSubmitting) {
                    e.preventDefault();
                    // Enter 키로 다음 필드로 이동
                    const inputs = Array.from(formInputs);
                    const currentIndex = inputs.indexOf(e.target);
                    if (currentIndex < inputs.length - 1) {
                        inputs[currentIndex + 1].focus();
                    }
                }
            }
        });
    });
    const offlineStatusBtn = document.getElementById('offlineStatus');
    if (offlineStatusBtn) {
        offlineStatusBtn.addEventListener('click', async () => {
            if (typeof syncOfflineQueue !== 'function') return;
            const result = await syncOfflineQueue();
            if (result.synced) showToast(`대기 ${result.synced}건을 업로드했습니다`, 'success');
            else if (result.failed) showToast('일부 대기 항목 업로드에 실패했습니다', 'error');
            else if (typeof navigator !== 'undefined' && navigator.onLine === false) showToast('아직 오프라인입니다', 'info');
            else showToast('업로드할 대기 항목이 없습니다', 'success');
        });
    }

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
    
    // 물품 수정 폼 - 중복 방지
    editForm.addEventListener('submit', handleEditItem, { once: false });
    
    // iOS Safari 호환성: 수정 폼 Enter 키 방지
    const editInputs = editForm.querySelectorAll('input, select, textarea');
    editInputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !isSubmitting) {
                if (e.target.type !== 'submit') {
                    e.preventDefault();
                }
            }
        });
    });
    
    formEventListenersAttached = true;
    document.getElementById('closeModal').addEventListener('click', closeEditModal);
    document.getElementById('cancelEdit').addEventListener('click', closeEditModal);
    
    // 검색 및 필터
    searchInput.addEventListener('input', filterItems);
    filterCategory.addEventListener('change', filterItems);
    const filterOrganization = document.getElementById('filterOrganization');
    const filterCondition = document.getElementById('filterCondition');
    if (filterOrganization) filterOrganization.addEventListener('change', filterItems);
    if (filterCondition) filterCondition.addEventListener('change', filterItems);
    ['filterSurveyor', 'filterLocation', 'filterDateFrom', 'filterDateTo'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', filterItems);
    });
    sortBy.addEventListener('change', (e) => {
        currentSort = e.target.value;
        filterItems();
    });
    
    // 데이터 관리
    document.getElementById('exportExcel').addEventListener('click', exportExcel);
    document.getElementById('exportExcelAll').addEventListener('click', exportExcelAll);
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
    
    // 데이터 마이그레이션 (관리자만)
    const startMigrationBtn = document.getElementById('startMigrationBtn');
    if (startMigrationBtn) {
        startMigrationBtn.addEventListener('click', migrateUserIds);
    }
    
    // 모달 외부 클릭 시 닫기
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) {
            closeEditModal();
        }
    });
}

// 전체 데이터 개수 업데이트 (현재 로드된 데이터 기준 - 읽기 0회)
function updateTotalCount() {
    // 현재 로드된 items 배열의 길이 사용
    // 실시간 리스너가 데이터를 동기화하므로 정확함
    totalItemCount = items.length;
    updateItemCount();
    
    console.log(`📊 전체 데이터 개수: ${totalItemCount}개 (캐시 - 읽기 0회)`);
}

// 일반 사용자용 이중 쿼리 로드 (userId + userEmail 병합)
async function loadItemsForUser(retryCount = 0) {
    console.log('🔄 일반 사용자: 이중 쿼리 시작 (userId + userEmail)');
    
    const listLoading = document.getElementById('listLoading');
    if (listLoading) {
        listLoading.style.display = 'block';
        itemList.innerHTML = '';
    }
    
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000; // 2초
    
    try {
        // 쿼리 1: userId로 조회 (본인이 작성한 데이터)
        console.log('📥 쿼리 1: userId로 조회 중...');
        let snapshot1;
        try {
            const query1 = db.collection('items')
                .where('userId', '==', currentUser.uid)
                .orderBy('timestamp', 'desc');
            
            snapshot1 = await query1.get();
            totalReads += snapshot1.docs.length;
        } catch (error) {
            if (error.code === 'failed-precondition' && retryCount < MAX_RETRIES) {
                console.log(`⚠️ 인덱스 생성 중... ${retryCount + 1}/${MAX_RETRIES} 재시도`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                return loadItemsForUser(retryCount + 1);
            }
            throw error;
        }
        
        // 쿼리 2: userEmail로 조회 (기존 데이터)
        console.log('📥 쿼리 2: userEmail로 조회 중...');
        let snapshot2;
        try {
            const query2 = db.collection('items')
                .where('userEmail', '==', currentUser.email)
                .orderBy('timestamp', 'desc');
            
            snapshot2 = await query2.get();
            totalReads += snapshot2.docs.length;
        } catch (error) {
            if (error.code === 'failed-precondition' && retryCount < MAX_RETRIES) {
                console.log(`⚠️ 인덱스 생성 중... ${retryCount + 1}/${MAX_RETRIES} 재시도`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                return loadItemsForUser(retryCount + 1);
            }
            // userEmail 쿼리 실패 시 userId 쿼리 결과만 사용
            console.warn('⚠️ userEmail 쿼리 실패, userId 결과만 사용:', error);
            snapshot2 = { docs: [], forEach: () => {} };
        }
        
        // 중복 제거하면서 병합
        const itemsMap = new Map();
        
        snapshot1.forEach((doc) => {
            itemsMap.set(doc.id, {
                id: doc.id,
                ...doc.data()
            });
        });
        
        snapshot2.forEach((doc) => {
            // 이미 존재하지 않는 경우만 추가 (중복 방지)
            if (!itemsMap.has(doc.id)) {
                itemsMap.set(doc.id, {
                    id: doc.id,
                    ...doc.data()
                });
            }
        });
        
        items = Array.from(itemsMap.values());
        if (typeof mergeOfflineQueueIntoItems === 'function') {
            await mergeOfflineQueueIntoItems();
        }
        
        console.log(`✅ 이중 쿼리 완료: 총 ${items.length}개 항목 (쿼리1: ${snapshot1.docs.length}개, 쿼리2: ${snapshot2.docs.length}개, 중복제거 후: ${items.length}개)`);
        console.log(`📊 총 읽기 횟수: ${totalReads}회`);
        
        // 정렬 적용
        const sortedItems = sortItems(getItemsForView(), currentSort);
        displayItems(sortedItems);
        updateItemCount();
        updateDashboard();
        if (typeof updateSurveySelect === 'function') updateSurveySelect();
        
        if (listLoading) listLoading.style.display = 'none';
        
        // 🔥 이제 실시간 리스너 등록
        setupUserRealtimeListener();
        
    } catch (error) {
        console.error('❌ 이중 쿼리 오류:', error);
        if (listLoading) listLoading.style.display = 'none';
        
        let errorMessage = '데이터를 불러오는데 실패했습니다';
        if (error.code === 'failed-precondition') {
            if (retryCount >= MAX_RETRIES) {
                errorMessage = '인덱스 생성 중입니다. 잠시 후 페이지를 새로고침해주세요.';
            } else {
                // 재시도 중이면 메시지 표시 안 함
                return;
            }
        } else if (error.code === 'permission-denied') {
            errorMessage = '권한이 없습니다. 관리자에게 문의하세요.';
        } else if (error.code === 'unavailable' || (typeof isOfflineError === 'function' && isOfflineError(error))) {
            if (typeof mergeOfflineQueueIntoItems === 'function') {
                await mergeOfflineQueueIntoItems();
            }
            if (items.length) {
                const sortedItems = sortItems(getItemsForView(), currentSort);
                displayItems(sortedItems);
                updateItemCount();
                updateDashboard();
                showToast('오프라인입니다. 저장된 목록과 대기 입력을 보여줍니다', 'info');
                return;
            }
            errorMessage = '네트워크 연결을 확인해주세요.';
        }
        
        showToast(errorMessage, 'error');
    }
}

// 일반 사용자용 실시간 리스너 설정
function setupUserRealtimeListener() {
    if (isListenerRegistered) {
        console.log('✅ 리스너가 이미 등록되어 있음');
        return;
    }
    
    console.log('🔄 일반 사용자: 실시간 리스너 등록 중...');
    
    // userId 기반 리스너만 등록 (새 데이터는 userId가 있음)
    const query = db.collection('items')
        .where('userId', '==', currentUser.uid)
        .orderBy('timestamp', 'desc');
    
    unsubscribe = query.onSnapshot((snapshot) => {
        // 변경사항만 처리
        let addedCount = 0, modifiedCount = 0, removedCount = 0;
        
        snapshot.docChanges().forEach((change) => {
            const docData = { id: change.doc.id, ...change.doc.data() };
            
            if (change.type === 'added') {
                const existingIndex = items.findIndex(item => item.id === docData.id);
                if (existingIndex === -1) {
                    items.unshift(docData);
                    addedCount++;
                    console.log(`➕ 새 물품 추가: "${docData.itemName}"`);
                }
            } else if (change.type === 'modified') {
                const index = items.findIndex(item => item.id === docData.id);
                if (index !== -1) {
                    items[index] = docData;
                    modifiedCount++;
                    console.log(`✏️ 물품 수정: "${docData.itemName}"`);
                }
            } else if (change.type === 'removed') {
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
            console.log(`🔄 변경사항: ➕${addedCount} ✏️${modifiedCount} 🗑️${removedCount} (읽기 ${changeReads}회)`);
            
            // 화면 업데이트
            if (searchInput && (searchInput.value || filterCategory.value || document.getElementById('filterOrganization')?.value || document.getElementById('filterCondition')?.value)) {
                filterItems();
            } else {
                const sortedItems = sortItems(getItemsForView(), currentSort);
                displayItems(sortedItems);
            }
            updateItemCount();
            updateDashboard();
        }
    }, (error) => {
        console.error('❌ 실시간 리스너 오류:', error);
        showToast('실시간 업데이트 연결에 실패했습니다', 'error');
    });
    
    isListenerRegistered = true;
    initialLoadComplete = true;
    console.log('✅ 일반 사용자 실시간 리스너 등록 완료');
}

// Firestore에서 물품 목록 실시간 로드 (역할별 최적화)
function loadItems() {
    // 🔥 핵심: 리스너가 이미 등록되어 있으면 절대 재등록하지 않음!
    if (isListenerRegistered) {
        console.log('✅ 리스너가 이미 등록되어 있음 (읽기 0회)');
        // 데이터만 다시 표시 (정렬 적용)
        if (items.length > 0) {
            const sortedItems = sortItems(getItemsForView(), currentSort);
            displayItems(sortedItems);
            updateItemCount();
        }
        return;
    }
    
    // 전체 개수 업데이트 (현재 로드된 데이터 기준)
    updateTotalCount();
    
    console.log('🔄 실시간 리스너 등록 중... (역할별 필터링)');
    
    // 로딩 표시
    const listLoading = document.getElementById('listLoading');
    if (listLoading) {
        listLoading.style.display = 'block';
        itemList.innerHTML = '';
    }
    
    // 🔥 역할별 쿼리 생성
    if (currentUserRole === 'admin') {
        // 👑 관리자: 전체 물품 (페이지네이션) - 기존 로직 유지
        console.log(`👑 관리자: 전체 물품 로드 (${ADMIN_PAGE_SIZE}개씩)`);
        
        // 페이지네이션 UI 표시
        showPaginationControls();
        
        // 관리자 쿼리 계속 진행
        let query = db.collection('items')
            .orderBy('timestamp', 'desc')
            .limit(ADMIN_PAGE_SIZE);
        
        // 🚀 최적화된 실시간 리스너 (변경된 문서만 처리) - 관리자용
        setupAdminRealtimeListener(query);
    } else {
        // 👤 일반 사용자: 이중 쿼리 방식 사용 (userId + userEmail)
        console.log('👤 일반 사용자: 이중 쿼리 방식으로 전환');
        
        // 페이지네이션 UI 숨김
        hidePaginationControls();
        
        // 일반 사용자는 loadItemsForUser()로 처리
        loadItemsForUser();
        return; // 여기서 함수 종료
    }
}

async function loadAllAdminItems() {
    if (adminFullLoadDone) return;
    if (adminFullLoadPromise) return adminFullLoadPromise;
    if (typeof db === 'undefined' || !currentUser) return;

    adminFullLoadPromise = (async () => {
        try {
            let cursor = null;
            const seen = new Set(items.map((item) => item.id));
            while (true) {
                let query = db.collection('items').orderBy('timestamp', 'desc').limit(ADMIN_FETCH_BATCH);
                if (cursor) query = query.startAfter(cursor);
                const snapshot = await query.get();
                if (snapshot.empty) break;
                snapshot.forEach((doc) => {
                    if (seen.has(doc.id)) return;
                    seen.add(doc.id);
                    items.push({ id: doc.id, ...doc.data() });
                });
                totalReads += snapshot.docs.length;
                cursor = snapshot.docs[snapshot.docs.length - 1];
                if (snapshot.docs.length < ADMIN_FETCH_BATCH) break;
            }
            adminFullLoadDone = true;
            if (typeof mergeOfflineQueueIntoItems === 'function') {
                await mergeOfflineQueueIntoItems();
            }
            if (typeof updateFilterOrganization === 'function') updateFilterOrganization();
            if (typeof refreshVisibleViews === 'function') refreshVisibleViews();
            else {
                filterItems();
                updateDashboard();
            }
            console.log(`📥 관리자 전체 로드 완료: ${items.length}개`);
        } catch (error) {
            console.warn('전체 물품 추가 로드 실패, 현재 목록으로 집계합니다:', error);
            adminFullLoadPromise = null;
        }
    })();
    return adminFullLoadPromise;
}

// 관리자용 실시간 리스너 설정 (기존 로직)
function setupAdminRealtimeListener(query) {
    const listLoading = document.getElementById('listLoading');
    
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
                
                if (currentUserRole === 'admin') {
                    loadAllAdminItems();
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
                        updateTotalCount();
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
            if (searchInput && (searchInput.value || filterCategory.value || document.getElementById('filterOrganization')?.value || document.getElementById('filterCondition')?.value)) {
                console.log(`🔍 검색 필터 적용 중...`);
                filterItems(); // 검색 필터 유지
            } else {
                console.log(`📋 전체 목록 표시 중... (정렬: ${currentSort})`);
                // 🔥 정렬 적용: 최신순으로 표시
                const sortedItems = sortItems(getItemsForView(), currentSort);
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
                errorMessage = '인덱스 생성 중입니다. 잠시 후 페이지를 새로고침해주세요.';
                // 인덱스 생성 링크 제공
                console.error('인덱스 생성 필요:', error);
                console.log('Firebase Console에서 인덱스를 생성하거나 잠시 후 다시 시도하세요.');
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
    const listEl = document.getElementById('itemList') || itemList;
    if (!listEl) return;

    // 🔥 중요: currentUser 확인
    if (!currentUser) {
        console.error('⚠️ displayItems 호출 시 currentUser가 없습니다!');
        listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <div class="empty-state-text">사용자 정보를 불러오는 중...</div>
            </div>
        `;
        return;
    }
    
    console.log(`📋 물품 목록 표시: ${itemsToShow.length}개 | 현재 사용자: ${currentUser.uid} | 역할: ${currentUserRole}`);
    
    if (itemsToShow.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <div class="empty-state-text">조사된 물품이 없습니다</div>
            </div>
        `;
        return;
    }
    
    listEl.innerHTML = itemsToShow.map(item => {
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
                <div class="item-title">${item.itemName || '미지정'}${item._pending ? '<span class="pending-badge">대기</span>' : ''}</div>
                ${item.category ? `<span class="item-category">${item.category}</span>` : ''}
            </div>
            
            <div class="item-info">
                <div class="info-item">
                    <span class="info-label">조사자:</span> ${item.surveyor || '-'}
                </div>
                ${item.surveyName ? `
                    <div class="info-item">
                        <span class="info-label">조사 회차:</span> ${item.surveyName}
                    </div>
                ` : ''}
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
    const visibleCount = getItemsForView().length;
    const filteredCount = lastFilteredItems.length || visibleCount;
    const survey = typeof getCurrentSurvey === 'function' ? getCurrentSurvey() : null;
    let prefix = '전체';
    if (typeof currentSurveyId !== 'undefined') {
        if (currentSurveyId === '__unassigned__') prefix = '미분류';
        else if (survey?.name) prefix = survey.name;
        else if (currentSurveyId && currentSurveyId !== '__all__') prefix = '선택한 회차';
    }

    if (filteredCount !== visibleCount) {
        itemCount.textContent = `${prefix} ${filteredCount}개 검색 / 전체 ${visibleCount}개`;
    } else if (currentUserRole === 'admin' && !adminFullLoadDone) {
        itemCount.textContent = `${prefix} ${visibleCount}개 물품 (불러오는 중)`;
    } else {
        itemCount.textContent = `${prefix} ${visibleCount}개 물품`;
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
    ['building', 'floor', 'room', 'organization', 'surveyor', 'quantity'].forEach(field => {
        const value = document.getElementById(field)?.value;
        if (value) commonValues[field] = value;
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
    if (commonValues.organization && typeof selectOrganization === 'function') {
        const orgSelect = document.getElementById('organizationSelect');
        if (orgSelect) orgSelect.value = commonValues.organization;
        currentOrganization = commonValues.organization;
    }
    if (typeof updateLocationPreview === 'function') updateLocationPreview();
    
    // 갯수가 복원되지 않았으면 기본값 1 설정
    if (!commonValues['quantity']) {
        document.getElementById('quantity').value = '1';
    }
    
    // 물품명 포커스
    document.getElementById('itemName').focus();
}

function resetFormAfterAdd() {
    if (continuousMode) {
        resetFormKeepCommon();
        return;
    }
    itemForm.reset();
    document.getElementById('surveyor').value = currentUser.displayName || '';
    document.getElementById('quantity').value = '1';
    if (currentOrganization && typeof selectOrganization === 'function') {
        const orgSelect = document.getElementById('organizationSelect');
        if (orgSelect) orgSelect.value = currentOrganization;
        document.getElementById('organization').value = currentOrganization;
    }
    if (typeof updateLocationPreview === 'function') updateLocationPreview();
}

// 물품 추가
async function handleAddItem(e) {
    e.preventDefault();
    e.stopPropagation(); // iOS Safari 호환성
    
    // 🔒 중복 제출 방지
    if (isSubmitting) {
        console.log('⚠️ 이미 제출 중입니다. 중복 제출 방지');
        return false;
    }
    
    // 필수 필드 검증
    const itemName = document.getElementById('itemName').value.trim();
    const surveyor = document.getElementById('surveyor').value.trim();
    
    if (!itemName || !surveyor) {
        showToast('물품명과 조사자 이름은 필수 항목입니다', 'error');
        return false;
    }

    if (typeof confirmAssetDuplicate === 'function') {
        const allowed = await confirmAssetDuplicate();
        if (!allowed) return false;
    }
    
    isSubmitting = true;
    
    // 제출 버튼 비활성화
    const submitBtn = itemForm.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '저장 중...';
    }
    
    const writableSurvey = typeof getWritableSurvey === 'function' ? getWritableSurvey() : null;
    if (!writableSurvey) {
        isSubmitting = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
        showToast('진행 중인 조사 회차가 없습니다. 회차를 먼저 선택하거나 만들어 주세요.', 'error');
        return false;
    }

    const formData = new FormData(itemForm);
    const data = {};
    formData.forEach((value, key) => {
        if (value) data[key] = value;
    });
    if (typeof applyItemLocationFields === 'function') {
        applyItemLocationFields(data);
    }
    if (typeof upsertLocationFromItem === 'function') {
        try {
            data.location = await upsertLocationFromItem(data) || data.location;
        } catch (error) {
            console.warn('위치 마스터 저장 건너뜀:', error);
            data.location = data.location || [data.building, data.floor, data.room].filter(Boolean).join(' ');
        }
    }
    
    // 사용자 정보 추가
    data.userId = currentUser.uid;
    data.userEmail = currentUser.email;
    if (writableSurvey && !writableSurvey.isFallback && writableSurvey.id) {
        data.surveyId = writableSurvey.id;
        data.surveyName = writableSurvey.name;
    }
    const persistOffline = async () => {
        const offlineData = {
            ...data,
            timestamp: new Date().toISOString()
        };
        await saveItemOffline(offlineData);
        showToast(`오프라인 저장: "${data.itemName || '물품'}". 연결되면 자동 업로드합니다`, 'success');
        resetFormAfterAdd();
    };

    if (typeof navigator !== 'undefined' && navigator.onLine === false && typeof saveItemOffline === 'function') {
        try {
            await persistOffline();
        } catch (error) {
            console.error('오프라인 저장 실패:', error);
            showToast('오프라인 저장에 실패했습니다', 'error');
        } finally {
            isSubmitting = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
            }
        }
        return false;
    }

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
        if (typeof markRegisterFound === 'function' && data.assetNumber) {
            await markRegisterFound(data.assetNumber, docRef.id, { condition: data.condition });
        }
        if (typeof refreshRegisterViews === 'function') refreshRegisterViews();
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
        
        resetFormAfterAdd();
    } catch (error) {
        console.error('등록 오류:', error);
        if (typeof isOfflineError === 'function' && isOfflineError(error) && typeof saveItemOffline === 'function') {
            try {
                await persistOffline();
            } catch (offlineError) {
                console.error('오프라인 저장 실패:', offlineError);
                showToast('등록 중 오류가 발생했습니다', 'error');
            }
        } else {
            showToast('등록 중 오류가 발생했습니다', 'error');
        }
    } finally {
        // 🔒 제출 플래그 해제 및 버튼 복원
        isSubmitting = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    }
    
    return false; // iOS Safari 호환성
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
    document.getElementById('editBuilding').value = item.building || '';
    document.getElementById('editFloor').value = item.floor || '';
    document.getElementById('editRoom').value = item.room || '';
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
    // 🔒 제출 플래그 초기화 (iOS Safari 호환성)
    isSubmitting = false;
    
    // 버튼 상태 복원
    const submitBtn = editForm.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '✅ 수정 완료';
    }
}

// 물품 수정
async function handleEditItem(e) {
    e.preventDefault();
    e.stopPropagation(); // iOS Safari 호환성
    
    // 🔒 중복 제출 방지
    if (isSubmitting) {
        console.log('⚠️ 이미 제출 중입니다. 중복 제출 방지');
        return false;
    }
    
    // 필수 필드 검증
    const itemName = document.getElementById('editItemName').value.trim();
    const surveyor = document.getElementById('editSurveyor').value.trim();
    
    if (!itemName || !surveyor) {
        showToast('물품명과 조사자 이름은 필수 항목입니다', 'error');
        return false;
    }
    
    isSubmitting = true;
    
    // 제출 버튼 비활성화
    const submitBtn = editForm.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '수정 중...';
    }
    
    const formData = new FormData(editForm);
    const data = {};
    formData.forEach((value, key) => {
        if (value) data[key] = value;
    });
    if (typeof applyItemLocationFields === 'function') {
        applyItemLocationFields(data);
    }
    if (typeof upsertLocationFromItem === 'function') {
        try {
            data.location = await upsertLocationFromItem(data) || data.location;
        } catch (error) {
            console.warn('위치 마스터 저장 건너뜀:', error);
        }
    }

    const saveEditOffline = async () => {
        await updateItemOffline(currentEditId, data);
        showToast('오프라인에서 수정했습니다. 연결되면 반영됩니다', 'success');
        closeEditModal();
    };

    if ((typeof isLocalItemId === 'function' && isLocalItemId(currentEditId))
        || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        try {
            await saveEditOffline();
        } catch (error) {
            console.error('오프라인 수정 실패:', error);
            showToast('수정 중 오류가 발생했습니다', 'error');
        } finally {
            isSubmitting = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
            }
        }
        return false;
    }
    
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    
    try {
        await db.collection('items').doc(currentEditId).update(data);
        showToast('물품이 수정되었습니다', 'success');
        closeEditModal();
    } catch (error) {
        console.error('수정 오류:', error);
        if (typeof isOfflineError === 'function' && isOfflineError(error) && typeof updateItemOffline === 'function') {
            try {
                await saveEditOffline();
            } catch (offlineError) {
                console.error('오프라인 수정 실패:', offlineError);
                showToast('수정 중 오류가 발생했습니다', 'error');
            }
        } else {
            showToast('수정 중 오류가 발생했습니다', 'error');
        }
    } finally {
        // 🔒 제출 플래그 해제 및 버튼 복원
        isSubmitting = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    }
    
    return false; // iOS Safari 호환성
}

// 물품 삭제
async function deleteItem(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    
    const isLocalPending = typeof isLocalItemId === 'function' && isLocalItemId(id);
    const isOwner = currentUser && item.userId && item.userId === currentUser.uid;
    if (currentUserRole !== 'admin' && !isLocalPending) {
        showToast('관리자만 삭제할 수 있습니다', 'error');
        return;
    }
    if (isLocalPending && currentUserRole !== 'admin' && !isOwner && item.userId) {
        showToast('본인이 저장한 대기 항목만 삭제할 수 있습니다', 'error');
        return;
    }
    
    if (!confirm('정말 삭제하시겠습니까?')) return;
    
    if (isLocalPending && typeof deleteItemOffline === 'function') {
        await deleteItemOffline(id);
        showToast('대기 중이던 항목을 삭제했습니다', 'success');
        return;
    }

    try {
        await db.collection('items').doc(id).delete();
        showToast('물품이 삭제되었습니다', 'success');
    } catch (error) {
        console.error('삭제 오류:', error);
        if (typeof isOfflineError === 'function' && isOfflineError(error) && typeof deleteItemOffline === 'function') {
            await deleteItemOffline(id);
            showToast('오프라인에서 삭제했습니다. 연결되면 반영됩니다', 'success');
        } else {
            showToast('삭제 중 오류가 발생했습니다', 'error');
        }
    }
}

function applyItemFilters(source) {
    const searchTerm = (searchInput?.value || '').toLowerCase();
    const category = filterCategory?.value || '';
    const organization = document.getElementById('filterOrganization')?.value || '';
    const condition = document.getElementById('filterCondition')?.value || '';
    const surveyor = document.getElementById('filterSurveyor')?.value || '';
    const locationTerm = (document.getElementById('filterLocation')?.value || '').toLowerCase().trim();
    const dateFrom = document.getElementById('filterDateFrom')?.value || '';
    const dateTo = document.getElementById('filterDateTo')?.value || '';

    return (source || getItemsForView()).filter((item) => {
        const haystack = [
            item.itemName, item.surveyor, item.manufacturer, item.model, item.notes,
            item.organization, item.location, item.assetNumber, item.building,
            item.floor, item.room, item.surveyName
        ].map((value) => String(value || '').toLowerCase()).join(' ');
        const matchesSearch = !searchTerm || haystack.includes(searchTerm);
        const matchesCategory = !category || item.category === category;
        const matchesOrganization = !organization || item.organization === organization;
        const matchesCondition = !condition || item.condition === condition;
        const matchesSurveyor = !surveyor || item.surveyor === surveyor;
        const locationText = [item.location, item.building, item.floor, item.room].filter(Boolean).join(' ').toLowerCase();
        const matchesLocation = !locationTerm || locationText.includes(locationTerm);
        const itemDate = typeof getSafeDate === 'function' ? getSafeDate(item.timestamp) : new Date(item.timestamp || 0);
        const matchesFrom = !dateFrom || itemDate >= new Date(`${dateFrom}T00:00:00`);
        const matchesTo = !dateTo || itemDate <= new Date(`${dateTo}T23:59:59`);
        return matchesSearch && matchesCategory && matchesOrganization && matchesCondition
            && matchesSurveyor && matchesLocation && matchesFrom && matchesTo;
    });
}

function filterItems(keepPage) {
    if (keepPage !== true) listPage = 1;
    lastFilteredItems = sortItems(applyItemFilters(getItemsForView()), currentSort);
    const totalPages = Math.max(1, Math.ceil(lastFilteredItems.length / ADMIN_PAGE_SIZE) || 1);
    if (listPage > totalPages) listPage = totalPages;
    const start = (listPage - 1) * ADMIN_PAGE_SIZE;
    displayItems(lastFilteredItems.slice(start, start + ADMIN_PAGE_SIZE));
    updateItemCount();
    updateListPagination();
}

// 정렬 함수
function sortItems(itemsToSort, sortType) {
    const sorted = [...itemsToSort];
    
    // Timestamp를 Date 객체로 안전하게 변환하는 헬퍼 함수
    const getTimestamp = (item) => {
        if (!item.timestamp) return new Date(0);
        
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
        
        // 그 외
        return new Date(0);
    };
    
    switch(sortType) {
        case 'newest':
            // 최신순: 최근 항목이 위로
            sorted.sort((a, b) => {
                const timeA = getTimestamp(a);
                const timeB = getTimestamp(b);
                return timeB - timeA;
            });
            break;
        case 'oldest':
            // 오래된 순: 오래된 항목이 위로
            sorted.sort((a, b) => {
                const timeA = getTimestamp(a);
                const timeB = getTimestamp(b);
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

// 엑셀 다운로드 - 현재 페이지 (클라이언트 사이드)
function exportExcel() {
    const exportItems = getItemsForView();
    if (exportItems.length === 0) {
        showToast('다운로드할 데이터가 없습니다', 'error');
        return;
    }
    
    try {
        const worksheetData = exportItems.map(item => {
            const timestamp = typeof getSafeDate === 'function' ? getSafeDate(item.timestamp) : (item.timestamp?.toDate?.() || new Date());
            return {
                '조사회차': item.surveyName || '',
                '조사자': item.surveyor || '',
                '기관명': item.organization || '',
                '건물': item.building || '',
                '층': item.floor || '',
                '실/호': item.room || '',
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
        
        const surveyLabel = (typeof getCurrentSurvey === 'function' && getCurrentSurvey()?.name) || '선택회차';
        XLSX.writeFile(workbook, `물품조사_${surveyLabel}_${new Date().toISOString().split('T')[0]}.xlsx`);
        showToast('엑셀 파일이 다운로드되었습니다', 'success');
    } catch (error) {
        console.error('다운로드 오류:', error);
        showToast('다운로드 중 오류가 발생했습니다', 'error');
    }
}

// 엑셀 다운로드 - 전체 데이터 (배치 처리)
async function exportExcelAll() {
    // 관리자 권한 확인
    if (currentUserRole !== 'admin') {
        showToast('관리자만 전체 데이터를 다운로드할 수 있습니다', 'error');
        return;
    }
    
    // 데이터 개수 확인 및 경고
    const estimatedCount = totalItemCount > 0 ? totalItemCount : items.length;
    if (estimatedCount === 0) {
        showToast('다운로드할 데이터가 없습니다', 'error');
        return;
    }
    
    // 대용량 데이터 경고
    if (estimatedCount > 10000) {
        const confirmed = confirm(
            `⚠️ 주의: 전체 데이터가 ${estimatedCount.toLocaleString()}건 이상입니다.\n\n` +
            `다운로드에 시간이 오래 걸리고 Firebase 읽기 비용이 발생합니다.\n\n` +
            `계속하시겠습니까?`
        );
        if (!confirmed) return;
    } else if (estimatedCount > 1000) {
        const confirmed = confirm(
            `전체 데이터 ${estimatedCount.toLocaleString()}건을 다운로드합니다.\n\n` +
            `시간이 걸릴 수 있습니다. 계속하시겠습니까?`
        );
        if (!confirmed) return;
    }
    
    // 프로그레스 모달 표시
    const progressModal = document.getElementById('progressModal');
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    const progressMessage = document.getElementById('progressMessage');
    
    progressModal.style.display = 'flex';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressMessage.textContent = '데이터를 가져오는 중...';
    
    try {
        const BATCH_SIZE = 500; // 500건씩 로드
        let allItems = [];
        let lastDoc = null;
        let loadedCount = 0;
        let batchCount = 0;
        
        console.log('🔄 전체 데이터 다운로드 시작...');
        
        // 배치 단위로 데이터 로드
        do {
            batchCount++;
            let query = db.collection('items')
                .orderBy('timestamp', 'desc')
                .limit(BATCH_SIZE);
            
            if (lastDoc) {
                query = query.startAfter(lastDoc);
            }
            
            const snapshot = await query.get();
            
            if (snapshot.empty) break;
            
            // 문서 데이터 추출
            const batchItems = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    surveyId: data.surveyId,
                    surveyName: data.surveyName,
                    surveyor: data.surveyor,
                    organization: data.organization,
                    building: data.building,
                    floor: data.floor,
                    room: data.room,
                    location: data.location,
                    itemName: data.itemName,
                    assetNumber: data.assetNumber,
                    quantity: data.quantity,
                    category: data.category,
                    manufacturer: data.manufacturer,
                    model: data.model,
                    width: data.width,
                    height: data.height,
                    depth: data.depth,
                    color: data.color,
                    material: data.material,
                    condition: data.condition,
                    notes: data.notes,
                    timestamp: data.timestamp,
                    userEmail: data.userEmail,
                    userId: data.userId
                };
            });
            
            allItems = allItems.concat(batchItems);
            loadedCount += batchItems.length;
            
            // 프로그레스 업데이트
            const progress = estimatedCount > 0 
                ? Math.min(100, Math.floor((loadedCount / estimatedCount) * 100))
                : Math.floor((batchCount * BATCH_SIZE / 1000) * 50); // 예상치 없으면 임시 진행률
            
            progressBar.style.width = `${progress}%`;
            progressPercent.textContent = `${progress}%`;
            progressMessage.textContent = `데이터 로드 중... (${loadedCount.toLocaleString()}건)`;
            
            console.log(`📦 배치 ${batchCount}: ${batchItems.length}건 로드 (누적: ${loadedCount}건)`);
            
            // 다음 페이지를 위한 마지막 문서 저장
            lastDoc = snapshot.docs[snapshot.docs.length - 1];
            
            // 더 이상 데이터가 없으면 중단
            if (snapshot.docs.length < BATCH_SIZE) break;
            
        } while (lastDoc);
        
        console.log(`✅ 전체 데이터 로드 완료: ${allItems.length}건`);
        const scopedItems = typeof getVisibleItems === 'function' ? getVisibleItems(allItems) : allItems;
        
        // 프로그레스 메시지 업데이트
        progressMessage.textContent = '엑셀 파일 생성 중...';
        progressBar.style.width = '90%';
        progressPercent.textContent = '90%';
        
        // 엑셀 데이터 생성
        const worksheetData = scopedItems.map(item => {
            const timestamp = typeof getSafeDate === 'function' ? getSafeDate(item.timestamp) : (item.timestamp?.toDate?.() || new Date());
            return {
                '조사회차': item.surveyName || '',
                '조사자': item.surveyor || '',
                '기관명': item.organization || '',
                '건물': item.building || '',
                '층': item.floor || '',
                '실/호': item.room || '',
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
            { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
            { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 20 }, 
            { wch: 18 }, { wch: 20 }
        ];
        
        // 파일 다운로드
        progressBar.style.width = '100%';
        progressPercent.textContent = '100%';
        progressMessage.textContent = '다운로드 중...';
        
        XLSX.writeFile(workbook, `물품조사_전체_${scopedItems.length}건_${new Date().toISOString().split('T')[0]}.xlsx`);
        
        // 프로그레스 모달 닫기
        setTimeout(() => {
            progressModal.style.display = 'none';
        }, 500);
        
        showToast(`전체 데이터 ${scopedItems.length.toLocaleString()}건이 다운로드되었습니다`, 'success');
        console.log('✅ 엑셀 다운로드 완료');
        
    } catch (error) {
        console.error('❌ 전체 데이터 다운로드 오류:', error);
        console.error('오류 상세:', {
            code: error.code,
            message: error.message,
            name: error.name
        });
        progressModal.style.display = 'none';
        
        if (error.code === 'permission-denied') {
            showToast('권한이 없습니다. 관리자 권한을 확인해주세요.', 'error');
        } else if (error.code === 'unavailable') {
            showToast('네트워크 오류가 발생했습니다. 다시 시도해주세요.', 'error');
        } else if (error.code === 'failed-precondition') {
            showToast('Firestore 인덱스가 생성 중입니다. 잠시 후 다시 시도해주세요.', 'error');
            console.error('💡 인덱스 생성이 필요합니다. Firebase Console에서 인덱스 링크를 확인하세요.');
        } else if (error.message && error.message.includes('index')) {
            showToast('데이터베이스 인덱스 생성이 필요합니다. 관리자에게 문의하세요.', 'error');
            console.error('💡 인덱스 오류:', error.message);
        } else {
            showToast(`다운로드 중 오류가 발생했습니다: ${error.message || error.code || '알 수 없는 오류'}`, 'error');
        }
    }
}

// JSON 다운로드
function exportJson() {
    const exportItems = getItemsForView();
    if (exportItems.length === 0) {
        showToast('다운로드할 데이터가 없습니다', 'error');
        return;
    }
    
    try {
        const exportData = exportItems.map(item => {
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
                surveyName: row['조사회차'] || '',
                surveyor: row['조사자'] || '',
                organization: row['기관명'] || '',
                building: row['건물'] || '',
                floor: row['층'] || '',
                room: row['실/호'] || '',
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
        const writableSurvey = typeof getWritableSurvey === 'function' ? getWritableSurvey() : null;
        
        for (const item of importedItems) {
            const docRef = db.collection('items').doc();
            if (typeof applyItemLocationFields === 'function') {
                applyItemLocationFields(item);
            }
            batch.set(docRef, {
                ...item,
                userId: currentUser.uid,
                userEmail: currentUser.email,
                surveyId: item.surveyId || writableSurvey?.id || '',
                surveyName: item.surveyName || writableSurvey?.name || '',
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
        const viewItems = getItemsForView();
        const totalItems = viewItems.length;
        const goodCondition = viewItems.filter(item => 
            item.condition === '매우 좋음' || item.condition === '좋음'
        ).length;
        const needsAttention = viewItems.filter(item => 
            item.condition === '나쁨' || item.condition === '매우 나쁨'
        ).length;
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recentItems = viewItems.filter(item => {
            const itemDate = typeof getSafeDate === 'function' ? getSafeDate(item.timestamp) : (item.timestamp?.toDate?.() || new Date(0));
            return itemDate >= sevenDaysAgo;
        }).length;
        
        document.getElementById('totalItems').textContent = totalItems;
        document.getElementById('goodCondition').textContent = goodCondition;
        document.getElementById('needsAttention').textContent = needsAttention;
        document.getElementById('recentItems').textContent = recentItems;
        updateDashboardScope(viewItems.length);
        
        updateCategoryChart();
        updateNamedBreakdown('surveyorChart', viewItems, (item) => item.surveyor || '미지정');
        updateNamedBreakdown('locationChart', viewItems, (item) => item.location || composeLocation?.(item.building, item.floor, item.room, '') || '위치 없음');
        updateRecentItemsList();
        if (typeof refreshRegisterViews === 'function') refreshRegisterViews();
        
        dashboardLoading.style.display = 'none';
        dashboardContent.style.display = 'block';
    }, 120);
}

function updateDashboardScope(count) {
    const el = document.getElementById('dashboardScope');
    if (!el) return;
    const survey = typeof getCurrentSurvey === 'function' ? getCurrentSurvey() : null;
    let label = '전체 회차';
    if (typeof currentSurveyId !== 'undefined') {
        if (currentSurveyId === '__unassigned__') label = '미분류';
        else if (survey?.name) label = survey.name;
        else if (currentSurveyId && currentSurveyId !== '__all__') label = '선택한 회차';
    }
    const loading = currentUserRole === 'admin' && !adminFullLoadDone ? ' · 나머지 데이터를 불러오는 중' : '';
    el.textContent = `${label} ${count}건 기준${loading}`;
}

function updateNamedBreakdown(elementId, source, pickName) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const counts = {};
    source.forEach((item) => {
        const name = String(pickName(item) || '').trim() || '미지정';
        counts[name] = (counts[name] || 0) + 1;
    });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (!entries.length) {
        el.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">데이터가 없습니다</p>';
        return;
    }
    const maxCount = Math.max(...entries.map((entry) => entry[1]), 1);
    el.innerHTML = entries.map(([name, count]) => {
        const percentage = (count / maxCount) * 100;
        return `
            <div class="category-bar">
                <div class="category-name">${typeof escapeHtml === 'function' ? escapeHtml(name) : name}</div>
                <div class="category-bar-container">
                    <div class="category-bar-fill" style="width: ${percentage}%">${count}개</div>
                </div>
            </div>
        `;
    }).join('');
}

// 카테고리별 차트 업데이트
function updateCategoryChart() {
    const categoryCount = {};
    getItemsForView().forEach(item => {
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
    const recentItems = sortItems(getItemsForView(), 'newest').slice(0, 5);
    
    if (recentItems.length === 0) {
        recentItemsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">최근 추가된 물품이 없습니다</p>';
        return;
    }
    
    recentItemsList.innerHTML = recentItems.map(item => {
        const timestamp = typeof getSafeDate === 'function' ? getSafeDate(item.timestamp) : (item.timestamp?.toDate?.() || new Date());
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
// 🔄 데이터 마이그레이션 함수
// ===============================================

// userId가 없는 데이터에 userId 자동 추가 (관리자 전용)
async function migrateUserIds() {
    if (currentUserRole !== 'admin') {
        showToast('관리자만 사용할 수 있습니다', 'error');
        return;
    }
    
    const progressDiv = document.getElementById('migrationProgress');
    const statusDiv = document.getElementById('migrationStatus');
    const progressBar = document.getElementById('migrationProgressBar');
    const startBtn = document.getElementById('startMigrationBtn');
    
    if (!confirm('데이터 마이그레이션을 시작하시겠습니까?\n\nuserEmail을 기준으로 userId를 자동으로 추가합니다.')) {
        return;
    }
    
    try {
        // UI 초기화
        statusDiv.style.display = 'block';
        startBtn.disabled = true;
        progressDiv.textContent = '데이터 조회 중...';
        progressBar.style.width = '0%';
        
        console.log('🔄 마이그레이션 시작...');
        
        // 1단계: userId가 없는 문서 조회
        const itemsWithoutUserId = await db.collection('items')
            .where('userId', '==', null)
            .get();
        
        // userId 필드가 아예 없는 경우도 찾기 위한 전체 조회
        const allItems = await db.collection('items').get();
        const itemsNeedingMigration = [];
        
        allItems.forEach((doc) => {
            const data = doc.data();
            if (!data.userId && data.userEmail) {
                itemsNeedingMigration.push({
                    id: doc.id,
                    email: data.userEmail,
                    data: data
                });
            }
        });
        
        const totalCount = itemsNeedingMigration.length;
        
        if (totalCount === 0) {
            progressDiv.textContent = '✅ 마이그레이션이 필요한 데이터가 없습니다';
            progressBar.style.width = '100%';
            showToast('모든 데이터에 userId가 있습니다', 'success');
            startBtn.disabled = false;
            return;
        }
        
        console.log(`📋 마이그레이션 대상: ${totalCount}개`);
        progressDiv.textContent = `총 ${totalCount}개 항목 발견. 사용자 매칭 중...`;
        
        // 2단계: users 컬렉션에서 이메일-userId 매핑 생성
        const usersSnapshot = await db.collection('users').get();
        const emailToUserIdMap = new Map();
        
        usersSnapshot.forEach((doc) => {
            const userData = doc.data();
            if (userData.email) {
                emailToUserIdMap.set(userData.email, doc.id);
            }
        });
        
        console.log(`👥 등록된 사용자: ${emailToUserIdMap.size}명`);
        
        // 3단계: 배치 업데이트 (500개씩)
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        const BATCH_SIZE = 500; // Firestore 배치 제한
        
        for (let i = 0; i < itemsNeedingMigration.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const batchItems = itemsNeedingMigration.slice(i, i + BATCH_SIZE);
            
            batchItems.forEach((item) => {
                const userId = emailToUserIdMap.get(item.email);
                
                if (userId) {
                    const docRef = db.collection('items').doc(item.id);
                    batch.update(docRef, {
                        userId: userId,
                        migratedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    updatedCount++;
                } else {
                    console.warn(`⚠️ 사용자를 찾을 수 없음: ${item.email}`);
                    skippedCount++;
                }
            });
            
            // 배치 커밋
            try {
                await batch.commit();
                
                // 진행률 업데이트
                const progress = Math.min(100, Math.floor(((i + batchItems.length) / totalCount) * 100));
                progressBar.style.width = `${progress}%`;
                progressDiv.textContent = `진행 중... ${i + batchItems.length}/${totalCount} (${progress}%)`;
                
                console.log(`✅ 배치 ${Math.floor(i / BATCH_SIZE) + 1} 완료: ${batchItems.length}개 업데이트`);
            } catch (error) {
                console.error(`❌ 배치 오류:`, error);
                errorCount += batchItems.length;
            }
        }
        
        // 완료 메시지
        progressBar.style.width = '100%';
        progressDiv.innerHTML = `
            <strong>✅ 마이그레이션 완료!</strong><br>
            <span style="font-size: 13px; margin-top: 4px; display: block;">
                • 업데이트: ${updatedCount}개<br>
                • 건너뜀: ${skippedCount}개 (사용자 없음)<br>
                ${errorCount > 0 ? `• 오류: ${errorCount}개<br>` : ''}
            </span>
        `;
        
        showToast(`마이그레이션 완료: ${updatedCount}개 업데이트`, 'success');
        console.log('🎉 마이그레이션 완료!', { updatedCount, skippedCount, errorCount });
        
        // 데이터 새로고침
        if (updatedCount > 0) {
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        }
        
    } catch (error) {
        console.error('❌ 마이그레이션 오류:', error);
        progressDiv.innerHTML = `<strong>❌ 오류 발생:</strong> ${error.message}`;
        showToast('마이그레이션 중 오류가 발생했습니다', 'error');
    } finally {
        startBtn.disabled = false;
    }
}

// ===============================================
// 📄 페이지네이션 함수 (관리자 전용)
// ===============================================

function updateListPagination() {
    const total = lastFilteredItems.length;
    const totalPages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE) || 1);
    hasMorePages = listPage < totalPages;
    currentPage = listPage;
    const paginationDiv = document.getElementById('paginationControls');
    if (paginationDiv) {
        paginationDiv.style.display = total > ADMIN_PAGE_SIZE ? 'flex' : 'none';
    }
    const pageInfo = document.getElementById('pageInfo');
    if (pageInfo) {
        pageInfo.textContent = `${listPage} / ${totalPages}페이지 · ${total}건`;
    }
    const nextBtn = document.getElementById('nextPageBtn');
    const prevBtn = document.getElementById('prevPageBtn');
    if (nextBtn) nextBtn.disabled = !hasMorePages;
    if (prevBtn) prevBtn.disabled = listPage <= 1;
}

function loadNextPage() {
    const totalPages = Math.max(1, Math.ceil(lastFilteredItems.length / ADMIN_PAGE_SIZE) || 1);
    if (listPage >= totalPages) {
        showToast('마지막 페이지입니다', 'info');
        return;
    }
    listPage += 1;
    filterItems(true);
    document.getElementById('list')?.scrollIntoView({ behavior: 'smooth' });
}

function goToFirstPage() {
    listPage = 1;
    filterItems(true);
}

function updatePaginationUI() {
    updateListPagination();
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
window.toggleUserRole = toggleUserRole;
window.migrateUserIds = migrateUserIds;
window.loadNextPage = loadNextPage;
window.goToFirstPage = goToFirstPage;
