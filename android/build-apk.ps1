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
function Test-JavaHome {
  param([string]$Path)
  if (-not $Path) { return $false }
  $Java = Join-Path $Path "bin\java.exe"
  $Javac = Join-Path $Path "bin\javac.exe"
  if (-not (Test-Path -LiteralPath $Java) -or -not (Test-Path -LiteralPath $Javac)) { return $false }
  try {
    $Major = (Get-Item -LiteralPath $Java).VersionInfo.ProductMajorPart
    return $Major -ge 17
  } catch {
    return $false
  }
}
$JavaCandidates = @(
  $env:JAVA_HOME,
  "C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot",
  "C:\Program Files\Eclipse Adoptium\jdk-17.0.16.8-hotspot",
  "C:\Program Files\Java\jdk-17"
) | Where-Object { $_ } | Select-Object -Unique
$JavaHome = $JavaCandidates | Where-Object { Test-JavaHome $_ } | Select-Object -First 1
if (-not $JavaHome) {
  throw "Missing JDK 17+. Android build-tools 35 D8 cannot run on Java 8. Set JAVA_HOME to a JDK 17 installation."
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

$ModelName = "Xenova/Qwen1.5-0.5B-Chat"
$ModelRevision = "340777bb38067a8a5af921a405e3206a8cc2f318"
$ModelRelativeDir = Join-Path "Xenova" "Qwen1.5-0.5B-Chat"
$AppDataAppDirName = [string]([char]0x5B6C) + [string]([char]0x5B6C)
$ModelRequiredFiles = @(
  [pscustomobject]@{ file = "config.json"; size = 677; sha256 = "347b4bab02495e69e6c460cb0de4f5db0fa8f9d7cf188aea2fc36ca5b7bd58fb" },
  [pscustomobject]@{ file = "generation_config.json"; size = 179; sha256 = "4a438118078e120d18b7fe4dbf884041d3c999e90b27346ee295cfb9e7f15ad7" },
  [pscustomobject]@{ file = "tokenizer.json"; size = 7028015; sha256 = "f7c9b2dba4a296b1aa76c16a34b8225c0c118978400d4bb66bff0902d702f5b8" },
  [pscustomobject]@{ file = "tokenizer_config.json"; size = 1168; sha256 = "fb7a9aad08c87a3e8a90fa7557e8039f0a122d90b07afed374bd825928c42510" },
  [pscustomobject]@{ file = "onnx/decoder_model_merged_quantized.onnx"; size = 482326147; sha256 = "068cad70fa3850652e6ebc0ad7a49847568f32e6eda5a8527e5893de9a7b8939" }
)

function Get-RelativePath {
  param(
    [string]$BasePath,
    [string]$Path
  )
  $BaseFull = [System.IO.Path]::GetFullPath($BasePath).TrimEnd('\', '/')
  $PathFull = [System.IO.Path]::GetFullPath($Path)
  if (-not $PathFull.StartsWith($BaseFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside base path: $PathFull"
  }
  return $PathFull.Substring($BaseFull.Length + 1)
}

function Resolve-ModelLayout {
  $Roots = @()
  if ($env:NAONAO_ANDROID_MODEL_ROOT) { $Roots += [System.IO.Path]::GetFullPath($env:NAONAO_ANDROID_MODEL_ROOT) }
  $Roots += (Join-Path $RepoRoot "app\models")
  if ($env:APPDATA) { $Roots += (Join-Path $env:APPDATA (Join-Path $AppDataAppDirName "models")) }
  if ($env:LOCALAPPDATA) { $Roots += (Join-Path $env:LOCALAPPDATA (Join-Path $AppDataAppDirName "models")) }
  if ($env:USERPROFILE) {
    $Roots += (Join-Path $env:USERPROFILE ".cache\huggingface\hub\models--Xenova--Qwen1.5-0.5B-Chat")
    $Roots += (Join-Path $env:USERPROFILE ".cache\huggingface\hub")
  }

  foreach ($Root in ($Roots | Where-Object { $_ } | Select-Object -Unique)) {
    $Layouts = @(
      (Join-Path $Root $ModelRelativeDir),
      (Join-Path $Root (Join-Path ".cache" (Join-Path $ModelRelativeDir $ModelRevision))),
      (Join-Path $Root (Join-Path $ModelName $ModelRevision)),
      (Join-Path $Root (Join-Path "snapshots" $ModelRevision)),
      (Join-Path $Root (Join-Path "models--Xenova--Qwen1.5-0.5B-Chat" (Join-Path "snapshots" $ModelRevision)))
    )
    foreach ($LayoutRoot in ($Layouts | Select-Object -Unique)) {
      if (-not (Test-Path -LiteralPath $LayoutRoot)) { continue }
      $Files = @()
      $Ok = $true
      foreach ($Entry in $ModelRequiredFiles) {
        $FilePath = Join-Path $LayoutRoot ($Entry.file.Replace("/", "\"))
        if (-not (Test-Path -LiteralPath $FilePath)) { $Ok = $false; break }
        $Item = Get-Item -LiteralPath $FilePath
        if ($Item.Length -ne [int64]$Entry.size) { $Ok = $false; break }
        $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $FilePath).Hash.ToLowerInvariant()
        if ($Hash -ne $Entry.sha256) { $Ok = $false; break }
        $Files += [pscustomobject]@{ file = $Entry.file; path = $FilePath; size = [int64]$Entry.size; sha256 = $Entry.sha256 }
      }
      if ($Ok) {
        return [pscustomobject]@{ root = $LayoutRoot; files = $Files }
      }
    }
  }
  return $null
}

function Copy-DirectoryChildrenWithoutModels {
  param(
    [string]$Source,
    [string]$Destination
  )
  if (-not (Test-Path -LiteralPath $Source)) { throw "Missing client source directory: $Source" }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | Where-Object { $_.Name -ne "models" } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Destination $_.Name) -Recurse -Force
  }
}

function Copy-DirectoryChildren {
  param(
    [string]$Source,
    [string]$Destination
  )
  if (-not (Test-Path -LiteralPath $Source)) { throw "Missing source directory: $Source" }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Destination $_.Name) -Recurse -Force
  }
}

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
  $Keystore = if ($env:NAONAO_ANDROID_KEYSTORE_PATH) { [System.IO.Path]::GetFullPath($env:NAONAO_ANDROID_KEYSTORE_PATH) } else { Join-Path $KeystoreDir "naonao-release-local.jks" }
  $KeyAlias = if ($env:NAONAO_ANDROID_KEY_ALIAS) { $env:NAONAO_ANDROID_KEY_ALIAS } else { "naonaorelease" }
  $KeyPassword = if ($env:NAONAO_ANDROID_KEY_PASSWORD) { $env:NAONAO_ANDROID_KEY_PASSWORD } else { "naonao-release" }
  $StorePassword = if ($env:NAONAO_ANDROID_STORE_PASSWORD) { $env:NAONAO_ANDROID_STORE_PASSWORD } else { $KeyPassword }
  $KeyDname = "CN=NAONAO Android Local Release,O=NAONAO,C=CN"
  $AutoGenerateKeystore = -not $env:NAONAO_ANDROID_KEYSTORE_PATH
  $FinalApk = Join-Path $DeliverableDir "naonao-android-$VersionName.apk"
} else {
  $Keystore = Join-Path $KeystoreDir "naonao-debug.jks"
  $KeyAlias = "androiddebugkey"
  $KeyPassword = "android"
  $StorePassword = $KeyPassword
  $KeyDname = "CN=NAONAO Android Debug,O=NAONAO,C=CN"
  $AutoGenerateKeystore = $true
  $FinalApk = Join-Path $DeliverableDir "naonao-android-debug.apk"
}

