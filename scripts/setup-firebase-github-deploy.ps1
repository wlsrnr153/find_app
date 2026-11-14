# Firebase Hosting ← GitHub Actions 자동 배포 1회 설정
# Spark/Blaze 요금제는 바꾸지 않습니다. Hosting 배포 권한용 서비스 계정만 추가합니다.
#
# 사용법 (PowerShell에서):
#   cd "C:\Users\bb\Desktop\find app"
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-firebase-github-deploy.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))

Write-Host '== 1) Firebase 로그인 ==' -ForegroundColor Cyan
firebase login

Write-Host ''
Write-Host '== 2) GitHub Actions 연동 (서비스 계정 + 시크릿 + 워크플로) ==' -ForegroundColor Cyan
Write-Host '안내에 따라 GitHub 저장소 wlsrnr153/find_app 을 선택하세요.'
firebase init hosting:github

Write-Host ''
Write-Host '완료되면 main 에 push 할 때마다 https://hyundai-e653c.web.app 이 자동 배포됩니다.' -ForegroundColor Green
Write-Host '이미 추가된 .github/workflows/*.yml 과 충돌하면 Firebase가 만든 파일을 우선하고 커밋하세요.'
