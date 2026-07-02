param(
  [string]$ApkPath = "deliverables\android\naonao-android-1.701.0.apk"
)

$ErrorActionPreference = "Stop"

$AndroidHome = $env:ANDROID_HOME
if (-not $AndroidHome) { $AndroidHome = $env:ANDROID_SDK_ROOT }
if (-not $AndroidHome) { $AndroidHome = "C:\Android\android-sdk" }
$JavaHome = $env:JAVA_HOME
if (-not $JavaHome) { $JavaHome = "C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot" }

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

$Aapt = Resolve-Tool (Join-Path $AndroidHome "build-tools\35.0.0") "aapt"
$Apksigner = Resolve-Tool (Join-Path $AndroidHome "build-tools\35.0.0") "apksigner"
$Java = Resolve-Tool (Join-Path $JavaHome "bin") "java"
foreach ($Path in @($Aapt, $Apksigner, $Java)) {
  if (-not (Test-Path $Path)) { throw "Missing verification dependency: $Path" }
}

$ResolvedApk = Resolve-Path $ApkPath
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("naonao-verify-" + [guid]::NewGuid().ToString("N"))
$TempRoot = [System.IO.Path]::GetFullPath($TempRoot)
$SystemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
if (-not $TempRoot.StartsWith($SystemTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use unexpected temp directory: $TempRoot"
}
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
$TempApk = Join-Path $TempRoot ([System.IO.Path]::GetFileName($ResolvedApk))
Copy-Item -LiteralPath $ResolvedApk -Destination $TempApk -Force

$env:JAVA_HOME = $JavaHome
$env:Path = (Join-Path $JavaHome "bin") + ";" + (Join-Path $AndroidHome "build-tools\35.0.0") + ";" + $env:Path

try {
  $Badging = & $Aapt dump badging $TempApk
  if ($LASTEXITCODE -ne 0) { throw "aapt badging failed" }
  $Signature = & $Apksigner verify --verbose $TempApk
  if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed" }

  $AppLabel = "application-label:'" + [string]([char]0x5B6C) + [string]([char]0x5B6C) + "'"
  $Required = @(
    "package: name='com.naonao.app.android'",
    "versionCode='170100'",
    "versionName='1.701.0'",
    "sdkVersion:'23'",
    "targetSdkVersion:'35'",
    $AppLabel,
    "launchable-activity: name='com.naonao.app.android.MainActivity'",
    "uses-permission: name='android.permission.INTERNET'",
    "uses-permission: name='android.permission.POST_NOTIFICATIONS'",
    "uses-permission: name='android.permission.RECEIVE_BOOT_COMPLETED'"
  )

  $Joined = ($Badging -join "`n")
  foreach ($Needle in $Required) {
    if (-not $Joined.Contains($Needle)) {
      throw "APK metadata check failed: missing [$Needle]"
    }
  }
  foreach ($Forbidden in @("application-debuggable", "testOnly='true'", "debuggable='true'")) {
    if ($Joined.Contains($Forbidden)) {
      throw "APK metadata check failed: forbidden [$Forbidden]"
    }
  }
  $SignatureText = $Signature -join "`n"
  foreach ($Scheme in @("v1 scheme (JAR signing): true", "v2 scheme (APK Signature Scheme v2): true", "v3 scheme (APK Signature Scheme v3): true")) {
    if (-not $SignatureText.Contains("Verified using $Scheme")) {
      throw "APK signature check failed: $Scheme"
    }
  }

  $ZipRoot = Join-Path $TempRoot "apk"
  New-Item -ItemType Directory -Force -Path $ZipRoot | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($TempApk, $ZipRoot)
  $RequiredEntries = @(
    "classes.dex",
    "AndroidManifest.xml",
    "assets\index.html",
    "assets\styles.css",
    "assets\app.js",
    "assets\build-info.json",
    "res\xml\network_security_config.xml"
  )
  foreach ($Entry in $RequiredEntries) {
    if (-not (Test-Path (Join-Path $ZipRoot $Entry))) {
      throw "APK content check failed: missing $Entry"
    }
  }
  foreach ($Entry in @("assets\index.html", "assets\styles.css", "assets\app.js", "classes.dex")) {
    $Item = Get-Item (Join-Path $ZipRoot $Entry)
    if ($Item.Length -lt 1000) {
      throw "APK content check failed: $Entry unexpectedly small"
    }
  }

  $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
  $AndroidMain = Join-Path $RepoRoot "android\src\main"
  $BuildInfo = Get-Content -LiteralPath (Join-Path $ZipRoot "assets\build-info.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($BuildInfo.package -ne "com.naonao.app.android" -or $BuildInfo.versionName -ne "1.701.0") {
    throw "APK content check failed: build-info metadata mismatch"
  }
  if (-not $BuildInfo.files -or $BuildInfo.files.Count -lt 10) {
    throw "APK content check failed: build-info source manifest is incomplete"
  }
  $CurrentSourceFiles = Get-ChildItem -LiteralPath $AndroidMain -Recurse -File |
    Where-Object { $_.FullName -ne (Join-Path $AndroidMain "assets\build-info.json") } |
    ForEach-Object { $_.FullName.Substring($AndroidMain.Length + 1).Replace("\", "/") } |
    Sort-Object
  $BuildInfoPaths = @($BuildInfo.files | ForEach-Object { [string]$_.path } | Sort-Object)
  $PathDiff = Compare-Object -ReferenceObject $CurrentSourceFiles -DifferenceObject $BuildInfoPaths
  if ($PathDiff) {
    throw "APK content check failed: build-info source file set does not match current source"
  }
  if (($BuildInfoPaths | Select-Object -Unique).Count -ne $BuildInfoPaths.Count) {
    throw "APK content check failed: build-info contains duplicate source paths"
  }
  foreach ($FileEntry in $BuildInfo.files) {
    $RelativePath = [string]$FileEntry.path
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or $RelativePath.Contains("..") -or [System.IO.Path]::IsPathRooted($RelativePath)) {
      throw "APK content check failed: invalid build-info path $RelativePath"
    }
    $SourcePath = Join-Path $AndroidMain ($RelativePath.Replace("/", "\"))
    if (-not (Test-Path -LiteralPath $SourcePath)) {
      throw "APK content check failed: build-info source missing $RelativePath"
    }
    $SourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $SourcePath).Hash
    if ($SourceHash -ne [string]$FileEntry.sha256) {
      throw "APK content check failed: $RelativePath does not match current source"
    }
    if ($RelativePath.StartsWith("assets/")) {
      $ApkAsset = Join-Path $ZipRoot ($RelativePath.Replace("/", "\"))
      if (-not (Test-Path -LiteralPath $ApkAsset)) {
        throw "APK content check failed: missing APK asset $RelativePath"
      }
      $ApkHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ApkAsset).Hash
      if ($ApkHash -ne [string]$FileEntry.sha256) {
        throw "APK content check failed: APK asset $RelativePath does not match build-info"
      }
    }
  }
  $DigestInput = ($BuildInfo.files | Sort-Object path | ForEach-Object { "$($_.path)=$($_.sha256)" }) -join "`n"
  $DigestBytes = [System.Text.Encoding]::UTF8.GetBytes($DigestInput)
  $SourceDigest = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($DigestBytes)).Replace("-", "")
  if ($SourceDigest -ne [string]$BuildInfo.sourceDigest) {
    throw "APK content check failed: build-info sourceDigest mismatch"
  }
  $MainActivity = Get-Content -LiteralPath (Join-Path $AndroidMain "java\com\naonao\app\android\MainActivity.java") -Raw -Encoding UTF8
  $ReminderReceiver = Get-Content -LiteralPath (Join-Path $AndroidMain "java\com\naonao\app\android\ReminderReceiver.java") -Raw -Encoding UTF8
  $BootReceiver = Get-Content -LiteralPath (Join-Path $AndroidMain "java\com\naonao\app\android\BootReceiver.java") -Raw -Encoding UTF8
  $Manifest = Get-Content -LiteralPath (Join-Path $AndroidMain "AndroidManifest.xml") -Raw -Encoding UTF8
  $AssetHtml = Get-Content -LiteralPath (Join-Path $AndroidMain "assets\index.html") -Raw -Encoding UTF8
  $AssetJs = Get-Content -LiteralPath (Join-Path $AndroidMain "assets\app.js") -Raw -Encoding UTF8
  $BuildScript = Get-Content -LiteralPath (Join-Path $RepoRoot "android\build-apk.ps1") -Raw -Encoding UTF8
  $SourceChecks = @(
    @{ Name = "manifest disables backup"; Text = $Manifest; Needle = 'android:allowBackup="false"' },
    @{ Name = "manifest disables debug"; Text = $Manifest; Needle = 'android:debuggable="false"' },
    @{ Name = "manifest disables test only"; Text = $Manifest; Needle = 'android:testOnly="false"' },
    @{ Name = "manifest blocks general cleartext"; Text = $Manifest; Needle = 'android:usesCleartextTraffic="false"' },
    @{ Name = "manifest has boot receiver"; Text = $Manifest; Needle = 'android:name=".BootReceiver"' },
    @{ Name = "manifest boot receiver not exported"; Text = $Manifest; Pattern = 'android:name="\.BootReceiver"[\s\S]*?android:exported="false"' },
    @{ Name = "manifest receives package replaced"; Text = $Manifest; Needle = 'android.intent.action.MY_PACKAGE_REPLACED' },
    @{ Name = "manifest receives boot completed"; Text = $Manifest; Needle = 'android.intent.action.BOOT_COMPLETED' },
    @{ Name = "webview disables universal file access"; Text = $MainActivity; Needle = "setAllowUniversalAccessFromFileURLs(false)" },
    @{ Name = "webview disables content access"; Text = $MainActivity; Needle = "setAllowContentAccess(false)" },
    @{ Name = "webview disables mixed content"; Text = $MainActivity; Needle = "MIXED_CONTENT_NEVER_ALLOW" },
    @{ Name = "legacy webview URL hook covered"; Text = $MainActivity; Needle = "shouldOverrideUrlLoading(WebView view, String url)" },
    @{ Name = "non-asset file URLs blocked"; Text = $MainActivity; Needle = 'return !uri.toString().startsWith("file:///android_asset/")' },
    @{ Name = "unknown schemes blocked"; Text = $MainActivity; Needle = "return true;" },
    @{ Name = "cleartext http checked before native request"; Text = $MainActivity; Needle = "ensureCleartextPermitted(endpoint)" },
    @{ Name = "cleartext http checked with platform policy"; Text = $MainActivity; Needle = "NetworkSecurityPolicy.getInstance()" },
    @{ Name = "external open only http/https"; Text = $MainActivity; Needle = '!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)' },
    @{ Name = "android bridge exposed"; Text = $MainActivity; Needle = 'addJavascriptInterface(androidBridge, "AndroidBridge")' },
    @{ Name = "android bridge shuts down with activity"; Text = $MainActivity; Needle = "androidBridge.shutdown()" },
    @{ Name = "webview destroyed with activity"; Text = $MainActivity; Needle = "webView.destroy()" },
    @{ Name = "native callbacks skip closed webview"; Text = $MainActivity; Needle = "if (!closed) webView.evaluateJavascript(script, null)" },
    @{ Name = "native executor stops on destroy"; Text = $MainActivity; Needle = "executor.shutdownNow()" },
    @{ Name = "native executor is bounded"; Text = $MainActivity; Needle = "Executors.newFixedThreadPool(3)" },
    @{ Name = "native http disconnects in finally"; Text = $MainActivity; Pattern = "finally\s*\{[\s\S]*?conn\.disconnect\(\);" },
    @{ Name = "native http response body capped"; Text = $MainActivity; Needle = "MAX_RESPONSE_CHARS" },
    @{ Name = "native http reads with cap"; Text = $MainActivity; Needle = "readAll(stream, MAX_RESPONSE_CHARS)" },
    @{ Name = "android bridge can cancel all reminders"; Text = $MainActivity; Needle = "cancelAllReminders()" },
    @{ Name = "notification permission requested on demand"; Text = $MainActivity; Needle = "ensureNotificationPermission()" },
    @{ Name = "native data export share available"; Text = $MainActivity; Needle = "shareText(String title, String text)" },
    @{ Name = "notification permission guarded"; Text = $ReminderReceiver; Needle = "POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED" },
    @{ Name = "notification click has launch fallback"; Text = $ReminderReceiver; Needle = "launch = new Intent(context, MainActivity.class)" },
    @{ Name = "notification launch avoids duplicate stack"; Text = $ReminderReceiver; Needle = "Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP" },
    @{ Name = "reminders persisted natively"; Text = $ReminderReceiver; Needle = "PREF_SCHEDULES" },
    @{ Name = "reminders restored natively"; Text = $ReminderReceiver; Needle = "restoreScheduled(Context context)" },
    @{ Name = "expired one-shot reminders are dropped on restore"; Text = $ReminderReceiver; Needle = "triggerAtWall <= now && repeatMs <= 0L" },
    @{ Name = "repeat reminders restore from repeat interval"; Text = $ReminderReceiver; Needle = "triggerAtWall > now ? triggerAtWall - now : repeatMs" },
    @{ Name = "reminders can be fully cleared natively"; Text = $ReminderReceiver; Needle = "cancelAll(Context context)" },
    @{ Name = "native reminder store clear"; Text = $ReminderReceiver; Needle = "prefs.edit().clear().apply()" },
    @{ Name = "one-shot reminders clear persisted schedule"; Text = $ReminderReceiver; Needle = "cancel(context, id)" },
    @{ Name = "reminders use non-exact idle alarm"; Text = $ReminderReceiver; Needle = "manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending)" },
    @{ Name = "reminder pending intents are immutable"; Text = $ReminderReceiver; Needle = "PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()" },
    @{ Name = "boot receiver restores reminders"; Text = $BootReceiver; Needle = "ReminderReceiver.restoreScheduled(context)" },
    @{ Name = "asset CSP present"; Text = $AssetHtml; Needle = "Content-Security-Policy" },
    @{ Name = "asset CSP blocks webview network"; Text = $AssetHtml; Needle = "connect-src 'none'" },
    @{ Name = "asset CSP avoids content images"; Text = $AssetHtml; Needle = "img-src 'self' data: file:" },
    @{ Name = "asset CSP disallows inline script"; Text = $AssetHtml; Needle = "script-src 'self'" },
    @{ Name = "asset references app js"; Text = $AssetHtml; Needle = '<script src="app.js"></script>' },
    @{ Name = "asset has data import button"; Text = $AssetHtml; Needle = 'id="import-data"' },
    @{ Name = "asset has in-page dialog"; Text = $AssetHtml; Needle = 'id="app-dialog"' },
    @{ Name = "app has android bridge callback"; Text = $AssetJs; Needle = "window.NAONAO_NATIVE" },
    @{ Name = "app uses in-page dialog helper"; Text = $AssetJs; Needle = "function showDialog" },
    @{ Name = "app imports exported data"; Text = $AssetJs; Needle = "function importData()" },
    @{ Name = "app strips imported trust confirmations"; Text = $AssetJs; Needle = "function normalizeImportedConfig(raw)" },
    @{ Name = "app export strips base url trust"; Text = $AssetJs; Needle = "confirmedBaseUrl:false, confirmedHermesUrl:false" },
    @{ Name = "app normalizes imported state"; Text = $AssetJs; Needle = "const importedState = normalizeState(parsed.state)" },
    @{ Name = "app syncs imported long reminders"; Text = $AssetJs; Needle = "syncEnabledLongTaskReminders(importedState.longTasks)" },
    @{ Name = "app syncs long reminders on startup"; Text = $AssetJs; Needle = "syncEnabledLongTaskReminders()" },
    @{ Name = "app preserves future long reminder due time"; Text = $AssetJs; Needle = "scheduleLongTaskReminder(task, task.nextDueAt - now)" },
    @{ Name = "app only reschedules expired long reminders"; Text = $AssetJs; Needle = "if(!task.nextDueAt || task.nextDueAt <= now)" },
    @{ Name = "app debounces enabled long reminder edits"; Text = $AssetJs; Needle = "function scheduleLongTaskSync(task, delayMs = 800)" },
    @{ Name = "app syncs long reminder on goal focusout"; Text = $AssetJs; Needle = "addEventListener('focusout'" },
    @{ Name = "app clears long reminder sync timer on delete"; Text = $AssetJs; Needle = "longTaskSyncTimers.delete(btn.dataset.id)" },
    @{ Name = "app persists long task webhook state immediately"; Text = $AssetJs; Pattern = "if\(target\.dataset\.action === 'long-webhook'\)[\s\S]*?persist\(\)" },
    @{ Name = "app has long task webhook secret cleanup helper"; Text = $AssetJs; Needle = "function deleteLongTaskWebhookSecrets(tasks = state.longTasks)" },
    @{ Name = "app has local reminder cancellation helper"; Text = $AssetJs; Needle = "function cancelLocalReminders(tasks = state.longTasks)" },
    @{ Name = "app calls native cancel all reminders"; Text = $AssetJs; Needle = "bridge.cancelAllReminders()" },
    @{ Name = "app binds data import button"; Text = $AssetJs; Needle = '$(''import-data'').addEventListener(''click'', importData)' },
    @{ Name = "app validates feishu cn"; Text = $AssetJs; Pattern = "feishu\\\.cn\|larksuite\\\.com" },
    @{ Name = "release build supports external keystore path"; Text = $BuildScript; Needle = "NAONAO_ANDROID_KEYSTORE_PATH" },
    @{ Name = "release build supports external key alias"; Text = $BuildScript; Needle = "NAONAO_ANDROID_KEY_ALIAS" },
    @{ Name = "release build supports separate store password"; Text = $BuildScript; Needle = "NAONAO_ANDROID_STORE_PASSWORD" },
    @{ Name = "release build supports external key password"; Text = $BuildScript; Needle = "NAONAO_ANDROID_KEY_PASSWORD" },
    @{ Name = "release build refuses missing configured keystore"; Text = $BuildScript; Needle = "Configured release keystore does not exist" }
  )
  foreach ($Check in $SourceChecks) {
    if ($Check.ContainsKey("Pattern")) {
      if ($Check.Text -notmatch $Check.Pattern) {
        throw "Source check failed: $($Check.Name)"
      }
    } elseif (-not $Check.Text.Contains($Check.Needle)) {
        throw "Source check failed: $($Check.Name)"
    }
  }
  if ($Manifest.Contains("android.permission.SCHEDULE_EXACT_ALARM")) {
    throw "Source check failed: manifest should not request SCHEDULE_EXACT_ALARM"
  }
  if ($Manifest.Contains('android:debuggable="true"') -or $Manifest.Contains('android:testOnly="true"')) {
    throw "Source check failed: manifest should not enable debug or testOnly"
  }
  if ($ReminderReceiver.Contains("setExact(") -or $ReminderReceiver.Contains("setExactAndAllowWhileIdle(")) {
    throw "Source check failed: reminders should avoid exact alarm APIs"
  }
  if ($AssetHtml.Contains("script-src 'self' 'unsafe-inline'") -or $AssetHtml -match "<script(?!\s+src=)") {
    throw "Source check failed: asset HTML should not allow inline scripts"
  }
  if ($AssetHtml -match "Content-Security-Policy[^""]*content:") {
    throw "Source check failed: asset HTML should not allow content URI resources"
  }
  if ($AssetHtml -match "\son[a-zA-Z]+\s*=") {
    throw "Source check failed: asset HTML should not use inline event handlers"
  }
  if ($AssetJs -match "\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b") {
    throw "Source check failed: asset JS should not perform direct network requests"
  }
  if ($AssetJs -match "\b(confirm|alert)\s*\(") {
    throw "Source check failed: asset JS should use in-page dialogs instead of native JS dialogs"
  }
  foreach ($Forbidden in @("WebChromeClient", "onShowFileChooser", "ACTION_GET_CONTENT", "ValueCallback<Uri[]>")) {
    if ($MainActivity.Contains($Forbidden)) {
      throw "Source check failed: WebView should not expose file chooser or content picker"
    }
  }

  $MainLines = $MainActivity -split "\r?\n"
  $OnCreateStart = -1
  $WebViewInit = -1
  for ($i = 0; $i -lt $MainLines.Count; $i++) {
    if ($OnCreateStart -lt 0 -and $MainLines[$i].Contains("super.onCreate(savedInstanceState);")) { $OnCreateStart = $i }
    if ($OnCreateStart -ge 0 -and $WebViewInit -lt 0 -and $MainLines[$i].Contains("webView = new WebView(this);")) { $WebViewInit = $i; break }
  }
  if ($OnCreateStart -lt 0 -or $WebViewInit -le $OnCreateStart) {
    throw "Source check failed: cannot locate onCreate WebView initialization"
  }
  $BeforeWebView = ($MainLines[$OnCreateStart..$WebViewInit] -join "`n")
  if ($BeforeWebView.Contains("requestPermissions")) {
    throw "Source check failed: notification permission not requested before webview"
  }

  function Assert-FunctionCalls($Text, $FunctionName, $CallText) {
    $Pattern = "function\s+$FunctionName\s*\("
    $Start = [regex]::Match($Text, $Pattern)
    if (-not $Start.Success) { throw "Source check failed: cannot locate function $FunctionName" }
    $Rest = $Text.Substring($Start.Index)
    $Next = [regex]::Match($Rest.Substring($Start.Length), "\nfunction\s+\w+\s*\(")
    $Body = if ($Next.Success) { $Rest.Substring(0, $Start.Length + $Next.Index) } else { $Rest }
    if (-not $Body.Contains($CallText)) {
      throw "Source check failed: $FunctionName does not call $CallText"
    }
  }
  Assert-FunctionCalls $AssetJs "importData" "cancelLocalReminders()"
  Assert-FunctionCalls $AssetJs "importData" "deleteLongTaskWebhookSecrets()"
  Assert-FunctionCalls $AssetJs "importData" "normalizeImportedConfig(parsed.config)"
  Assert-FunctionCalls $AssetJs "clearData" "cancelLocalReminders()"
  Assert-FunctionCalls $AssetJs "clearData" "deleteLongTaskWebhookSecrets()"

  $Hash = Get-FileHash -Algorithm SHA256 $ResolvedApk
  [pscustomobject]@{
    Apk = $ResolvedApk.Path
    Bytes = (Get-Item $ResolvedApk).Length
    Sha256 = $Hash.Hash
    Package = "com.naonao.app.android"
    VersionName = "1.701.0"
    VersionCode = 170100
    Signature = "v1/v2/v3 verified"
    Content = "classes.dex and Android assets verified; APK build-info matches current Android source"
    SourceGuards = "manifest, WebView, cleartext policy, notification, reminder restore, CSP, bridge checks passed"
  }
} finally {
  if (Test-Path -LiteralPath $TempRoot) {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force
  }
}
