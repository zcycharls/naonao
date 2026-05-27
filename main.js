const { app, BrowserWindow, shell, ipcMain, screen, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')

// ═══ 日志转发到前端 ═══
function sendLogToRenderer(msg) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('main-log', msg)
  })
}

// ═══ 本地 AI 模型（按需下载到 userData 目录）═══
let localModelPipeline = null
let localModelLoading = false
let localModelReady = false
let localModelCancelFlag = false
const MODEL_NAME = 'Xenova/Qwen1.5-0.5B-Chat'

// 模型存放目录：优先 userData/models/（按需下载），兼容开发环境
function getModelDir() {
  // 生产/运行时：userData/models/（点击下载后存放的位置）
  const userDataDir = path.join(app.getPath('userData'), 'models', 'Xenova', 'Qwen1.5-0.5B-Chat')
  if (fs.existsSync(path.join(userDataDir, 'config.json'))) return userDataDir
  // 开发环境：直接从项目目录加载（方便调试）
  const devDir = path.join(__dirname, 'app', 'models', 'Xenova', 'Qwen1.5-0.5B-Chat')
  if (fs.existsSync(path.join(devDir, 'config.json'))) return devDir
  return null
}

function getModelsRootDir() {
  // 返回模型所在的父目录（供 transformers.js env.localModelPath 使用）
  const userDataRoot = path.join(app.getPath('userData'), 'models')
  if (fs.existsSync(path.join(userDataRoot, 'Xenova', 'Qwen1.5-0.5B-Chat', 'config.json'))) return userDataRoot
  const devDir = path.join(__dirname, 'app', 'models')
  if (fs.existsSync(path.join(devDir, 'Xenova', 'Qwen1.5-0.5B-Chat', 'config.json'))) return devDir
  return null
}

// 检查用户是否已下载模型（只看 userData，不等同于 getModelDir 的 dev 回退）
function hasDownloadedModel() {
  const userDataDir = path.join(app.getPath('userData'), 'models', 'Xenova', 'Qwen1.5-0.5B-Chat')
  return fs.existsSync(path.join(userDataDir, 'onnx', 'decoder_model_merged_quantized.onnx'))
}

async function loadLocalModel() {
  if (localModelLoading || localModelReady) return localModelReady
  const modelDir = getModelDir()
  const modelsRoot = getModelsRootDir()

  if (!modelDir || !modelsRoot) {
    console.log('[孬孬] 模型目录未找到')
    return false
  }
  localModelLoading = true
  try {
    // @xenova/transformers v2+ 是 ESM，需要用动态 import() 加载
    const transformers = await import('@xenova/transformers')
    const { pipeline, env } = transformers
    // 设置本地模型根目录，让 transformers.js 能正确找到本地模型
    env.localModelPath = modelsRoot
    env.allowRemoteModels = false
    console.log('[孬孬] 开始加载模型: ' + MODEL_NAME)
    localModelPipeline = await pipeline('text-generation', MODEL_NAME, {
      local_files_only: true,
    })
    localModelReady = true
    console.log('[孬孬] ✅ 模型加载成功')
    return true
  } catch (e) {
    console.error('[孬孬] 模型加载失败:', e.message)
    localModelReady = false
    return false
  } finally {
    localModelLoading = false
  }
}

