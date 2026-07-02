param(
  [string]$ApkPath = "deliverables\android\naonao-android-1.701.0.apk",
  [string]$EvidenceDir = "deliverables\android\install-smoke",
  [int]$LaunchWaitSeconds = 3,
  [switch]$SkipApkVerify
)

$ErrorActionPreference = "Stop"

$AndroidHome = $env:ANDROID_HOME
if (-not $AndroidHome) { $AndroidHome = $env:ANDROID_SDK_ROOT }
if (-not $AndroidHome) { $AndroidHome = "C:\Android\android-sdk" }

function Resolve-Tool {
  param(
    [string]$Directory,
    [string]$Name
  )
  $Candidates = @(
    (Join-Path $Directory "$Name.exe"),
    (Join-Path $Directory "$Name.bat"),
    (Join-Path $Directory $Name)
  )
  foreach ($Candidate in $Candidates) {
    if (Test-Path -LiteralPath $Candidate) { return $Candidate }
  }
  return $Candidates[0]
}

$Adb = Resolve-Tool (Join-Path $AndroidHome "platform-tools") "adb"
if (-not (Test-Path $Adb)) { throw "Missing adb: $Adb" }

$PackageName = "com.naonao.app.android"
$ActivityName = "$PackageName/.MainActivity"
$ResolvedApk = (Resolve-Path $ApkPath).Path
$ResolvedEvidenceDir = [System.IO.Path]::GetFullPath($EvidenceDir)
$RepoRoot = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $PSScriptRoot "..")).Path)
$AllowedEvidenceRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "deliverables\android"))
$AllowedEvidencePrefix = $AllowedEvidenceRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if ($ResolvedEvidenceDir -ne $AllowedEvidenceRoot -and -not $ResolvedEvidenceDir.StartsWith($AllowedEvidencePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write install smoke evidence outside deliverables\android: $ResolvedEvidenceDir"
}
New-Item -ItemType Directory -Force -Path $ResolvedEvidenceDir | Out-Null
if (-not $SkipApkVerify) {
  $Verifier = Join-Path $PSScriptRoot "android-verify-apk.ps1"
  if (-not (Test-Path $Verifier)) { throw "Missing APK verifier: $Verifier" }
  & $Verifier -ApkPath $ResolvedApk | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "APK verification failed" }
}

$Devices = & $Adb devices -l
if ($LASTEXITCODE -ne 0) { throw "adb devices failed" }

$DeviceRows = @($Devices | Where-Object { $_ -match "\sdevice(\s|$)" -and $_ -notmatch "^List of devices" })
if ($DeviceRows.Count -ne 1) {
  throw "Expected exactly one connected Android device, found $($DeviceRows.Count).`n$($Devices -join "`n")"
}
$DeviceSerial = ($DeviceRows[0].Trim() -split "\s+")[0]

function Invoke-DeviceAdb {
  param(
    [string[]]$AdbArgs,
    [switch]$AllowFailure
  )
  $Output = & $Adb -s $DeviceSerial @AdbArgs 2>&1
  $ExitCode = $LASTEXITCODE
  if ($ExitCode -ne 0 -and -not $AllowFailure) {
    throw "adb $($AdbArgs -join ' ') failed with exit code $ExitCode.`n$($Output -join "`n")"
  }
  [pscustomobject]@{
    Output = @($Output)
    ExitCode = $ExitCode
  }
}

function Assert-NoLaunchCrash {
  param([string]$LogText)

  $EscapedPackage = [regex]::Escape($PackageName)
  $CrashPatterns = @(
    "(?s)FATAL EXCEPTION[\s\S]{0,1200}Process:\s*$EscapedPackage",
    "Fatal signal \d+.*$EscapedPackage",
    "AndroidRuntime.*$EscapedPackage",
    "$EscapedPackage.*(crash|fatal|Force finishing)",
    "(chromium|crashpad|WebView).*$EscapedPackage.*(crash|fatal|renderer)"
  )
  foreach ($Pattern in $CrashPatterns) {
    $Match = [regex]::Match($LogText, $Pattern, "IgnoreCase, Singleline")
    if ($Match.Success) {
      $Start = [Math]::Max(0, $Match.Index - 500)
      $Length = [Math]::Min(1800, $LogText.Length - $Start)
      $Excerpt = $LogText.Substring($Start, $Length)
      throw "Launch logcat crash check failed.`n$Excerpt"
    }
  }
}

function Test-PackageProcess {
  $PidResult = Invoke-DeviceAdb -AdbArgs @("shell", "pidof", $PackageName) -AllowFailure
  if (($PidResult.Output -join " ").Trim()) { return $true }

  $PsResult = Invoke-DeviceAdb -AdbArgs @("shell", "ps") -AllowFailure
  return (($PsResult.Output -join "`n") -match [regex]::Escape($PackageName))
}

