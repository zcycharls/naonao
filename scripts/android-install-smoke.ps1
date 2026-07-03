param(
  [string]$ApkPath = "",
  [string]$EvidenceDir = "deliverables\android\install-smoke",
  [string]$DeviceSerial = "",
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
$RepoRoot = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $PSScriptRoot "..")).Path)
$AndroidManifest = Join-Path $RepoRoot "android\src\main\AndroidManifest.xml"
$ManifestText = Get-Content -LiteralPath $AndroidManifest -Raw -Encoding UTF8
$VersionName = [regex]::Match($ManifestText, 'android:versionName="([^"]+)"').Groups[1].Value
$VersionCode = [int][regex]::Match($ManifestText, 'android:versionCode="(\d+)"').Groups[1].Value
if (-not $VersionName -or -not $VersionCode) {
  throw "Could not read Android version from $AndroidManifest"
}
if (-not $ApkPath) {
  $ApkPath = "deliverables\android\naonao-android-$VersionName.apk"
}
$ResolvedApk = (Resolve-Path $ApkPath).Path
$ResolvedEvidenceDir = [System.IO.Path]::GetFullPath($EvidenceDir)
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
if ($DeviceSerial) {
  $MatchingRows = @($DeviceRows | Where-Object { ($_ -split "\s+")[0] -eq $DeviceSerial })
  if ($MatchingRows.Count -ne 1) {
    $State = & $Adb -s $DeviceSerial shell getprop sys.boot_completed 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Requested Android device is not connected: $DeviceSerial.`n$($Devices -join "`n")`n$($State -join "`n")"
    }
    $DeviceRows = @("$DeviceSerial device")
  } else {
    $DeviceRows = $MatchingRows
  }
} elseif ($DeviceRows.Count -ne 1) {
  throw "Expected exactly one connected Android device, found $($DeviceRows.Count). Pass -DeviceSerial when multiple adb targets exist.`n$($Devices -join "`n")"
}
$DeviceSerial = ($DeviceRows[0].Trim() -split "\s+")[0]

function Invoke-DeviceAdb {
  param(
    [string[]]$AdbArgs,
    [switch]$AllowFailure
  )
  $OldErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $Output = & $Adb -s $DeviceSerial @AdbArgs 2>&1
    $ExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $OldErrorActionPreference
  }
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

function Assert-WebViewReady {
  param([string]$LogText)

  $SmokeMatch = [regex]::Match($LogText, "NAONAO_SMOKE[\s\S]{0,1000}")
  if (-not $SmokeMatch.Success) {
    throw "Launch logcat did not contain the Android WebView readiness marker."
  }

  $SmokeWindow = $SmokeMatch.Value
  $SmokeLines = @($SmokeWindow -split "`n" | Where-Object { $_ -match "NAONAO_SMOKE" })
  foreach ($Line in $SmokeLines) {
    $PayloadMatch = [regex]::Match($Line, "NAONAO_SMOKE\([^)]*\):\s*(?<payload>.*)$")
    if (-not $PayloadMatch.Success) { continue }
    $Payload = $PayloadMatch.Groups["payload"].Value.Trim()
    try {
      $DecodedPayload = $Payload | ConvertFrom-Json
      if ($DecodedPayload -is [string]) {
        $ReadyState = $DecodedPayload | ConvertFrom-Json
      } else {
        $ReadyState = $DecodedPayload
      }
      if ($ReadyState.title -eq "孬孬 Android" -and
          [int]$ReadyState.nav -eq 5 -and
          [bool]$ReadyState.home -and
          [bool]$ReadyState.naonao -and
          [bool]$ReadyState.bridge) {
        return
      }
    } catch {
      continue
    }
  }

  $NormalizedSmoke = $SmokeWindow -replace "\\", ""
  if ($NormalizedSmoke -match '"title"\s*:\s*"[^"]+"' -and
      $NormalizedSmoke -match '"nav"\s*:\s*5' -and
      $NormalizedSmoke -match '"home"\s*:\s*true' -and
      $NormalizedSmoke -match '"naonao"\s*:\s*true' -and
      $NormalizedSmoke -match '"bridge"\s*:\s*true') {
    return
  }

  throw "Launch logcat contained NAONAO_SMOKE but not the expected WebView readiness state.`n$SmokeWindow"
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
if ($PackageText -notmatch "versionName=$([regex]::Escape($VersionName))" -or $PackageText -notmatch "versionCode=$VersionCode") {
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
Assert-WebViewReady -LogText $LogcatText

$ScreenshotPath = Join-Path $ResolvedEvidenceDir "launch.png"
$RemoteScreenshot = "/sdcard/Download/naonao-install-smoke-launch.png"
Invoke-DeviceAdb -AdbArgs @("shell", "screencap", "-p", $RemoteScreenshot) | Out-Null
$PullOutput = Invoke-DeviceAdb -AdbArgs @("pull", $RemoteScreenshot, $ScreenshotPath) -AllowFailure
Invoke-DeviceAdb -AdbArgs @("shell", "rm", "-f", $RemoteScreenshot) -AllowFailure | Out-Null
if ($PullOutput.ExitCode -ne 0) {
  Write-EvidenceText -Name "screencap-error.txt" -Text ($PullOutput.Output -join "`n") | Out-Null
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
  versionName = $VersionName
  versionCode = $VersionCode
  evidenceDir = $ResolvedEvidenceDir
  files = @{
    start = "am-start.txt"
    package = "dumpsys-package.txt"
    window = "dumpsys-window.txt"
    activities = "dumpsys-activities.txt"
    logcat = "logcat.txt"
    screenshot = "launch.png"
  }
  webViewReady = "passed"
}
$ReportPath = Join-Path $ResolvedEvidenceDir "install-smoke-report.json"
$Report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportPath -Encoding UTF8

[pscustomobject]@{
  Apk = $ResolvedApk
  Device = $DeviceRows[0].Trim()
  Package = $PackageName
  VersionName = $VersionName
  VersionCode = $VersionCode
  Install = "passed"
  Launch = "passed"
  Process = "passed"
  ForegroundConfirmed = $ForegroundConfirmed
  LaunchCrashScan = "passed"
  WebViewReady = "passed"
  Screenshot = $ScreenshotPath
  EvidenceDir = $ResolvedEvidenceDir
  Report = $ReportPath
}