// 下载模型到 userData 目录（点击下载按钮时调用）
async function downloadLocalModel(progressCallback, isCancelled) {
  const modelsRoot = path.join(app.getPath('userData'), 'models')
  // 确保目录存在
  if (!fs.existsSync(modelsRoot)) {
    fs.mkdirSync(modelsRoot, { recursive: true })
  }
  try {
    // @xenova/transformers v2+ 是 ESM，需要用动态 import() 加载
    const transformers = await import('@xenova/transformers')
    const { pipeline, env } = transformers
    // 设置本地模型根目录 + 缓存目录（统一放到 userData 下，删除时才能清干净）
    env.localModelPath = modelsRoot
    env.cacheDir = path.join(modelsRoot, '.cache')
    env.allowRemoteModels = true  // 允许从 HuggingFace 下载
    env.allowLocalModels = true
    // 使用国内镜像加速（HuggingFace 在国内常被墙）
    env.remoteHost = 'https://hf-mirror.com'

    console.log('[孬孬] 开始下载模型:', MODEL_NAME, '(镜像: hf-mirror.com)')
    // 下载并加载模型（会触发自动下载）
    const p = await pipeline('text-generation', MODEL_NAME, {
      progress_callback: (info) => {
        if (isCancelled && isCancelled()) throw new Error('CANCELLED')
        if (progressCallback && info) {
          // @xenova/transformers progress: { status, name, file, loaded, total, progress }
          const pct = info.progress !== undefined ? Math.round(info.progress) : 0
          const msg = info.status === 'progress'
            ? `下载中 ${pct}% · ${info.name || ''}`
            : info.status || '准备中…'
          progressCallback({ pct, msg, loaded: info.loaded, total: info.total })
        }
      }
    })
    console.log('[孬孬] ✅ 模型下载并完成加载')
    return { success: true, pipeline: p }
  } catch (e) {
    if (e.message === 'CANCELLED') {
      console.log('[孬孬] ⏹ 下载已取消')
      return { success: false, error: '已取消下载', cancelled: true }
    }
    console.error('[孬孬] 模型下载失败:', e)
    return { success: false, error: e.message }
  }
}

async function runLocalInference(text) {
  if (!localModelReady) {
    const ok = await loadLocalModel()
    if (!ok) return null
  }
  try {
    // 过滤用户输入中的 ChatML 控制字符，防止 prompt 注入
    const safeText = String(text)
      .replace(/<\|?im_(start|end)\|?>/gi, '')  // 移除 <|im_start|> 等
      .replace(/[\r\n]/g, ' ')                  // 换行转为空格，防止伪造新消息
      .slice(0, 500)                         // 硬限长度
    const prompt = `<|im_start|>system\n你是一只叫"孬孬"的数字陪伴宠物，专门陪伴有ADHD的用户。风格：每次回复极简短（最多2-3句话），温柔、接纳、非评判；帮用户聚焦当下；偶尔用1-2个emoji；用中文回复。\n<|im_end|>\n<|im_start|>user\n${safeText}\n<|im_end|>\n<|im_start|>assistant\n`
    const result = await localModelPipeline(prompt, {
      max_new_tokens: 80,
      temperature: 0.7,
      top_p: 0.9,
      do_sample: true,
    })
    // 提取回复 — 严格只取 assistant 部分，防止提示词泄漏
    let full = ''
    if (Array.isArray(result) && result.length > 0) {
      full = result[0]?.generated_text || result[0]?.text || ''
    } else if (typeof result === 'object' && result !== null) {
      full = result.generated_text || result.text || ''
    } else if (typeof result === 'string') {
      full = result
    }
    const marker = '<|im_start|>assistant\n'
    const idx = full.lastIndexOf(marker)
    let response = idx !== -1 ? full.substring(idx + marker.length) : full
    // 移除所有 ChatML 控制 token
    response = response.replace(/<\|im_start\|>(system|user|assistant)/g, '').replace(/<\|im_end\|>/g, '').replace(/<\|im_start\|>/g, '')
    // 移除残留的提示词内容（以角色名开头的行）
    response = response.replace(/^(system|user|assistant)\s*[:\n][\s\S]*$/gm, '')
    response = response.trim()
    return response || null
  } catch (e) {
    console.error('[孬孬] 本地推理失败:', e)
    return null
  }
}

// Disable DPI scaling so window size = actual pixels
// Note: commandLine calls moved inside app.whenReady() to avoid undefined errors
// app.commandLine.appendSwitch('high-dpi-support', '1')
// app.commandLine.appendSwitch('force-device-scale-factor', '1')

let win
const PRELOAD = path.join(__dirname, 'preload.js')
const APP_HTML = path.join(__dirname, 'app', 'index.html')

