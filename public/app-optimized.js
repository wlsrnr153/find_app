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

// IndexedDB 설정
let indexedDB_instance = null;
const DB_NAME = 'ItemsSurveyDB';
const STORE_NAME = 'items';
const DB_VERSION = 1;

// 초기 로드 완료 플래그 (버그 수정용)
let initialLoadComplete = false;

// 디바운스 타이머
let cacheUpdateTimer = null;
const CACHE_UPDATE_DEBOUNCE = 2000; // 2초

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

// 앱 초기화 (async 지원)
async function initApp() {
    initDarkMode();
    initOrganizations();
    initTabs();
    initEventListeners();
    initRoleBasedUI();
    
    // 🚀 최적화: 캐시에서 먼저 로드 (즉시 표시)
    const cacheLoaded = await loadItemsFromCache();
    
    if (cacheLoaded) {
        console.log('✅ 캐시 데이터 표시 완료 - Firebase 동기화 시작');
    } else {
        console.log('ℹ️ 캐시 없음 - Firebase에서 전체 로드');
    }
    
    // 그 다음 실시간 리스너 시작 (항상 실행)
    loadItemsOptimized();
    
    // 조사자 이름 자동 설정
    const surveyorInput = document.getElementById('surveyor');
    if (surveyorInput && currentUser) {
        surveyorInput.value = currentUser.displayName || '';
    }
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

// IndexedDB 초기화
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        if (indexedDB_instance) {
            resolve(indexedDB_instance);
            return;
        }
        
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => {
            console.error('❌ IndexedDB 열기 실패:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            indexedDB_instance = request.result;
            console.log('✅ IndexedDB 연결 성공');
            resolve(indexedDB_instance);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            
            // 기존 스토어가 있으면 삭제
            if (database.objectStoreNames.contains(STORE_NAME)) {
                database.deleteObjectStore(STORE_NAME);
            }
            
            // 새 스토어 생성
            const objectStore = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
            objectStore.createIndex('timestamp', 'timestamp', { unique: false });
            
            console.log('✅ IndexedDB 스토어 생성 완료');
        };
    });
}

// 캐시에서 데이터 로드 (IndexedDB 우선, localStorage 폴백)
async function loadItemsFromCache() {
    try {
        const cacheTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
        
        if (!cacheTimestamp) {
            console.log('ℹ️ 캐시 타임스탬프 없음');
            return false;
        }
        
        const cacheAge = Date.now() - parseInt(cacheTimestamp);
        if (cacheAge >= CACHE_DURATION) {
            console.log('⏰ 캐시 만료됨 (경과 시간:', Math.floor(cacheAge / 1000), '초)');
            return false;
        }
        
        // 1순위: IndexedDB에서 로드 시도
        try {
            const database = await initIndexedDB();
            const transaction = database.transaction([STORE_NAME], 'readonly');
            const objectStore = transaction.objectStore(STORE_NAME);
            const request = objectStore.getAll();
            
            const cachedData = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            
            if (cachedData && cachedData.length > 0) {
                // Timestamp 복원 (Date → Firestore Timestamp 호환 객체)
                items = cachedData.map(item => ({
                    ...item,
                    timestamp: item.timestamp ? {
                        toDate: () => new Date(item.timestamp)
                    } : null
                }));
                
                // 함수가 정의된 경우에만 호출 (app.js 로드 후)
                if (typeof displayItems === 'function') {
                    displayItems(items);
                }
                if (typeof updateItemCount === 'function') {
                    updateItemCount();
                }
                console.log(`✅ IndexedDB에서 ${items.length}개 항목 로드 (Firebase 읽기 0회)`);
                return true;
            }
        } catch (indexedDBError) {
            console.warn('⚠️ IndexedDB 로드 실패, localStorage로 폴백:', indexedDBError);
            
            // 2순위: localStorage 폴백
            const cachedData = localStorage.getItem(CACHE_KEY);
            if (cachedData) {
                const parsedData = JSON.parse(cachedData);
                
                items = parsedData.map(item => ({
                    ...item,
                    timestamp: item.timestamp ? {
                        toDate: () => new Date(item.timestamp)
                    } : null
                }));
                
                // 함수가 정의된 경우에만 호출 (app.js 로드 후)
                if (typeof displayItems === 'function') {
                    displayItems(items);
                }
                if (typeof updateItemCount === 'function') {
                    updateItemCount();
                }
                console.log(`✅ localStorage에서 ${items.length}개 항목 로드 (Firebase 읽기 0회)`);
                return true;
            }
        }
    } catch (error) {
        console.error('❌ 캐시 로드 오류:', error);
        // 손상된 캐시 정리
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    }
    
    return false;
}

