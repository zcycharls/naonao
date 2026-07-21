const { app, BrowserWindow, ipcMain, safeStorage, screen } = require('electron')
const dns = require('dns')
const fs = require('fs')
const http = require('http')
const https = require('https')
const net = require('net')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')
const { pathToFileURL } = require('url')
const Engine = require('./app/js/steam-game-engine.js')
const Director = require('./app/js/steam-director-engine.js')

const TEST_USER_DATA = process.env.NAONAO_STEAM_TEST_USER_DATA
const GAME_HTML = path.join(__dirname, 'app', 'steam-game.html')
const COMPANION_HTML = path.join(__dirname, 'app', 'steam-companion.html')
const MAIN_PRELOAD = path.join(__dirname, 'steam-preload.js')
const COMPANION_PRELOAD = path.join(__dirname, 'steam-companion-preload.js')
const GAME_PAGE_URL = pathToFileURL(GAME_HTML).href
const COMPANION_PAGE_URL = pathToFileURL(COMPANION_HTML).href

function isPathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function computeIsolatedTestRun({
  argv = process.argv,
  testUserData = TEST_USER_DATA,
  temporaryRoot = os.tmpdir(),
} = {}) {
  if (!argv.includes('--naonao-steam-test') || !testUserData) return false
  return isPathInside(temporaryRoot, testUserData)
}

function computeTestMode(options = {}) {
  const isPackaged = options.isPackaged ?? app.isPackaged
  return !isPackaged && computeIsolatedTestRun(options)
}

const ISOLATED_TEST_RUN = computeIsolatedTestRun()
const TEST_MODE = computeTestMode()

let mainWindow = null
let companionWindow = null
let gameState = null
let tickTimer = null
let directorRequestInFlight = false

function saveFile() {
  return path.join(app.getPath('userData'), 'focus-quest-save.json')
}

function integrationConfigFile() {
  return path.join(app.getPath('userData'), 'integrations.json')
}

function aiKeyFile(provider) {
  return path.join(app.getPath('userData'), provider === 'openai' ? 'openai-api-key.bin' : 'hermes-api-key.bin')
}

function feishuWebhookFile() {
  return path.join(app.getPath('userData'), 'feishu-webhook.bin')
}

function atomicWrite(file, contents, mode = 0o600) {
  const temporary = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(temporary, contents, { encoding: typeof contents === 'string' ? 'utf8' : undefined, mode })
  try {
    fs.renameSync(temporary, file)
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch {}
    throw error
  }
}

function readEncryptedString(file) {
  try {
    if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.decryptString(fs.readFileSync(file))
  } catch {
    return ''
  }
}

function writeEncryptedString(file, value, maxLength = 4096) {
  try {
    const text = String(value || '').trim()
    if (text.length > maxLength) return false
    if (!text) {
      try { fs.unlinkSync(file) } catch {}
      return true
    }
    if (!safeStorage.isEncryptionAvailable()) return false
    atomicWrite(file, safeStorage.encryptString(text))
    return true
  } catch {
    return false
  }
}

function readIntegrationConfig() {
  try {
    return Director.normalizeIntegrationConfig(JSON.parse(fs.readFileSync(integrationConfigFile(), 'utf8')))
  } catch {
    return Director.normalizeIntegrationConfig(null)
  }
}

function writeIntegrationConfig(config) {
  atomicWrite(integrationConfigFile(), `${JSON.stringify(config, null, 2)}\n`)
}

function integrationSummary() {
  const config = readIntegrationConfig()
  return {
    ...config,
    ai: {
      ...config.ai,
      hasKey: Boolean(readEncryptedString(aiKeyFile(config.ai.provider))),
    },
    feishu: {
      ...config.feishu,
      hasWebhook: Boolean(readEncryptedString(feishuWebhookFile())),
    },
  }
}

function mergeIntegrationConfig(current, patch) {
  const source = patch && typeof patch === 'object' ? patch : {}
  const merged = {
    ...current,
    ai: source.ai && typeof source.ai === 'object' ? { ...current.ai, ...source.ai } : current.ai,
    feishu: source.feishu && typeof source.feishu === 'object' ? { ...current.feishu, ...source.feishu } : current.feishu,
  }
  return Director.normalizeIntegrationConfig(merged)
}

