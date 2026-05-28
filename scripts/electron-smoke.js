const assert = require('assert')
const { execFileSync, spawn } = require('child_process')

const port = 9333 + Math.floor(Math.random() * 300)
const electronPath = require('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, [`--remote-debugging-port=${port}`, '.'], {
  cwd: process.cwd(),
  env,
  stdio: 'ignore',
  windowsHide: true,
})

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function killTree() {
  if (child.exitCode !== null) return
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    child.kill('SIGKILL')
  }
}

async function getPageTarget() {
  const started = Date.now()
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`)
      const targets = await response.json()
      const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch {}
    await delay(300)
  }
  throw new Error('No Electron page target found')
}

async function main() {
  assert.ok(child.pid, 'Electron did not start')

  const page = await getPageTarget()
  const errors = []
  const logs = []
  let nextId = 1
  const pending = new Map()
  const ws = new WebSocket(page.webSocketDebuggerUrl)

  function send(method, params = {}) {
    const id = nextId++
    ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 5000)
      pending.set(id, { resolve, reject, timer })
    })
  }

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id)
      pending.delete(msg.id)
      clearTimeout(item.timer)
      msg.error ? item.reject(new Error(msg.error.message)) : item.resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const detail = msg.params.exceptionDetails
      errors.push({
        text: detail.text,
        url: detail.url,
        line: detail.lineNumber + 1,
        column: detail.columnNumber + 1,
        description: detail.exception && detail.exception.description,
      })
    }
    if (msg.method === 'Log.entryAdded') {
      const entry = msg.params.entry
      if (entry.level === 'error') {
        logs.push({ source: entry.source, text: entry.text, url: entry.url, line: entry.lineNumber })
      }
    }
  })

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
  await delay(7000)

  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const localStatus = window.petBridge ? await window.petBridge.localModelStatus() : {};
      const bodyDoubleButton = document.getElementById('body-double-btn');
      const hat = document.getElementById('bd-hat');
      const previousBodyDouble = localStorage.getItem('nono_bd');
      let bodyDoubleShowsHat = false;
      if (bodyDoubleButton && hat) {
        localStorage.setItem('nono_bd', '0');
        window.dispatchEvent(new StorageEvent('storage', { key: 'nono_bd', newValue: '0' }));
        bodyDoubleButton.click();
        bodyDoubleShowsHat = hat.classList.contains('show');
        bodyDoubleButton.click();
        if (previousBodyDouble === null) {
          localStorage.removeItem('nono_bd');
        } else {
          localStorage.setItem('nono_bd', previousBodyDouble);
          window.dispatchEvent(new StorageEvent('storage', { key: 'nono_bd', newValue: previousBodyDouble }));
        }
      }
      return JSON.stringify({
        title: document.title,
        scripts: [...document.scripts].map(script => script.getAttribute('src')),
        hasPetDialog: !!window.petDialog,
        fallbackWorks: typeof smartFallback === 'function' && !!smartFallback('你好'),
        localModelApi: typeof refreshLocalModelStatus === 'function' && typeof loadLocalModel === 'function' && typeof localInference === 'function',
        localStatusLeaksPath: 'modelDir' in localStatus || 'modelsRoot' in localStatus,
        bodyDoubleShowsHat,
        taskRows: !!document.getElementById('task-rows')
      })
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  assert.ok(!result.exceptionDetails, `smoke evaluation failed: ${JSON.stringify(result.exceptionDetails, null, 2)}`)
  const smoke = JSON.parse(result.result.value)

  ws.close()

  assert.deepStrictEqual(errors, [], `runtime exceptions: ${JSON.stringify(errors, null, 2)}`)
  assert.deepStrictEqual(logs, [], `browser error logs: ${JSON.stringify(logs, null, 2)}`)
  assert.deepStrictEqual(smoke.scripts.slice(-4), [
    'js/pet-dialog.js',
    'js/fallback-data.js',
    'js/local-model.js',
    'app.js',
  ])
  assert.strictEqual(smoke.hasPetDialog, true)
  assert.strictEqual(smoke.fallbackWorks, true)
  assert.strictEqual(smoke.localModelApi, true)
  assert.strictEqual(smoke.localStatusLeaksPath, false)
  assert.strictEqual(smoke.bodyDoubleShowsHat, true)
  assert.strictEqual(smoke.taskRows, true)

  console.log('electron smoke passed')
}

main().finally(killTree).catch(error => {
  console.error(error)
  process.exitCode = 1
})
