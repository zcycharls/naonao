# Android APK 验证记录

时间：2026-07-03

## 产物

- 主交付：`deliverables/android/naonao-android-1.703.848.apk`
- 调试包：`deliverables/android/naonao-android-debug.apk`
- 安装说明：`deliverables/android/INSTALL.md`
- 当前主交付大小：49,970 字节
- 当前调试包大小：49,970 字节
- 当前主交付 SHA256：`E3CEEDC55DB713AFB1B39D13632150728A67CE2C1B8A5ABB3920C0BC4913B839`
- 当前调试包 SHA256：`00DDC276A4604960DF44DB7D91878484350FD02C62DE6E518369FB1384C1F92A`

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
  - build-info 标记为 `android-network-client`
  - build-info `modelMode` 为 `network-only`
  - APK 内未发现 `assets/models`、`assets/desktop-runtime`、`assets/bundled-client`、Transformers/WASM、ONNX 或 safetensors 资源
  - 当前源码/资源 `sourceDigest`：`B57CC0B3749E1B8BB3715EFC8BAC2AF49AD9842A85B824CAEE3DDD3E219B2432`
  - Manifest、WebView 安全设置、URL 白名单拦截、AndroidBridge、通知权限按需请求、数据导出分享、数据导入恢复、通知权限保护、原生提醒恢复、CSP、飞书 Webhook 域名校验、原生 HTTP 明文策略检查已做源码门禁检查
- 直接拆包搜索 `models|desktop-runtime|transformers|onnx|wasm|bundled-client`，结果为 0 个匹配项。
- `node --check scripts/android-state-tests.js` 通过。
- `node --check scripts/android-smoke.js` 通过。
- `node scripts/android-state-tests.js` 通过，覆盖任务、子步骤、想法冰箱、番茄钟、AI 消息组装、导航、设置入口、Android 返回键、Webhook 密钥保存清理、提醒调度、导入导出和数据清理逻辑。
- `node scripts/android-smoke.js` 通过：移动端视口主要视图、关键控件、底部导航和横向溢出检查通过。

## 说明

这个 APK 不是网页端，也不是桌面客户端打包进手机。Android 端运行方式是 Android WebView + 原生桥；AI 请求通过 Hermes Agent 或 API 提供商走网络模型。APK 不包含本地大模型，因此不能作为手机端离线大模型推理包使用。

已完成的是 APK 内容门禁、源码/资源一致性门禁、页面 smoke 和状态逻辑测试。安装级 smoke 需要连接 Android 真机或模拟器后运行：

```powershell
.\scripts\android-release-check.ps1 -RequireDevice
```

当 ADB 同时存在多个目标时，可以指定设备：

```powershell
.\scripts\android-release-check.ps1 -DeviceSerial emulator-5554
```
