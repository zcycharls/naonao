const { app, BrowserWindow, shell, ipcMain, screen, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

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
const MODEL_RELATIVE_DIR = path.join('Xenova', 'Qwen1.5-0.5B-Chat')
const MODEL_CONFIG_FILE = path.join(MODEL_RELATIVE_DIR, 'config.json')
const MODEL_ONNX_FILE = path.join(MODEL_RELATIVE_DIR, 'onnx', 'decoder_model_merged_quantized.onnx')

function getModelRootCandidates(includeDev = true) {
  const userDataRoot = path.join(app.getPath('userData'), 'models')
  const roots = [userDataRoot, path.join(userDataRoot, '.cache')]
  if (includeDev) {
    const devRoot = path.join(__dirname, 'app', 'models')
    roots.push(devRoot, path.join(devRoot, '.cache'))
  }
  return roots
}

// 模型存放目录：优先 userData/models/（按需下载），兼容开发环境
function getModelDir() {
  for (const root of getModelRootCandidates()) {
    if (fs.existsSync(path.join(root, MODEL_CONFIG_FILE))) {
      return path.join(root, MODEL_RELATIVE_DIR)
    }
  }
  return null
}

function getModelsRootDir() {
  // 返回模型所在的父目录（供 transformers.js env.localModelPath 使用）
  for (const root of getModelRootCandidates()) {
    if (fs.existsSync(path.join(root, MODEL_CONFIG_FILE))) return root
  }
  return null
}

// 检查用户是否已下载模型（只看 userData，不等同于 getModelDir 的 dev 回退）
function hasDownloadedModel() {
  return getModelRootCandidates(false).some(root => fs.existsSync(path.join(root, MODEL_ONNX_FILE)))
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
    env.cacheDir = path.join(app.getPath('userData'), 'models', '.cache')
    env.allowRemoteModels = false
    env.allowLocalModels = true
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
      return_full_text: false,
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
const PET_BASE_WIDTH = 335
const PET_BASE_HEIGHT = 320
const PET_MIN_SCALE = 0.7
const PET_MAX_SCALE = 1.4
let petDragAnchor = null
let petDragTimer = null
let petWindowShape = null

function normalizePetScale(value) {
  const scale = Number(value)
  if (!Number.isFinite(scale)) return 1
  return Math.max(PET_MIN_SCALE, Math.min(PET_MAX_SCALE, scale))
}

function petWindowWidthForScale(scale) {
  return Math.round(240 * scale + 95)
}

function petWindowHeightForScale(scale) {
  return Math.round(PET_BASE_HEIGHT * scale)
}

function stopPetDragTimer() {
  if (!petDragTimer) return
  clearInterval(petDragTimer)
  petDragTimer = null
}

function applyPetWindowShape() {
  // Keep the native window rectangular. Electron setShape clips the transparent
  // window surface on Windows and can make the pet appear to sink or lose mouse
  // events during drag. petWindowShape is still used as the visible drag bounds.
}

function movePetWindowToCursor() {
  if (!win || win.isDestroyed() || !petDragAnchor) return
  const cursor = screen.getCursorScreenPoint()
  const x = cursor.x - petDragAnchor.dx
  const y = cursor.y - petDragAnchor.dy
  win.setPosition(Math.round(x), Math.round(y))
}

function canOpenExternal(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isAllowedAppNavigation(url) {
  return url.startsWith(pathToFileURL(APP_HTML).href)
}

function hardenWindow(browserWindow) {
  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (canOpenExternal(url)) {
      shell.openExternal(url)
    } else {
      console.warn('[孬孬] 拒绝打开外部链接:', url)
    }
    return { action: 'deny' }
  })
  browserWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppNavigation(url)) {
      event.preventDefault()
      if (canOpenExternal(url)) shell.openExternal(url)
    }
  })
  browserWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

