# Firebase Hosting 배포 가이드 🚀

## 🔍 중요: Git과 Firebase는 다릅니다!

### 차이점 이해하기

| 작업 | Git (GitHub) | Firebase Hosting |
|------|--------------|------------------|
| **목적** | 코드 버전 관리 | 웹사이트 호스팅 |
| **명령어** | `git push` | `firebase deploy` |
| **결과** | GitHub 저장소 업데이트 | 실제 웹사이트 업데이트 |
| **URL** | github.com/... | hyundai-e653c.web.app |

---

## 📋 올바른 배포 워크플로우

### 1단계: 코드 수정 및 Git 커밋
```bash
# 파일 수정 후...
git add .
git commit -m "수정 내용 설명"
git push
```

**결과**: ✅ GitHub에 코드 저장됨 (백업)

---

### 2단계: Firebase에 배포 (중요!)
```bash
firebase deploy
```

**결과**: ✅ 실제 웹사이트에 변경사항 반영됨!

---

## 🚀 배포 명령어

### 전체 배포 (권장)
```bash
firebase deploy
```
- Firestore 규칙, Hosting 모두 배포

### Hosting만 배포 (빠름)
```bash
firebase deploy --only hosting
```
- 웹 파일만 배포 (HTML, CSS, JS)

### Firestore 규칙만 배포
```bash
firebase deploy --only firestore:rules
```
- 보안 규칙만 업데이트

---

## 📊 배포 확인 방법

### 1. 배포 성공 메시지 확인
```
+  Deploy complete!
+  Hosting URL: https://hyundai-e653c.web.app
```

### 2. 웹사이트 접속
```
https://hyundai-e653c.web.app
```

### 3. 강제 새로고침
- **Windows**: Ctrl + Shift + R
- **Mac**: Cmd + Shift + R
- 브라우저 캐시 무시하고 최신 버전 로드

### 4. Firebase Console에서 확인
```
https://console.firebase.google.com/project/hyundai-e653c/hosting
```

---

## ⚠️ 주의사항

### 1. Git push만으로는 웹사이트가 업데이트되지 않습니다!
```bash
git push          # ❌ GitHub에만 저장
firebase deploy   # ✅ 웹사이트에 반영
```

### 2. 브라우저 캐시
- 배포 후에도 이전 버전이 보이면 **강제 새로고침** (Ctrl + Shift + R)

### 3. 배포 시간
- 보통 1~2분 소요
- 전 세계 CDN에 전파되는 시간 포함

### 4. 배포 중 웹사이트
- 배포 중에도 웹사이트는 정상 작동
- 이전 버전이 서비스됨

---

## 📝 완전한 작업 흐름 예시

### 시나리오: app.js 파일 수정

```bash
# 1. 코드 수정
# app.js 파일을 에디터에서 수정

# 2. Git에 저장 (백업용)
git add .
git commit -m "Firebase 읽기 최적화 적용"
git push

# 3. Firebase에 배포 (실제 반영)
firebase deploy

# 4. 웹사이트 확인
# https://hyundai-e653c.web.app 접속
# Ctrl + Shift + R (강제 새로고침)
```

---

## 🔄 자동화 (선택사항)

### GitHub Actions로 자동 배포

`.github/workflows/deploy.yml` 파일 생성:
```yaml
name: Deploy to Firebase Hosting

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: '${{ secrets.GITHUB_TOKEN }}'
          firebaseServiceAccount: '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}'
          projectId: hyundai-e653c
```

**효과**: Git push할 때 자동으로 Firebase에 배포됨

---

## 📍 현재 배포 정보

### 프로젝트 정보
- **프로젝트 ID**: hyundai-e653c
- **Hosting URL**: https://hyundai-e653c.web.app
- **Console**: https://console.firebase.google.com/project/hyundai-e653c

### 최근 배포
- **날짜**: 2025-11-10
- **배포된 파일**: 8개
- **상태**: ✅ 배포 성공

---

## 🐛 문제 해결

### 배포 후에도 변경사항이 안 보여요
1. **강제 새로고침**: Ctrl + Shift + R
2. **시크릿 모드**: 새 시크릿 창에서 확인
3. **다른 브라우저**: Chrome, Edge, Safari 등
4. **캐시 삭제**: 브라우저 설정에서 캐시 삭제

### firebase deploy 명령어가 안 돼요
```bash
# Firebase CLI 재로그인
firebase login --reauth

# 프로젝트 확인
firebase projects:list

# 프로젝트 선택
firebase use hyundai-e653c
```

### 일부 파일만 배포하고 싶어요
```bash
# 특정 파일만 수정했을 때
firebase deploy --only hosting

# Firestore 규칙만 수정했을 때
firebase deploy --only firestore:rules
```

---

## 📊 배포 체크리스트

배포 전:
- [ ] 로컬에서 테스트 완료
- [ ] 콘솔에 오류 없음
- [ ] Git commit 완료

배포:
- [ ] `firebase deploy` 실행
- [ ] "Deploy complete!" 메시지 확인

배포 후:
- [ ] 웹사이트 접속 확인
- [ ] 강제 새로고침 (Ctrl + Shift + R)
- [ ] 주요 기능 테스트
- [ ] 모바일에서도 확인

---

## 💡 팁

### 빠른 배포 (Hosting만)
```bash
firebase deploy --only hosting
```
→ Firestore 규칙은 그대로, 웹 파일만 배포 (빠름)

### 배포 히스토리 확인
```bash
firebase hosting:releases
```

### 이전 버전으로 롤백
Firebase Console → Hosting → 버전 기록 → "롤백" 버튼

---

## 🎯 요약

### Git vs Firebase

```
코드 수정
    ↓
git add . + commit + push
    ↓
GitHub 저장소 업데이트 ✅
(웹사이트는 아직 변경 없음 ❌)
    ↓
firebase deploy
    ↓
Firebase Hosting 배포 ✅
(웹사이트에 변경사항 반영 ✅)
```

### 기억하세요!
> **Git push = 백업**  
> **Firebase deploy = 실제 배포**

두 가지 모두 해야 합니다!

---

**작성일**: 2025-11-10
**프로젝트**: hyundai-e653c
**URL**: https://hyundai-e653c.web.app
