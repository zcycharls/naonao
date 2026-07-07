# 孬孬 Android 客户端

这是孬孬的 Android 客户端工程。它不是网页端，也不依赖 `naonao.help` 运行；APK 内置本地界面资源，通过 Android WebView + 原生桥接提供移动端体验。

当前主交付是网络模型客户端 APK：APK 内只包含 Android 原生壳和移动端界面资源，不打包桌面客户端、本地 AI 模型、Transformers/WASM 或 `dist/win-unpacked` 桌面运行时。AI 对话通过 Hermes Agent 或 API 提供商走 Android 原生桥发起网络请求；未配置网络模型时仅使用本地规则 fallback。

## 范围

- 任务锚点、子步骤、当前任务切换
- 番茄钟、休息、心情记录、完成统计
- 想法冰箱、取用为任务
- 数据统计、近 14 天趋势、连续打卡
- 未配置网络模型时的本地规则 fallback
- Anthropic / OpenAI 兼容 / Hermes Agent 请求通道
- 飞书 Webhook 测试和长远任务提醒；每个长远任务可保存独立 Webhook
- Android 本地通知与振动提醒

## 构建

```powershell
.\android\build-apk.ps1
```

产物：

```text
deliverables\android\naonao-android-1.707.1030.apk
```

脚本使用 Android SDK build-tools 直接构建，不要求 Gradle。Android APK 不依赖本机桌面构建产物或本地模型目录；发布校验会反向检查 APK 中不得出现 `assets/models`、Transformers/WASM、`assets/bundled-client` 或 `assets/desktop-runtime`。

开发调试包：

```powershell
.\android\build-apk.ps1 -Configuration debug
```

`naonao-android-1.707.1030.apk` 是给用户侧载安装的主交付；当前大小约 513 KB。`naonao-android-debug.apk` 只用于调试排查。当前 release 产物使用本机自签名 keystore，适合侧载测试和私发安装。正式上架或长期公开发布前，应改用你自己长期保管的 release keystore，否则以后换签名会导致同包名覆盖升级失败。

正式签名可通过环境变量注入：

```powershell
$env:NAONAO_ANDROID_KEYSTORE_PATH = "D:\keys\naonao-release.jks"
$env:NAONAO_ANDROID_KEY_ALIAS = "naonao"
$env:NAONAO_ANDROID_STORE_PASSWORD = "..."
$env:NAONAO_ANDROID_KEY_PASSWORD = "..."
.\android\build-apk.ps1 -Configuration release
```

不要把正式 keystore 或密码提交进仓库。

侧载安装说明见：

```text
deliverables\android\INSTALL.md
```

## 验证

```powershell
node scripts\android-state-tests.js
node scripts\android-smoke.js
.\scripts\android-verify-apk.ps1
```

安装级验证需要连接一台开启 USB 调试的 Android 手机：

```powershell
.\scripts\android-install-smoke.ps1
```

脚本会安装 APK、显式启动主 Activity、确认包版本/进程/前台 Activity，并扫描本次启动后的 logcat 崩溃信号。

没有连接 Android 设备时，统一发布门禁会跳过安装级 smoke；需要强制真机或模拟器安装验证时使用 `.\scripts\android-release-check.ps1 -RequireDevice` 或加 `-DeviceSerial <设备序列号>`。
