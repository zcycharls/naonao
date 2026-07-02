# 孬孬 Android 客户端

这是孬孬的 Android 客户端工程。它不是网页端，也不依赖 `naonao.help` 运行；APK 内置本地界面资源，通过 Android WebView + 原生桥接提供移动端体验。

## 范围

- 任务锚点、子步骤、当前任务切换
- 番茄钟、休息、心情记录、完成统计
- 想法冰箱、取用为任务
- 数据统计、近 14 天趋势、连续打卡
- 本地对话 fallback
- Anthropic / OpenAI 兼容 / Hermes Agent 请求通道
- 飞书 Webhook 测试和长远任务提醒；每个长远任务可保存独立 Webhook
- Android 本地通知与振动提醒

## 构建

```powershell
.\android\build-apk.ps1
```

产物：

```text
deliverables\android\naonao-android-1.701.0.apk
```

脚本使用 Android SDK build-tools 直接构建，不要求 Gradle。

开发调试包：

```powershell
.\android\build-apk.ps1 -Configuration debug
```

`naonao-android-1.701.0.apk` 是给用户侧载安装的主交付；`naonao-android-debug.apk` 只用于调试排查。当前 release 产物使用本机自签名 keystore，适合侧载测试和私发安装。正式上架或长期公开发布前，应改用你自己长期保管的 release keystore，否则以后换签名会导致同包名覆盖升级失败。

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

当前开发机没有可用 Android 设备；CPU 固件虚拟化未开启，且 Hypervisor Platform 未启用，所以暂时不能在本机完成稳定模拟器验证。
