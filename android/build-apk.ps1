param(
  [ValidateSet("debug", "release")]
  [string]$Configuration = "release"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$AndroidHome = $env:ANDROID_HOME
if (-not $AndroidHome) { $AndroidHome = $env:ANDROID_SDK_ROOT }
if (-not $AndroidHome) { $AndroidHome = "C:\Android\android-sdk" }
$AndroidHome = [System.IO.Path]::GetFullPath($AndroidHome)

$JavaHome = $env:JAVA_HOME
if (-not $JavaHome -or (-not (Test-Path (Join-Path $JavaHome "bin\javac.exe")) -and -not (Test-Path (Join-Path $JavaHome "bin\javac")))) {
  $JavaHome = "C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot"
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
  return $Candidates[0]
}

$Platform = Join-Path $AndroidHome "platforms\android-35\android.jar"
$BuildTools = Join-Path $AndroidHome "build-tools\35.0.0"
$Manifest = Join-Path $PSScriptRoot "src\main\AndroidManifest.xml"
$Aapt2 = Resolve-Tool $BuildTools "aapt2"
$D8 = Resolve-Tool $BuildTools "d8"
$Zipalign = Resolve-Tool $BuildTools "zipalign"
$Apksigner = Resolve-Tool $BuildTools "apksigner"
$Keytool = Resolve-Tool (Join-Path $JavaHome "bin") "keytool"
$Javac = Resolve-Tool (Join-Path $JavaHome "bin") "javac"
$Jar = Resolve-Tool (Join-Path $JavaHome "bin") "jar"

foreach ($Path in @($Platform, $Manifest, $Aapt2, $D8, $Zipalign, $Apksigner, $Keytool, $Javac, $Jar)) {
  if (-not (Test-Path $Path)) { throw "Missing Android build dependency: $Path" }
}

$env:JAVA_HOME = $JavaHome

$ManifestText = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8
$VersionNameMatch = [regex]::Match($ManifestText, 'android:versionName="([^"]+)"')
$VersionName = if ($VersionNameMatch.Success) { $VersionNameMatch.Groups[1].Value } else { "0.0.0" }

$StageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("naonao-android-build-" + [guid]::NewGuid().ToString("N"))
$StageRoot = [System.IO.Path]::GetFullPath($StageRoot)
$TempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
if (-not $StageRoot.StartsWith($TempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use unexpected staging directory: $StageRoot"
}

$BuildDir = Join-Path $StageRoot "build"
$GenDir = Join-Path $BuildDir "gen"
$ClassDir = Join-Path $BuildDir "classes"
$DexDir = Join-Path $BuildDir "dex"
$CompiledDir = Join-Path $BuildDir "compiled"
$UnsignedApk = Join-Path $BuildDir "naonao-unsigned.apk"
$UnalignedApk = Join-Path $BuildDir "naonao-unaligned.apk"
$AlignedApk = Join-Path $BuildDir "naonao-aligned.apk"
$DeliverableDir = Join-Path $RepoRoot "deliverables\android"
$KeystoreDir = Join-Path $PSScriptRoot ".keystore"
if ($Configuration -eq "release") {
  $Keystore = Join-Path $KeystoreDir "naonao-release-local.jks"
  $KeyAlias = "naonaorelease"
  $KeyPassword = "naonao-release"
  $KeyDname = "CN=NAONAO Android Local Release,O=NAONAO,C=CN"
  $FinalApk = Join-Path $DeliverableDir "naonao-android-$VersionName.apk"
} else {
  $Keystore = Join-Path $KeystoreDir "naonao-debug.jks"
  $KeyAlias = "androiddebugkey"
  $KeyPassword = "android"
  $KeyDname = "CN=NAONAO Android Debug,O=NAONAO,C=CN"
  $FinalApk = Join-Path $DeliverableDir "naonao-android-debug.apk"
}

try {
  New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "src") -Destination (Join-Path $StageRoot "src") -Recurse -Force

  New-Item -ItemType Directory -Force -Path $GenDir, $ClassDir, $DexDir, $CompiledDir, $DeliverableDir, $KeystoreDir | Out-Null

  $StageMain = Join-Path $StageRoot "src\main"
  $BuildInfoPath = Join-Path $StageMain "assets\build-info.json"
  $SourceRoot = Join-Path $PSScriptRoot "src\main"
  $BuildFiles = Get-ChildItem -LiteralPath $SourceRoot -Recurse -File |
    Where-Object { $_.FullName -ne (Join-Path $SourceRoot "assets\build-info.json") } |
    Sort-Object FullName |
    ForEach-Object {
      $RelativePath = $_.FullName.Substring($SourceRoot.Length + 1).Replace("\", "/")
      [pscustomobject]@{
        path = $RelativePath
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
      }
    }
  $DigestInput = ($BuildFiles | ForEach-Object { "$($_.path)=$($_.sha256)" }) -join "`n"
  $DigestBytes = [System.Text.Encoding]::UTF8.GetBytes($DigestInput)
  $SourceDigest = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($DigestBytes)).Replace("-", "")
  $BuildInfo = [pscustomobject]@{
    package = "com.naonao.app.android"
    versionName = $VersionName
    sourceDigest = $SourceDigest
    files = $BuildFiles
  }
  $BuildInfo | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $BuildInfoPath -Encoding UTF8

  & $Aapt2 compile --dir (Join-Path $StageMain "res") -o $CompiledDir
  if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

  $FlatFiles = Get-ChildItem -Path $CompiledDir -Filter *.flat | ForEach-Object { $_.FullName }
  & $Aapt2 link `
    -o $UnsignedApk `
    -I $Platform `
    --manifest (Join-Path $StageMain "AndroidManifest.xml") `
    --java $GenDir `
    --min-sdk-version 23 `
    --target-sdk-version 35 `
    -A (Join-Path $StageMain "assets") `
    $FlatFiles
  if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

  $Sources = @()
  $Sources += Get-ChildItem -Path (Join-Path $StageMain "java") -Filter *.java -Recurse | ForEach-Object { $_.FullName }
  $Sources += Get-ChildItem -Path $GenDir -Filter *.java -Recurse | ForEach-Object { $_.FullName }
  $SourceList = Join-Path $BuildDir "sources.txt"
  [System.IO.File]::WriteAllLines($SourceList, [string[]]$Sources, [System.Text.UTF8Encoding]::new($false))

  & $Javac -encoding UTF-8 -source 8 -target 8 -classpath $Platform -d $ClassDir "@$SourceList"
  if ($LASTEXITCODE -ne 0) { throw "javac failed" }

  $ClassFiles = Get-ChildItem -Path $ClassDir -Filter *.class -Recurse | ForEach-Object { $_.FullName }
  & $D8 --min-api 23 --lib $Platform --output $DexDir $ClassFiles
  if ($LASTEXITCODE -ne 0) { throw "d8 failed" }

  Copy-Item -LiteralPath $UnsignedApk -Destination $UnalignedApk -Force
  Push-Location $DexDir
  try {
    & $Jar uf $UnalignedApk classes.dex
    if ($LASTEXITCODE -ne 0) { throw "jar update failed" }
  } finally {
    Pop-Location
  }

  if (-not (Test-Path $Keystore)) {
    & $Keytool -genkeypair `
      -keystore $Keystore `
      -storepass $KeyPassword `
      -keypass $KeyPassword `
      -alias $KeyAlias `
      -keyalg RSA `
      -keysize 2048 `
      -validity 10000 `
      -dname $KeyDname
    if ($LASTEXITCODE -ne 0) { throw "$Configuration keystore generation failed" }
  }

  & $Zipalign -p -f 4 $UnalignedApk $AlignedApk
  if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

  & $Apksigner sign `
    --ks $Keystore `
    --ks-pass "pass:$KeyPassword" `
    --key-pass "pass:$KeyPassword" `
    --out $FinalApk `
    $AlignedApk
  if ($LASTEXITCODE -ne 0) { throw "apksigner sign failed" }

  & $Apksigner verify --verbose --print-certs $FinalApk
  if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed" }

  $RelativeApk = "deliverables\android\" + [System.IO.Path]::GetFileName($FinalApk)
  Write-Host "APK built: $RelativeApk"
} finally {
  if (Test-Path $StageRoot) {
    Remove-Item -LiteralPath $StageRoot -Recurse -Force
  }
}
