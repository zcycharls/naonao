# 孬孬 Android APK 安装说明

主安装包：

```text
deliverables/android/naonao-android-1.703.848.apk
```

SHA256：

```text
C452453E0F2BE126F7E954F2FABA57FFBD950181444CDC1A84F888CFE42E1729
```

文件大小：584,976,955 字节，约 585 MB。

这个 APK 是完整打包版本：内含 Android 原生壳、本地 HTML/CSS/JS、完整桌面客户端静态资源、本地 AI 模型文件，以及 Windows 桌面运行时归档。Android 端仍通过 WebView 和原生桥运行；随包的 Windows/Electron/Chromium 运行时是资源归档，不会在 Android 上直接执行。

## 手机安装

1. 把 `naonao-android-1.703.848.apk` 传到 Android 手机。
2. 在手机文件管理器里点开 APK。
3. 如果提示“不允许安装未知应用”，进入提示里的设置页，允许当前文件管理器或浏览器安装未知应用。
4. 安装完成后打开“孬孬”。
5. 首次在设置里开启通知提醒时，允许通知权限；不允许也能使用任务、番茄钟、冰箱和本地对话。

## 数据导出

进入“设置 -> 数据与关于”，点击“导出数据”。APK 会先在页面里生成 JSON，同时打开 Android 系统分享面板，方便保存到文件、网盘或发送给自己。API Key、Webhook、Hermes Key 保存在 Android Keystore 中，不会被导出。

恢复数据时，把之前导出的 JSON 粘贴到同一个文本框，点击“导入数据”。导入会覆盖当前任务、统计、冰箱、对话和本地记忆；API Key、全局 Webhook、Hermes Key 不会恢复，需要在设置里重新保存。旧长远任务专用 Webhook 会随旧长远任务一起从 Android Keystore 清理，避免残留不可见的旧任务地址。第三方 OpenAI 兼容 Base URL / Hermes Base URL 的“已确认信任”状态不会随导出或导入迁移，换机后需要重新勾选确认。

当前 Android 客户端没有上传文件或选择手机相册/文件的功能，因此 WebView 已关闭 `content://` 资源访问和文件选择器入口。数据导入请继续使用上面的 JSON 粘贴方式。

## Hermes Agent 连接提示

Android 里的 `127.0.0.1` / `localhost` 指手机本机，不是电脑。如果 Hermes Agent 运行在电脑上，请使用 HTTPS 或可信隧道地址；直接填写 `http://192.168.x.x:8642/v1` 这类局域网明文地址可能会被 Android 安全策略拦截。

## 电脑连接手机验证

手机开启 USB 调试后，在仓库根目录运行：

```powershell
.\scripts\android-release-check.ps1 -RequireDevice
```

脚本会先跑 Android 状态测试、移动端页面 smoke、APK 包名/版本/签名/内置资源/sourceDigest 门禁和环境诊断，再通过 `adb install -r` 安装并启动 `com.naonao.app.android`。
启动后还会确认已安装包版本、应用进程、前台 Activity，并扫描本次启动后的 logcat，若出现本包 `FATAL EXCEPTION`、`AndroidRuntime`、`Fatal signal` 或关联 WebView/Chromium 崩溃信号会直接失败。
通过时会把 `am start` 输出、`dumpsys package/window/activity`、本次启动后的 `logcat`、启动截图和 `install-smoke-report.json` 保存到 `deliverables/android/install-smoke/`，用于复核真机或模拟器上的实际运行状态。

如果本机 ADB 同时存在多个目标，可加 `-DeviceSerial emulator-5554` 或真机序列号指定要验证的设备。
