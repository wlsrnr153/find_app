// Firebase 기반 물품 조사 시스템

// 전역 상태
let items = [];
let currentUser = null;
let currentEditId = null;
let unsubscribe = null;
let currentSort = 'newest';

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
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        userName.textContent = `👤 ${user.displayName || user.email}`;
        initApp();
    } else {
        // 로그인 페이지로 리다이렉트
        window.location.href = 'login.html';
    }
});

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
    initTabs();
    initEventListeners();
    loadItems();
    
    // 조사자 이름 자동완성 (사용자 이름으로)
    document.getElementById('surveyor').value = currentUser.displayName || '';
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
        loadItems();
    }
}

// 이벤트 리스너 초기화
function initEventListeners() {
    // 물품 추가 폼
    itemForm.addEventListener('submit', handleAddItem);
    document.getElementById('resetBtn').addEventListener('click', () => {
        itemForm.reset();
        document.getElementById('surveyor').value = currentUser.displayName || '';
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
    
    // 모달 외부 클릭 시 닫기
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) {
            closeEditModal();
        }
    });
}

// Firestore에서 물품 목록 실시간 로드
function loadItems() {
    // 이전 리스너 해제
    if (unsubscribe) {
        unsubscribe();
    }
    
    // 로딩 표시
    const listLoading = document.getElementById('listLoading');
    if (listLoading) {
        listLoading.style.display = 'block';
        itemList.innerHTML = '';
    }
    
    // 실시간 리스너 등록
    unsubscribe = db.collection('items')
        .orderBy('timestamp', 'desc')
        .onSnapshot((snapshot) => {
            items = [];
            snapshot.forEach((doc) => {
                items.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            
            // 로딩 숨기기
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

// 물품 목록 표시
function displayItems(itemsToShow) {
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
        const isOwner = item.userId === currentUser.uid;
        const timestamp = item.timestamp ? item.timestamp.toDate() : new Date();
        
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
                </div>
                <div class="item-actions">
                    ${isOwner ? `
                        <button class="btn btn-secondary btn-small" onclick="openEditModal('${item.id}')">✏️ 수정</button>
                        <button class="btn btn-danger btn-small" onclick="deleteItem('${item.id}')">🗑️ 삭제</button>
                    ` : `
                        <span style="font-size: 12px; color: var(--gray-600);">읽기 전용</span>
                    `}
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// 물품 수 업데이트
function updateItemCount() {
    itemCount.textContent = `총 ${items.length}개 물품`;
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
    
    try {
        await db.collection('items').add(data);
        showToast('물품이 등록되었습니다', 'success');
        itemForm.reset();
        document.getElementById('surveyor').value = currentUser.displayName || '';
    } catch (error) {
        console.error('등록 오류:', error);
        showToast('등록 중 오류가 발생했습니다', 'error');
    }
}

// 수정 모달 열기
function openEditModal(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    
    // 권한 확인
    if (item.userId !== currentUser.uid) {
        showToast('본인이 작성한 물품만 수정할 수 있습니다', 'error');
        return;
    }
    
    currentEditId = id;
    
    // 폼에 데이터 채우기
    document.getElementById('editId').value = item.id;
    document.getElementById('editSurveyor').value = item.surveyor || '';
    document.getElementById('editItemName').value = item.itemName || '';
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
    
    // 권한 확인
    if (item.userId !== currentUser.uid) {
        showToast('본인이 작성한 물품만 삭제할 수 있습니다', 'error');
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
                '물품명': item.itemName || '',
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
                itemName: row['물품명'] || '',
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
    const confirmed = confirm('⚠️ 본인이 작성한 모든 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.');
    
    if (!confirmed) return;
    
    const doubleConfirm = confirm('정말로 삭제하시겠습니까? 다시 한 번 확인합니다.');
    
    if (!doubleConfirm) return;
    
    try {
        const myItems = items.filter(item => item.userId === currentUser.uid);
        
        if (myItems.length === 0) {
            showToast('삭제할 데이터가 없습니다', 'error');
            return;
        }
        
        const batch = db.batch();
        myItems.forEach(item => {
            batch.delete(db.collection('items').doc(item.id));
        });
        
        await batch.commit();
        showToast(`${myItems.length}개 항목이 삭제되었습니다`, 'success');
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
        // 통계 계산
        const totalItems = items.length;
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

// 전역 함수로 노출
window.openEditModal = openEditModal;
window.deleteItem = deleteItem;
window.switchTab = switchTab;
