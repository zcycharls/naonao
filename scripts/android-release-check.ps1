param(
  [switch]$Rebuild,
  [switch]$RequireDevice,
  [string]$DeviceSerial = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $RepoRoot
try {
  if (-not $env:JAVA_HOME) {
    $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot"
  }
  if (-not $env:ANDROID_HOME) {
    if ($env:ANDROID_SDK_ROOT) {
      $env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
    } else {
      $env:ANDROID_HOME = "C:\Android\android-sdk"
    }
  }
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  $PathSeparator = [System.IO.Path]::PathSeparator
  $env:Path = @(
    (Join-Path $env:JAVA_HOME "bin"),
    (Join-Path $env:ANDROID_HOME "platform-tools"),
    (Join-Path $env:ANDROID_HOME "build-tools\35.0.0"),
    $env:Path
  ) -join $PathSeparator

  if ($Rebuild) {
    & .\android\build-apk.ps1 -Configuration release
    & .\android\build-apk.ps1 -Configuration debug
  }

  node --check android\src\main\assets\app.js
  node --check scripts\android-state-tests.js
  node --check scripts\android-smoke.js
  node scripts\android-state-tests.js
  node scripts\android-smoke.js

  $ApkInfo = & .\scripts\android-verify-apk.ps1
  $EnvInfo = .\scripts\android-env-check.ps1 -SkipRemoteSdkList

  $ManifestText = Get-Content -LiteralPath android\src\main\AndroidManifest.xml -Raw -Encoding UTF8
  $VersionName = [regex]::Match($ManifestText, 'android:versionName="([^"]+)"').Groups[1].Value
  if (-not $VersionName) { throw "Could not read Android versionName from manifest" }
  $ReleaseApk = "deliverables\android\naonao-android-$VersionName.apk"
  $DebugApk = "deliverables\android\naonao-android-debug.apk"
  $ReleaseHash = (Get-FileHash -Algorithm SHA256 $ReleaseApk).Hash
  $DebugHash = (Get-FileHash -Algorithm SHA256 $DebugApk).Hash
  $BuildInfoRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("naonao-release-check-" + [guid]::NewGuid().ToString("N"))
  $BuildInfoRoot = [System.IO.Path]::GetFullPath($BuildInfoRoot)
  $TempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if (-not $BuildInfoRoot.StartsWith($TempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use unexpected temp directory: $BuildInfoRoot"
  }
  try {
    New-Item -ItemType Directory -Force -Path $BuildInfoRoot | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path $ReleaseApk), $BuildInfoRoot)
    $BuildInfo = Get-Content -LiteralPath (Join-Path $BuildInfoRoot "assets\build-info.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $SourceDigest = [string]$BuildInfo.sourceDigest
  } finally {
    if (Test-Path -LiteralPath $BuildInfoRoot) {
      Remove-Item -LiteralPath $BuildInfoRoot -Recurse -Force
    }
  }
  if (-not (Select-String -LiteralPath deliverables\android\INSTALL.md -SimpleMatch $ReleaseHash -Quiet)) {
    throw "INSTALL.md release hash mismatch: $ReleaseHash"
  }
  if (-not (Select-String -LiteralPath deliverables\android\VERIFY.md -SimpleMatch $ReleaseHash -Quiet)) {
    throw "VERIFY.md release hash mismatch: $ReleaseHash"
  }
  if (-not (Select-String -LiteralPath deliverables\android\VERIFY.md -SimpleMatch $DebugHash -Quiet)) {
    throw "VERIFY.md debug hash mismatch: $DebugHash"
  }
  if (-not (Select-String -LiteralPath deliverables\android\VERIFY.md -SimpleMatch $SourceDigest -Quiet)) {
    throw "VERIFY.md sourceDigest mismatch: $SourceDigest"
  }

  $InstallSmoke = "skipped: no connected Android device"
  if ($DeviceSerial -or $EnvInfo.ConnectedDevices -eq 1 -or $RequireDevice) {
    $InstallArgs = @{
      ApkPath = $ReleaseApk
      EvidenceDir = "deliverables\android\install-smoke"
      SkipApkVerify = $true
    }
    if ($DeviceSerial) { $InstallArgs.DeviceSerial = $DeviceSerial }
    & .\scripts\android-install-smoke.ps1 @InstallArgs
    $InstallSmoke = "passed"
  }

  $OldErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $DiffCheck = & git diff --check 2>&1 | Out-String
    $DiffExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $OldErrorActionPreference
  }
  if ($DiffExitCode -ne 0) {
    throw "git diff --check failed.`n$DiffCheck"
  }

  [pscustomobject]@{
    ReleaseApk = (Resolve-Path $ReleaseApk).Path
    ReleaseSha256 = $ReleaseHash
    DebugSha256 = $DebugHash
    Package = $ApkInfo.Package
    VersionName = $ApkInfo.VersionName
    VersionCode = $ApkInfo.VersionCode
    SourceDigest = $SourceDigest
    ApkVerification = $ApkInfo.SourceGuards
    AndroidSmoke = "passed"
    EnvConnectedDevices = $EnvInfo.ConnectedDevices
    EnvModernEmulator = $EnvInfo.ModernEmulator
    EnvSystemImages = $EnvInfo.SystemImages
    InstallSmoke = $InstallSmoke
  }
} finally {
  Pop-Location
}
