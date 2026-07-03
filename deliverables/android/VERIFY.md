# Android APK 验证记录

时间：2026-07-02

## 产物

- 主交付：`deliverables/android/naonao-android-1.703.848.apk`
- 调试包：`deliverables/android/naonao-android-debug.apk`
- 安装说明：`deliverables/android/INSTALL.md`
- 当前主交付 SHA256：`61A164AA20EAF0B215AE28C855A02FE7FBEFF3B188CD73AB51A2186C7D08F9F3`
- 当前调试包 SHA256：`ACED1B7854E55AD2E341800A113F1FA04887BEDFBFBA7F912A13EA1D6EEF37EB`

## 已验证

- `android/build-apk.ps1` 可重复构建 release/debug APK，release 与 debug 并行构建也不会互相清理临时目录。
- `scripts/android-verify-apk.ps1` 验证 release APK：
  - 包名：`com.naonao.app.android`
  - 版本：`1.703.848`
  - `versionCode=1703848`
  - `minSdk=23`
  - `targetSdk=35`
  - 入口：`com.naonao.app.android.MainActivity`
  - 应用名：`孬孬`
  - v1/v2/v3 签名验证通过
  - Manifest 显式 `android:debuggable="false"` 与 `android:testOnly="false"`；APK badging 未出现 `application-debuggable`、`debuggable='true'` 或 `testOnly='true'`
  - `classes.dex`、`assets/index.html`、`assets/styles.css`、`assets/app.js`、`assets/build-info.json` 和网络安全配置已拆包检查
  - Manifest、WebView 安全设置、URL 白名单拦截、AndroidBridge、通知权限按需请求、数据导出分享、数据导入恢复、通知权限保护、原生提醒恢复、CSP、飞书 Webhook 域名校验、原生 HTTP 明文策略检查已做源码门禁检查
  - APK 内页面 CSP 已收紧为 `script-src 'self'` 与 `connect-src 'none'`；页面不允许 inline script/inline event handler，前端 JS 不直接发网络请求，外部 AI/飞书请求只走 AndroidBridge 原生代发
  - APK 内 `assets/build-info.json` 记录 12 个 Android 源码/资源文件的 SHA256 和稳定 `sourceDigest`，覆盖 Manifest、Java、res 和前端 assets；验证脚本会逐项和当前源码对比并检查文件集合完整性，避免源码更新后误交付旧 APK
  - 当前 Android 源码 `sourceDigest`：`B136A6509929930B02DF9D2C9803BB3D4272E235ACF4F0703A91E8B7D143964E`
  - 已确认重复构建时 APK 整包 SHA256 会因 zip/signing 元数据变化而改变；因此交付校验以当前 APK SHA256 + APK 内稳定 `sourceDigest` + 逐文件源码 hash 门禁共同判断，不把整包 hash 可复现性当成已满足条件
  - AndroidBridge 网络请求线程池已限制并发；HTTP 连接在异常路径也会 `disconnect`，响应体读取有上限，避免网络异常或超大响应造成资源占用失控
  - 原生提醒不申请 `SCHEDULE_EXACT_ALARM`，也不使用 exact alarm API；通知点击带 `MainActivity` 兜底和栈复用 flag，避免启动 Intent 为空或重复堆栈
  - AndroidBridge 已绑定 Activity 生命周期；页面销毁时会关闭后台请求线程、移除待投递回调、解绑并销毁 WebView，避免关闭应用后继续回调已销毁页面
- `node scripts/android-smoke.js` 验证本地 Android 页面：
  - 通过 DevTools 协议在 `390x844` 移动端视口渲染截图
  - 截图尺寸与 CSS 视口一致
  - 使用代表性任务、子步骤、想法冰箱、统计、心情和长远任务数据启动页面
  - 已保存 `home`、`tasks`、`focus`、`freezer`、`stats`、`settings` 六个视图截图到 `deliverables/android/screens/`
  - `app.js` 已初始化
  - 已交互切换并检查 `home`、`tasks`、`focus`、`freezer`、`stats`、`settings` 主要视图
  - 每个主要视图的关键控件存在
  - 番茄钟按代表性剩余时间渲染为 `13:25`
  - 底部导航 CSS 生效
  - 5 个底部导航入口均完整可见
  - 横向溢出计数为 0（见 `android-smoke-report.json`）
