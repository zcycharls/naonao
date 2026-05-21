# MEMORY.md — 孬孬 (NAONAO) 项目长期记忆

## 项目概要
- **孬孬**：ADHD 桌面陪伴宠物（树袋熊形象）
- **平台**：Electron 桌面应用 + Web 版 (GitHub Pages)
- **核心能力**：AI 对话、番茄钟、任务锚、本地 AI 推理、统计面板
- **仓库**：`https://github.com/zcycharls/naonao` (main 分支)
- **本地路径**：`C:\Users\16627\Desktop\NAONAO`

## 技术栈

| 层面 | 选型 | 备注 |
|------|------|------|
| 框架 | Electron 28.3.3 | 桌面版 |
| 前端 | 纯 HTML/CSS/JS（零框架）| 所有 CSS/JS 内联在 index.html 中 |
| 本地 AI | @xenova/transformers 2.17.2 | ESM 模块，需 `await import()` |
| AI 模型 | Qwen1.5-0.5B-Chat（量化版 460MB）| 按需下载，不打包 |
| 镜像 | HF Mirror (hf-mirror.com) | 国内加速 |
| 打包 | electron-builder 24.0.0 | 输出 NSIS 安装包 |
| 存储 | localStorage（Web）/ safeStorage（桌面 Key）| |

## 关键架构决策

### 双文件结构
- `index.html`：Web 版（约 1800 行），部署到 GitHub Pages
- `app/index.html`：Electron 版（约 4200 行），带本地 AI、safeStorage 等
- 两个文件需要**独立同步修改**，不能共用代码

### 本地 AI 模型管理
- **按需下载**：模型不内置到安装包（`extraResources: []`）
- 下载到 `userData/models/`，含 `.cache/` 目录
- ESM 加载：`await import('@xenova/transformers')`
- 国内镜像：`env.remoteHost = 'https://hf-mirror.com'`
- 启动脚本：`start.sh` 解决 `ELECTRON_RUN_AS_NODE` 问题

### 启动流程
1. `npm start` → `bash start.sh` → `unset ELECTRON_RUN_AS_NODE; npx electron .`
2. 主进程加载模型（如已下载）
3. Onboarding 引导（首次启动）
4. 宠物展示 + 自动提醒系统

### 版本号规则
格式：`主版本.月月日日.次版本`（如 `1.0521.1912`）

## 用户偏好
- **开发流程**：先改代码 → 启动测试 → 截图确认 → 提交推送
- **Git 推送**：用 SSH（`git@github.com:zcycharls/naonao.git`），HTTPS 常被墙
- **每次改完都启动应用让用户验证**
- **不瞎猜配置**：先独立验证通路再改代码
- **保持代码风格一致**：用 petDialog 而非原生 alert/confirm

## 已完成功能
- ✅ AI 对话（Anthropic / OpenAI 兼容）
- ✅ 本地 AI 离线推理（Qwen1.5-0.5B）
- ✅ 番茄钟 + 自动提醒
- ✅ 任务锚 + 任务管理
- ✅ 100+ ADHD 知识卡片
- ✅ Onboarding 引导（3 步：问候/API配置/任务锚）
- ✅ 数据统计面板（番茄钟追踪、打卡日历、趋势图）
- ✅ 模型按需下载 + 删除管理
- ✅ 重新引导按钮

## 活跃问题/注意事项
- 两个 `index.html` 需手动同步修改
- GitHub Pages 部署路径：`https://zcycharls.github.io/naonao`
- 安装包下载链接在 `showcase.html` 中指向 `/releases`
- Electron 版依赖 `safeStorage` 加密存储 API Key
