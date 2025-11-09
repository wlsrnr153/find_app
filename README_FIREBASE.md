# 🔥 Firebase 기반 물품 조사 시스템

스마트폰과 PC에서 사용 가능한 **실시간 동기화** 물품 조사 웹 애플리케이션입니다.

## ✨ 주요 기능

### 🔐 사용자 인증
- 이메일/비밀번호 기반 회원가입 및 로그인
- 비밀번호 재설정 기능
- 사용자별 데이터 관리

### 📱 모바일 최적화
- 스마트폰에서 편리한 물품 정보 입력
- 반응형 디자인으로 모든 기기 지원
- 터치 친화적인 인터페이스

### 📝 물품 관리
- 물품명, 제조사, 모델명, 치수 등 상세 정보 입력
- 카테고리별 분류 (가구, 전자제품, 사무용품 등)
- 실시간 검색 및 필터링

### 👥 다중 사용자 지원
- 여러 명이 동시에 조사 가능
- 실시간 데이터 동기화 (Firebase Firestore)
- 사용자별 권한 관리 (본인 데이터만 수정/삭제)

### 📊 데이터 관리
- **엑셀 내보내기**: 조사 데이터를 엑셀 파일로 다운로드
- **JSON 내보내기**: JSON 형식으로 백업
- **데이터 가져오기**: 엑셀/JSON 파일 업로드
- 클라우드 자동 백업

## 🚀 설치 및 실행

### ⚠️ 중요: Firebase 설정이 필수입니다!

이 애플리케이션은 Firebase를 사용하므로, 먼저 Firebase 프로젝트를 생성해야 합니다.

### 1단계: Firebase 프로젝트 설정

**📖 [FIREBASE_SETUP.md](FIREBASE_SETUP.md) 가이드를 먼저 읽고 따라하세요!**

주요 단계:
1. Firebase Console에서 프로젝트 생성
2. Authentication 활성화 (이메일/비밀번호)
3. Firestore Database 생성
4. Firebase 구성 정보를 `public/firebase-config.js`에 입력
5. Firestore 보안 규칙 설정

### 2단계: 로컬 서버 실행

Firebase 설정이 완료되면 간단한 웹 서버만 실행하면 됩니다:

**방법 1: Python 사용 (Python 3 설치되어 있는 경우)**
```bash
cd "C:\Users\bb\Desktop\find app\public"
python -m http.server 3000
```

**방법 2: Node.js 사용**
```bash
npm install -g http-server
cd "C:\Users\bb\Desktop\find app\public"
http-server -p 3000
```

**방법 3: VS Code Live Server 확장**
- VS Code에서 `public/login.html` 우클릭
- "Open with Live Server" 선택

### 3단계: 웹 브라우저에서 접속

```
http://localhost:3000/login.html
```

## 📱 스마트폰에서 접속하기

### 같은 Wi-Fi 네트워크에 연결된 경우:

1. **PC의 IP 주소 확인**:
   - Windows: `ipconfig` 명령 실행
   - Mac/Linux: `ifconfig` 또는 `ip addr` 명령 실행

2. **스마트폰 브라우저에서 접속**:
   ```
   http://[PC의IP주소]:3000/login.html
   ```
   예: `http://192.168.0.100:3000/login.html`

## 📖 사용 방법

### 1️⃣ 회원가입 및 로그인

1. 브라우저에서 `login.html` 접속
2. "회원가입" 탭 클릭
3. 이름, 이메일, 비밀번호 입력
4. 회원가입 완료 후 자동 로그인

### 2️⃣ 물품 입력 (📝 입력 탭)

1. 조사자 이름 자동 입력됨 (변경 가능)
2. 물품명과 필요한 정보 입력
3. ✅ 저장 버튼 클릭
4. 새로운 물품 계속 입력 가능

### 3️⃣ 물품 목록 확인 (📋 목록 탭)

- 모든 사용자가 입력한 물품 실시간 확인
- 본인이 작성한 물품만 수정/삭제 가능
- 검색창으로 빠른 검색
- 카테고리 필터 적용 가능

### 4️⃣ 데이터 관리 (⚙️ 관리 탭)

- **📊 엑셀로 다운로드**: 모든 조사 결과 엑셀 파일로 저장
- **💾 JSON으로 다운로드**: JSON 형식 백업
- **📂 파일 선택**: 이전 데이터 불러오기
- **🗑️ 모든 데이터 삭제**: 본인 데이터만 초기화

## 🔒 보안 및 권한

### 데이터 권한
- ✅ **읽기**: 로그인한 모든 사용자
- ✅ **생성**: 로그인한 모든 사용자
- ⚠️ **수정**: 작성자만 가능
- ⚠️ **삭제**: 작성자만 가능

### Firestore 보안 규칙
`firestore.rules` 파일에 정의되어 있으며, Firebase Console에서 설정해야 합니다.