function parseIpv4Bytes(value) {
  const parts = String(value || '').split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return parts
}

function parseIpv6Bytes(value) {
  let source = String(value || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (!source.includes(':')) return null
  if (source.includes('.')) {
    const lastColon = source.lastIndexOf(':')
    const ipv4 = parseIpv4Bytes(source.slice(lastColon + 1))
    if (!ipv4) return null
    source = `${source.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`
  }
  const halves = source.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (left.some(part => !/^[0-9a-f]{1,4}$/.test(part)) || right.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  const groups = [...left, ...Array(missing).fill('0'), ...right].map(part => Number.parseInt(part, 16))
  if (groups.length !== 8) return null
  return groups.flatMap(group => [group >> 8, group & 0xff])
}

function classifyIpv4Bytes(bytes) {
  if (!bytes) return 'invalid'
  const [a, b, c] = bytes
  if (a === 127) return 'loopback'
  if (a === 0 || a === 10 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224) return 'private'
  return 'public'
}

function classifyNetworkAddress(value) {
  const source = String(value || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  const ipv4 = parseIpv4Bytes(source)
  if (ipv4) return classifyIpv4Bytes(ipv4)
  const ipv6 = parseIpv6Bytes(source)
  if (!ipv6) return 'invalid'
  if (ipv6.slice(0, 15).every(byte => byte === 0) && ipv6[15] === 1) return 'loopback'
  if (ipv6.slice(0, 10).every(byte => byte === 0) && ipv6[10] === 0xff && ipv6[11] === 0xff) {
    return classifyIpv4Bytes(ipv6.slice(12))
  }
  if (ipv6.every(byte => byte === 0) ||
      ipv6.slice(0, 12).every(byte => byte === 0) ||
      (ipv6[0] & 0xfe) === 0xfc ||
      (ipv6[0] === 0xfe && (ipv6[1] & 0xc0) === 0x80) ||
      (ipv6[0] === 0xfe && (ipv6[1] & 0xc0) === 0xc0) ||
      ipv6[0] === 0xff ||
      (ipv6[0] === 0x20 && ipv6[1] === 0x01 && ipv6[2] === 0x0d && ipv6[3] === 0xb8)) return 'private'
  return 'public'
}

function abortError() {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function withAbort(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function validateNetworkTarget(value, {
  allowLoopback = false,
  lookup = dns.promises.lookup,
  signal,
} = {}) {
  const url = value instanceof URL ? value : new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP and HTTPS network targets are supported')
  if (url.username || url.password) throw new Error('Network targets cannot contain credentials')
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const literalKind = net.isIP(hostname) ? classifyNetworkAddress(hostname) : 'invalid'
  let records
  if (literalKind !== 'invalid') {
    records = [{ address: hostname, family: net.isIP(hostname) }]
  } else {
    const answer = await withAbort(Promise.resolve(lookup(hostname, { all: true, verbatim: true })), signal)
    records = (Array.isArray(answer) ? answer : [answer])
      .map(record => ({ address: record?.address, family: Number(record?.family) || net.isIP(record?.address) }))
      .filter(record => record.address && (record.family === 4 || record.family === 6))
    if (!records.length) throw new Error('Network target did not resolve')
  }
  for (const record of records) {
    const kind = classifyNetworkAddress(record.address)
    if (kind === 'loopback' && allowLoopback) continue
    if (kind !== 'public') throw new Error('Private network targets are not allowed')
  }
  return { url, ...records[0] }
}

function validateLiteralNetworkTarget(value, { allowLoopback = false } = {}) {
  const url = value instanceof URL ? value : new URL(value)
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!net.isIP(hostname)) return url
  const kind = classifyNetworkAddress(hostname)
  if (kind === 'loopback' && allowLoopback) return url
  if (kind !== 'public') throw new Error('Private network targets are not allowed')
  return url
}

function createPinnedLookup(target) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    queueMicrotask(() => {
      if (options?.all) callback(null, [{ address: target.address, family: target.family }])
      else callback(null, target.address, target.family)
    })
  }
}

function requestHeaders(value) {
  const headers = {}
  const entries = value instanceof Headers
    ? value.entries()
    : Array.isArray(value)
      ? value
      : Object.entries(value || {})
  for (const [name, headerValue] of entries) {
    if (String(name).toLowerCase() === 'host' || headerValue == null) continue
    headers[name] = headerValue
  }
  return headers
}

function incomingResponse(message, method) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(message.headers)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item != null) headers.append(name, item)
    }
  }
  const status = Number(message.statusCode) || 0
  if (status < 200 || status > 599) throw new Error(`Unsupported HTTP status ${status}`)
  const hasBody = method !== 'HEAD' && ![204, 205, 304].includes(status)
  return new Response(hasBody ? Readable.toWeb(message) : null, {
    status,
    statusText: message.statusMessage || '',
    headers,
  })
}