function makeWindow(opts) {
  const browserWindow = new BrowserWindow({
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
  hardenWindow(browserWindow)
  return browserWindow
}

function lockWindowSize(browserWindow, width, height) {
  if (!browserWindow || browserWindow.isDestroyed()) return
  const fixedWidth = Math.round(width)
  const fixedHeight = Math.round(height)
  const restoreSize = () => {
    if (browserWindow.isDestroyed()) return
    const bounds = browserWindow.getBounds()
    if (bounds.width !== fixedWidth || bounds.height !== fixedHeight) {
      browserWindow.setBounds({ ...bounds, width: fixedWidth, height: fixedHeight })
    }
  }
  browserWindow.setResizable(false)
  browserWindow.setMaximizable(false)
  browserWindow.setMinimumSize(fixedWidth, fixedHeight)
  browserWindow.setMaximumSize(fixedWidth, fixedHeight)
  browserWindow.on('will-resize', event => {
    event.preventDefault()
    restoreSize()
  })
  browserWindow.on('resize', restoreSize)
  browserWindow.on('maximize', () => {
    browserWindow.unmaximize()
    restoreSize()
  })
  browserWindow.webContents.on('did-finish-load', restoreSize)
  restoreSize()
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  const { width: sw, height: sh } = workArea

  // Koala wrapper is 240px wide (left-aligned, see app/index.html .pet-img-wrap).
  // Right gutter holds the bubble (width:200) + tray buttons (right:18, ~22px).
  const W = workArea.width, H = workArea.height

  win = makeWindow({
    width: W,
    height: H,
    x: workArea.x,
    y: workArea.y,
    transparent: true,
    skipTaskbar: false,
    focusable: false,
    thickFrame: false,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
  })

  win.loadFile(APP_HTML)
  win.webContents.on('did-finish-load', () => {
    win.setBackgroundColor('#00000000')
    if (typeof win.setHasShadow === 'function') win.setHasShadow(false)
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'screen-saver')

  ipcMain.on('move-window', (event, payload) => {
    const dx = Number(payload && payload.dx)
    const dy = Number(payload && payload.dy)
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    const sender = BrowserWindow.fromWebContents(event.sender) || win
    const [x, y] = sender.getPosition()
    const [w, h] = sender.getSize()
    const nx = Math.max(0, Math.min(sw - w, x + Math.round(Math.max(-2000, Math.min(2000, dx)))))
    const ny = Math.max(0, Math.min(sh - h, y + Math.round(Math.max(-2000, Math.min(2000, dy)))))
    sender.setPosition(nx, ny)
  })

  ipcMain.on('pet:drag-start', (event) => {
    if (!win || win.isDestroyed()) return
    const sender = BrowserWindow.fromWebContents(event.sender)
    if (sender !== win) return
    stopPetDragTimer()
    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    petDragAnchor = {
      dx: cursor.x - bounds.x,
      dy: cursor.y - bounds.y,
    }
    petDragTimer = setInterval(movePetWindowToCursor, 16)
  })

  ipcMain.on('pet:drag-move', (event) => {
    if (!win || win.isDestroyed() || !petDragAnchor) return
    const sender = BrowserWindow.fromWebContents(event.sender)
    if (sender !== win) return
    movePetWindowToCursor()
  })

  ipcMain.on('pet:drag-end', (event) => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    if (sender !== win) return
    stopPetDragTimer()
    petDragAnchor = null
    applyPetWindowShape()
  })

  ipcMain.on('pet:shape:set', (event, rects) => {
    if (!win || win.isDestroyed() || typeof win.setShape !== 'function') return
    const sender = BrowserWindow.fromWebContents(event.sender)
    if (sender !== win || !Array.isArray(rects)) return
    const bounds = win.getBounds()
    const shape = rects.slice(0, 8).map(rect => {
      const x = Math.max(0, Math.floor(Number(rect?.x) || 0))
      const y = Math.max(0, Math.floor(Number(rect?.y) || 0))
      const width = Math.min(bounds.width - x, Math.ceil(Number(rect?.width) || 0))
      const height = Math.min(bounds.height - y, Math.ceil(Number(rect?.height) || 0))
      return { x, y, width, height }
    }).filter(rect => rect.width > 0 && rect.height > 0)
    if (shape.length) {
      petWindowShape = shape
    }
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
    lockWindowSize(chatWin, chatW, chatH)
    chatWin.setAlwaysOnTop(true, 'screen-saver')
    chatWin.loadFile(APP_HTML, { query: { mode: 'chat' } })
    chatWin.on('closed', () => { chatWin = null })
  })

  ipcMain.on('collapse', () => {
    if (chatWin && !chatWin.isDestroyed()) chatWin.close()
  })

  ipcMain.on('set-ignore-mouse', (_, ignore) => {
    win.setIgnoreMouseEvents(!!ignore, { forward: true })
  })

  ipcMain.handle('pet:size:set', (event, value) => {
    if (!win || win.isDestroyed()) return { success: false, error: '宠物窗口不存在' }
    const sender = BrowserWindow.fromWebContents(event.sender)
    if (sender !== win) return { success: false, error: '只能从宠物窗口调整大小' }
    const scale = normalizePetScale(value)
    const bounds = win.getBounds()
    return { success: true, scale, width: bounds.width, height: bounds.height }
  })

  let settingsWin = null
  let longTasksWin = null
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
    lockWindowSize(settingsWin, setW, setH)
    settingsWin.setAlwaysOnTop(true, 'screen-saver')
    settingsWin.loadFile(APP_HTML, { query: { mode: 'settings' } })
    settingsWin.on('closed', () => { settingsWin = null })
  })

  ipcMain.on('open-long-tasks', () => {
    if (longTasksWin && !longTasksWin.isDestroyed()) {
      longTasksWin.focus(); return
    }
    const [x, y] = win.getPosition()
    const setW = 480, setH = 680
    longTasksWin = makeWindow({
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
    lockWindowSize(longTasksWin, setW, setH)
    longTasksWin.setAlwaysOnTop(true, 'screen-saver')
    longTasksWin.loadFile(APP_HTML, { query: { mode: 'long-tasks' } })
    longTasksWin.on('closed', () => { longTasksWin = null })
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

  ipcMain.on('config:changed', (event) => {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed() && w.webContents !== event.sender) {
        w.webContents.send('config:changed')
      }
    })
  })
}

// ── Encrypted storage for the API key (DPAPI on Windows / Keychain on macOS) ──
const SECRET_FILE = () => path.join(app.getPath('userData'), 'apk.bin')
const FEISHU_WEBHOOK_FILE = () => path.join(app.getPath('userData'), 'feishu-webhook.bin')
const FEISHU_APP_SECRET_FILE = () => path.join(app.getPath('userData'), 'feishu-app-secret.bin')
const HERMES_API_KEY_FILE = () => path.join(app.getPath('userData'), 'hermes-api-key.bin')
const LONG_TASK_WEBHOOKS_FILE = () => path.join(app.getPath('userData'), 'long-task-webhooks.bin')
const FEISHU_SUPERVISOR_FILE = () => path.join(app.getPath('userData'), 'feishu-supervisor.bin')
let feishuClient = null
let feishuWsClient = null
let feishuWsConnected = false
let feishuAppId = ''
const feishuSeenMessages = new Set()
let feishuSupervisorTimer = null
let feishuSupervisorSending = false

ipcMain.handle('secret:has', () => {
  return !!readEncryptedString(SECRET_FILE())
})

ipcMain.handle('secret:set', (_evt, value) => {
  try {
    if (typeof value !== 'string' || value.length > 4096) return false
    const f = SECRET_FILE()
    if (!value) {
      try { fs.unlinkSync(f) } catch (e) { console.error('[孬孬] 删除旧密钥文件失败:', e.message) }
      return true
    }
    if (!safeStorage.isEncryptionAvailable()) return false
    fs.writeFileSync(f, safeStorage.encryptString(String(value)), { mode: 0o600 })
    return true
  } catch (e) {
    console.error('[孬孬] 保存加密密钥失败:', e.message)
    return false
  }
})

app.whenReady().then(() => {
  createWindow()
  restoreFeishuSupervisor()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ═══ 本地模型 IPC 接口 ═══
ipcMain.handle('local-model:status', () => {
  return {
    hasModel: hasDownloadedModel(),
    ready: localModelReady,
    loading: localModelLoading,
  }
})

function readEncryptedString(filePath) {
  try {
    if (!fs.existsSync(filePath)) return ''
    if (!safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.decryptString(fs.readFileSync(filePath))
  } catch (e) {
    console.error('[孬孬] 读取加密配置失败:', e.message)
    return ''
  }
}

function writeEncryptedString(filePath, value, maxLength) {
  try {
    if (typeof value !== 'string' || value.length > maxLength) return false
    if (!value) {
      try { fs.unlinkSync(filePath) } catch {}
      return true
    }
    if (!safeStorage.isEncryptionAvailable()) return false
    fs.writeFileSync(filePath, safeStorage.encryptString(value), { mode: 0o600 })
    return true
  } catch (e) {
    console.error('[孬孬] 保存加密配置失败:', e.message)
    return false
  }
}

function readEncryptedJSON(filePath, fallback) {
  const raw = readEncryptedString(filePath)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch (e) {
    console.error('[孬孬] 读取加密 JSON 失败:', e.message)
    return fallback
  }
}

function writeEncryptedJSON(filePath, value, maxLength) {
  try {
    return writeEncryptedString(filePath, JSON.stringify(value || {}), maxLength)
  } catch (e) {
    console.error('[孬孬] 保存加密 JSON 失败:', e.message)
    return false
  }
}

const PROVIDER_DEFAULT_MODEL = {
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o-mini',
}
const PROVIDER_MAX_MESSAGES = 24
const PROVIDER_MAX_TEXT = 12000

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase() === 'openai' ? 'openai' : 'anthropic'
}

function normalizeProviderModel(provider, value) {
  return String(value || '').trim().slice(0, 160) || PROVIDER_DEFAULT_MODEL[provider]
}

function normalizeOpenAIBaseUrl(value) {
  const raw = String(value || '').trim() || 'https://api.openai.com'
  const url = new URL(raw)
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('OpenAI-compatible Base URL must use https or local http')
  }
  url.username = ''
  url.password = ''
  url.hash = ''
  url.search = ''
  let pathname = (url.pathname || '/v1').replace(/\/+$/, '') || '/v1'
  if (!/\/chat\/completions$/.test(pathname)) pathname += '/chat/completions'
  url.pathname = pathname
  return url.toString()
}

function normalizeProviderContent(content) {
  if (typeof content === 'string') return content.slice(0, PROVIDER_MAX_TEXT)
  if (!Array.isArray(content)) return String(content || '').slice(0, PROVIDER_MAX_TEXT)
  return content.slice(0, 8).map(part => {
    if (!part || typeof part !== 'object') return null
    if (part.type === 'text') return { type: 'text', text: String(part.text || '').slice(0, PROVIDER_MAX_TEXT) }
    if (part.type === 'image' && part.source && typeof part.source === 'object') {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: String(part.source.media_type || 'image/png').slice(0, 80),
          data: String(part.source.data || '').slice(0, 10_000_000),
        },
      }
    }
    if (part.type === 'image_url' && part.image_url && typeof part.image_url === 'object') {
      return { type: 'image_url', image_url: { url: String(part.image_url.url || '').slice(0, 10_000_000) } }
    }
    return null
  }).filter(Boolean)
}

function normalizeProviderMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages.slice(-PROVIDER_MAX_MESSAGES).map(message => {
    const role = ['system', 'user', 'assistant'].includes(message?.role) ? message.role : 'user'
    return { role, content: normalizeProviderContent(message?.content) }
  }).filter(message => message.content !== '' && (!Array.isArray(message.content) || message.content.length > 0))
}

function providerHeaders(provider, apiKey) {
  if (provider === 'anthropic') {
    return {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
  }
  return {
    'content-type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

function extractProviderText(provider, body) {
  if (provider === 'anthropic') return String(body?.content?.[0]?.text || '').trim()
  return String(body?.choices?.[0]?.message?.content || '').trim()
}

ipcMain.handle('ai:chat', async (_evt, config) => {
  try {
    const apiKey = readEncryptedString(SECRET_FILE())
    if (!apiKey) return { success: false, error: 'API Key is not configured' }

    const provider = normalizeProvider(config?.provider)
    const model = normalizeProviderModel(provider, config?.model)
    const maxTokens = Math.min(2000, Math.max(1, Number(config?.maxTokens) || 400))
    const systemPrompt = String(config?.system || '').slice(0, PROVIDER_MAX_TEXT)
    let messages = normalizeProviderMessages(config?.messages)
    if (!messages.length) return { success: false, error: 'No messages to send' }

    let url
    let body
    if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages'
      messages = messages.filter(message => message.role !== 'system')
      body = { model, max_tokens: maxTokens, stream: false, system: systemPrompt, messages }
    } else {
      url = normalizeOpenAIBaseUrl(config?.baseUrl)
      body = { model, messages, max_tokens: maxTokens, stream: false }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: providerHeaders(provider, apiKey),
      body: JSON.stringify(body),
    })
    const bodyText = await response.text()
    let parsed = null
    try { parsed = JSON.parse(bodyText) } catch {}
    if (!response.ok) {
      return { success: false, error: parsed?.error?.message || `HTTP ${response.status}` }
    }
    return { success: true, text: extractProviderText(provider, parsed) }
  } catch (e) {
    return { success: false, error: e.message || 'AI request failed' }
  }
})

function isAllowedFeishuWebhook(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      (url.hostname === 'open.feishu.cn' || url.hostname === 'open.larksuite.com') &&
      /^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+$/.test(url.pathname)
  } catch {
    return false
  }
}

