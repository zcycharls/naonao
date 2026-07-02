param(
  [string]$ApkPath = "deliverables\android\naonao-android-1.701.0.apk",
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

Invoke-DeviceAdb -AdbArgs @("install", "-r", $ResolvedApk) | Out-Null
Invoke-DeviceAdb -AdbArgs @("shell", "am", "force-stop", $PackageName) | Out-Null
Invoke-DeviceAdb -AdbArgs @("logcat", "-c") | Out-Null

$StartResult = Invoke-DeviceAdb -AdbArgs @("shell", "am", "start", "-W", "-n", $ActivityName)
$StartText = $StartResult.Output -join "`n"
if ($StartText -notmatch "Status:\s*ok") {
  throw "Activity launch did not report Status: ok.`n$StartText"
}

Start-Sleep -Seconds ([Math]::Max(1, $LaunchWaitSeconds))

$PackageInfo = Invoke-DeviceAdb -AdbArgs @("shell", "dumpsys", "package", $PackageName)
$PackageText = $PackageInfo.Output -join "`n"
if ($PackageText -notmatch "versionName=1\.701\.0" -or $PackageText -notmatch "versionCode=170100") {
  throw "Installed package version check failed"
}

$ProcessConfirmed = Test-PackageProcess
if (-not $ProcessConfirmed) {
  throw "Installed package did not keep a running process after launch."
}

$WindowInfo = Invoke-DeviceAdb -AdbArgs @("shell", "dumpsys", "window")
$FocusText = $WindowInfo.Output -join "`n"
$ActivityInfo = Invoke-DeviceAdb -AdbArgs @("shell", "dumpsys", "activity", "activities") -AllowFailure
$ActivityText = $ActivityInfo.Output -join "`n"
$ForegroundConfirmed = ($FocusText -match [regex]::Escape($PackageName)) -or ($ActivityText -match [regex]::Escape($PackageName))
if (-not $ForegroundConfirmed) {
  throw "APK installed and launch command ran, but foreground package could not be confirmed from dumpsys."
}

$Logcat = Invoke-DeviceAdb -AdbArgs @("logcat", "-d", "-v", "time") -AllowFailure
Assert-NoLaunchCrash -LogText ($Logcat.Output -join "`n")

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
}
