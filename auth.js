// 인증 관련 스크립트

const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const loading = document.getElementById('loading');

// 탭 전환
document.querySelectorAll('.form-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        
        // 모든 탭 비활성화
        document.querySelectorAll('.form-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.form-content').forEach(c => c.classList.remove('active'));
        
        // 선택된 탭 활성화
        tab.classList.add('active');
        document.getElementById(tabName).classList.add('active');
        
        // 메시지 초기화
        hideMessages();
    });
});

// 로그인
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    showLoading();
    hideMessages();
    
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        console.log('로그인 성공:', userCredential.user);
        
        // 메인 페이지로 이동
        window.location.href = 'index.html';
    } catch (error) {
        console.error('로그인 오류:', error);
        showError(getErrorMessage(error.code));
        hideLoading();
    }
});

// 회원가입
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const passwordConfirm = document.getElementById('signupPasswordConfirm').value;
    
    // 비밀번호 확인
    if (password !== passwordConfirm) {
        showError('비밀번호가 일치하지 않습니다');
        return;
    }
    
    if (password.length < 6) {
        showError('비밀번호는 최소 6자 이상이어야 합니다');
        return;
    }
    
    showLoading();
    hideMessages();
    
    try {
        // 사용자 생성
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        // 프로필 업데이트
        await user.updateProfile({
            displayName: name
        });
        
        // Firestore에 사용자 정보 저장
        await db.collection('users').doc(user.uid).set({
            name: name,
            email: email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('회원가입 성공:', user);
        
        showSuccess('회원가입이 완료되었습니다! 로그인 페이지로 이동합니다...');
        
        // 2초 후 메인 페이지로 이동
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 2000);
        
    } catch (error) {
        console.error('회원가입 오류:', error);
        showError(getErrorMessage(error.code));
        hideLoading();
    }
});

// 비밀번호 재설정
document.getElementById('forgotPasswordLink').addEventListener('click', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    
    if (!email) {
        showError('이메일을 입력해주세요');
        return;
    }
    
    showLoading();
    hideMessages();
    
    try {
        await auth.sendPasswordResetEmail(email);
        showSuccess('비밀번호 재설정 이메일을 발송했습니다. 이메일을 확인해주세요.');
        hideLoading();
    } catch (error) {
        console.error('비밀번호 재설정 오류:', error);
        showError(getErrorMessage(error.code));
        hideLoading();
    }
});

// 에러 메시지 표시
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add('show');
}

// 성공 메시지 표시
function showSuccess(message) {
    successMessage.textContent = message;
    successMessage.classList.add('show');
}

// 메시지 숨기기
function hideMessages() {
    errorMessage.classList.remove('show');
    successMessage.classList.remove('show');
}

// 로딩 표시
function showLoading() {
    loading.classList.add('show');
    document.querySelectorAll('.login-btn').forEach(btn => btn.disabled = true);
}

// 로딩 숨기기
function hideLoading() {
    loading.classList.remove('show');
    document.querySelectorAll('.login-btn').forEach(btn => btn.disabled = false);
}

// Firebase 에러 코드를 한국어 메시지로 변환
function getErrorMessage(errorCode) {
    const errorMessages = {
        'auth/email-already-in-use': '이미 사용 중인 이메일입니다',
        'auth/invalid-email': '올바른 이메일 형식이 아닙니다',
        'auth/operation-not-allowed': '이메일/비밀번호 로그인이 비활성화되어 있습니다',
        'auth/weak-password': '비밀번호가 너무 약합니다 (최소 6자)',
        'auth/user-disabled': '비활성화된 계정입니다',
        'auth/user-not-found': '존재하지 않는 계정입니다',
        'auth/wrong-password': '비밀번호가 올바르지 않습니다',
        'auth/too-many-requests': '너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요',
        'auth/network-request-failed': '네트워크 오류가 발생했습니다',
        'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다'
    };
    
    return errorMessages[errorCode] || `오류가 발생했습니다: ${errorCode}`;
}

// Firebase 설정 확인
window.addEventListener('load', () => {
    try {
        if (!firebase.apps.length) {
            console.error('Firebase가 초기화되지 않았습니다. firebase-config.js를 확인하세요.');
            showError('Firebase 설정이 필요합니다. FIREBASE_SETUP.md 가이드를 참고하세요.');
        }
    } catch (error) {
        console.error('Firebase 초기화 오류:', error);
        showError('Firebase 설정을 확인해주세요.');
    }
});