function makeWindow(opts) {
  return new BrowserWindow({
    frame: false,
    alwaysOnTop: true,
    ...opts,
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      ...(opts.webPreferences || {}),
    },
  })
}

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  // Koala wrapper is 240px wide (left-aligned, see app/index.html .pet-img-wrap).
  // Right gutter holds the bubble (width:200) + tray buttons (right:18, ~22px).
  const W = 500, H = 320

  win = makeWindow({
    width: W,
    height: H,
    x: Math.floor(sw * 0.6),
    y: Math.floor(sh * 0.5),
    transparent: true,
    skipTaskbar: false,
    focusable: false,
    thickFrame: false,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000001',
  })

  win.loadFile(APP_HTML)
  win.webContents.on('did-finish-load', () => {
    win.setBackgroundColor('#00000000')
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')

  ipcMain.on('move-window', (event, { dx, dy }) => {
    const sender = BrowserWindow.fromWebContents(event.sender) || win
    const [x, y] = sender.getPosition()
    const [w, h] = sender.getSize()
    const nx = Math.max(0, Math.min(sw - w, x + Math.round(dx)))
    const ny = Math.max(0, Math.min(sh - h, y + Math.round(dy)))
    sender.setPosition(nx, ny)
  })

  let chatWin = null

  ipcMain.on('expand', () => {
    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.focus()
      return
    }
    const [x, y] = win.getPosition()
    const chatW = 380, chatH = 680
    // Place chat window to the left of pet, or right if not enough space
    let cx = x - chatW - 8
    if (cx < 0) cx = x + W + 8
    cx = Math.max(0, Math.min(cx, sw - chatW))
    const cy = Math.max(0, Math.min(y, sh - chatH))

    chatWin = makeWindow({
      width: chatW,
      height: chatH,
      x: cx, y: cy,
      transparent: true,
      backgroundColor: '#00000000',
      thickFrame: false,
      hasShadow: false,
      resizable: false,
    })
    chatWin.loadFile(APP_HTML, { query: { mode: 'chat' } })
    chatWin.on('closed', () => { chatWin = null })
  })

  ipcMain.on('collapse', () => {
    if (chatWin && !chatWin.isDestroyed()) chatWin.close()
  })

  ipcMain.on('set-ignore-mouse', (_, ignore) => {
    win.setIgnoreMouseEvents(ignore, { forward: true })
  })

  let settingsWin = null
  ipcMain.on('open-settings', () => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.focus(); return
    }
    const [x, y] = win.getPosition()
    // Match the chat window's dimensions (380x680) so the two side panels feel like a pair.
    const setW = 380, setH = 680
    settingsWin = makeWindow({
      width: setW,
      height: setH,
      x: Math.max(0, x - (setW + 8)),
      y: Math.max(0, Math.min(y, screen.getPrimaryDisplay().workAreaSize.height - setH)),
      transparent: true,
      backgroundColor: '#00000000',
      thickFrame: false,
      hasShadow: false,
      resizable: false,
    })
    settingsWin.loadFile(APP_HTML, { query: { mode: 'settings' } })
    settingsWin.on('closed', () => { settingsWin = null })
  })

  ipcMain.on('close-app', () => app.quit())
  ipcMain.on('close-self', (evt) => {
    const w = BrowserWindow.fromWebContents(evt.sender)
    if (w && !w.isDestroyed()) w.close()
  })
  ipcMain.on('minimize-self', (evt) => {
    const w = BrowserWindow.fromWebContents(evt.sender)
    if (w && !w.isDestroyed()) w.minimize()
  })
  // Minimize the pet window to the taskbar.
  // The pet window normally has `focusable: false`, which on Windows implies skipTaskbar:true ―
  // i.e. once minimized it disappears from the taskbar and can't be restored (looks "closed").
  // Workaround: flip focusable on for the minimize, then flip it back when restored.
  ipcMain.on('hide-app', () => {
    if (!win || win.isDestroyed()) return
    win.setFocusable(true)
    win.setSkipTaskbar(false)
    win.minimize()
    win.once('restore', () => {
      win.setFocusable(false)
    })
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        shell.openExternal(url)
      } else {
        console.warn('[孬孬] 拒绝打开非 HTTP 链接:', url)
      }
    } catch {
      console.warn('[孬孬] 无效 URL:', url)
    }
    return { action: 'deny' }
  })
}