function isValidLongTaskId(value) {
  return /^[A-Za-z0-9_-]{3,48}$/.test(String(value || '').trim())
}

function isValidFeishuAppId(value) {
  return /^cli_[A-Za-z0-9]+$/.test(String(value || '').trim())
}

function normalizeFeishuInterval(value) {
  return Math.min(240, Math.max(1, Math.round(Number(value) || 30)))
}

function sanitizeFeishuSupervisorTask(task) {
  if (!task || typeof task !== 'object') return null
  const title = String(task.title || '').trim().slice(0, 80)
  const nextStep = String(task.nextStep || '').trim().slice(0, 120)
  if (!title && !nextStep) return null
  return { title, nextStep }
}

function normalizeFeishuSupervisorState(value) {
  const raw = value && typeof value === 'object' ? value : {}
  return {
    enabled: !!raw.enabled,
    interval: normalizeFeishuInterval(raw.interval),
    appEnabled: !!raw.appEnabled,
    appId: String(raw.appId || '').trim().slice(0, 80),
    chatId: String(raw.chatId || '').trim().slice(0, 160),
    task: sanitizeFeishuSupervisorTask(raw.task),
    lastSentAt: Number(raw.lastSentAt) || 0,
    nextDueAt: Number(raw.nextDueAt) || 0,
    retryCount: Math.max(0, Math.min(3, Number(raw.retryCount) || 0)),
    lastError: String(raw.lastError || '').slice(0, 240),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  }
}