function requestPinned(target, binding, options, signal, networkOptions) {
  const protocol = target.protocol === 'https:' ? https : target.protocol === 'http:' ? http : null
  if (!protocol) return Promise.reject(new Error('Only HTTP and HTTPS network targets are supported'))
  if (target.username || target.password) return Promise.reject(new Error('Network targets cannot contain credentials'))
  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  const method = String(options.method || 'GET').toUpperCase()
  const headers = requestHeaders(options.headers)
  const body = options.body == null
    ? null
    : Buffer.isBuffer(options.body)
      ? options.body
      : options.body instanceof Uint8Array
        ? Buffer.from(options.body)
        : Buffer.from(String(options.body))
  const tlsServername = net.isIP(hostname) ? '' : hostname

  return new Promise((resolve, reject) => {
    const request = protocol.request({
      protocol: target.protocol,
      hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method,
      headers,
      agent: false,
      autoSelectFamily: false,
      family: binding.family,
      lookup: createPinnedLookup(binding),
      signal,
      ...(target.protocol === 'https:' ? {
        servername: tlsServername,
        ...(networkOptions.ca ? { ca: networkOptions.ca } : {}),
      } : {}),
    }, message => {
      try {
        resolve(incomingResponse(message, method))
      } catch (error) {
        message.destroy()
        reject(error)
      }
    })
    request.once('error', reject)
    request.end(body)
  })
}

async function requestValidated(value, options, networkOptions, signal) {
  const binding = await validateNetworkTarget(value, { ...networkOptions, signal })
  const response = await requestPinned(binding.url, binding, options, signal, networkOptions)
  if (response.status < 300 || response.status >= 400) return response
  try { await response.body?.cancel() } catch {}
  throw new TypeError('Redirects are not allowed')
}

async function fetchWithTimeout(url, options, timeoutMs, consumeResponse, networkOptions = {}) {
  if (typeof consumeResponse !== 'function') throw new TypeError('A response consumer is required')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await requestValidated(url, options || {}, networkOptions, controller.signal)
    return await consumeResponse(response)
  } catch (error) {
    const timedOut = controller.signal.aborted
    controller.abort()
    if (timedOut && error?.name !== 'AbortError') throw abortError()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function responseJson(response, maxLength = 128000) {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxLength) {
    try { await response.body?.cancel() } catch {}
    throw new Error('Service response is too large')
  }
  if (!response.body || typeof response.body.getReader !== 'function') throw new Error('Service returned an unreadable response')
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      length += chunk.length
      if (length > maxLength) {
        await reader.cancel()
        throw new Error('Service response is too large')
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  const text = Buffer.concat(chunks, length).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Service did not return valid JSON')
  }
}

function fetchJsonWithTimeout(url, options = {}, timeoutMs = 20000, maxLength = 128000, networkOptions = {}) {
  return fetchWithTimeout(url, options, timeoutMs, async response => ({
    ok: response.ok,
    status: response.status,
    body: await responseJson(response, maxLength),
  }), networkOptions)
}

function fetchStatusWithTimeout(url, options = {}, timeoutMs = 20000, networkOptions = {}) {
  return fetchWithTimeout(url, options, timeoutMs, async response => {
    try { await response.body?.cancel() } catch {}
    return { ok: response.ok, status: response.status }
  }, networkOptions)
}

