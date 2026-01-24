@echo off
chcp 65001 >nul
echo ========================================
echo 🚀 Firebase 배포 스크립트
echo ========================================
echo.

echo 📍 현재 위치: %CD%
echo.

echo 🔄 Firebase에 배포 중...
echo.

firebase deploy --only hosting

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo ✅ 배포 완료!
    echo ========================================
    echo.
    echo 🌐 웹사이트 URL: https://hyundai-e653c.web.app
    echo.
    echo 💡 변경사항 확인:
    echo    1. 위 URL로 접속
    echo    2. Ctrl + Shift + R (강제 새로고침)
    echo    3. 로그인 페이지에서 도움말 확인
    echo.
) else (
    echo.
    echo ========================================
    echo ❌ 배포 실패
    echo ========================================
    echo.
    echo 문제 해결:
    echo    1. Firebase CLI 설치 확인: firebase --version
    echo    2. 로그인 확인: firebase login
    echo    3. 프로젝트 확인: firebase use hyundai-e653c
    echo.
)

pause
