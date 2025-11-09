# 🔥 Firebase 설정 가이드

Firebase를 사용하려면 먼저 Firebase 프로젝트를 생성하고 설정해야 합니다.

## 1단계: Firebase 프로젝트 생성

1. **Firebase Console 접속**
   - https://console.firebase.google.com/ 접속
   - 구글 계정으로 로그인

2. **새 프로젝트 생성**
   - "프로젝트 추가" 클릭
   - 프로젝트 이름: "물품조사시스템" (원하는 이름)
   - Google Analytics: 선택사항 (나중에 추가 가능)
   - "프로젝트 만들기" 클릭

## 2단계: 웹 앱 추가

1. **웹 앱 등록**
   - Firebase 프로젝트 개요 페이지에서
   - 웹 아이콘 (</>) 클릭
   - 앱 닉네임: "물품조사앱"
   - Firebase Hosting 설정: 선택사항
   - "앱 등록" 클릭

2. **Firebase SDK 구성 코드 복사**
   - 표시되는 `firebaseConfig` 코드를 복사하세요
   - 아래와 같은 형식입니다:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```

**⚠️ 주의:** Firebase Console에서 코드를 복사할 때 `import` 문이 포함된 코드는 **무시하세요**!
우리는 Compat 버전을 사용하므로 **위의 `firebaseConfig` 객체만** 복사하면 됩니다.


## 3단계: Authentication 활성화

1. **Authentication 설정**
   - 왼쪽 메뉴에서 "Authentication" 클릭
   - "시작하기" 클릭
   
2. **로그인 방법 설정**
   - "Sign-in method" 탭 클릭
   - "이메일/비밀번호" 선택
   - "사용 설정" 토글 ON
   - "저장" 클릭

## 4단계: Firestore Database 생성

1. **Firestore 생성**
   - 왼쪽 메뉴에서 "Firestore Database" 클릭
   - "데이터베이스 만들기" 클릭
   
2. **보안 규칙 선택**
   - "테스트 모드에서 시작" 선택 (나중에 변경)
   - "다음" 클릭
   
3. **Cloud Firestore 위치 선택**
   - 위치: "asia-northeast3 (서울)" 권장
   - "사용 설정" 클릭

## 5단계: Firebase 구성 정보 입력

1. **config 파일 열기**
   - 프로젝트의 `public/firebase-config.js` 파일 열기

2. **Firebase 구성 정보 입력**
   - 2단계에서 복사한 `firebaseConfig` 정보를 붙여넣기
   - 파일 저장

```javascript
// public/firebase-config.js 예시
const firebaseConfig = {
  apiKey: "여기에_본인의_API_키",
  authDomain: "여기에_본인의_도메인",
  projectId: "여기에_본인의_프로젝트_ID",
  storageBucket: "여기에_본인의_스토리지",
  messagingSenderId: "여기에_본인의_ID",
  appId: "여기에_본인의_앱_ID"
};
```

## 6단계: Firestore 보안 규칙 설정

1. **Firebase Console에서 Firestore 보안 규칙 설정**
   - Firestore Database → 규칙 탭
   - 아래 규칙을 복사하여 붙여넣기:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 사용자 문서 - 본인만 읽기/쓰기
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // 물품 문서 - 로그인한 사용자는 모두 읽기, 작성자만 수정/삭제
    match /items/{itemId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && 
        resource.data.userId == request.auth.uid;
    }
  }
}
```

2. **게시** 버튼 클릭

## 7단계: 완료! 🎉

이제 애플리케이션을 실행할 준비가 되었습니다.

```bash
npm start
```

브라우저에서 http://localhost:3000 접속하여 회원가입/로그인을 시도하세요!

## 📱 모바일에서 접속

같은 Wi-Fi 네트워크:
```
http://[PC의IP주소]:3000
```

## 🔒 보안 참고사항

- API 키는 공개되어도 괜찮습니다 (Firebase 보안 규칙으로 보호됨)
- 하지만 GitHub 등에 올릴 때는 `.gitignore`에 추가하는 것을 권장
- 운영 환경에서는 보안 규칙을 더 강화하세요

## 💰 비용

**무료 할당량 (Spark Plan):**
- Firestore 읽기: 50,000회/일
- Firestore 쓰기: 20,000회/일
- Firestore 삭제: 20,000회/일
- 저장소: 1GB
- 네트워크: 10GB/월

물품 조사 시스템 기준으로 소규모~중규모 팀은 완전 무료입니다!

## ❓ 문제 해결

### Firebase가 작동하지 않는 경우:
1. `firebase-config.js`의 설정값이 올바른지 확인
2. Firebase Console에서 Authentication이 활성화되었는지 확인
3. Firestore Database가 생성되었는지 확인
4. 브라우저 콘솔(F12)에서 에러 메시지 확인

### 도움이 필요한 경우:
- Firebase 공식 문서: https://firebase.google.com/docs
- 한국어 가이드: https://firebase.google.com/docs?hl=ko