class InvalidSaveError extends Error {
  constructor(message, cause) {
    super(message, { cause })
    this.name = 'InvalidSaveError'
  }
}

function validateSaveObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 ||
      !value.profile || typeof value.profile !== 'object' ||
      !Array.isArray(value.tasks) ||
      !value.run || typeof value.run !== 'object' ||
      !value.settings || typeof value.settings !== 'object') {
    throw new InvalidSaveError('Save data has an invalid structure')
  }
  return value
}

function parseStoredState(contents, value) {
  let raw
  try {
    raw = JSON.parse(contents)
    validateSaveObject(raw)
    return Engine.normalizeState(raw, value)
  } catch (error) {
    if (error instanceof InvalidSaveError) throw error
    throw new InvalidSaveError('Save data could not be parsed', error)
  }
}

function quarantineFile(file) {
  let target = `${file}.corrupt`
  let suffix = 1
  while (fs.existsSync(target)) {
    target = `${file}.corrupt.${suffix}`
    suffix += 1
  }
  fs.renameSync(file, target)
  return target
}

function readState(value = new Date()) {
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  const file = saveFile()
  const backup = `${file}.bak`
  let normalized
  try {
    normalized = parseStoredState(fs.readFileSync(file, 'utf8'), now)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      normalized = Engine.createDefaultState(now)
    } else if (error instanceof InvalidSaveError) {
      quarantineFile(file)
      try {
        normalized = parseStoredState(fs.readFileSync(backup, 'utf8'), now)
      } catch (backupError) {
        if (backupError?.code === 'ENOENT') {
          normalized = Engine.createDefaultState(now)
        } else if (backupError instanceof InvalidSaveError) {
          quarantineFile(backup)
          normalized = Engine.createDefaultState(now)
        } else {
          throw backupError
        }
      }
    } else {
      throw error
    }
  }
  const settled = Engine.settleRun(normalized, now)
  writeState(settled.state)
  gameState = settled.state
  return gameState
}

function writeState(state) {
  validateSaveObject(state)
  const file = saveFile()
  const backup = `${file}.bak`
  const contents = `${JSON.stringify(state, null, 2)}\n`
  let previous = null
  try {
    previous = fs.readFileSync(file, 'utf8')
    parseStoredState(previous, new Date())
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (previous !== null) atomicWrite(backup, previous)
  atomicWrite(file, contents)
  if (previous === null) {
    try {
      atomicWrite(backup, contents)
    } catch (error) {
      console.error('Could not create save backup:', error)
    }
  }
}

function hardenWindow(browserWindow, expectedPageUrl) {
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  browserWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== expectedPageUrl) event.preventDefault()
  })
  browserWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  browserWindow.webContents.session.setPermissionCheckHandler(() => false)
}

function makeWindow(options, expectedPageUrl) {
  const browserWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#161814',
    ...options,
    webPreferences: {
      preload: MAIN_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: TEST_MODE,
      ...(TEST_MODE ? { additionalArguments: ['--naonao-internal-test-bridge'] } : {}),
      ...(options.webPreferences || {}),
    },
  })
  browserWindow.setMenuBarVisibility(false)
  hardenWindow(browserWindow, expectedPageUrl)
  return browserWindow
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  const workArea = screen.getPrimaryDisplay().workArea
  const width = Math.min(1280, workArea.width - 40)
  const height = Math.min(820, workArea.height - 40)
  mainWindow = makeWindow({
    width,
    height,
    minWidth: Math.min(1000, width),
    minHeight: Math.min(700, height),
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    frame: false,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    title: 'Naonao: Focus Quest',
  }, GAME_PAGE_URL)
  mainWindow.loadFile(GAME_HTML)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })
  return mainWindow
}

function createCompanionWindow() {
  if (companionWindow && !companionWindow.isDestroyed()) return companionWindow
  const workArea = screen.getPrimaryDisplay().workArea
  const width = 280
  const height = 330
  companionWindow = makeWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + workArea.height - height - 24,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: 'Naonao Companion',
    webPreferences: { preload: COMPANION_PRELOAD },
  }, COMPANION_PAGE_URL)
  companionWindow.setAlwaysOnTop(true, 'floating')
  companionWindow.loadFile(COMPANION_HTML)
  companionWindow.once('ready-to-show', () => companionWindow?.showInactive())
  companionWindow.on('closed', () => { companionWindow = null })
  return companionWindow
}

