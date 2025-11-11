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

// ⚠️ 주의: app-optimized.js는 순수하게 캐시 관련 함수만 제공합니다
// DOM 선택, 인증, 초기화 등은 모두 app.js에서 처리됩니다

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

// ⚠️ loadItemsOptimized()와 manualRefresh()는 app.js의 loadItems()로 통합되었습니다
// app-optimized.js는 순수하게 캐시 관련 함수만 제공합니다

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
// ✅ app-optimized.js 역할
// ============================================
// 이 파일은 순수하게 IndexedDB 캐싱 시스템만 제공합니다.
// 
// 제공하는 함수:
// - initIndexedDB(): IndexedDB 초기화
// - loadItemsFromCache(): 캐시에서 데이터 로드
// - saveItemsToCache(): 캐시에 데이터 저장
// - debouncedSaveCache(): 디바운스된 캐시 저장
// - clearAllCache(): 모든 캐시 삭제
//
// app.js에서 다음과 같이 사용:
// 1. initApp()에서 loadItemsFromCache() 호출
// 2. loadItems()에서 debouncedSaveCache() 호출
// ============================================
