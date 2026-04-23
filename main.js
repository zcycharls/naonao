const { app, BrowserWindow, shell, ipcMain, screen } = require('electron')
const path = require('path')

let win

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  win = new BrowserWindow({
    width: 200,
    height: 280,
    x: Math.floor(width * 0.75),
    y: Math.floor(height * 0.55),
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
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
    const [x, y] = win.getPosition()
    const [w, h] = win.getSize()
    const nx = Math.max(0, Math.min(sw - w, x + Math.round(dx)))
    const ny = Math.max(0, Math.min(sh - h, y + Math.round(dy)))
    win.setPosition(nx, ny)
  })

  ipcMain.on('set-ignore-mouse', (_, ignore) => {
    win.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.on('expand', () => {
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
    const [wx, wy] = win.getPosition()
    // reposition so it doesn't go off screen
    const newX = Math.min(wx, sw - 420)
    const newY = Math.min(wy, sh - 780)
    win.setBounds({ x: newX, y: newY, width: 420, height: 780 })
  })

  ipcMain.on('collapse', () => {
    win.setSize(200, 280)
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
