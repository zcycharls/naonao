# Steam 提交说明

本目录包含 Naonao: Focus Quest 的 SteamPipe 示例和商店提交草稿。代码可以准备构建，但 AppID、Depot ID、Steamworks 账号、费用、素材权利声明和 Valve 审核必须由发行方完成。

## 1. 构建

```powershell
npm ci
npm test
npm run release:check
```

`release:check` 会重新构建、逐文件核对 ASAR 与源码，并运行打包程序 smoke。上传目录：`dist/steam/win-unpacked`。

Steam 启动项：

- Executable: `NaonaoFocusQuest.exe`
- Launch type: `Launch (Default)`
- Operating system: `Windows`
- Architecture: `64-bit`

## 2. SteamPipe

1. 复制 `scripts/app_build_APPID.vdf.example` 与 `scripts/depot_build_DEPOTID.vdf.example`，去掉 `.example`。
2. 将 `YOUR_APP_ID` 和 `YOUR_DEPOT_ID` 替换为 Steamworks 后台分配的数字。
3. 在 app build 文件中填写对应 depot 配置文件名。
4. 使用 Steamworks SDK 的 ContentBuilder 上传，不要把账号密码写入 VDF 或仓库。
5. 在 Steamworks 的测试分支安装构建，验证首次启动、计时恢复、存档和卸载重装。
6. 复制 `../submission.example.json` 为 `../submission.json`，填写并确认发行资料，然后运行 `npm run verify:submission`。

## 3. 当前能力声明

- 游戏不集成 Steamworks SDK。
- 不支持 Steam 云、Steam 成就、创意工坊、联机、控制器或跨平台。
- 勋章是游戏内本地进度，不是 Steam 成就。
- 游戏核心与存档不需要联网。
- 玩家可以主动连接 Hermes Agent 或 OpenAI 兼容模型，生成结构化任务关卡。
- 每次模型生成前均要求单次任务发送确认；最近完成任务名称默认不发送。
- 玩家可以主动配置飞书机器人 Webhook，发送已勾选的完成回执。
- 游戏不内置模型、模型订阅、API Key、飞书 SDK、遥测或开发者代理服务。

商店页不得宣称以上未实现能力。

## 4. 提交顺序

1. 完成 Steam Direct 入驻、费用和税务/银行资料。
2. 创建 AppID 与 depot。
3. 确认全部视觉素材、名称、音乐和代码依赖的商业使用权。
4. 按 `store-page-zh-CN.md` 填写商店页，并制作后台要求的全部商店图。
5. 按 `content-survey-draft.md` 和真实素材来源完成实时/预生成 AI 内容调查。
6. 上传构建到仅开发者可见分支并完整安装测试。
7. 提交商店页和构建审核，并为被退回留出修改时间。

官方文档：

- https://partner.steamgames.com/doc/gettingstarted/onboarding
- https://partner.steamgames.com/doc/gettingstarted/appfee
- https://partner.steamgames.com/doc/store/review_process
- https://partner.steamgames.com/doc/sdk/uploading