function readFeishuSupervisorState() {
  return normalizeFeishuSupervisorState(readEncryptedJSON(FEISHU_SUPERVISOR_FILE(), {}))
}

function writeFeishuSupervisorState(state) {
  return writeEncryptedJSON(FEISHU_SUPERVISOR_FILE(), normalizeFeishuSupervisorState(state), 12000)
}

function broadcastFeishuSupervisorStatus(extra = {}) {
  const state = readFeishuSupervisorState()
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) {
      w.webContents.send('feishu:supervisor-status', { ...state, ...extra })
    }
  })
}

function buildFeishuSupervisorMessage(state, isTest = false) {
  const now = new Date()
  const hm = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const lines = [
    isTest ? '[孬孬测试提醒]' : '[孬孬监督签到]',
    `${hm} 现在在做什么？`,
  ]
  if (state.task?.title) lines.push(`当前任务：${state.task.title}`)
  if (state.task?.nextStep) lines.push(`下一步：${state.task.nextStep}`)
  lines.push('请用一句话回复/记录：我刚才在做什么，下一步做什么。')
  return lines.join('\n')
}

async function sendFeishuAppMessage(chatId, text) {
  const message = String(text || '').trim().slice(0, 1800)
  const targetChatId = String(chatId || '').trim()
  if (!feishuClient || !feishuWsConnected) {
    return { success: false, error: '飞书应用机器人未连接' }
  }
  if (!targetChatId || !message) {
    return { success: false, error: '缺少会话或消息内容' }
  }
  try {
    const messageApi = feishuClient.im?.v1?.message || feishuClient.im?.message
    if (!messageApi?.create) return { success: false, error: '飞书 SDK 消息 API 不可用' }
    await messageApi.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: targetChatId,
        msg_type: 'text',
        content: JSON.stringify({ text: message }),
      },
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message || '发送失败' }
  }
}

async function sendFeishuSupervisorMessage(state, isTest = false) {
  const text = buildFeishuSupervisorMessage(state, isTest)
  if (state.appEnabled && state.chatId) {
    const appResult = await sendFeishuAppMessage(state.chatId, text)
    if (appResult?.success) return appResult
    const webhook = readEncryptedString(FEISHU_WEBHOOK_FILE())
    if (!webhook) return appResult
  }
  return sendFeishuWebhookMessage(readEncryptedString(FEISHU_WEBHOOK_FILE()), text)
}

function stopFeishuSupervisorTimer() {
  if (!feishuSupervisorTimer) return
  clearTimeout(feishuSupervisorTimer)
  feishuSupervisorTimer = null
}

function scheduleFeishuSupervisor() {
  stopFeishuSupervisorTimer()
  const state = readFeishuSupervisorState()
  if (!state.enabled) {
    broadcastFeishuSupervisorStatus({ running: false })
    return
  }
  const intervalMs = normalizeFeishuInterval(state.interval) * 60 * 1000
  const dueAt = state.nextDueAt || (Date.now() + intervalMs)
  const delay = Math.max(1000, Math.min(dueAt - Date.now(), 2_147_000_000))
  feishuSupervisorTimer = setTimeout(() => runFeishuSupervisorTick(false), delay)
  broadcastFeishuSupervisorStatus({ running: true, nextDueAt: dueAt })
}

