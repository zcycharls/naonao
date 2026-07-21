# Naonao: Focus Quest 1.1.0 验证记录

验证日期：2026-07-15

## 结果

- 状态机奖励幂等、关卡重生成进度继承、过期专注结算与存档恢复：通过。
- 任务导演 URL、结构化输出、输入/历史/模型输出高风险内容拒绝：通过。
- 响应体超时与字节上限、DNS 结果固定、私网拦截、TLS 主机名校验和 3xx 拒绝：通过。
- IPC 窗口/Frame 校验、Companion 状态投影与最小 preload：通过。
- Steam 源码白名单、渲染层无网络 API 与 ASAR Windows 路径回归：通过。
- `npm audit --json` 与 `npm audit --omit=dev --json`：0 漏洞。
- Electron 源码入口完整流程：通过。
- 打包后可执行文件完整流程：通过；`testMode` 为 `false`，无测试完成桥或本地飞书绕过。
- 离线导演零网络请求：通过。
- Hermes 本机端点和 OpenAI 兼容端点连接与关卡生成：通过。
- 飞书测试、专注完成和任务完成回执：在隔离源码 smoke 中通过；打包态保持默认关闭。
- 实际模型请求字段与公开数据披露逐字段一致：通过。
- API Key 与 Webhook 明文泄漏检查：通过。
- 1000 x 700 最小窗口与 280 x 330 桌面伴侣布局、截图非空和敏感值检查：通过。
- Git 基线：`aa3172bfe68bb93564324ec8b7c968b19429d27a`。

## Depot

- 路径：`dist/steam/win-unpacked`
- 文件数：21
- 未压缩体积：320516656 bytes（305.67 MiB）
- 语言包：`zh-CN.pak`、`en-US.pak`
- 主程序：`NaonaoFocusQuest.exe`
- 主程序 SHA256：`75E3BD4E38CD90B8382E2979F84E1DCA787B3B937BC31ED203F791051A4C7E7E`
- `resources/app.asar`：2707085 bytes（2.58 MiB）
- ASAR SHA256：`49053F7E1DA395B1E7B18A5FC601A96C065418628EEA6478093E95DE75C077DB`
- Authenticode：`NotSigned`（无签名者或时间戳证书）

Steam 可以分发未签名 depot，但发行方仍应根据自身信誉与发布策略决定是否购买代码签名证书。

## 打包边界

`resources/app.asar` 包含 16 个文件：`package.json` 加 15 个显式构建白名单文件。全部 15 个源码文件与 ASAR 内文件 SHA256 逐项一致，仅包含 Steam 主进程、两个预加载层、游戏/伴侣界面、游戏状态机、受限任务导演和必要图片/纹理。未包含原客户端、本地模型、飞书/Lark SDK、ONNX、Transformers 或生产依赖。

AI/Hermes 与飞书能力使用 Electron 主进程的受限 HTTPS/本机 HTTP 请求；DNS 校验结果固定到实际 socket，HTTPS 仍按原 hostname 校验证书。模型和第三方 SDK 不随 depot 分发。

## 截图

- `steam-game-packaged.png`：打包程序最小窗口。
- `steam-companion-packaged.png`：打包程序桌面伴侣。
- `steam-connections-packaged.png`：打包程序 AI/飞书连接控制台。
- `steam-game-source.png`：开发入口最小窗口。
- `steam-companion-source.png`：开发入口桌面伴侣。
- `steam-connections-source.png`：开发入口 AI/飞书连接控制台。

## 仍需发行方完成

- Steamworks 账号、AppID、Depot ID、费用与时间要求。
- 宠物图、图标、帽子、纹理和商店素材的商业权利证明。
- 按素材真实来源填写预生成 AI 内容披露，并提交实时 AI 内容与防护说明。
- 最终商店 capsule、logo、截图、公开隐私政策网址与联系方式。
- 在声明的最低配置硬件上完成安装、运行和缩放验证。
- 最终确认代码签名策略；当前 EXE 未签名。
- 使用真实 VDF 与 `steam/submission.json` 通过 `npm run verify:submission`。
- Valve 商店页与构建审核。
