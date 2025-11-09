# ⚡ 빠른 배포 가이드 (5분 완성)

## 🚀 지금 바로 배포하기

### 1단계: Firebase CLI 설치 (1분)

```powershell
npm install -g firebase-tools
```

### 2단계: 로그인 (1분)

```powershell
firebase login
```

### 3단계: 배포! (1분)

```powershell
cd "C:\Users\bb\Desktop\find app"
firebase deploy --only hosting
```

### 완료! 🎉

배포 완료되면 URL이 표시됩니다:
```
✔ Deploy complete!
Hosting URL: https://hyundai-e653c.web.app
```

---

## 📱 지금 바로 접속 가능!

**PC에서:**
```
https://hyundai-e653c.web.app
```

**스마트폰에서:**
```
https://hyundai-e653c.web.app
```

전 세계 어디서나 접속 가능합니다!

---

## 🌐 커스텀 도메인 연결 (선택사항)

### survey.hjs4393.com 으로 접속하고 싶다면?

**DEPLOYMENT_GUIDE.md** 파일의 6단계부터 진행하세요!

1. Firebase Console에서 도메인 추가
2. DNS 설정 (A 레코드)
3. 20분~2시간 대기
4. 완료!

---

## 🔄 업데이트 방법

수정 후:

```powershell
firebase deploy --only hosting
```

1분 안에 업데이트 완료!

---

## 💡 팁

### 배포 전 로컬 테스트:
```powershell
firebase serve
```

### 특정 프로젝트로 배포:
```powershell
firebase use hyundai-e653c
firebase deploy --only hosting
```

### 배포 기록 확인:
```powershell
firebase hosting:channel:list
```

---

## ✅ 성공 확인

1. 배포 명령 성공 메시지 확인
2. 제공된 URL 접속
3. 로그인 페이지 표시 확인
4. 회원가입 테스트
5. 완료! 🎊

---

**상세한 설정은 DEPLOYMENT_GUIDE.md를 참고하세요!**