async function runFeishuSupervisorTick(isTest = false) {
  if (feishuSupervisorSending) return { success: false, error: '正在发送中' }
  const state = readFeishuSupervisorState()
  if (!state.enabled && !isTest) return { success: false, error: '飞书监督未开启' }
  feishuSupervisorSending = true
  try {
    const result = await sendFeishuSupervisorMessage(state, isTest)
    if (isTest) {
      broadcastFeishuSupervisorStatus({ testResult: result })
      return result
    }
    const now = Date.now()
    if (result?.success) {
      state.lastSentAt = now
      state.retryCount = 0
      state.lastError = ''
      state.nextDueAt = now + normalizeFeishuInterval(state.interval) * 60 * 1000
    } else {
      const retrySteps = [60_000, 5 * 60_000, 15 * 60_000]
      const retryCount = Math.min(3, state.retryCount + 1)
      state.retryCount = retryCount
      state.lastError = result?.error || '发送失败'
      state.nextDueAt = now + retrySteps[Math.min(retryCount - 1, retrySteps.length - 1)]
    }
    state.updatedAt = now
    writeFeishuSupervisorState(state)
    broadcastFeishuSupervisorStatus({ running: true })
    return result
  } finally {
    feishuSupervisorSending = false
    if (!isTest) scheduleFeishuSupervisor()
  }
}

function configureFeishuSupervisor(config) {
  const previous = readFeishuSupervisorState()
  const next = normalizeFeishuSupervisorState({
    ...previous,
    enabled: !!config?.enabled,
    interval: config?.interval,
    appEnabled: !!config?.appEnabled,
    appId: config?.appId,
    chatId: config?.chatId,
    task: config?.task,
    updatedAt: Date.now(),
  })
  const intervalChanged = previous.interval !== next.interval
  const wasDisabled = !previous.enabled && next.enabled
  if (!next.enabled) {
    next.nextDueAt = 0
    next.retryCount = 0
    next.lastError = ''
  } else if (!previous.nextDueAt || intervalChanged || wasDisabled) {
    next.nextDueAt = Date.now() + normalizeFeishuInterval(next.interval) * 60 * 1000
    next.retryCount = 0
  }
  writeFeishuSupervisorState(next)
  scheduleFeishuSupervisor()
  return { success: true, state: readFeishuSupervisorState() }
}

async function restoreFeishuSupervisor() {
  const state = readFeishuSupervisorState()
  if (state.appEnabled && isValidFeishuAppId(state.appId) && readEncryptedString(FEISHU_APP_SECRET_FILE())) {
    try { await startFeishuAppConnection({ appId: state.appId }) } catch (e) {
      console.error('[孬孬] 飞书应用恢复失败:', e.message)
    }
  }
  scheduleFeishuSupervisor()
}

function broadcastFeishuStatus(payload) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('feishu:status', payload)
  })
}

function broadcastFeishuMessage(payload) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('feishu:message', payload)
  })
}

function parseFeishuText(content) {
  try {
    const parsed = JSON.parse(content || '{}')
    return String(parsed.text || parsed.title || '').trim()
  } catch {
    return String(content || '').trim()
  }
}

function normalizeFeishuEvent(data) {
  const event = data && data.event ? data.event : data
  const message = event && event.message ? event.message : {}
  const sender = event && event.sender ? event.sender : {}
  const senderId = sender.sender_id || {}
  return {
    chatId: message.chat_id || '',
    messageId: message.message_id || '',
    text: parseFeishuText(message.content),
    createTime: message.create_time || '',
    senderId: senderId.open_id || senderId.user_id || '',
    senderType: sender.sender_type || '',
  }
}

function stopFeishuWs() {
  if (feishuWsClient) {
    try { feishuWsClient.close && feishuWsClient.close() } catch (e) {
      console.error('[孬孬] 关闭飞书长连接失败:', e.message)
    }
  }
  feishuClient = null
  feishuWsClient = null
  feishuWsConnected = false
  broadcastFeishuStatus({ connected: false })
}

ipcMain.handle('feishu:webhook:get', () => {
  return readEncryptedString(FEISHU_WEBHOOK_FILE())
})