// 캐시에 데이터 저장 (IndexedDB 우선, localStorage 폴백)
async function saveItemsToCache(itemsData) {
    try {
        if (!itemsData || itemsData.length === 0) {
            console.log('ℹ️ 저장할 데이터 없음');
            return;
        }
        
        // Timestamp를 Date 객체로 변환
        const serializedData = itemsData.map(item => ({
            ...item,
            timestamp: item.timestamp?.toDate?.() instanceof Date 
                ? item.timestamp.toDate().toISOString()
                : (item.timestamp instanceof Date ? item.timestamp.toISOString() : item.timestamp),
            _cachedAt: new Date().toISOString()
        }));
        
        // 1순위: IndexedDB에 저장
        try {
            const database = await initIndexedDB();
            const transaction = database.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            
            // 기존 데이터 삭제
            objectStore.clear();
            
            // 새 데이터 저장
            for (const item of serializedData) {
                objectStore.add(item);
            }
            
            await new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
            
            console.log(`✅ IndexedDB에 ${serializedData.length}개 항목 저장 완료`);
        } catch (indexedDBError) {
            console.warn('⚠️ IndexedDB 저장 실패, localStorage로 폴백:', indexedDBError);
            
            // 2순위: localStorage 폴백
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(serializedData));
                console.log(`✅ localStorage에 ${serializedData.length}개 항목 저장 완료`);
            } catch (localStorageError) {
                if (localStorageError.name === 'QuotaExceededError') {
                    console.warn('⚠️ localStorage 용량 초과 - 캐시 정리');
                    localStorage.removeItem(CACHE_KEY);
                    
                    // 최근 50개만 저장 시도
                    const limitedData = serializedData.slice(0, 50);
                    localStorage.setItem(CACHE_KEY, JSON.stringify(limitedData));
                    console.log(`✅ localStorage에 최근 ${limitedData.length}개 항목만 저장`);
                } else {
                    throw localStorageError;
                }
            }
        }
        
        // 타임스탬프 저장 (공통)
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
        
    } catch (error) {
        console.error('❌ 캐시 저장 오류:', error);
    }
}

// 디바운스된 캐시 저장 (불필요한 저장 방지)
function debouncedSaveCache(itemsData) {
    if (cacheUpdateTimer) {
        clearTimeout(cacheUpdateTimer);
    }
    
    cacheUpdateTimer = setTimeout(() => {
        saveItemsToCache(itemsData);
    }, CACHE_UPDATE_DEBOUNCE);
}

