# 🚀 Firebase Hosting 배포 가이드 (서브도메인 방식)

기존 도메인: **https://www.hjs4393.com**  
물품조사 시스템: **https://survey.hjs4393.com** (예시)

---

## 📋 배포 단계 요약

1. Firebase CLI 설치 (5분)
2. Firebase Hosting 초기화 (3분)
3. 배포 실행 (2분)
4. 커스텀 도메인 연결 (5분)
5. DNS 설정 (도메인 업체에서)

**총 소요 시간: 약 20분**

---

## 1단계: Firebase CLI 설치

### Windows에서 설치:

**방법 A: npm 사용 (Node.js 이미 설치됨)**
```powershell
npm install -g firebase-tools
```

**방법 B: 독립 실행 파일**
- https://firebase.google.com/docs/cli 접속
- Windows 실행 파일 다운로드 및 설치

### 설치 확인:
```powershell
firebase --version
```

버전이 표시되면 성공! (예: 13.0.0)

---

## 2단계: Firebase 로그인

```powershell
firebase login
```

- 브라우저가 열리면 Google 계정으로 로그인
- "Firebase CLI가 Google 계정에 액세스하도록 허용" → **허용** 클릭
- 터미널에 "✔ Success! Logged in as your-email@gmail.com" 표시되면 성공

---

## 3단계: 프로젝트 초기화

### 3-1. 프로젝트 폴더로 이동

```powershell
cd "C:\Users\bb\Desktop\find app"
```

### 3-2. Firebase 초기화

```powershell
firebase init hosting
```

### 3-3. 질문에 답하기:

**"Select a Firebase project:"**
```
→ Use an existing project (기존 프로젝트 사용)
→ hyundai-e653c 선택 (본인의 프로젝트)
```

**"What do you want to use as your public directory?"**
```
→ public 입력
```

**"Configure as a single-page app (rewrite all urls to /index.html)?"**
```
→ N (No)
```

**"Set up automatic builds and deploys with GitHub?"**
```
→ N (No)
```

**"File public/index.html already exists. Overwrite?"**
```
→ N (No) ⚠️ 중요: 덮어쓰지 마세요!
```

완료되면 `firebase.json` 파일이 생성됩니다.

---

## 4단계: firebase.json 설정 확인

생성된 `firebase.json` 파일을 열고 아래처럼 수정하세요:

```json
{
  "hosting": {
    "public": "public",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "/",
        "destination": "/login.html"
      }
    ],
    "headers": [
      {
        "source": "**/*.@(js|css)",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "max-age=3600"
          }
        ]
      }
    ]
  }
}
```

---

## 5단계: 첫 배포 (테스트)

```powershell
firebase deploy --only hosting
```

배포 완료되면 다음과 같은 메시지가 표시됩니다:
```
✔ Deploy complete!

Hosting URL: https://hyundai-e653c.web.app
```

### 테스트:
브라우저에서 표시된 URL로 접속하여 정상 작동 확인!

---

## 6단계: 커스텀 도메인 연결 (서브도메인)

### 6-1. Firebase Console에서 설정

1. **Firebase Console 접속**
   - https://console.firebase.google.com
   - 프로젝트 선택 (hyundai-e653c)

2. **Hosting 메뉴 이동**
   - 왼쪽 메뉴 → **Hosting**
   - "도메인 추가" 또는 "Add custom domain" 클릭

3. **서브도메인 입력**
   ```
   survey.hjs4393.com
   ```
   (또는 원하는 서브도메인: items.hjs4393.com, check.hjs4393.com 등)

4. **소유권 확인**
   - "계속" 클릭
   - Firebase가 DNS 레코드 제공

### 6-2. DNS 설정이 필요합니다!

Firebase가 제공하는 정보:

**A 레코드 추가:**
```
Type: A
Name: survey (또는 @ 없이 서브도메인만)
Value: [Firebase가 제공하는 IP 주소들]
```

**예시:**
```
Type: A
Name: survey
Value: 151.101.1.195
Value: 151.101.65.195
```

---

## 7단계: DNS 설정하기

### 도메인 관리 페이지에서:

**hjs4393.com 도메인을 관리하는 곳에서 설정해야 합니다.**

일반적인 도메인 업체:
- 가비아 (gabia.com)
- 카페24
- 호스팅케이알
- Cloudflare
- AWS Route53
- 기타

### DNS 설정 방법 (일반적):

1. 도메인 관리 페이지 로그인
2. DNS 관리 또는 "도메인 설정" 메뉴 찾기
3. 새 레코드 추가:

**A 레코드 2개 추가:**
```
Type: A
Name: survey
Value: 151.101.1.195
TTL: 3600

Type: A
Name: survey
Value: 151.101.65.195
TTL: 3600
```

