<#
  win-preflight.ps1 — md2docx Windows 环境自检

  用途：在目标 Windows 机器上判断「能否跑 WSL2 + Docker」，
        以及「若只能纯 Windows，原生方案的前提是否满足」。

  运行（普通权限即可，部分项需管理员才显示，会自动跳过）：
      powershell -ExecutionPolicy Bypass -File win-preflight.ps1

  输出：逐项 ✓/✗ 与最终结论。
#>

$ErrorActionPreference = 'SilentlyContinue'
$script:Admin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "  [NO]   $m" -ForegroundColor Red }
function Warn($m) { Write-Host "  [注意] $m" -ForegroundColor Yellow }
function Info($m) { Write-Host "         $m" -ForegroundColor Gray }

Write-Host "md2docx Windows 环境自检" -ForegroundColor White
Write-Host "管理员权限: $(if ($script:Admin) {'是'} else {'否（部分检测项会跳过）'})"

$wslUsable = $true
$nativePrereq = $true

# ---------------------------------------------------------------- 系统版本
Section "1. 操作系统"
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$build = [int]$cv.CurrentBuildNumber
Info ("$($cv.ProductName) {0}.{1} (Build {2})" -f $cv.CurrentMajorVersionNumber, $cv.CurrentMinorVersionNumber, $build)
if ($build -ge 19041) { Ok "版本满足 WSL2 要求（需 Build 19041 / Win10 2004 以上）" }
else { Bad "版本过低，WSL2 需要 Build 19041+"; $wslUsable = $false }

# ---------------------------------------------------------------- 硬件虚拟化
Section "2. 硬件虚拟化（WSL2 必需）"
$cs = Get-CimInstance Win32_ComputerSystem
$proc = Get-CimInstance Win32_Processor | Select-Object -First 1
$fwVirt = $proc.VirtualizationFirmwareEnabled
$hypervisor = $cs.HypervisorPresent
Info "CPU: $($proc.Name)"
Info "逻辑核心: $($proc.NumberOfLogicalProcessors) | 内存: $([math]::Round($cs.TotalPhysicalMemory/1GB,1)) GB"
if ($fwVirt -eq $true) { Ok "BIOS/UEFI 已开启虚拟化" }
elseif ($fwVirt -eq $false) { Bad "BIOS/UEFI 未开启虚拟化 —— 需进 BIOS 开启 VT-x/AMD-V"; $wslUsable = $false }
else { Warn "无法读取虚拟化状态（可能被虚拟化平台或权限隐藏）" }
if ($hypervisor -eq $true) { Info "检测到 Hypervisor 已运行（可能是 Hyper-V 或已在虚拟机内）" }

# ---------------------------------------------------------------- 功能开关
Section "3. Windows 功能（WSL2 必需）"
$features = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')
foreach ($f in $features) {
  $state = (Get-WindowsOptionalFeature -Online -FeatureName $f).State
  if (-not $state) { Warn "$f 状态读取失败（需管理员）"; continue }
  if ($state -eq 'Enabled') { Ok "$f 已启用" } else { Bad "$f 未启用"; $wslUsable = $false }
}
$hv = (Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All).State
if ($hv) { Info "Hyper-V: $hv（WSL2 不强制需要 Hyper-V，但 Docker Desktop 可能用）" }

