# Firebase 읽기 최적화 가이드 📊

## 🚨 문제 상황
- **현재 사용량**: 31만 회/일
- **무료 한도**: 5만 회/일
- **초과량**: **약 6.2배 초과** ⚠️

---

## 📋 문제 원인 분석

### 1. 실시간 리스너 (onSnapshot) 과다 사용
```javascript
// ❌ 문제 코드
db.collection('items')
    .onSnapshot((snapshot) => {
        items = [];
        snapshot.forEach((doc) => {  // 매번 모든 문서를 읽음
            items.push({...});
        });
    });
```

**문제점:**
- 페이지 로드마다 전체 컬렉션 읽기
- 물품 100개 × 사용자 10명 × 페이지 새로고침 30회/일 = **30,000회**
- 데이터 변경 시마다 추가 읽기 발생

---

## ✅ 최적화 솔루션

### 🎯 솔루션 1: 변경된 문서만 처리 (가장 중요!)

```javascript
// ✅ 최적화된 코드
db.collection('items')
    .onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                items.unshift({ id: change.doc.id, ...change.doc.data() });
            } else if (change.type === 'modified') {
                const index = items.findIndex(item => item.id === change.doc.id);
                items[index] = { id: change.doc.id, ...change.doc.data() };
            } else if (change.type === 'removed') {
                items = items.filter(item => item.id !== change.doc.id);
            }
        });
    });
```

**효과:**
- 초기 로드: 100회 읽기
- 이후 변경: 변경된 문서만 (1~10회)
- **절감률: 90% 이상** 🎉

---

### 🎯 솔루션 2: Firebase 오프라인 지속성 활성화

```javascript
// 캐싱 활성화 (app.js 상단에 추가)
db.enablePersistence({ synchronizeTabs: true })
    .catch((err) => {
        console.warn('오프라인 지속성 활성화 실패:', err);
    });
```

**효과:**
- 같은 브라우저에서 재방문 시 캐시 사용
- Firebase 서버에 요청하지 않음
- **읽기 횟수: 0회** 🎉

---

### 🎯 솔루션 3: LocalStorage 캐싱

```javascript
// 캐시 설정
const CACHE_DURATION = 5 * 60 * 1000; // 5분

function loadItemsFromCache() {
    const cachedData = localStorage.getItem('items_cache');
    const cacheTimestamp = localStorage.getItem('items_cache_timestamp');
    
    if (cachedData && Date.now() - cacheTimestamp < CACHE_DURATION) {
        items = JSON.parse(cachedData);
        displayItems(items);
        return true; // 캐시에서 로드 성공
    }
    return false;
}

function saveItemsToCache(itemsData) {
    localStorage.setItem('items_cache', JSON.stringify(itemsData));
    localStorage.setItem('items_cache_timestamp', Date.now().toString());
}
```

**효과:**
- 5분 이내 재방문 시 캐시 사용
- 페이지 새로고침 시 Firebase 읽기 0회
- **절감률: 70~80%** 🎉

---

### 🎯 솔루션 4: 페이지네이션 (선택사항)

```javascript
// 한 번에 20개씩만 로드
const PAGE_SIZE = 20;
let lastVisible = null;

function loadItemsPaginated() {
    let query = db.collection('items')
        .orderBy('timestamp', 'desc')
        .limit(PAGE_SIZE);
    
    if (lastVisible) {
        query = query.startAfter(lastVisible);
    }
    
    query.get().then((snapshot) => {
        lastVisible = snapshot.docs[snapshot.docs.length - 1];
        // 처리...
    });
}
```

**효과:**
- 초기 로드: 20회 (100회 → 20회)
- **절감률: 80%** 🎉

---

## 🔧 적용 방법

### 방법 1: 기존 코드 수정 (권장)

`app.js`의 `loadItems()` 함수를 다음과 같이 수정하세요:

```javascript
// Firestore에서 물품 목록 실시간 로드
function loadItems() {
    if (unsubscribe) {
        unsubscribe();
    }
    
    const listLoading = document.getElementById('listLoading');
    if (listLoading) {
        listLoading.style.display = 'block';
        itemList.innerHTML = '';
    }
    
    // 🔥 핵심 수정: docChanges() 사용
    unsubscribe = db.collection('items')
        .orderBy('timestamp', 'desc')
        .onSnapshot((snapshot) => {
            const isInitialLoad = items.length === 0;
            
            if (isInitialLoad) {
                // 초기 로드만 전체 읽기
                items = [];
                snapshot.forEach((doc) => {
                    items.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
            } else {
                // 이후에는 변경사항만 처리
                snapshot.docChanges().forEach((change) => {
                    const docData = { id: change.doc.id, ...change.doc.data() };
                    
                    if (change.type === 'added') {
                        if (!items.find(item => item.id === docData.id)) {
                            items.unshift(docData);
                        }
                    } else if (change.type === 'modified') {
                        const index = items.findIndex(item => item.id === docData.id);
                        if (index !== -1) {
                            items[index] = docData;
                        }
                    } else if (change.type === 'removed') {
                        items = items.filter(item => item.id !== docData.id);
                    }
                });
            }
            
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
```

### 방법 2: 오프라인 지속성 활성화

`app.js` 상단 (Firebase 초기화 후)에 추가:

```javascript
// Firebase 오프라인 지속성 활성화
db.enablePersistence({ synchronizeTabs: true })
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            console.warn('여러 탭이 열려 있어 오프라인 지속성이 비활성화됩니다.');
        } else if (err.code == 'unimplemented') {
            console.warn('브라우저가 오프라인 지속성을 지원하지 않습니다.');
        }
    });
```

---

## 📊 예상 효과

| 항목 | 기존 | 최적화 후 | 절감률 |
|------|------|-----------|--------|
| 초기 로드 | 100회 | 100회 | 0% |
| 데이터 1개 추가 | 101회 | 1회 | **99%** ✅ |
| 페이지 새로고침 | 100회 | 0회 (캐시) | **100%** ✅ |
| 하루 총 읽기 | 310,000회 | ~10,000회 | **97%** ✅ |

**결과: 무료 한도 내 사용 가능! 🎉**

---

## ⚠️ 주의사항

1. **오프라인 지속성**: 브라우저당 한 번만 활성화 가능
2. **캐시 무효화**: 중요한 업데이트가 있으면 캐시 시간 단축
3. **IndexedDB 저장소**: 브라우저가 최대 50MB 정도 지원
4. **실시간성 vs 비용**: 실시간성이 중요하면 onSnapshot 유지, 비용 절감이 중요하면 get() 사용

---

## 🎯 최종 권장사항

### 즉시 적용 (필수)
1. ✅ **docChanges() 사용** - 97% 절감 효과
2. ✅ **enablePersistence() 활성화** - 추가 절감

### 추가 검토 (선택)
3. LocalStorage 캐싱 추가
4. 페이지네이션 구현 (물품이 1000개 이상일 때)

---

## 📞 추가 도움

Firebase 사용량 모니터링:
- Firebase Console → Firestore → Usage 탭에서 실시간 확인

궁금한 점이 있으면 언제든지 문의하세요!