## 🌟 Firebase의 장점

### ✅ 실시간 동기화
- 누군가 데이터를 추가하면 **즉시** 모든 기기에 반영
- 새로고침 불필요

### ✅ 클라우드 백업
- 데이터가 Google 서버에 자동 저장
- PC가 꺼져도 데이터 안전

### ✅ 원격 접근
- 인터넷만 있으면 **어디서나** 접속 가능
- 집, 사무실, 현장 등 장소 제한 없음

### ✅ 확장성
- 사용자가 늘어나도 자동 확장
- 성능 저하 없음

## 💰 비용

### 무료 할당량 (Spark Plan)
- Firestore 읽기: **50,000회/일**
- Firestore 쓰기: **20,000회/일**
- Firestore 삭제: **20,000회/일**
- 저장소: **1GB**
- 네트워크: **10GB/월**
- Authentication 사용자: **무제한**

### 예상 사용량
```
소규모 팀 (10명, 월 1000건 조사):
→ 완전 무료 ✅

중규모 팀 (30명, 월 5000건 조사):
→ 완전 무료 ✅

대규모 팀 (100명, 월 20000건 조사):
→ 무료 (사진 많지 않으면) ✅
```

## 📂 프로젝트 구조

```
find app/
├── FIREBASE_SETUP.md      # Firebase 설정 가이드
├── README_FIREBASE.md      # 이 파일
├── firestore.rules         # Firestore 보안 규칙
└── public/
    ├── login.html          # 로그인/회원가입 페이지
    ├── index.html          # 메인 페이지
    ├── auth.js             # 인증 로직
    ├── app.js              # 메인 앱 로직 (Firebase 연동)
    ├── style.css           # 스타일시트
    ├── firebase-config.js  # Firebase 설정 (직접 입력 필요!)
    └── ...
```

## 🔧 Firebase 설정 파일

**중요:** `public/firebase-config.js` 파일에 본인의 Firebase 프로젝트 정보를 입력해야 합니다!

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",              // ← 여기에 입력
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

## 🛠️ 문제 해결

### "Firebase가 초기화되지 않았습니다" 오류
→ `firebase-config.js`에 올바른 Firebase 설정 정보를 입력했는지 확인

### 로그인 후 데이터가 보이지 않음
→ Firestore Database가 생성되었는지 확인
→ 보안 규칙이 올바르게 설정되었는지 확인

### 데이터 수정/삭제가 안됨
→ 본인이 작성한 데이터인지 확인 (다른 사용자 데이터는 수정 불가)

### 스마트폰에서 접속이 안됨
→ PC와 스마트폰이 같은 Wi-Fi에 연결되어 있는지 확인
→ 방화벽이 포트를 차단하고 있는지 확인

## 💡 실무 활용 팁

1. **현장 조사**: 스마트폰으로 현장에서 바로 입력
2. **팀 협업**: 여러 명이 동시에 각자 다른 장소에서 조사
3. **실시간 확인**: 관리자가 사무실에서 실시간으로 진행 상황 모니터링
4. **데이터 통합**: 엑셀 다운로드로 최종 보고서 작성
5. **재사용**: 이전 조사 데이터를 업로드하여 계속 사용

## 🌐 배포 (선택사항)

### Firebase Hosting으로 배포
Firebase 프로젝트에서 무료 호스팅 가능:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

배포 후 `https://your-project.web.app` 같은 URL로 접속 가능!

## 🆚 기존 버전과의 차이

| 기능 | 기존 (JSON 파일) | Firebase 버전 |
|------|-----------------|---------------|
| **사용자 인증** | ❌ 없음 | ✅ 이메일 로그인 |
| **동시 접속** | ⚠️ 데이터 충돌 가능 | ✅ 실시간 동기화 |
| **원격 접근** | ⚠️ 복잡한 설정 | ✅ 자동 지원 |
| **데이터 백업** | ⚠️ 수동 백업 | ✅ 자동 백업 |
| **권한 관리** | ❌ 없음 | ✅ 사용자별 권한 |
| **서버 필요** | ✅ Node.js 서버 | ❌ 서버 불필요 |
| **비용** | ₩0 (로컬) | ₩0~소액 (클라우드) |

## 📞 지원

문제가 발생하거나 기능 추가가 필요한 경우:
- Firebase 공식 문서: https://firebase.google.com/docs?hl=ko
- Firestore 가이드: https://firebase.google.com/docs/firestore?hl=ko
- Authentication 가이드: https://firebase.google.com/docs/auth?hl=ko

## 🎉 완료!

Firebase 설정만 마치면 강력한 클라우드 기반 물품 조사 시스템을 사용할 수 있습니다!

**첫 사용자 등록 후 바로 시작하세요!** 🚀