# ---------------------------------------------------------------- WSL 实测
Section "4. WSL 实际可用性（最关键）"
$wslCmd = Get-Command wsl.exe
if (-not $wslCmd) {
  Bad "未找到 wsl.exe —— WSL 未安装"
  $wslUsable = $false
} else {
  $ver = (& wsl.exe --version) 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0 -and $ver -match 'WSL') {
    Ok "wsl.exe 可用"
    $ver.Trim().Split("`n") | Select-Object -First 4 | ForEach-Object { Info $_.Trim() }
    $distros = (& wsl.exe --list --quiet) 2>&1 | Out-String
    if ($distros.Trim()) { Ok "已安装发行版: $($distros.Trim() -replace "`r?`n", ', ')" }
    else { Warn "未安装任何 Linux 发行版（wsl --install -d Ubuntu 可装）" }
    # 实跑一条命令，确认真能执行
    $probe = (& wsl.exe -e sh -c "echo WSL_OK && uname -r") 2>&1 | Out-String
    if ($probe -match 'WSL_OK') { Ok "WSL 内可执行命令，内核: $($probe -replace 'WSL_OK','' -replace "`r?`n",' ')" }
    else { Bad "WSL 存在但无法执行命令（可能未装发行版或未初始化）"; $wslUsable = $false }
  } else {
    Bad "wsl.exe 存在但不能正常工作"
    if ($ver.Trim()) { Info $ver.Trim() }
    $wslUsable = $false
  }
}

# ---------------------------------------------------------------- Docker
Section "5. Docker（若走 Docker 路线）"
$docker = Get-Command docker.exe
if (-not $docker) { Warn "未安装 docker（走 Docker 路线需先装 Docker Desktop 或 WSL2 内装 Engine）" }
else {
  $dv = (& docker version --format '{{.Server.Version}}') 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0) { Ok "Docker 守护进程可用，Server 版本 $($dv.Trim())" }
  else { Warn "docker 命令存在但守护进程未运行（Docker Desktop 未启动？）" }
}

# ---------------------------------------------------------------- 纯 Windows 前提
Section "6. 纯 Windows 原生方案前提"
$edgePaths = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Ok "系统自带 Edge：$edge（可作 mermaid 渲染器，省 ~150MB）" }
else { Warn "未找到 Edge（原生方案需自带 Chromium）"; $nativePrereq = $false }

$fonts = @('msyh.ttc','simsun.ttc','Deng.ttf')
$found = $fonts | Where-Object { Test-Path "$env:WINDIR\Fonts\$_" }
if ($found) { Ok "中文字体存在: $($found -join ', ')（图表中文渲染前提）" }
else { Warn "未找到常见中文字体"; $nativePrereq = $false }

# 临时目录可写 + 端口可用
if (Test-Path $env:TEMP) { Ok "TEMP 可写: $env:TEMP" } else { Bad "TEMP 不可写"; $nativePrereq = $false }
$busy = (Get-NetTCPConnection -State Listen -LocalPort 8080).Count
if ($busy -gt 0) { Warn "8080 端口已被占用（服务应自动挑空闲端口）" } else { Ok "8080 端口空闲" }

Info "磁盘可用: $([math]::Round((Get-PSDrive C).Free/1GB,1)) GB (C:)"

# ---------------------------------------------------------------- 结论
Section "结论"
if ($wslUsable) {
  Write-Host "  ✓ 这台机器可以跑 WSL2。" -ForegroundColor Green
  Write-Host "    → 推荐走 Docker 路线：复用现有 Linux 镜像，Windows 侧零维护。" -ForegroundColor Green
  Write-Host "      Docker Desktop 有商用许可限制；不想受限制可在 WSL2 内直装 Docker Engine。" -ForegroundColor Gray
} else {
  Write-Host "  ✗ 这台机器很可能跑不了 WSL2。" -ForegroundColor Red
  Write-Host "    → 走「纯 Windows 原生一键安装」路线（见 docs/plans/windows-native.md）。" -ForegroundColor Yellow
  Write-Host "      该方案已可去掉 Java / graphviz / Python 三个依赖，安装包约 100–350MB。" -ForegroundColor Gray
}
if ($nativePrereq) { Write-Host "  ✓ 纯 Windows 原生方案的前提满足。" -ForegroundColor Green }
else { Write-Host "  ! 纯 Windows 方案有前提未满足（见上文「注意」项）。" -ForegroundColor Yellow }
Write-Host ""
Write-Host "把以上输出整段贴回给助手，即可据此确定路线。" -ForegroundColor White
