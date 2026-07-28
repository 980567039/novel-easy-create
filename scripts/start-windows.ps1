$ErrorActionPreference = "Stop"
$projectDir = (Resolve-Path (Join-Path $PSScriptRoot ".."))
Set-Location $projectDir
$Host.UI.RawUI.WindowTitle = "小白作家 - Windows 一键启动"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 小白作家 - Windows 一键启动" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "项目目录：$projectDir"

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "未找到 Node.js 或 npm。请先安装 Node.js 20+：" -ForegroundColor Red
  Write-Host "https://nodejs.org/"
  Read-Host "按回车键退出"
  exit 1
}

Write-Host "Node: $(node --version)"
Write-Host "npm:  $(npm --version)"

if (-not (Test-Path (Join-Path $projectDir "node_modules"))) {
  Write-Host "正在安装项目依赖..." -ForegroundColor Yellow
  npm ci
}

if (-not (Test-Path (Join-Path $projectDir ".env"))) {
  Write-Host "未找到 .env，正在从 .env.example 创建..." -ForegroundColor Yellow
  Copy-Item (Join-Path $projectDir ".env.example") (Join-Path $projectDir ".env")
  Write-Host "已创建 .env；如需使用云端模型，请编辑其中的 AI_API_KEY。"
}

Write-Host "正在生成 Prisma Client..." -ForegroundColor Yellow
npm run db:generate

$databaseReady = $false
$pgIsReady = Get-Command pg_isready -ErrorAction SilentlyContinue
if ($null -ne $pgIsReady) {
  & $pgIsReady.Source -h localhost -p 5432 *> $null
  $databaseReady = ($LASTEXITCODE -eq 0)
} else {
  $databaseReady = (Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded
}

if ($databaseReady) {
  Write-Host "PostgreSQL 已连接，正在同步数据库结构..." -ForegroundColor Green
  try {
    npm run db:sync
  } catch {
    Write-Host "数据库结构同步失败，请检查 .env 中的 DATABASE_URL。前端仍会启动。" -ForegroundColor Yellow
  }
} else {
  Write-Host "未检测到 localhost:5432 的 PostgreSQL。" -ForegroundColor Yellow
  Write-Host "前端仍会启动，但项目创建 API 暂时会返回 DATABASE_UNAVAILABLE。"
}

Write-Host "开发服务器启动中：http://localhost:3000" -ForegroundColor Green
Write-Host "关闭此窗口即可停止开发服务器。"
npm run dev

$exitCode = $LASTEXITCODE
Write-Host "开发服务器已退出（代码：$exitCode）。"
Read-Host "按回车键关闭窗口"
exit $exitCode