function closeCompanionWindow() {
  if (companionWindow && !companionWindow.isDestroyed()) companionWindow.close()
  companionWindow = null
}

function reconcileCompanion() {
  if (gameState?.settings?.companion) createCompanionWindow()
  else closeCompanionWindow()
}

function companionState(state) {
  return {
    run: {
      status: state.run.status,
      durationMinutes: state.run.durationMinutes,
      remainingSeconds: state.run.remainingSeconds,
      endsAt: state.run.endsAt,
    },
    settings: { focusMinutes: state.settings.focusMinutes },
  }
}

function broadcastState(event = null) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('game:state', { state: gameState, event })
  }
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.webContents.send('game:state', {
      state: companionState(gameState),
      event: event ? { type: event.type } : null,
    })
  }
}

function applyResult(result, event = null) {
  if (!result || !result.state) return { state: gameState, error: 'Game state update failed' }
  try {
    writeState(result.state)
  } catch (error) {
    console.error('Could not persist game state:', error)
    return { state: gameState, error: 'Game state save failed' }
  }
  gameState = result.state
  reconcileCompanion()
  const payload = { ...result, state: gameState, event }
  broadcastState(event ? { ...event, ...result, state: undefined } : null)
  queueFeishuNotification(event, result)
  return payload
}

function runEvent(result, fallbackType, run) {
  if (result?.completed) {
    return { type: 'run-completed', taskId: run.taskId, durationMinutes: run.durationMinutes }
  }
  return { type: fallbackType }
}

function isTrustedSender(event, browserWindow, expectedPageUrl) {
  if (!event || !browserWindow || browserWindow.isDestroyed()) return false
  const contents = browserWindow.webContents
  return event.sender === contents &&
    event.senderFrame === contents.mainFrame &&
    event.senderFrame?.url === expectedPageUrl
}

function senderRole(event) {
  if (isTrustedSender(event, mainWindow, GAME_PAGE_URL)) return 'main'
  if (isTrustedSender(event, companionWindow, COMPANION_PAGE_URL)) return 'companion'
  return null
}

function requireSender(event, roles) {
  const role = senderRole(event)
  if (!roles.includes(role)) throw new Error('IPC request denied')
  return role
}

function modelHeaders(config) {
  const headers = { 'content-type': 'application/json' }
  const key = readEncryptedString(aiKeyFile(config.provider))
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

function modelsEndpoint(baseUrl) {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/chat\/completions$/, '').replace(/\/+$/, '')}/models`
  return url.toString()
}

function healthEndpoint(baseUrl) {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/v\d+$/, '').replace(/\/+$/, '')}/health`
  return url.toString()
}

async function testAiConnection() {
  const config = readIntegrationConfig().ai
  if (!config.enabled) return { success: false, error: '请先开启任务导演' }
  const url = new URL(config.baseUrl)
  if (!Director.isLoopbackHost(url.hostname) && !config.networkConsent) {
    return { success: false, error: '请先确认允许连接此模型地址' }
  }
  if (!Director.isLoopbackHost(url.hostname) && !readEncryptedString(aiKeyFile(config.provider))) {
    return { success: false, error: '远程模型需要 API Key' }
  }
  try {
    const networkOptions = { allowLoopback: Director.isLoopbackHost(url.hostname) }
    const candidates = config.provider === 'hermes'
      ? [healthEndpoint(config.baseUrl), modelsEndpoint(config.baseUrl)]
      : [modelsEndpoint(config.baseUrl)]
    let lastStatus = 0
    for (const endpoint of candidates) {
      try {
        const response = await fetchStatusWithTimeout(endpoint, { headers: modelHeaders(config) }, 8000, networkOptions)
        lastStatus = response.status
        if (response.ok) return { success: true }
      } catch {}
    }
    return { success: false, error: lastStatus ? `HTTP ${lastStatus}` : '连接失败' }
  } catch (error) {
    return { success: false, error: error.name === 'AbortError' ? '连接超时' : String(error.message || '连接失败').slice(0, 160) }
  }
}

