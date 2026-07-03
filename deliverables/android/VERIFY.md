# Android APK 验证记录

时间：2026-07-03

## 产物

- 主交付：`deliverables/android/naonao-android-1.703.848.apk`
- 调试包：`deliverables/android/naonao-android-debug.apk`
- 安装说明：`deliverables/android/INSTALL.md`
- 当前主交付大小：584,976,955 字节
- 当前调试包大小：584,976,955 字节
- 当前主交付 SHA256：`C452453E0F2BE126F7E954F2FABA57FFBD950181444CDC1A84F888CFE42E1729`
- 当前调试包 SHA256：`D01BE9CEFBC100FA4F3462DAD6C022841A8CCECCEFC5CE3DAAC532A215AB5765`

## 已验证

- `scripts/android-verify-apk.ps1` 验证 release APK：
  - 包名：`com.naonao.app.android`
  - 版本：`1.703.848`
  - `versionCode=1703848`
  - `minSdk=23`
  - `targetSdk=35`
  - 入口：`com.naonao.app.android.MainActivity`
  - 应用名：`孬孬`
  - v1/v2/v3 签名验证通过
  - `classes.dex`、Android assets、网络安全配置、`assets/build-info.json` 均已拆包检查
  - build-info 标记为 `full-android-client`
  - 完整桌面客户端静态资源已打入 `assets/bundled-client/`，共 13 个文件
  - 本地 AI 模型已打入 `assets/models/Xenova/Qwen1.5-0.5B-Chat/`，模型版本 `340777bb38067a8a5af921a405e3206a8cc2f318`，总大小 489,356,186 字节，5 个模型文件 SHA256 均逐项校验
  - `dist/win-unpacked` 已作为 `assets/desktop-runtime/win-unpacked.zip` 打入 APK；归档哈希、806 个桌面运行时源文件集合和逐文件 SHA256 均与本机 `dist/win-unpacked` 对齐
  - 当前源码/资源 `sourceDigest`：`3492CC26079A3DAD567F35B745AFF8DC751F71A856DBF2348B8F130317723F72`
  - Manifest、WebView 安全设置、URL 白名单拦截、AndroidBridge、通知权限按需请求、数据导出分享、数据导入恢复、通知权限保护、原生提醒恢复、CSP、飞书 Webhook 域名校验、原生 HTTP 明文策略检查已做源码门禁检查
- `node --check scripts/android-state-tests.js` 通过。
- `node --check scripts/android-smoke.js` 通过。
- `node scripts/android-state-tests.js` 通过，覆盖任务、子步骤、想法冰箱、番茄钟、AI 消息组装、导航、设置入口、Android 返回键、Webhook 密钥保存清理、提醒调度、导入导出和数据清理逻辑。
- `node scripts/android-smoke.js` 通过：
  - 通过 DevTools 协议在 `390x844` 移动端视口渲染截图
  - 已交互检查 `home`、`tasks`、`focus`、`freezer`、`stats`、`settings` 主要视图
  - 每个主要视图关键控件存在
  - 底部 5 个导航入口完整可见
  - 横向溢出计数为 0
  - 截图和报告输出到 `deliverables/android/screens/`、`deliverables/android/android-smoke.png`、`deliverables/android/android-smoke-report.json`

## 说明

这个 APK 不是网页端，也不是只含 WebView 壳的小包。Android 端运行方式仍是 Android WebView + 原生桥；Windows/Electron/Chromium 运行时不能在 Android 上直接执行，因此以 `win-unpacked.zip` 形式作为资源归档随包保存。

已完成的是 APK 内容门禁、源码/资源一致性门禁、页面 smoke 和状态逻辑测试。安装级 smoke 需要连接 Android 真机或模拟器后运行：

```powershell
.\scripts\android-release-check.ps1 -RequireDevice
```

当 ADB 同时存在多个目标时，可以指定设备：

```powershell
.\scripts\android-release-check.ps1 -DeviceSerial emulator-5554
```
