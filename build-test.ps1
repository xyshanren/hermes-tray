# Hermes Tray Windows 构建测试 (PowerShell 版)
# 替代 build-test.bat, 避开 CMD 行尾/块解析/编码坑
# 用法: .\build-test.ps1

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

$timestamp = Get-Date -Format "yyyy/MM/dd HH:mm:ss"
$global:failed = $false

function Stage($n, $name) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "[阶段 $n/6] $name" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Check($name, $cmd, $cmdArgs = "--version", $hint = "") {
    Write-Host -NoNewline "[检查] $name ... "
    # 用 cmd /c 替代 & (PowerShell `&` 操作符在某些环境下会挂)
    $out = cmd /c "$cmd $cmdArgs 2>&1"
    if ($LASTEXITCODE -eq 0) {
        Write-Host $out.Trim() -ForegroundColor Green
        return $true
    } else {
        Write-Host "[失败]" -ForegroundColor Red
        if ($hint) { Write-Host "[修复] $hint" -ForegroundColor Yellow }
        return $false
    }
}

Write-Host "Hermes Tray Windows 构建测试 (PowerShell)" -ForegroundColor Cyan
Write-Host "开始时间: $timestamp" -ForegroundColor Cyan

# 阶段 1: 环境检查
Stage 1 "环境检查"
$envOk = $true
$envOk = (Check "Node.js" "node") -and $envOk
$envOk = (Check "npm" "npm") -and $envOk
$rustOk = (Check "Rust" "rustc") -and (Check "Cargo" "cargo")
$envOk = $rustOk -and $envOk
$isccOk = (cmd /c "iscc /?" 2>&1 | Select-String "Inno Setup" -Quiet) -ne $null
if (-not $isccOk) { Write-Host "[警告] Inno Setup 未找到 (阶段 5 会跳过)" -ForegroundColor Yellow }

Write-Host ""
Write-Host "[检查] 项目文件完整性"
$files = @("src-tauri\Cargo.toml", "package.json", "setup.iss", "assets\icon.ico")
foreach ($f in $files) {
    if (Test-Path $f) { Write-Host "  [OK] $f" -ForegroundColor Green }
    else { Write-Host "  [缺失] $f" -ForegroundColor Red }
}

# 阶段 2: npm 依赖安装
Stage 2 "npm 依赖安装"
if (-not $envOk) {
    Write-Host "[跳过] 环境未通过" -ForegroundColor Yellow
} else {
    Write-Host "[步骤] npm install..."
    cmd /c "npm install" 2>&1 | Out-Host
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[通过] npm install" -ForegroundColor Green
    } else {
        Write-Host "[失败] npm install (退出码 $LASTEXITCODE)" -ForegroundColor Red
        $envOk = $false
    }
}

# 阶段 3: 前端构建
Stage 3 "前端构建"
if ($envOk) {
    Write-Host "[步骤] npm run build (tsc + vite)..."
    cmd /c "npm run build" 2>&1 | Out-Host
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[通过] 前端构建" -ForegroundColor Green
    } else {
        Write-Host "[失败] 前端构建 (退出码 $LASTEXITCODE)" -ForegroundColor Red
    }
}

# 阶段 4: Tauri 构建
Stage 4 "Tauri 构建"
if (-not $rustOk) {
    Write-Host "[跳过] Rust 不可用" -ForegroundColor Yellow
} else {
    Write-Host "[步骤] npm run tauri build..."
    Write-Host "[注意] 首次构建会下载 Rust crate (5-15 分钟)"
    cmd /c "npm run tauri build" 2>&1 | Out-Host
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[通过] Tauri 构建" -ForegroundColor Green
        $exe = "src-tauri\target\release\hermes-tray-tauri.exe"
        if (Test-Path $exe) {
            $size = (Get-Item $exe).Length
            Write-Host "  [通过] 主程序: $exe ($size 字节)" -ForegroundColor Green
        }
        if (Test-Path "src-tauri\target\release\bundle\msi") {
            Get-ChildItem "src-tauri\target\release\bundle\msi\*.msi" | ForEach-Object {
                Write-Host "  [MSI] $($_.FullName) ($($_.Length) 字节)" -ForegroundColor Cyan
            }
        }
        if (Test-Path "src-tauri\target\release\bundle\nsis") {
            Get-ChildItem "src-tauri\target\release\bundle\nsis\*.exe" | ForEach-Object {
                Write-Host "  [NSIS] $($_.FullName) ($($_.Length) 字节)" -ForegroundColor Cyan
            }
        }
    } else {
        Write-Host "[失败] Tauri 构建 (退出码 $LASTEXITCODE)" -ForegroundColor Red
    }
}

# 阶段 5: Inno Setup
Stage 5 "Inno Setup 安装程序"
if (-not $isccOk) {
    Write-Host "[跳过] Inno Setup 不可用" -ForegroundColor Yellow
} elseif (-not (Test-Path "src-tauri\target\release\hermes-tray-tauri.exe")) {
    Write-Host "[跳过] 主程序不存在 (需先修复阶段 4)" -ForegroundColor Yellow
} else {
    Write-Host "[步骤] iscc setup.iss..."
    cmd /c "iscc setup.iss" 2>&1 | Out-Host
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[通过] Inno Setup 编译" -ForegroundColor Green
        if (Test-Path "installer") {
            Get-ChildItem "installer\*.exe" | ForEach-Object {
                Write-Host "  [安装程序] $($_.FullName) ($($_.Length) 字节)" -ForegroundColor Cyan
            }
        }
    } else {
        Write-Host "[失败] Inno Setup 编译 (退出码 $LASTEXITCODE)" -ForegroundColor Red
    }
}

# 阶段 6: 汇总
Stage 6 "测试汇总"

# build-test-summary.txt
$summaryFile = Join-Path $PSScriptRoot "build-test-summary.txt"
$summary = @()
$summary += "Hermes Tray Build Test Summary"
$summary += "================================"
$summary += "Date: $timestamp"
$summary += ""
$summary += "Result: $(if ($global:failed) {'FAILED'} else {'PASSED'})"
$summary += ""
$summary += "Artifacts:"
$exe = "src-tauri\target\release\hermes-tray-tauri.exe"
if (Test-Path $exe) {
    $summary += "  Main EXE: $((Resolve-Path $exe).Path) ($((Get-Item $exe).Length) bytes)"
}
if (Test-Path "installer") {
    Get-ChildItem "installer\*.exe" | ForEach-Object {
        $summary += "  Installer: $($_.FullName) ($($_.Length) bytes)"
    }
}
$summary | Out-File -FilePath $summaryFile -Encoding UTF8
Write-Host "摘要已写入: $summaryFile" -ForegroundColor Cyan

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($global:failed) {
    Write-Host "结果: 部分失败" -ForegroundColor Red
} else {
    Write-Host "结果: 全部通过" -ForegroundColor Green
}
Write-Host "========================================" -ForegroundColor Cyan

# 自动打开 log
$logFile = Join-Path $PSScriptRoot "build-test.log"
if (Test-Path $logFile) {
    Start-Process notepad.exe $logFile
}

Write-Host ""
Write-Host "按任意键关闭..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")