// 최적화된 데이터 로드 (변경된 문서만 처리) - 버그 수정 버전
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
            // 🐛 버그 수정: 플래그 기반 초기 로드 판단 (items.length가 아님!)
            if (!initialLoadComplete) {
                // ✅ 초기 로드: 모든 문서 (캐시 여부와 무관하게 한 번만 실행)
                items = [];
                snapshot.forEach((doc) => {
                    items.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
                
                initialLoadComplete = true; // 플래그 설정
                console.log(`📥 초기 로드 완료: ${items.length}개 문서 (Firebase 읽기 ${items.length}회)`);
                console.log('✅ 이후로는 변경사항만 읽기 (최적화 모드 활성화)');
            } else {
                // 🚀 변경사항만 처리 (읽기 최소화!)
                let addedCount = 0, modifiedCount = 0, removedCount = 0;
                
                snapshot.docChanges().forEach((change) => {
                    const docData = { id: change.doc.id, ...change.doc.data() };
                    
                    if (change.type === 'added') {
                        // 중복 확인 후 추가
                        const existingIndex = items.findIndex(item => item.id === docData.id);
                        if (existingIndex === -1) {
                            items.unshift(docData);
                            addedCount++;
                        }
                    } else if (change.type === 'modified') {
                        const index = items.findIndex(item => item.id === docData.id);
                        if (index !== -1) {
                            items[index] = docData;
                            modifiedCount++;
                        }
                    } else if (change.type === 'removed') {
                        const beforeLength = items.length;
                        items = items.filter(item => item.id !== docData.id);
                        if (items.length < beforeLength) {
                            removedCount++;
                        }
                    }
                });
                
                const totalChanges = addedCount + modifiedCount + removedCount;
                if (totalChanges > 0) {
                    console.log(`🔄 변경 감지: ➕${addedCount} ✏️${modifiedCount} 🗑️${removedCount} (Firebase 읽기 ${totalChanges}회)`);
                }
            }
            
            // 🚀 디바운스된 캐시 저장 (불필요한 저장 방지)
            debouncedSaveCache(items);
            
            if (listLoading) listLoading.style.display = 'none';
            
            // 함수가 정의된 경우에만 호출 (app.js 로드 후)
            if (typeof displayItems === 'function') {
                displayItems(items);
            }
            if (typeof updateItemCount === 'function') {
                updateItemCount();
            }
            if (typeof updateDashboard === 'function') {
                updateDashboard();
            }
        }, (error) => {
            console.error('❌ 데이터 로드 오류:', error);
            if (listLoading) listLoading.style.display = 'none';
            if (typeof showToast === 'function') {
                showToast('데이터를 불러오는데 실패했습니다', 'error');
            }
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
        
        // 디바운스된 캐시 저장
        debouncedSaveCache(items);
        
        // 함수가 정의된 경우에만 호출 (app.js 로드 후)
        if (typeof displayItems === 'function') {
            displayItems(items);
        }
        if (typeof updateItemCount === 'function') {
            updateItemCount();
        }
        if (typeof updateDashboard === 'function') {
            updateDashboard();
        }
        if (typeof showToast === 'function') {
            showToast('데이터를 새로고침했습니다', 'success');
        }
        console.log(`🔄 수동 새로고침: ${items.length}개 문서 (Firebase 읽기 ${items.length}회)`);
    } catch (error) {
        console.error('❌ 새로고침 오류:', error);
        if (typeof showToast === 'function') {
            showToast('새로고침에 실패했습니다', 'error');
        }
    } finally {
        if (listLoading) listLoading.style.display = 'none';
    }
}

// 캐시 완전 삭제 함수 (디버깅/문제 해결용)
async function clearAllCache() {
    try {
        // localStorage 캐시 삭제
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TIMESTAMP_KEY);
        
        // IndexedDB 캐시 삭제
        if (indexedDB_instance) {
            const transaction = indexedDB_instance.transaction([STORE_NAME], 'readwrite');
            const objectStore = transaction.objectStore(STORE_NAME);
            objectStore.clear();
            
            await new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        }
        
        console.log('✅ 모든 캐시 삭제 완료');
        if (typeof showToast === 'function') {
            showToast('캐시가 삭제되었습니다', 'success');
        }
    } catch (error) {
        console.error('❌ 캐시 삭제 오류:', error);
    }
}

// ============================================
// 🔧 app.js에서 필요한 함수들
// ============================================
// 아래 함수들은 app.js에서 가져와야 합니다:
// - initDarkMode()
// - initOrganizations()
// - initTabs()
// - initEventListeners()
// - displayItems(items)
// - updateItemCount()
// - updateDashboard()
// - showToast(message, type)
//
// app-optimized.js는 캐시 로직만 담당하고,
// 실제 UI 함수들은 app.js에서 실행됩니다.
// ============================================


