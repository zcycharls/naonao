const { spawn } = require('child_process')
const electronPath = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const showConsole = env.NAONAO_SHOW_CONSOLE === '1'
const child = spawn(electronPath, ['.'], {
  cwd: process.cwd(),
  env,
  stdio: showConsole ? 'inherit' : 'ignore',
  windowsHide: !showConsole,
  detached: !showConsole,
})

child.on('error', error => {
  console.error(error)
  process.exit(1)
})

if (!showConsole) {
  child.unref()
  setTimeout(() => process.exit(0), 100)
  return
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code || 0)
})