async function generateDirectedQuest(taskId, consent) {
  if (directorRequestInFlight) return { state: gameState, error: '任务导演正在处理另一个请求' }
  const config = readIntegrationConfig().ai
  const task = gameState.tasks.find(item => item.id === taskId)
  if (!task || task.done) return { state: gameState, error: '请选择一个未完成任务' }
  if (!config.enabled) return { state: gameState, error: '请先开启任务导演' }
  if (consent !== true) return { state: gameState, error: '需要确认本次任务发送' }
  const url = new URL(config.baseUrl)
  if (!Director.isLoopbackHost(url.hostname) && !config.networkConsent) {
    return { state: gameState, error: '请先确认允许连接此模型地址' }
  }
  const apiKey = readEncryptedString(aiKeyFile(config.provider))
  if (!Director.isLoopbackHost(url.hostname) && !apiKey) return { state: gameState, error: '远程模型需要 API Key' }

  directorRequestInFlight = true
  try {
    const recentTasks = config.shareMemory
      ? gameState.tasks.filter(item => item.done).slice(0, 5).map(item => item.text)
      : []
    const messages = Director.buildDirectorMessages({ task: task.text, profile: gameState.profile, recentTasks })
    const request = Director.buildProviderRequest(config, messages, apiKey)
    const response = await fetchJsonWithTimeout(request.url, request.options, 20000, 128000, {
      allowLoopback: Director.isLoopbackHost(url.hostname),
    })
    const body = response.body
    if (!response.ok) return { state: gameState, error: String(body?.error?.message || `HTTP ${response.status}`).slice(0, 180) }
    const text = Director.extractProviderText(body)
    const quest = Director.parseDirectorResponse(text, task.text, config.provider)
    return applyResult(Engine.assignQuest(gameState, taskId, quest, new Date()), {
      type: 'director-generated',
      taskId,
      provider: config.provider,
    })
  } catch (error) {
    const message = error.name === 'AbortError' ? '任务导演请求超时' : String(error.message || '任务导演请求失败').slice(0, 180)
    return { state: gameState, error: message }
  } finally {
    directorRequestInFlight = false
  }
}

