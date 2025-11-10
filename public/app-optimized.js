// Firebase 기반 물품 조사 시스템 - 최적화 버전

// 전역 상태
let items = [];
let currentUser = null;
let currentUserRole = 'user';
let currentEditId = null;
let unsubscribe = null;
let currentSort = 'newest';
let continuousMode = false;
let selectedFields = ['surveyor', 'organization', 'location', 'itemName', 'assetNumber', 'quantity'];
let organizations = [];
let currentOrganization = '';

// 캐시 설정
const CACHE_KEY = 'items_cache';
const CACHE_TIMESTAMP_KEY = 'items_cache_timestamp';
const CACHE_DURATION = 5 * 60 * 1000; // 5분

// Firebase 오프라인 지속성 활성화 (중요!)
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
        await initUserRole();
        
        const roleEmoji = currentUserRole === 'admin' ? '👑' : '👤';
        const roleText = currentUserRole === 'admin' ? ' (관리자)' : '';
        userName.textContent = `${roleEmoji} ${user.displayName || user.email}${roleText}`;
        
        initApp();
    } else {
        window.location.href = 'login.html';
    }
});

// 사용자 역할 초기화
async function initUserRole() {
    try {
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        
        if (userDoc.exists) {
            currentUserRole = userDoc.data().role || 'user';
        } else {
            const usersSnapshot = await db.collection('users').limit(1).get();
            const isFirstUser = usersSnapshot.empty;
            currentUserRole = isFirstUser ? 'admin' : 'user';
            
            await db.collection('users').doc(currentUser.uid).set({
                email: currentUser.email,
                displayName: currentUser.displayName || currentUser.email,
                role: currentUserRole,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            if (isFirstUser) {
                showToast('첫 번째 사용자로 관리자 권한이 부여되었습니다', 'success');
            }
        }
    } catch (error) {
        console.error('사용자 역할 초기화 오류:', error);
        currentUserRole = 'user';
    }
}

// 로그아웃
logoutBtn.addEventListener('click', async () => {
    if (confirm('로그아웃 하시겠습니까?')) {
        try {
            await auth.signOut();
            window.location.href = 'login.html';
        } catch (error) {
            console.error('로그아웃 오류:', error);
            showToast('로그아웃에 실패했습니다', 'error');
        }
    }
});

// 앱 초기화
function initApp() {
    initDarkMode();
    initOrganizations();
    initTabs();
    initEventListeners();
    initRoleBasedUI();
    
    // 최적화: 캐시에서 먼저 로드
    loadItemsFromCache();
    
    // 그 다음 실시간 리스너 시작
    loadItemsOptimized();
    
    document.getElementById('surveyor').value = currentUser.displayName || '';
}

// 역할별 UI 초기화
function initRoleBasedUI() {
    const userManagementSection = document.getElementById('userManagementSection');
    const dangerZoneSection = document.getElementById('dangerZoneSection');
    
    if (currentUserRole === 'admin') {
        if (userManagementSection) userManagementSection.style.display = 'block';
        if (dangerZoneSection) dangerZoneSection.style.display = 'block';
    } else {
        if (userManagementSection) userManagementSection.style.display = 'none';
        if (dangerZoneSection) dangerZoneSection.style.display = 'none';
    }
}

// ============================================
// 🚀 최적화된 데이터 로드 함수
// ============================================

// 캐시에서 데이터 로드 (즉시 표시)
function loadItemsFromCache() {
    try {
        const cachedData = localStorage.getItem(CACHE_KEY);
        const cacheTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
        
        if (cachedData && cacheTimestamp) {
            const now = Date.now();
            const cacheAge = now - parseInt(cacheTimestamp);
            
            // 캐시가 유효하면 사용
            if (cacheAge < CACHE_DURATION) {
                items = JSON.parse(cachedData);
                displayItems(items);
                updateItemCount();
                console.log('✅ 캐시에서 데이터 로드 (Firebase 읽기 0회)');
                return true;
            }
        }
    } catch (error) {
        console.error('캐시 로드 오류:', error);
    }
    return false;
}

// 캐시에 데이터 저장
function saveItemsToCache(itemsData) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(itemsData));
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (error) {
        console.error('캐시 저장 오류:', error);
    }
}

// 최적화된 데이터 로드 (변경된 문서만 처리)
function loadItemsOptimized() {
    if (unsubscribe) {
        unsubscribe();
    }
    
    const listLoading = document.getElementById('listLoading');
    if (listLoading) {
        listLoading.style.display = 'block';
    }
    
    // 🔥 핵심 최적화: docChanges()로 변경된 문서만 처리
    unsubscribe = db.collection('items')
        .orderBy('timestamp', 'desc')
        .onSnapshot((snapshot) => {
            // 초기 로드인지 확인
            const isInitialLoad = items.length === 0;
            
            if (isInitialLoad) {
                // 초기 로드: 모든 문서
                items = [];
                snapshot.forEach((doc) => {
                    items.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
                console.log(`📥 초기 로드: ${items.length}개 문서 (읽기 ${items.length}회)`);
            } else {
                // 🚀 변경사항만 처리 (읽기 최소화)
                snapshot.docChanges().forEach((change) => {
                    const docData = { id: change.doc.id, ...change.doc.data() };
                    
                    if (change.type === 'added') {
                        // 이미 있는지 확인 (중복 방지)
                        if (!items.find(item => item.id === docData.id)) {
                            items.unshift(docData);
                            console.log('➕ 문서 추가 (읽기 1회)');
                        }
                    } else if (change.type === 'modified') {
                        const index = items.findIndex(item => item.id === docData.id);
                        if (index !== -1) {
                            items[index] = docData;
                            console.log('✏️ 문서 수정 (읽기 1회)');
                        }
                    } else if (change.type === 'removed') {
                        items = items.filter(item => item.id !== docData.id);
                        console.log('🗑️ 문서 삭제 (읽기 1회)');
                    }
                });
            }
            
            // 캐시 저장
            saveItemsToCache(items);
            
            if (listLoading) listLoading.style.display = 'none';
            
            displayItems(items);
            updateItemCount();
            updateDashboard();
        }, (error) => {
            console.error('데이터 로드 오류:', error);
            if (listLoading) listLoading.style.display = 'none';
            showToast('데이터를 불러오는데 실패했습니다', 'error');
        });
}

// 수동 새로고침 함수 (필요시에만 사용)
async function manualRefresh() {
    const listLoading = document.getElementById('listLoading');
    if (listLoading) listLoading.style.display = 'block';
    
    try {
        const snapshot = await db.collection('items')
            .orderBy('timestamp', 'desc')
            .get({ source: 'server' }); // 강제로 서버에서 가져오기
        
        items = [];
        snapshot.forEach((doc) => {
            items.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        saveItemsToCache(items);
        displayItems(items);
        updateItemCount();
        updateDashboard();
        
        showToast('데이터를 새로고침했습니다', 'success');
        console.log(`🔄 수동 새로고침: ${items.length}개 문서 (읽기 ${items.length}회)`);
    } catch (error) {
        console.error('새로고침 오류:', error);
        showToast('새로고침에 실패했습니다', 'error');
    } finally {
        if (listLoading) listLoading.style.display = 'none';
    }
}

// ============================================
// 나머지 함수들은 기존 코드와 동일
// ============================================

// [이하 기존 코드의 모든 함수들을 그대로 포함...]

