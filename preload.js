const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petBridge', {
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', { dx, dy }),
  expand:     ()       => ipcRenderer.send('expand'),
  collapse:   ()       => ipcRenderer.send('collapse'),
  closeApp:   ()       => ipcRenderer.send('close-app'),
  hideApp:    ()       => ipcRenderer.send('hide-app'),
  setIgnoreMouse: (v)  => ipcRenderer.send('set-ignore-mouse', v),
  openSettings:   ()   => ipcRenderer.send('open-settings'),
  closeSelf:      ()   => ipcRenderer.send('close-self'),
  minimizeSelf:   ()   => ipcRenderer.send('minimize-self'),
  // Encrypted API key storage (DPAPI / Keychain via Electron safeStorage)
  getSecret: () => ipcRenderer.invoke('secret:get'),
  setSecret: (v) => ipcRenderer.invoke('secret:set', v),
  // Local AI model (on-demand download)
  localModelStatus: () => ipcRenderer.invoke('local-model:status'),
  localModelDownload: () => ipcRenderer.invoke('local-model:download'),
  localModelDelete:  () => ipcRenderer.invoke('local-model:delete'),
  localModelLoad:   () => ipcRenderer.invoke('local-model:load'),
  localModelInference: (text) => ipcRenderer.invoke('local-model:inference', text),
  // 主进程日志转发到前端
  onMainLog: (callback) => ipcRenderer.on('main-log', (_evt, msg) => callback(msg)),
  // 下载进度监听
  onLocalModelProgress: (callback) => ipcRenderer.on('local-model:progress', (_evt, data) => callback(data)),
})
