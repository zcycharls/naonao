const { contextBridge, ipcRenderer } = require('electron')

function safeCallback(callback) {
  return typeof callback === 'function' ? callback : () => {}
}

contextBridge.exposeInMainWorld('petBridge', {
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', { dx: Number(dx), dy: Number(dy) }),
  expand:     ()       => ipcRenderer.send('expand'),
  collapse:   ()       => ipcRenderer.send('collapse'),
  closeApp:   ()       => ipcRenderer.send('close-app'),
  hideApp:    ()       => ipcRenderer.send('hide-app'),
  setIgnoreMouse: (v)  => ipcRenderer.send('set-ignore-mouse', !!v),
  openSettings:   ()   => ipcRenderer.send('open-settings'),
  closeSelf:      ()   => ipcRenderer.send('close-self'),
  minimizeSelf:   ()   => ipcRenderer.send('minimize-self'),
  notifyConfigChanged: () => ipcRenderer.send('config:changed'),
  // Encrypted API key storage (DPAPI / Keychain via Electron safeStorage)
  getSecret: () => ipcRenderer.invoke('secret:get'),
  setSecret: (v) => ipcRenderer.invoke('secret:set', String(v || '')),
  getFeishuWebhook: () => ipcRenderer.invoke('feishu:webhook:get'),
  setFeishuWebhook: (v) => ipcRenderer.invoke('feishu:webhook:set', String(v || '')),
  sendFeishu: (text) => ipcRenderer.invoke('feishu:send', String(text || '').slice(0, 1800)),
  getFeishuAppSecret: () => ipcRenderer.invoke('feishu:app-secret:get'),
  setFeishuAppSecret: (v) => ipcRenderer.invoke('feishu:app-secret:set', String(v || '')),
  startFeishuApp: (config) => ipcRenderer.invoke('feishu:app-start', config && typeof config === 'object' ? config : {}),
  stopFeishuApp: () => ipcRenderer.invoke('feishu:app-stop'),
  feishuAppStatus: () => ipcRenderer.invoke('feishu:app-status'),
  sendFeishuApp: (chatId, text) => ipcRenderer.invoke('feishu:app-send', String(chatId || ''), String(text || '').slice(0, 1800)),
  // Local AI model (on-demand download)
  localModelStatus: () => ipcRenderer.invoke('local-model:status'),
  localModelDownload: () => ipcRenderer.invoke('local-model:download'),
  localModelCancel:  () => ipcRenderer.invoke('local-model:cancel'),
  localModelDelete:  () => ipcRenderer.invoke('local-model:delete'),
  localModelLoad:   () => ipcRenderer.invoke('local-model:load'),
  localModelInference: (text) => ipcRenderer.invoke('local-model:inference', String(text || '').slice(0, 2000)),
  // 主进程日志转发到前端
  onMainLog: (callback) => {
    const cb = safeCallback(callback)
    ipcRenderer.on('main-log', (_evt, msg) => cb(String(msg || '').slice(0, 2000)))
  },
  // 下载进度监听
  onLocalModelProgress: (callback) => {
    const cb = safeCallback(callback)
    ipcRenderer.on('local-model:progress', (_evt, data) => cb(data && typeof data === 'object' ? data : {}))
  },
  onFeishuMessage: (callback) => {
    const cb = safeCallback(callback)
    ipcRenderer.on('feishu:message', (_evt, data) => cb(data && typeof data === 'object' ? data : {}))
  },
  onFeishuStatus: (callback) => {
    const cb = safeCallback(callback)
    ipcRenderer.on('feishu:status', (_evt, data) => cb(data && typeof data === 'object' ? data : {}))
  },
  onConfigChanged: (callback) => {
    const cb = safeCallback(callback)
    ipcRenderer.on('config:changed', () => cb())
  },
})