ipcMain.handle('feishu:webhook:set', (_evt, value) => {
  const webhook = String(value || '').trim()
  if (webhook && !isAllowedFeishuWebhook(webhook)) return false
  return writeEncryptedString(FEISHU_WEBHOOK_FILE(), webhook, 2048)
})

async function sendFeishuWebhookMessage(webhook, text) {
  const message = String(text || '').trim().slice(0, 1800)
  if (!webhook || !isAllowedFeishuWebhook(webhook)) {
    return { success: false, error: '飞书 Webhook 未配置或格式不正确' }
  }
  if (!message) {
    return { success: false, error: '消息为空' }
  }

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: message },
      }),
    })
    const bodyText = await response.text()
    let body = null
    try { body = JSON.parse(bodyText) } catch {}
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }
    if (body && typeof body.code === 'number' && body.code !== 0) {
      return { success: false, error: body.msg || body.StatusMessage || `飞书返回 code ${body.code}` }
    }
    if (body && typeof body.StatusCode === 'number' && body.StatusCode !== 0) {
      return { success: false, error: body.StatusMessage || `飞书返回 StatusCode ${body.StatusCode}` }
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message || '发送失败' }
  }
}

ipcMain.handle('feishu:send', async (_evt, text) => {
  const webhook = readEncryptedString(FEISHU_WEBHOOK_FILE())
  return sendFeishuWebhookMessage(webhook, text)
})

ipcMain.handle('feishu:long-task-webhook:get', (_evt, taskId) => {
  const id = String(taskId || '').trim()
  if (!isValidLongTaskId(id)) return ''
  const webhooks = readEncryptedJSON(LONG_TASK_WEBHOOKS_FILE(), {})
  return String(webhooks[id] || '')
})

ipcMain.handle('feishu:long-task-webhook:set', (_evt, taskId, value) => {
  const id = String(taskId || '').trim()
  const webhook = String(value || '').trim()
  if (!isValidLongTaskId(id)) return false
  if (webhook && !isAllowedFeishuWebhook(webhook)) return false
  const webhooks = readEncryptedJSON(LONG_TASK_WEBHOOKS_FILE(), {})
  if (webhook) webhooks[id] = webhook
  else delete webhooks[id]
  return writeEncryptedJSON(LONG_TASK_WEBHOOKS_FILE(), webhooks, 20000)
})

ipcMain.handle('feishu:long-task-send', async (_evt, taskId, text) => {
  const id = String(taskId || '').trim()
  if (!isValidLongTaskId(id)) return { success: false, error: '长远任务 id 不正确' }
  const webhooks = readEncryptedJSON(LONG_TASK_WEBHOOKS_FILE(), {})
  return sendFeishuWebhookMessage(String(webhooks[id] || ''), text)
})

ipcMain.handle('feishu:app-secret:get', () => {
  return readEncryptedString(FEISHU_APP_SECRET_FILE())
})

ipcMain.handle('feishu:app-secret:set', (_evt, value) => {
  return writeEncryptedString(FEISHU_APP_SECRET_FILE(), String(value || '').trim(), 2048)
})

ipcMain.handle('hermes:api-key:get', () => {
  return readEncryptedString(HERMES_API_KEY_FILE())
})

ipcMain.handle('hermes:api-key:set', (_evt, value) => {
  return writeEncryptedString(HERMES_API_KEY_FILE(), String(value || '').trim(), 2048)
})

function normalizeHermesBaseUrl(value) {
  const raw = String(value || '').trim() || 'http://127.0.0.1:8642/v1'
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Hermes API Base URL 只支持 http/https')
  url.hash = ''
  url.search = ''
  url.pathname = (url.pathname || '/v1').replace(/\/+$/, '') || '/v1'
  return url.toString().replace(/\/+$/, '')
}

function hermesEndpoint(baseUrl, pathName) {
  return `${normalizeHermesBaseUrl(baseUrl).replace(/\/+$/, '')}/${String(pathName || '').replace(/^\/+/, '')}`
}

function hermesHealthUrl(baseUrl) {
  const url = new URL(normalizeHermesBaseUrl(baseUrl))
  url.pathname = url.pathname.replace(/\/v\d+$/, '').replace(/\/+$/, '') + '/health'
  return url.toString()
}

