const { contextBridge, ipcRenderer } = require('electron')

const api = {
  environment: () => ipcRenderer.invoke('game:environment'),
  getState: () => ipcRenderer.invoke('game:get-state'),
  addTask: text => ipcRenderer.invoke('game:add-task', text),
  completeTask: taskId => ipcRenderer.invoke('game:complete-task', taskId),
  removeTask: taskId => ipcRenderer.invoke('game:remove-task', taskId),
  startRun: options => ipcRenderer.invoke('game:start-run', options),
  pauseRun: () => ipcRenderer.invoke('game:pause-run'),
  resumeRun: () => ipcRenderer.invoke('game:resume-run'),
  cancelRun: () => ipcRenderer.invoke('game:cancel-run'),
  claimQuest: questId => ipcRenderer.invoke('game:claim-quest', questId),
  updateSettings: settings => ipcRenderer.invoke('game:update-settings', settings),
  completeQuestStep: (taskId, stepId) => ipcRenderer.invoke('game:complete-quest-step', taskId, stepId),
  generateQuest: (taskId, consent) => ipcRenderer.invoke('director:generate', taskId, consent === true),
  generateOfflineQuest: taskId => ipcRenderer.invoke('director:offline', taskId),
  getIntegrationConfig: () => ipcRenderer.invoke('integration:get-config'),
  updateIntegrationConfig: config => ipcRenderer.invoke('integration:update-config', config),
  setAiKey: (provider, key) => ipcRenderer.invoke('integration:set-ai-key', provider, key),
  testAi: () => ipcRenderer.invoke('integration:test-ai'),
  setFeishuWebhook: webhook => ipcRenderer.invoke('integration:set-feishu-webhook', webhook),
  testFeishu: () => ipcRenderer.invoke('integration:test-feishu'),
  remaining: () => ipcRenderer.invoke('game:remaining'),
  onState: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('game:state', listener)
    return () => ipcRenderer.removeListener('game:state', listener)
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
}

if (process.argv.includes('--naonao-internal-test-bridge')) {
  api.testCompleteRun = () => ipcRenderer.invoke('game:test-complete-run')
}

contextBridge.exposeInMainWorld('naonaoGame', Object.freeze(api))