// ── Encrypted storage for the API key (DPAPI on Windows / Keychain on macOS) ──
const SECRET_FILE = () => path.join(app.getPath('userData'), 'apk.bin')

ipcMain.handle('secret:get', () => {
  try {
    const f = SECRET_FILE()
    if (!fs.existsSync(f)) return ''
    if (!safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.decryptString(fs.readFileSync(f))
  } catch {
    return ''
  }
})

ipcMain.handle('secret:set', (_evt, value) => {
  try {
    const f = SECRET_FILE()
    if (!value) {
      try { fs.unlinkSync(f) } catch {}
      return true
    }
    if (!safeStorage.isEncryptionAvailable()) return false
    fs.writeFileSync(f, safeStorage.encryptString(String(value)), { mode: 0o600 })
    return true
  } catch {
    return false
  }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ═══ 本地模型 IPC 接口 ═══
ipcMain.handle('local-model:status', () => {
  const dir = getModelDir()
  const root = getModelsRootDir()
  return {
    hasModel: hasDownloadedModel(),
    ready: localModelReady,
    loading: localModelLoading,
    modelDir: dir,
    modelsRoot: root,
  }
})

ipcMain.handle('local-model:load', async () => {
  return await loadLocalModel()
})

ipcMain.handle('local-model:inference', async (_event, text) => {
  if (typeof text !== 'string' || text.length === 0 || text.length > 2000) {
    return null
  }
  return await runLocalInference(text)
})

// 处理下载请求（点击下载按钮时调用）
ipcMain.handle('local-model:download', async (event) => {
  if (localModelLoading) {
    return { success: false, error: '正在下载中，请稍候' }
  }
  if (localModelReady) {
    return { success: true, message: '模型已就绪' }
  }

  localModelLoading = true
  localModelCancelFlag = false
  // 发送进度更新到渲染进程
  const sendProgress = (progress) => {
    event.sender.send('local-model:progress', progress)
  }

  const result = await downloadLocalModel(sendProgress, () => localModelCancelFlag)
  localModelLoading = false

  if (localModelCancelFlag) {
    return { success: false, error: '已取消下载', cancelled: true }
  }
  if (result.success) {
    localModelPipeline = result.pipeline
    localModelReady = true
    return { success: true }
  } else {
    return { success: false, error: result.error }
  }
})

// 取消下载
ipcMain.handle('local-model:cancel', async () => {
  localModelCancelFlag = true
  localModelLoading = false
  return { success: true }
})

// 删除已下载的本地模型文件
ipcMain.handle('local-model:delete', async () => {
  if (localModelLoading) {
    return { success: false, error: '模型正在使用中，请稍候' }
  }
  // 释放已加载的 pipeline
  localModelPipeline = null
  localModelReady = false
  localModelLoading = false
  // 删除 userData/models/ 下的模型文件和缓存
  const modelsRoot = path.join(app.getPath('userData'), 'models')
  // 同时清掉 @xenova/transformers 默认缓存（旧版本残留）
  const legacyCache = path.join(__dirname, 'node_modules', '@xenova', 'transformers', '.cache')
  try {
    if (fs.existsSync(modelsRoot)) {
      fs.rmSync(modelsRoot, { recursive: true, force: true })
      console.log('[孬孬] ✅ 已删除本地模型文件:', modelsRoot)
    }
    if (fs.existsSync(legacyCache)) {
      fs.rmSync(legacyCache, { recursive: true, force: true })
      console.log('[孬孬] ✅ 已清掉旧缓存:', legacyCache)
    }
    return { success: true }
  } catch (e) {
    console.error('[孬孬] 删除模型文件失败:', e)
    return { success: false, error: e.message }
  }
})