- `node --check android/src/main/assets/app.js` 通过。
- `node scripts/android-state-tests.js` 验证 Android 端核心状态逻辑：
  - 任务、子步骤、想法冰箱可写入
  - 番茄钟暂停/恢复时间基准稳定
  - AI 消息组装不会重复最后一条用户消息
  - 底部导航、设置入口与 Android 返回键的视图切换逻辑通过
  - 长远任务飞书 Webhook 密钥保存和清理逻辑通过
  - 番茄钟开始时会注册原生一次性提醒，暂停/重置/完成时会取消；前台准时完成时通知，后台很久后再打开不会重复弹旧通知
  - 通知权限改为用户在设置中开启提醒时再请求；权限未授予时开关会回滚并提示
  - 数据导出会生成 JSON，并调用 Android 系统分享面板；Keystore 中的密钥不会导出
  - 数据导入会校验导出的 JSON，复用状态/配置清洗逻辑恢复任务、统计、冰箱、对话和本地记忆；非法 JSON 不会覆盖现有数据
  - 数据导出和导入都会清除第三方 OpenAI 兼容 Base URL / Hermes Base URL 的信任确认状态，避免导入包把旧设备或他人设备上的“允许向第三方地址发送 Key”确认一起迁移
  - 导入新数据会删除旧长远任务专用 Webhook 密钥，避免旧任务被覆盖后 Keystore 残留不可见的任务 Webhook；全局 API Key、全局 Webhook、Hermes Key 仍按导入文案保留，不从导入包恢复
  - 导入或启动后，已启用的长远任务会重新下发给原生提醒调度，避免界面显示已启用但系统闹钟未恢复；已有未来 `nextDueAt` 会按剩余时间同步，不会每次打开都把提醒推迟一个完整间隔
  - 清空数据或导入新数据前，会调用原生全量清理，取消 ReminderReceiver 持久化表中的所有已登记提醒并清空表；旧版本或历史残留的系统闹钟不会继续恢复