function hermesHeaders() {
  const headers = { 'content-type': 'application/json' }
  const key = readEncryptedString(HERMES_API_KEY_FILE())
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

ipcMain.handle('hermes:test', async (_evt, config) => {
  try {
    const baseUrl = normalizeHermesBaseUrl(config?.baseUrl)
    let response = await fetch(hermesHealthUrl(baseUrl), { headers: hermesHeaders() })
    if (!response.ok) response = await fetch(hermesEndpoint(baseUrl, 'models'), { headers: hermesHeaders() })
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` }
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message || '连接失败' }
  }
})

ipcMain.handle('hermes:chat', async (_evt, config) => {
  try {
    const baseUrl = normalizeHermesBaseUrl(config?.baseUrl)
    const model = String(config?.model || '').trim() || 'hermes-agent'
    const messages = Array.isArray(config?.messages) ? config.messages : []
    const response = await fetch(hermesEndpoint(baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: hermesHeaders(),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: Math.min(1000, Math.max(1, Number(config?.maxTokens) || 240)),
        stream: false,
      }),
    })
    const bodyText = await response.text()
    let body = null
    try { body = JSON.parse(bodyText) } catch {}
    if (!response.ok) {
      return { success: false, error: body?.error?.message || `HTTP ${response.status}` }
    }
    const text = String(body?.choices?.[0]?.message?.content || '').trim()
    return { success: true, text }
  } catch (e) {
    return { success: false, error: e.message || '请求失败' }
  }
})

async function startFeishuAppConnection(config) {
  const appId = String(config?.appId || '').trim()
  const appSecret = readEncryptedString(FEISHU_APP_SECRET_FILE())
  if (!isValidFeishuAppId(appId)) {
    return { success: false, error: 'App ID 格式不正确' }
  }
  if (!appSecret) {
    return { success: false, error: 'App Secret 未配置' }
  }

  try {
    stopFeishuWs()
    const Lark = require('@larksuiteoapi/node-sdk')
    const baseConfig = {
      appId,
      appSecret,
      domain: Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.warn,
    }
    feishuClient = new Lark.Client(baseConfig)
    feishuWsClient = new Lark.WSClient({ ...baseConfig, autoReconnect: true })
    feishuAppId = appId
    const dispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        const msg = normalizeFeishuEvent(data)
        if (!msg.chatId || !msg.text || msg.senderType === 'app') return
        if (msg.messageId && feishuSeenMessages.has(msg.messageId)) return
        if (msg.messageId) {
          feishuSeenMessages.add(msg.messageId)
          if (feishuSeenMessages.size > 500) {
            const first = feishuSeenMessages.values().next().value
            feishuSeenMessages.delete(first)
          }
        }
        broadcastFeishuMessage(msg)
      },
    })
    feishuWsClient.start({ eventDispatcher: dispatcher })
    feishuWsConnected = true
    broadcastFeishuStatus({ connected: true, appId: feishuAppId })
    return { success: true }
  } catch (e) {
    stopFeishuWs()
    return { success: false, error: e.message || '连接失败' }
  }
}

ipcMain.handle('feishu:app-start', async (_evt, config) => startFeishuAppConnection(config))

ipcMain.handle('feishu:app-stop', async () => {
  stopFeishuWs()
  return { success: true }
})

ipcMain.handle('feishu:app-status', () => {
  return { connected: feishuWsConnected, appId: feishuAppId }
})

ipcMain.handle('feishu:app-send', async (_evt, chatId, text) => {
  const message = String(text || '').trim().slice(0, 1800)
  const targetChatId = String(chatId || '').trim()
  if (!feishuClient || !feishuWsConnected) {
    return { success: false, error: '飞书应用机器人未连接' }
  }
  if (!targetChatId || !message) {
    return { success: false, error: '缺少会话或消息内容' }
  }
  try {
    const messageApi = feishuClient.im?.v1?.message || feishuClient.im?.message
    if (!messageApi?.create) return { success: false, error: '飞书 SDK 消息 API 不可用' }
    await messageApi.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: targetChatId,
        msg_type: 'text',
        content: JSON.stringify({ text: message }),
      },
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message || '发送失败' }
  }
})

ipcMain.handle('feishu:supervisor:configure', (_evt, config) => {
  return configureFeishuSupervisor(config)
})

ipcMain.handle('feishu:supervisor:status', () => {
  return { success: true, state: readFeishuSupervisorState(), running: !!feishuSupervisorTimer }
})

ipcMain.handle('feishu:supervisor:test', async (_evt, config) => {
  const state = normalizeFeishuSupervisorState({ ...readFeishuSupervisorState(), ...(config || {}) })
  const result = await sendFeishuSupervisorMessage(state, true)
  broadcastFeishuSupervisorStatus({ testResult: result })
  return result
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