function Write-EvidenceText {
  param(
    [string]$Name,
    [string]$Text
  )
  $Path = Join-Path $ResolvedEvidenceDir $Name
  Set-Content -LiteralPath $Path -Encoding UTF8 -Value $Text
  return $Path
}

Invoke-DeviceAdb -AdbArgs @("install", "-r", $ResolvedApk) | Out-Null
Invoke-DeviceAdb -AdbArgs @("shell", "am", "force-stop", $PackageName) | Out-Null
Invoke-DeviceAdb -AdbArgs @("logcat", "-c") | Out-Null

$StartResult = Invoke-DeviceAdb -AdbArgs @("shell", "am", "start", "-W", "-n", $ActivityName)
$StartText = $StartResult.Output -join "`n"
Write-EvidenceText -Name "am-start.txt" -Text $StartText | Out-Null
if ($StartText -notmatch "Status:\s*ok") {
  throw "Activity launch did not report Status: ok.`n$StartText"
}

Start-Sleep -Seconds ([Math]::Max(1, $LaunchWaitSeconds))

$PackageInfo = Invoke-DeviceAdb -AdbArgs @("shell", "dumpsys", "package", $PackageName)
$PackageText = $PackageInfo.Output -join "`n"
Write-EvidenceText -Name "dumpsys-package.txt" -Text $PackageText | Out-Null
if ($PackageText -notmatch "versionName=1\.701\.0" -or $PackageText -notmatch "versionCode=170100") {
  throw "Installed package version check failed"
}

$ProcessConfirmed = Test-PackageProcess
if (-not $ProcessConfirmed) {
  throw "Installed package did not keep a running process after launch."
}

$WindowInfo = Invoke-DeviceAdb -AdbArgs @("shell", "dumpsys", "window")
$FocusText = $WindowInfo.Output -join "`n"
Write-EvidenceText -Name "dumpsys-window.txt" -Text $FocusText | Out-Null
$ActivityInfo = Invoke-DeviceAdb -AdbArgs @("shell", "dumpsys", "activity", "activities") -AllowFailure
$ActivityText = $ActivityInfo.Output -join "`n"
Write-EvidenceText -Name "dumpsys-activities.txt" -Text $ActivityText | Out-Null
$ForegroundConfirmed = ($FocusText -match [regex]::Escape($PackageName)) -or ($ActivityText -match [regex]::Escape($PackageName))
if (-not $ForegroundConfirmed) {
  throw "APK installed and launch command ran, but foreground package could not be confirmed from dumpsys."
}

$Logcat = Invoke-DeviceAdb -AdbArgs @("logcat", "-d", "-v", "time") -AllowFailure
$LogcatText = $Logcat.Output -join "`n"
Write-EvidenceText -Name "logcat.txt" -Text $LogcatText | Out-Null
Assert-NoLaunchCrash -LogText $LogcatText

$ScreenshotPath = Join-Path $ResolvedEvidenceDir "launch.png"
$RemoteScreenshot = "/sdcard/Download/naonao-install-smoke-launch.png"
Invoke-DeviceAdb -AdbArgs @("shell", "screencap", "-p", $RemoteScreenshot) | Out-Null
$PullOutput = & $Adb -s $DeviceSerial pull $RemoteScreenshot $ScreenshotPath 2>&1
$PullExitCode = $LASTEXITCODE
Invoke-DeviceAdb -AdbArgs @("shell", "rm", "-f", $RemoteScreenshot) -AllowFailure | Out-Null
if ($PullExitCode -ne 0) {
  Write-EvidenceText -Name "screencap-error.txt" -Text ($PullOutput -join "`n") | Out-Null
  throw "adb pull launch screenshot failed; see screencap-error.txt"
}
if ((Get-Item -LiteralPath $ScreenshotPath).Length -lt 1000) {
  throw "Launch screenshot is unexpectedly small: $ScreenshotPath"
}

$Report = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  apk = $ResolvedApk
  device = $DeviceRows[0].Trim()
  package = $PackageName
  versionName = "1.701.0"
  versionCode = 170100
  evidenceDir = $ResolvedEvidenceDir
  files = @{
    start = "am-start.txt"
    package = "dumpsys-package.txt"
    window = "dumpsys-window.txt"
    activities = "dumpsys-activities.txt"
    logcat = "logcat.txt"
    screenshot = "launch.png"
  }
}
$ReportPath = Join-Path $ResolvedEvidenceDir "install-smoke-report.json"
$Report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportPath -Encoding UTF8

[pscustomobject]@{
  Apk = $ResolvedApk
  Device = $DeviceRows[0].Trim()
  Package = $PackageName
  VersionName = "1.701.0"
  VersionCode = 170100
  Install = "passed"
  Launch = "passed"
  Process = "passed"
  ForegroundConfirmed = $ForegroundConfirmed
  LaunchCrashScan = "passed"
  Screenshot = $ScreenshotPath
  EvidenceDir = $ResolvedEvidenceDir
  Report = $ReportPath
}