- Android 前端飞书 Webhook 校验已与原生桥对齐，仅允许 `open.feishu.cn` 与 `open.larksuite.com`。
- Hermes / OpenAI 兼容自定义 Base URL 在发送前会检查 Android 明文 HTTP 策略；Android 拦截非本机 HTTP 时会返回中文错误。设置页和安装说明已提示：手机上的 `127.0.0.1` 不是电脑，电脑 Hermes 建议用 HTTPS 或可信隧道地址。
- WebView URL 处理已收敛为白名单：只有 APK 内 `file:///android_asset/` 留在 WebView，`http/https` 交给外部浏览器，其它 scheme 与非 asset `file://` 都被拦截，避免外部内容进入带有 AndroidBridge 的 WebView。
- Android 客户端没有上传文件或选择手机相册/文件的功能，因此 WebView 已禁用 `content://` 资源访问、CSP 不允许 `content:` 资源，且没有暴露文件选择器或系统内容选择器入口。
- 导入、清空和长期记忆查看已改为 APK 内页内对话框，不依赖 WebView 原生 `confirm()` / `alert()`；验证脚本会禁止生产前端重新使用原生 JS dialog，避免不同 Android System WebView 上对话框行为不一致。
- 长远任务提醒规格已持久化到原生 SharedPreferences；设备重启或应用替换后由 `BootReceiver` 恢复调度。一次性提醒触发后会清理持久化记录，避免下次启动重复恢复。
- 原生恢复提醒时会丢弃已经过期的一次性提醒，避免设备重启或应用替换后突然恢复旧番茄钟完成通知；重复提醒过期时按 repeat interval 恢复到下一次。
- 设置页隐藏桌面式滚动条，保留触摸滚动能力。
- 已启用长远任务的目标说明变更后，会防抖同步原生提醒正文；输入框失焦时立即同步，避免系统通知仍使用旧目标。
- 单独保存长远任务专用 Webhook 后，会立即持久化 `hasWebhook` 并刷新占位提示，避免 Keystore 已保存但界面状态丢失。
- 统计页 14 天趋势图已按移动端宽度压缩；无番茄数据时显示空态说明，避免零值柱误导和日期标签撑出横向裁切。
- 任务页长标题卡片已防止被按钮挤压成竖排，烟测包含任务标题可读性门禁。
- `scripts/android-release-check.ps1 -DeviceSerial emulator-5554` 已作为统一发布门禁入口验证通过。它会串联 JS 语法检查、Android 状态测试、移动端页面 smoke、APK 签名/sourceDigest 门禁、本地环境诊断、文档 hash 一致性、`git diff --check` 和安装级 smoke。发布门禁会从当前 APK 内 `assets/build-info.json` 读取实际 `sourceDigest` 并校验文档同步，避免脚本硬编码源码摘要；默认跳过远端 SDK 包列表探测，避免网络或证书问题拖慢本地 APK 验证。需要完整环境诊断时单独运行 `scripts/android-env-check.ps1`。
- Android 15 API 35 AOSP ATD 模拟器安装级 smoke 已通过：`adb install -r`、显式启动 `com.naonao.app.android/.MainActivity`、已安装包版本、应用进程、前台 Activity、logcat 崩溃扫描和启动截图均已验证。证据目录：`deliverables/android/install-smoke/`。
- 本地已有 `.github/workflows/android-apk.yml` 草案，可在 GitHub Actions 中构建 APK 并用 Android Emulator 跑安装启动 smoke；但当前 GitHub token 缺少 `workflow` scope，远端 `main` 尚未包含该工作流，所以不能把远端 Emulator 验证当作已完成证据。
- `android/build-apk.ps1` 默认使用本机自签名 release keystore，适合侧载测试和私发安装；脚本也支持通过 `NAONAO_ANDROID_KEYSTORE_PATH`、`NAONAO_ANDROID_KEY_ALIAS`、`NAONAO_ANDROID_STORE_PASSWORD`、`NAONAO_ANDROID_KEY_PASSWORD` 注入长期保管的正式签名。若将来公开长期分发，应使用稳定正式签名，否则换签名会导致同包名覆盖升级失败。

## 验证边界

已完成的是 Android Emulator 安装启动验证，不是真机验证。当前开发机没有连接 Android 手机；如果要补真机证据，连接一台开启 USB 调试的 Android 设备后运行：

```powershell
.\scripts\android-release-check.ps1 -RequireDevice
```

`scripts/android-install-smoke.ps1` 已提供安装级门禁。它会先调用 `scripts/android-verify-apk.ps1` 验证 APK，再安装、显式启动 `com.naonao.app.android/.MainActivity`，检查已安装包版本、应用进程、前台 Activity，并扫描本次启动后的 logcat。若发现本包 `FATAL EXCEPTION`、`AndroidRuntime`、`Fatal signal` 或关联 WebView/Chromium 崩溃信号会直接失败。通过时会把 `am start` 输出、`dumpsys package/window/activity`、本次启动后的 `logcat`、启动截图和 `install-smoke-report.json` 保存到 `deliverables/android/install-smoke/`。当 ADB 同时存在多个目标时，可以用 `-DeviceSerial emulator-5554` 或真机序列号指定目标。

复核当前模拟器安装证据可运行：

```powershell
.\scripts\android-verify-apk.ps1
node scripts\android-smoke.js
.\scripts\android-install-smoke.ps1 -DeviceSerial emulator-5554
```
