const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('naonaoGame', Object.freeze({
  getState: () => ipcRenderer.invoke('game:get-state'),
  startRun: options => ipcRenderer.invoke('game:start-run', options),
  pauseRun: () => ipcRenderer.invoke('game:pause-run'),
  resumeRun: () => ipcRenderer.invoke('game:resume-run'),
  onState: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('game:state', listener)
    return () => ipcRenderer.removeListener('game:state', listener)
  },
  showMain: () => ipcRenderer.send('window:show-main'),
  disableCompanion: () => ipcRenderer.send('companion:disable'),
}))