async function sendFeishuMessage(text) {
  const webhook = readEncryptedString(feishuWebhookFile())
  if (!Director.isAllowedFeishuWebhook(webhook, TEST_MODE)) return { success: false, error: '飞书 Webhook 未配置或格式不正确' }
  try {
    const webhookUrl = new URL(webhook)
    const response = await fetchJsonWithTimeout(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ msg_type: 'text', content: { text: String(text || '').slice(0, 1600) } }),
    }, 10000, 32000, {
      allowLoopback: TEST_MODE && Director.isLoopbackHost(webhookUrl.hostname),
    })
    const body = response.body
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` }
    if (typeof body.code === 'number' && body.code !== 0) return { success: false, error: String(body.msg || `飞书返回 ${body.code}`).slice(0, 160) }
    if (typeof body.StatusCode === 'number' && body.StatusCode !== 0) return { success: false, error: String(body.StatusMessage || `飞书返回 ${body.StatusCode}`).slice(0, 160) }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.name === 'AbortError' ? '飞书发送超时' : String(error.message || '飞书发送失败').slice(0, 160) }
  }
}

function queueFeishuNotification(event, result) {
  if (!event || result?.error) return
  const config = readIntegrationConfig().feishu
  if (!config.enabled) return
  let message = ''
  if (event.type === 'run-completed' && config.notifyFocus) {
    const taskText = event.taskId ? gameState.tasks.find(item => item.id === event.taskId)?.text : ''
    message = `【Naonao 专注完成】\n时长：${event.durationMinutes || 0} 分钟${taskText ? `\n任务：${taskText}` : ''}\n今日连续：${gameState.profile.streak} 天`
  }
  if ((event.type === 'task-completed' || result.taskCompleted) && config.notifyTask) {
    const task = gameState.tasks.find(item => item.id === event.taskId)
    if (task) message = `【Naonao 任务完成】\n${task.text}\n获得成长与叶片奖励。`
  }
  if (message) setTimeout(() => sendFeishuMessage(message), 0)
}

function registerGameIpc() {
  const handle = (channel, roles, handler) => ipcMain.handle(channel, (event, ...args) => {
    const role = requireSender(event, roles)
    return handler(role, ...args)
  })
  const listen = (channel, roles, listener) => ipcMain.on(channel, (event, ...args) => {
    const role = senderRole(event)
    if (!roles.includes(role)) return
    listener(role, ...args)
  })

  handle('game:environment', ['main'], () => ({
    edition: 'steam-game',
    localCoreOffline: true,
    optionalOnline: true,
    testMode: TEST_MODE,
    savePath: TEST_MODE ? saveFile() : null,
  }))
  handle('game:get-state', ['main', 'companion'], role => ({
    state: role === 'main' ? gameState : companionState(gameState),
  }))
  handle('game:add-task', ['main'], (_role, text) => applyResult(Engine.addTask(gameState, text, new Date()), { type: 'task-added' }))
  handle('game:complete-task', ['main'], (_role, taskId) => applyResult(Engine.completeTask(gameState, taskId, new Date()), { type: 'task-completed', taskId }))
  handle('game:remove-task', ['main'], (_role, taskId) => applyResult(Engine.removeTask(gameState, taskId, new Date()), { type: 'task-removed' }))
  handle('game:start-run', ['main', 'companion'], (role, options) => {
    const allowedOptions = role === 'main' ? options : { durationMinutes: gameState.settings.focusMinutes }
    return applyResult(Engine.startRun(gameState, allowedOptions, new Date()), { type: 'run-started' })
  })
  handle('game:pause-run', ['main', 'companion'], () => {
    const run = { ...gameState.run }
    const result = Engine.pauseRun(gameState, new Date())
    return applyResult(result, runEvent(result, 'run-paused', run))
  })
  handle('game:resume-run', ['main', 'companion'], () => applyResult(Engine.resumeRun(gameState, new Date()), { type: 'run-resumed' }))
  handle('game:cancel-run', ['main'], () => {
    const run = { ...gameState.run }
    const result = Engine.cancelRun(gameState, new Date())
    return applyResult(result, runEvent(result, 'run-cancelled', run))
  })
  handle('game:claim-quest', ['main'], (_role, questId) => applyResult(Engine.claimDailyQuest(gameState, questId, new Date()), { type: 'quest-claimed' }))
  handle('game:update-settings', ['main'], (_role, settings) => applyResult(Engine.updateSettings(gameState, settings, new Date()), { type: 'settings-updated' }))
  handle('game:complete-quest-step', ['main'], (_role, taskId, stepId) => applyResult(
    Engine.completeQuestStep(gameState, taskId, stepId, new Date()),
    { type: 'quest-step-completed', taskId, stepId },
  ))
  handle('director:generate', ['main'], (_role, taskId, consent) => generateDirectedQuest(String(taskId || ''), consent === true))
  handle('director:offline', ['main'], (_role, taskId) => {
    const task = gameState.tasks.find(item => item.id === taskId)
    if (!task || task.done) return { state: gameState, error: '请选择一个未完成任务' }
    return applyResult(Engine.assignQuest(gameState, taskId, Director.createFallbackQuest(task.text), new Date()), {
      type: 'director-generated',
      taskId,
      provider: 'offline',
    })
  })
  handle('integration:get-config', ['main'], () => integrationSummary())
  handle('integration:update-config', ['main'], (_role, input) => {
    try {
      const current = readIntegrationConfig()
      const patch = input && typeof input === 'object' ? { ...input } : {}
      if (patch.ai && typeof patch.ai === 'object') {
        const mergedAi = { ...current.ai, ...patch.ai }
        const provider = Director.providerName(mergedAi.provider)
        const baseUrl = Director.normalizeBaseUrl(provider, mergedAi.baseUrl)
        validateLiteralNetworkTarget(baseUrl, { allowLoopback: Director.isLoopbackHost(new URL(baseUrl).hostname) })
        patch.ai = { ...patch.ai, provider, baseUrl }
      }
      const config = mergeIntegrationConfig(current, patch)
      writeIntegrationConfig(config)
      return { success: true, config: integrationSummary() }
    } catch (error) {
      return { success: false, error: String(error.message || '连接配置无效').slice(0, 160) }
    }
  })
  handle('integration:set-ai-key', ['main'], (_role, provider, key) => ({
    success: writeEncryptedString(aiKeyFile(Director.providerName(provider)), key),
  }))
  handle('integration:test-ai', ['main'], () => testAiConnection())
  handle('integration:set-feishu-webhook', ['main'], (_role, webhook) => {
    const value = String(webhook || '').trim()
    if (value && !Director.isAllowedFeishuWebhook(value, TEST_MODE)) return { success: false, error: '飞书 Webhook 格式不正确' }
    if (value) {
      const url = new URL(value)
      validateLiteralNetworkTarget(url, { allowLoopback: TEST_MODE && Director.isLoopbackHost(url.hostname) })
    }
    return { success: writeEncryptedString(feishuWebhookFile(), value, 2048) }
  })
  handle('integration:test-feishu', ['main'], () => sendFeishuMessage('【Naonao: Focus Quest】\n飞书连接测试成功。'))
  handle('game:remaining', ['main'], () => ({
    seconds: Engine.runRemainingSeconds(gameState, new Date()),
    status: gameState.run.status,
  }))
  if (TEST_MODE) {
    handle('game:test-complete-run', ['main'], () => {
      const startedState = gameState.run.status === 'idle'
        ? Engine.startRun(gameState, { durationMinutes: 10 }, new Date()).state
        : gameState
      const run = { ...startedState.run }
      const completed = Engine.settleRun(startedState, new Date(Date.now() + 91 * 60 * 1000))
      return applyResult(completed, { type: 'run-completed', taskId: run.taskId, durationMinutes: run.durationMinutes })
    })
  }

  listen('window:minimize', ['main'], () => mainWindow?.minimize())
  listen('window:toggle-maximize', ['main'], () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  listen('window:close', ['main'], () => mainWindow?.close())
  listen('window:show-main', ['companion'], () => {
    const browserWindow = createMainWindow()
    if (browserWindow.isMinimized()) browserWindow.restore()
    browserWindow.show()
    browserWindow.focus()
  })
  listen('companion:disable', ['companion'], () => {
    applyResult(Engine.updateSettings(gameState, { companion: false }, new Date()), { type: 'companion-disabled' })
  })
}

function startTicking() {
  clearInterval(tickTimer)
  tickTimer = setInterval(() => {
    if (!gameState || gameState.run.status !== 'running') return
    const result = Engine.settleRun(gameState, new Date())
    if (result.completed) {
      const run = { ...gameState.run }
      applyResult(result, { type: 'run-completed', taskId: run.taskId, durationMinutes: run.durationMinutes })
    }
    else broadcastState()
  }, 1000)
}

function startApplication() {
  app.setName('Naonao: Focus Quest')
  if (ISOLATED_TEST_RUN) {
    app.setPath('userData', path.resolve(TEST_USER_DATA))
  } else {
    app.setPath('userData', path.join(app.getPath('appData'), 'Naonao Focus Quest'))
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    const browserWindow = createMainWindow()
    if (browserWindow.isMinimized()) browserWindow.restore()
    browserWindow.show()
    browserWindow.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('help.naonao.focusquest')
    readState()
    registerGameIpc()
    createMainWindow()
    reconcileCompanion()
    startTicking()
  }).catch(error => {
    console.error('Steam game failed to start:', error)
    app.quit()
  })

  app.on('before-quit', () => clearInterval(tickTimer))
  app.on('window-all-closed', () => app.quit())
}

if (require.main === module || process.defaultApp || app.isPackaged) startApplication()

module.exports = {
  COMPANION_PAGE_URL,
  GAME_PAGE_URL,
  applyResult,
  classifyNetworkAddress,
  companionState,
  computeIsolatedTestRun,
  computeTestMode,
  fetchJsonWithTimeout,
  getGameStateForTest: () => gameState,
  isTrustedSender,
  mergeIntegrationConfig,
  readState,
  responseJson,
  runEvent,
  setGameStateForTest: state => { gameState = state },
  startApplication,
  validateNetworkTarget,
  writeState,
}
