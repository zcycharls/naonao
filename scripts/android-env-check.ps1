param(
  [string]$AndroidHome = $env:ANDROID_HOME,
  [switch]$SkipRemoteSdkList
)

$ErrorActionPreference = "Stop"

if (-not $AndroidHome) { $AndroidHome = $env:ANDROID_SDK_ROOT }
if (-not $AndroidHome) { $AndroidHome = "C:\Android\android-sdk" }
$AndroidHome = [System.IO.Path]::GetFullPath($AndroidHome)

function Test-PathValue($Path) {
  if ($Path -and (Test-Path -LiteralPath $Path)) { return $Path }
  return $null
}

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
  return $null
}

function Get-CommandOutput($Command, $Arguments = @(), $TimeoutSeconds = 20) {
  if (-not (Test-Path -LiteralPath $Command)) {
    return [pscustomobject]@{ ExitCode = $null; Output = "missing: $Command" }
  }
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $Command
  $psi.Arguments = ($Arguments | ForEach-Object {
    if ($_ -match '\s') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join " "
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $process = [System.Diagnostics.Process]::Start($psi)
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill()
    return [pscustomobject]@{ ExitCode = $null; Output = "timeout after ${TimeoutSeconds}s" }
  }
  $output = ($process.StandardOutput.ReadToEnd() + $process.StandardError.ReadToEnd()).Trim()
  [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $output }
}

$Java17 = Test-PathValue "C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot\bin\java.exe"
if (-not $Java17 -and $env:JAVA_HOME) { $Java17 = Resolve-Tool (Join-Path $env:JAVA_HOME "bin") "java" }
$Java8 = Test-PathValue "C:\Program Files\Java\jdk1.8.0_211\bin\java.exe"
$SdkManager = Resolve-Tool (Join-Path $AndroidHome "tools\bin") "sdkmanager"
if (-not $SdkManager) { $SdkManager = Resolve-Tool (Join-Path $AndroidHome "cmdline-tools\latest\bin") "sdkmanager" }
$AvdManager = Resolve-Tool (Join-Path $AndroidHome "tools\bin") "avdmanager"
if (-not $AvdManager) { $AvdManager = Resolve-Tool (Join-Path $AndroidHome "cmdline-tools\latest\bin") "avdmanager" }
$LegacyEmulator = Resolve-Tool (Join-Path $AndroidHome "tools") "emulator"
$ModernEmulator = Resolve-Tool (Join-Path $AndroidHome "emulator") "emulator"
$Adb = Resolve-Tool (Join-Path $AndroidHome "platform-tools") "adb"
$SystemImages = Test-PathValue (Join-Path $AndroidHome "system-images")

$AdbDevices = if ($Adb) { Get-CommandOutput $Adb @("devices", "-l") 20 } else { $null }
$LegacyEmulatorVersion = if ($LegacyEmulator) { Get-CommandOutput $LegacyEmulator @("-version") 20 } else { $null }
$DeviceRows = @()
if ($AdbDevices) {
  $DeviceRows = @($AdbDevices.Output -split "\r?\n" | Where-Object { $_ -match "\bdevice\b" -and $_ -notmatch "^List of devices" })
}

$SdkReachable = $false
$SdkReachError = $null
try {
  if (Get-Command Test-NetConnection -ErrorAction SilentlyContinue) {
    $tcp = Test-NetConnection dl.google.com -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue
    $SdkReachable = [bool]$tcp
  } else {
    $tcp = [System.Net.Sockets.TcpClient]::new()
    $connect = $tcp.BeginConnect("dl.google.com", 443, $null, $null)
    if ($connect.AsyncWaitHandle.WaitOne(5000)) {
      $tcp.EndConnect($connect)
      $SdkReachable = $true
    }
    $tcp.Close()
  }
} catch {
  $SdkReachError = $_.Exception.Message
}

$LegacySdkManagerWithJava8 = $null
$LegacySdkManagerListWithJava8 = $null
if ($SdkManager -and $Java8) {
  $oldJavaHome = $env:JAVA_HOME
  $oldPath = $env:Path
  try {
    $env:JAVA_HOME = Split-Path (Split-Path $Java8 -Parent) -Parent
    $env:Path = (Split-Path $Java8 -Parent) + ";" + (Join-Path $AndroidHome "tools\bin") + ";" + $oldPath
    $LegacySdkManagerWithJava8 = Get-CommandOutput $SdkManager @("--version") 20
    if (-not $SkipRemoteSdkList) {
      $LegacySdkManagerListWithJava8 = Get-CommandOutput $SdkManager @("--list") 40
    }
  } finally {
    $env:JAVA_HOME = $oldJavaHome
    $env:Path = $oldPath
  }
}

[pscustomobject]@{
  AndroidHome = $AndroidHome
  Java17 = $Java17
  Java8 = $Java8
  SdkManager = $SdkManager
  AvdManager = $AvdManager
  ModernEmulator = $ModernEmulator
  LegacyEmulator = $LegacyEmulator
  SystemImages = $SystemImages
  Adb = $Adb
  ConnectedDevices = $DeviceRows.Count
  GoogleSdkSourceReachable = $SdkReachable
  GoogleSdkSourceError = $SdkReachError
  LegacySdkManagerExitCode = if ($LegacySdkManagerWithJava8) { $LegacySdkManagerWithJava8.ExitCode } else { $null }
  LegacySdkManagerOutput = if ($LegacySdkManagerWithJava8) { $LegacySdkManagerWithJava8.Output } else { $null }
  LegacySdkManagerListExitCode = if ($LegacySdkManagerListWithJava8) { $LegacySdkManagerListWithJava8.ExitCode } else { $null }
  LegacySdkManagerListOutput = if ($LegacySdkManagerListWithJava8) { $LegacySdkManagerListWithJava8.Output } else { $null }
  LegacyEmulatorVersionExitCode = if ($LegacyEmulatorVersion) { $LegacyEmulatorVersion.ExitCode } else { $null }
  LegacyEmulatorVersionOutput = if ($LegacyEmulatorVersion) { $LegacyEmulatorVersion.Output } else { $null }
}