try {
  New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "src") -Destination (Join-Path $StageRoot "src") -Recurse -Force

  New-Item -ItemType Directory -Force -Path $GenDir, $ClassDir, $DexDir, $CompiledDir, $DeliverableDir, $KeystoreDir | Out-Null

  $StageMain = Join-Path $StageRoot "src\main"
  $StageAssets = Join-Path $StageMain "assets"
  $ClientSourceRoot = Join-Path $RepoRoot "app"
  $BundledClientAssets = Join-Path $StageAssets "bundled-client"
  Copy-DirectoryChildrenWithoutModels -Source $ClientSourceRoot -Destination $BundledClientAssets

  $DesktopRuntimeSourceRoot = Join-Path $RepoRoot "dist\win-unpacked"
  if (-not (Test-Path -LiteralPath $DesktopRuntimeSourceRoot)) {
    throw "Missing desktop runtime directory for full Android APK: $DesktopRuntimeSourceRoot. Run npm run pack/build first."
  }
  $BundledDesktopRuntimeDir = Join-Path $StageAssets "desktop-runtime"
  New-Item -ItemType Directory -Force -Path $BundledDesktopRuntimeDir | Out-Null
  $BundledDesktopRuntimeArchive = Join-Path $BundledDesktopRuntimeDir "win-unpacked.zip"
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $BundledDesktopRuntimeArchive) {
    Remove-Item -LiteralPath $BundledDesktopRuntimeArchive -Force
  }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($DesktopRuntimeSourceRoot, $BundledDesktopRuntimeArchive, [System.IO.Compression.CompressionLevel]::Optimal, $false)

  $ModelLayout = Resolve-ModelLayout
  if (-not $ModelLayout) {
    throw "Missing complete local AI model for Android full APK. Expected $ModelName@$ModelRevision with verified files. Put it under app\models\$ModelRelativeDir, set NAONAO_ANDROID_MODEL_ROOT, or download the model before building."
  }
  $BundledModelRoot = Join-Path $StageAssets (Join-Path "models" $ModelRelativeDir)
  foreach ($Entry in $ModelLayout.files) {
    $Dest = Join-Path $BundledModelRoot ($Entry.file.Replace("/", "\"))
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Dest) | Out-Null
    Copy-Item -LiteralPath $Entry.path -Destination $Dest -Force
  }

  $BuildInfoPath = Join-Path $StageMain "assets\build-info.json"
  $SourceRoot = Join-Path $PSScriptRoot "src\main"
  $BuildFiles = @()
  $BuildFiles += Get-ChildItem -LiteralPath $SourceRoot -Recurse -File |
    Where-Object { $_.FullName -ne (Join-Path $SourceRoot "assets\build-info.json") } |
    Sort-Object FullName |
    ForEach-Object {
      $RelativePath = $_.FullName.Substring($SourceRoot.Length + 1).Replace("\", "/")
      $AssetPath = if ($RelativePath.StartsWith("assets/")) { $RelativePath } else { $null }
      [pscustomobject]@{
        kind = "android"
        sourcePath = "android/src/main/$RelativePath"
        assetPath = $AssetPath
        bytes = $_.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
      }
    }
  $BuildFiles += Get-ChildItem -LiteralPath $ClientSourceRoot -Recurse -File |
    Where-Object { (Get-RelativePath -BasePath $ClientSourceRoot -Path $_.FullName) -notmatch '^[\\/]?models[\\/]' } |
    Sort-Object FullName |
    ForEach-Object {
      $RelativePath = (Get-RelativePath -BasePath $ClientSourceRoot -Path $_.FullName).Replace("\", "/")
      [pscustomobject]@{
        kind = "bundled-client"
        sourcePath = "app/$RelativePath"
        assetPath = "assets/bundled-client/$RelativePath"
        bytes = $_.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
      }
    }
  $BuildFiles += Get-ChildItem -LiteralPath $DesktopRuntimeSourceRoot -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
      $RelativePath = (Get-RelativePath -BasePath $DesktopRuntimeSourceRoot -Path $_.FullName).Replace("\", "/")
      [pscustomobject]@{
        kind = "desktop-runtime"
        sourcePath = "dist/win-unpacked/$RelativePath"
        assetPath = $null
        bytes = $_.Length
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
      }
    }
  $BuildFiles += $ModelLayout.files | ForEach-Object {
      $RelativePath = $_.file
      [pscustomobject]@{
        kind = "bundled-model"
        sourcePath = "$ModelName/$ModelRevision/$RelativePath"
        assetPath = "assets/models/$($ModelRelativeDir.Replace('\', '/'))/$RelativePath"
        bytes = [int64]$_.size
        sha256 = $_.sha256
      }
    }
  $DigestInput = ($BuildFiles | Sort-Object assetPath, sourcePath | ForEach-Object { "$($_.kind)|$($_.sourcePath)|$($_.assetPath)|$($_.bytes)|$($_.sha256)" }) -join "`n"
  $DigestBytes = [System.Text.Encoding]::UTF8.GetBytes($DigestInput)
  $SourceDigest = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($DigestBytes)).Replace("-", "")
  $BuildInfo = [pscustomobject]@{
    package = "com.naonao.app.android"
    versionName = $VersionName
    bundle = "full-android-client"
    sourceDigest = $SourceDigest
    bundledClientRoot = "assets/bundled-client"
    bundledDesktopRuntimeArchive = [pscustomobject]@{
      path = "assets/desktop-runtime/win-unpacked.zip"
      bytes = (Get-Item -LiteralPath $BundledDesktopRuntimeArchive).Length
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $BundledDesktopRuntimeArchive).Hash.ToLowerInvariant()
    }
    bundledModel = [pscustomobject]@{
      name = $ModelName
      revision = $ModelRevision
      root = "assets/models/$($ModelRelativeDir.Replace('\', '/'))"
      bytes = ($ModelRequiredFiles | Measure-Object -Property size -Sum).Sum
    }
    files = $BuildFiles
  }
  $BuildInfo | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $BuildInfoPath -Encoding UTF8

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
    if (-not $AutoGenerateKeystore) {
      throw "Configured release keystore does not exist: $Keystore"
    }
    & $Keytool -genkeypair `
      -keystore $Keystore `
      -storepass $StorePassword `
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
    --ks-pass "pass:$StorePassword" `
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
