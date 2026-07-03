# 孬孬（NAONAO）—— ADHD 数字陪伴宠物

> 一只桌面宠物，陪伴 ADHD 用户聚焦当下、减少焦虑。
> 支持**本地 AI 模型**（免费离线），模型按需下载，不内置到安装包。
> 当前维护 **Electron 桌面客户端** 和 **Android 客户端**；`naonao.help` / GitHub Pages 仅作为介绍和安装包下载页，不是网页端。

---

## 当前功能

- 桌面宠物：透明无边界悬浮，支持拖动、点击反馈和单按钮拖拽调整宠物大小；宠物和页面悬停时保持默认光标。
- 任务锚点：维护当前任务和子步骤，把注意力拉回“下一步做什么”。
- 番茄钟 / 一起专注：专注模式下可戴工作帽，减少环境干扰。
- 飞书监督：可按固定间隔发送监督提醒，也支持飞书应用长连接读取回复；定时器由主进程持久化调度，支持失败重试和应用重启后恢复。
- 长远任务监督：独立页面配置多个长期目标，每个目标绑定独立飞书机器人 Webhook 和独立汇报间隔；每个目标的监督状态由主进程恢复。
- Hermes Agent：可连接官方 Hermes Agent sidecar，并保留本地记忆 fallback。
- 本地 AI 模型：可按需下载离线模型，安装包不内置大模型文件。

---

## 快速开始（新电脑）

如果你是第一次使用孬孬桌面客户端，先看：[新手教程](docs/新手教程.md)。

### 1. 克隆项目

```bash
# 克隆到桌面
git clone https://github.com/zcycharls/naonao.git C:/Users/你的用户名/Desktop/NAONAO
cd C:/Users/你的用户名/Desktop/NAONAO
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动应用

```bash
npm start
```

---

## 常见问题

### `require('electron')` 返回路径字符串（不是 API 对象）

**症状**：启动时报错 `Cannot read properties of undefined (reading 'handle')`

**原因**：`ELECTRON_RUN_AS_NODE=1` 环境变量被设置，导致 Electron 以 Node.js 模式运行（而不是主进程模式）。

**解决**：`npm start` 会通过 Node 启动器删除这个环境变量后再启动 Electron。直接用 `npm start` 即可。

如果问题仍存在，手动取消变量：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start
```

### `npm install` 超时（国内网络）

```bash
# 使用国内镜像
npm config set registry https://registry.npmmirror.com
npm config set ELECTRON_MIRROR https://npmmirror.com/mirrors/electron/
npm install
```

---

## 本地 AI 模型（按需下载）

模型**不会**内置到安装包（减小体积 460MB），用户需要时在设置里点击“下载并加载模型”按钮。

### 开发环境测试

如果想在开发环境直接测试 AI 功能（不用点击下载按钮），把模型文件放到：

```
app/models/Xenova/Qwen1.5-0.5B-Chat/
```

### 生产环境

用户安装应用后，模型会下载到：

```
C:/Users/用户名/AppData/Roaming/孬孬/models/
```

---

## 打包安装包

```bash
npm run build
```

输出文件：`dist/孬孬-Setup-<版本号>.exe`

**注意**：打包配置显式排除 `app/models/**`，模型不会打包进安装包。

---

## 📄 项目结构

```
NAONAO/
├── app/
│   ├── index.html          # 主界面（宠物 + 聊天 + 设置）
│   ├── models/             # 本地 AI 模型（开发环境，可选）
│   └── ...
├── main.js                 # Electron 主进程
├── preload.js              # 预加载脚本（暴露 API 到前端）
├── package.json
├── scripts/start-electron.js # 跨平台启动包装脚本
└── dist/                  # 打包输出目录
```

---

## GitHub

- 仓库地址：https://github.com/zcycharls/naonao
- 推送代码（需要先配置 SSH key）：

```bash
# 1. 生成 SSH key
ssh-keygen -t ed25519 -C "你的邮箱"

# 2. 复制公钥到 GitHub（https://github.com/settings/keys）
cat ~/.ssh/id_ed25519.pub

# 3. 切换远程地址为 SSH
git remote set-url origin git@github.com:zcycharls/naonao.git

# 4. 推送
git push origin main
```

---

## 技术栈

- **Electron** 42.3.0
- **@xenova/transformers** ^2.17.2（本地 AI 推理）
- **onnxruntime-node** ^1.14.0
- **electron-builder** ^26.8.1（打包）

---

## 版本号规则

版本号格式：`主版本.月日.时分`

例如：`1.518.907` = 5月18日 09:07 构建。版本号必须是合法 SemVer，数字段不保留前导零。

运行 `npm run version:bump` 会同步更新 `package.json` 和 `package-lock.json`。打包时会自动根据 `package.json` 的 `version` 字段生成安装包文件名。

---

## 给 Agent 的提示

如果你是新电脑上的 Agent，需要继续开发这个项目：

1. **先读这个 README**，了解项目结构
2. **运行 `npm install && npm start`** 启动应用
3. **本地 AI 模型**需要手动下载（点击设置里的按钮），或者把 `app/models/` 目录复制过来
4. **推送代码前**确保已配置 SSH key（参考上方"GitHub"章节）
5. **打包前**先测试 `npm start` 能正常运行
6. **客户端优先**：桌面端功能入口在 `app/index.html`，业务代码在 `app/app.js` 和 `app/styles.css`；Android 客户端源码在 `android/`；`naonao.help` 只放介绍和下载链接，不实现网页端功能。

---

Made for ADHDers.
