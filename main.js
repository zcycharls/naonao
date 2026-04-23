const { app, BrowserWindow, shell, ipcMain, screen } = require('electron')
const path = require('path')

// Disable DPI scaling so window size = actual pixels
app.commandLine.appendSwitch('high-dpi-support', '1')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

let win

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  // Image is 240x286 — use exactly this as window size
  const W = 240, H = 286

  win = new BrowserWindow({
    width: W,
    height: H,
    x: Math.floor(sw * 0.6),
    y: Math.floor(sh * 0.5),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  win.loadFile(path.join(__dirname, 'app', 'index.html'))
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  ipcMain.on('move-window', (_, { dx, dy }) => {
    const [x, y] = win.getPosition()
    const [w, h] = win.getSize()
    const nx = Math.max(0, Math.min(sw - w, x + Math.round(dx)))
    const ny = Math.max(0, Math.min(sh - h, y + Math.round(dy)))
    win.setPosition(nx, ny)
  })

  ipcMain.on('expand', () => {
    const [x, y] = win.getPosition()
    const nx = Math.min(x, sw - 420)
    const ny = Math.min(y, sh - 780)
    win.setBounds({ x: nx, y: ny, width: 420, height: 780 })
  })

  ipcMain.on('collapse', () => {
    win.setSize(W, H)
  })

  ipcMain.on('set-ignore-mouse', (_, ignore) => {
    win.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.on('close-app', () => app.quit())
  ipcMain.on('hide-app', () => win.minimize())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
