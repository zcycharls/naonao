# Naonao: Focus Quest

`steam-game` 是孬孬的独立 Steam 游戏版。原客户端继续在 `main` 分支维护，两个版本不共享入口、存档或发布包。

这是一款由可选 AI/Hermes 任务导演驱动的单人专注冒险游戏：玩家把现实任务生成 3–5 个关卡，逐关完成专注旅程，获得成长、叶片、羁绊、路线进度、收藏与勋章。

## 产品边界

- Windows x64、简体中文、键盘与鼠标。
- 游戏核心、计时和本地存档可以完全离线运行。
- 可选连接 Hermes Agent 或 OpenAI 兼容模型；不内置模型、API Key 或模型订阅。
- 模型只生成结构化任务关卡，不能执行工具、系统命令或自主操作。
- 可选飞书机器人完成回执；不包含飞书 SDK 或长连接账号功能。
- API Key 与 Webhook 使用 Electron `safeStorage`（Windows DPAPI）加密保存。
- 无广告、内购、开发者遥测或开发者代理服务器。
- 桌面伴侣必须由玩家主动开启。
- 存档位于 `%APPDATA%\Naonao Focus Quest\focus-quest-save.json`。

## 开发

```powershell
npm install
npm start
```

## 验证

```powershell
npm test
```

测试覆盖状态机、任务导演输出校验、加密配置、模拟模型/飞书网络流程、持久化计时与桌面伴侣窗口。

## Steam Depot

```powershell
npm run release:check
```

命令会运行源码测试、重新构建 depot、核对 ASAR 哈希并运行打包程序 smoke。可上传内容生成在 `dist/steam/win-unpacked`。Steam 负责安装和更新，本分支不生成 NSIS 安装器。

提交与上传说明见 [steam/README.md](steam/README.md)。