**또는 CNAME 방식 (Firebase가 제공하는 경우):**
```
Type: CNAME
Name: survey
Value: hyundai-e653c.web.app
TTL: 3600
```

4. 저장 후 **20분~2시간 대기** (DNS 전파 시간)

---

## 8단계: SSL 인증서 자동 발급 (Firebase가 처리)

DNS 설정이 완료되고 확인되면:
- Firebase가 자동으로 SSL 인증서 발급
- **HTTPS** 자동 적용
- 최대 24시간 소요 (보통 1~2시간)

**완료되면:**
```
✅ https://survey.hjs4393.com
```

---

## 🎉 완료 확인

### ✅ 체크리스트:

1. [ ] Firebase CLI 설치됨
2. [ ] Firebase 로그인 완료
3. [ ] `firebase init hosting` 완료
4. [ ] `firebase deploy` 성공
5. [ ] Firebase 기본 URL 접속 확인 (https://xxx.web.app)
6. [ ] Firebase Console에서 커스텀 도메인 추가
7. [ ] DNS 레코드 설정 완료
8. [ ] DNS 전파 대기 (20분~2시간)
9. [ ] SSL 인증서 발급 완료
10. [ ] https://survey.hjs4393.com 접속 확인 ✨

---

## 📱 모바일 접속

DNS와 SSL이 완료되면:
```
스마트폰 브라우저: https://survey.hjs4393.com
```

전 세계 어디서나 접속 가능! 🌍

---

## 🔄 업데이트 방법

코드 수정 후 다시 배포:

```powershell
cd "C:\Users\bb\Desktop\find app"
firebase deploy --only hosting
```

1~2분 안에 업데이트 완료!

---

## 🎯 기존 웹사이트에 메뉴 추가

### www.hjs4393.com 메뉴에 추가:

**HTML 예시:**
```html
<nav>
  <a href="/">홈</a>
  <a href="/about">소개</a>
  <a href="/projects">프로젝트</a>
  <a href="https://survey.hjs4393.com" target="_blank">
    물품조사시스템 🔥
  </a>
  <a href="/contact">연락처</a>
</nav>
```

또는 버튼 형태로:
```html
<a href="https://survey.hjs4393.com" 
   class="btn btn-primary" 
   target="_blank">
  📦 물품조사 시작하기
</a>
```

---

## 💰 비용

### Firebase Hosting 무료 할당량:
- 저장소: 10GB
- 전송량: 360MB/일
- SSL 인증서: 무료
- 커스텀 도메인: 무료

**물품 조사 시스템: 완전 무료!** ✅

---

## 🔒 보안 강화 (선택사항)

### Firebase Hosting 보안 규칙 추가:

`firebase.json`에 추가:
```json
{
  "hosting": {
    "headers": [
      {
        "source": "**",
        "headers": [
          {
            "key": "X-Frame-Options",
            "value": "SAMEORIGIN"
          },
          {
            "key": "X-Content-Type-Options",
            "value": "nosniff"
          }
        ]
      }
    ]
  }
}
```

---

## ❓ 문제 해결

### 문제 1: "Permission denied" 오류
```powershell
firebase login --reauth
```

### 문제 2: DNS 설정 확인
```powershell
nslookup survey.hjs4393.com
```

IP 주소가 표시되면 DNS 설정 완료!

### 문제 3: SSL 인증서 발급 안됨
- 24시간 대기
- DNS 레코드가 올바른지 확인
- Firebase Console에서 상태 확인

### 문제 4: 배포 후 변경사항이 안 보임
- 브라우저 캐시 삭제 (Ctrl + Shift + Delete)
- 시크릿 모드로 접속 (Ctrl + Shift + N)

---

## 📞 추가 지원

### Firebase 공식 문서:
- Hosting: https://firebase.google.com/docs/hosting
- 커스텀 도메인: https://firebase.google.com/docs/hosting/custom-domain
- 한국어 가이드: https://firebase.google.com/docs/hosting?hl=ko

### DNS 설정 도움:
도메인 등록 업체에 문의하여 DNS 레코드 추가 요청 가능

---

## 🎊 완료 후

배포가 완료되면:

1. **기존 웹사이트 메뉴 업데이트**
   - www.hjs4393.com 에 "물품조사시스템" 링크 추가

2. **직원들에게 공유**
   ```
   물품조사 시스템: https://survey.hjs4393.com
   
   1. 회원가입 (이메일/비밀번호)
   2. 로그인
   3. 물품 정보 입력
   4. 실시간 동기화
   5. 엑셀 다운로드
   ```

3. **즐겨찾기 추가 권장**
   - 스마트폰 홈 화면에 추가 가능
   - PWA처럼 작동

**배포 완료! 축하합니다! 🎉**

