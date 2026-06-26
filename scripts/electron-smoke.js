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
      const pw = document.getElementById('pw');
      const petImg = document.getElementById('pet-img');
      const tray = document.getElementById('pet-tray');
      const miniBubble = document.getElementById('mini-bubble');
      let petBodyPinned = false;
      let petTrayNearBody = false;
      let miniBubbleNearBody = false;
      let petDraggingFreezes = false;
      let petPressKeepsLayout = false;
      let petClickJumps = false;
      let petHeartNearBody = false;
      let petBubbleAvoidsTray = false;
      let petPressLayoutDelta = {};
      if (pw && petImg) {
        pw.style.left = '0px';
        pw.style.top = '0px';
        window.syncPetAnchors?.();
        const sway = document.querySelector('.pet-sway-wrap');
        if (sway) sway.style.transform = 'translate(9px, 11px)';
        petImg.style.transform = 'translate(4px, 6px)';
        window.syncPetAnchors?.();
        const rect = window.__nonoPetVisibleRect ? window.__nonoPetVisibleRect() : petImg.getBoundingClientRect();
        const transformsBefore = {
          swayInline: sway ? sway.style.transform : '',
          imgInline: petImg.style.transform,
          swayComputed: sway ? getComputedStyle(sway).transform : '',
          imgComputed: getComputedStyle(petImg).transform,
        };
        const trayBefore = tray ? tray.getBoundingClientRect() : null;
        const bubbleBefore = miniBubble ? miniBubble.getBoundingClientRect() : null;
        const wrapBefore = document.querySelector('.pet-img-wrap')?.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        petImg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy, screenX: 300, screenY: 300 }));
        await new Promise(requestAnimationFrame);
        const rectPressed = window.__nonoPetVisibleRect ? window.__nonoPetVisibleRect() : petImg.getBoundingClientRect();
        const transformsPressed = {
          swayInline: sway ? sway.style.transform : '',
          imgInline: petImg.style.transform,
          swayComputed: sway ? getComputedStyle(sway).transform : '',
          imgComputed: getComputedStyle(petImg).transform,
        };
        const trayPressed = tray ? tray.getBoundingClientRect() : null;
        const bubblePressed = miniBubble ? miniBubble.getBoundingClientRect() : null;
        const close = (a, b) => Math.abs(a - b) <= 1;
        petPressLayoutDelta = {
          petLeft: rectPressed.left - rect.left,
          petTop: rectPressed.top - rect.top,
          trayLeft: trayBefore && trayPressed ? trayPressed.left - trayBefore.left : 0,
          trayTop: trayBefore && trayPressed ? trayPressed.top - trayBefore.top : 0,
          bubbleLeft: bubbleBefore && bubblePressed ? bubblePressed.left - bubbleBefore.left : 0,
          bubbleTop: bubbleBefore && bubblePressed ? bubblePressed.top - bubbleBefore.top : 0,
          petLeftVar: getComputedStyle(document.documentElement).getPropertyValue('--pet-left'),
          petTopVar: getComputedStyle(document.documentElement).getPropertyValue('--pet-top'),
          wrapBefore: wrapBefore ? { left: wrapBefore.left, top: wrapBefore.top, width: wrapBefore.width, height: wrapBefore.height } : null,
          wrapPressed: document.querySelector('.pet-img-wrap') ? {
            left: document.querySelector('.pet-img-wrap').getBoundingClientRect().left,
            top: document.querySelector('.pet-img-wrap').getBoundingClientRect().top,
            width: document.querySelector('.pet-img-wrap').getBoundingClientRect().width,
            height: document.querySelector('.pet-img-wrap').getBoundingClientRect().height
          } : null,
          transformsBefore,
          transformsPressed,
        };
        petDraggingFreezes = pw.classList.contains('dragging');
        petPressKeepsLayout = close(rect.left, rectPressed.left) &&
          close(rect.top, rectPressed.top) &&
          (!trayBefore || !trayPressed || (close(trayBefore.left, trayPressed.left) && close(trayBefore.top, trayPressed.top))) &&
          (!bubbleBefore || !bubblePressed || (close(bubbleBefore.left, bubblePressed.left) && close(bubbleBefore.top, bubblePressed.top)));
        window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + 30, clientY: cy + 20, screenX: 330, screenY: 320 }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx + 30, clientY: cy + 20, screenX: 330, screenY: 320 }));
        if (sway) sway.style.transform = '';
        petImg.style.transform = '';
        petBodyPinned = pw.style.left === '0px' && pw.style.top === '0px';
        window.syncPetAnchors?.();
        const bodyRect = window.__nonoPetVisibleRect ? window.__nonoPetVisibleRect() : rect;
        const clickX = bodyRect.left + bodyRect.width / 2;
        const clickY = bodyRect.top + bodyRect.height / 2;
        petImg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: clickX, clientY: clickY, screenX: 360, screenY: 360 }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: clickX, clientY: clickY, screenX: 360, screenY: 360 }));
        await new Promise(requestAnimationFrame);
        petClickJumps = pw.classList.contains('jumping');
        const heart = document.querySelector('.heart');
        if (heart) {
          const heartRect = heart.getBoundingClientRect();
          petHeartNearBody = heartRect.left >= bodyRect.left - 30 &&
            heartRect.left <= bodyRect.right + 30 &&
            heartRect.top >= bodyRect.top - 80 &&
            heartRect.top <= bodyRect.bottom;
        }
        window.syncPetAnchors?.();
        if (tray) {
          const trayRect = tray.getBoundingClientRect();
          const trayCenterY = trayRect.top + trayRect.height / 2;
          const targetY = bodyRect.top + bodyRect.height * .56;
          petTrayNearBody = trayRect.left >= bodyRect.right + 4 &&
            trayRect.left <= bodyRect.right + 28 &&
            Math.abs(trayCenterY - targetY) <= 18;
          if (miniBubble && miniBubble.classList.contains('show')) {
            const bubbleRect = miniBubble.getBoundingClientRect();
            petBubbleAvoidsTray = trayRect.right < bubbleRect.left ||
              bubbleRect.right < trayRect.left ||
              trayRect.bottom < bubbleRect.top ||
              bubbleRect.bottom < trayRect.top;
          } else {
            petBubbleAvoidsTray = true;
          }
        }
        if (miniBubble) {
          const bubbleRect = miniBubble.getBoundingClientRect();
          const bubbleOnRight = bubbleRect.left >= bodyRect.right + 20 &&
            bubbleRect.left <= bodyRect.right + 90;
          const bubbleOnLeft = bubbleRect.right <= bodyRect.left - 8 &&
            bubbleRect.right >= bodyRect.left - 90;
          miniBubbleNearBody = (bubbleOnRight || bubbleOnLeft) &&
            bubbleRect.top >= bodyRect.top - 8 &&
            bubbleRect.top <= bodyRect.top + 32;
        }
      }
      return JSON.stringify({
        title: document.title,
        scripts: [...document.scripts].map(script => script.getAttribute('src')),
        hasPetDialog: !!window.petDialog,
        fallbackWorks: typeof smartFallback === 'function' && !!smartFallback('你好'),
        localModelApi: typeof refreshLocalModelStatus === 'function' && typeof loadLocalModel === 'function' && typeof localInference === 'function',
        petSizeApi: !!window.petBridge && typeof window.petBridge.setPetSize === 'function' && typeof window.petBridge.setPetShape === 'function' && typeof window.petBridge.startPetDrag === 'function' && typeof window.petBridge.movePetDrag === 'function' && typeof window.petBridge.endPetDrag === 'function',
        feishuApi: !!window.petBridge && typeof window.petBridge.getFeishuWebhook === 'function' && typeof window.petBridge.setFeishuWebhook === 'function' && typeof window.petBridge.sendFeishu === 'function',
        feishuAppApi: !!window.petBridge && typeof window.petBridge.startFeishuApp === 'function' && typeof window.petBridge.sendFeishuApp === 'function' && typeof window.petBridge.onFeishuMessage === 'function',
        longTaskFeishuApi: !!window.petBridge && typeof window.petBridge.getLongTaskWebhook === 'function' && typeof window.petBridge.setLongTaskWebhook === 'function' && typeof window.petBridge.sendLongTaskFeishu === 'function',
        hermesAgentApi: !!window.petBridge && typeof window.petBridge.getHermesApiKey === 'function' && typeof window.petBridge.setHermesApiKey === 'function' && typeof window.petBridge.testHermesAgent === 'function' && typeof window.petBridge.chatHermesAgent === 'function',
        configSyncApi: !!window.petBridge && typeof window.petBridge.notifyConfigChanged === 'function' && typeof window.petBridge.onConfigChanged === 'function',
        feishuSettings: !!document.getElementById('feishu-enabled') && !!document.getElementById('feishu-webhook') && !!document.getElementById('feishu-interval') && !!document.getElementById('feishu-app-id') && !!document.getElementById('feishu-app-secret'),
        longTaskSettings: !!document.getElementById('long-task-add-btn') && !!document.getElementById('long-task-list') && !!document.getElementById('long-task-status'),
        feishuIntervalMin: document.getElementById('feishu-interval')?.getAttribute('min'),
        petSizeControls: !!document.getElementById('pet-size-handle') && !document.getElementById('tray-size-down') && !document.getElementById('tray-size-up'),
        hermesSettings: !!document.getElementById('hermes-agent-enabled') && !!document.getElementById('hermes-agent-base') && !!document.getElementById('hermes-agent-key') && !!document.getElementById('hermes-agent-test-btn') && !!document.getElementById('hermes-enabled') && !!document.getElementById('hermes-review-btn') && !!document.getElementById('hermes-clear-btn'),
        localStatusLeaksPath: 'modelDir' in localStatus || 'modelsRoot' in localStatus,
        bodyDoubleShowsHat,
        petBodyPinned,
        petDraggingFreezes,
        petPressKeepsLayout,
        petClickJumps,
        petHeartNearBody,
        petBubbleAvoidsTray,
        petPressLayoutDelta,
        petTrayNearBody,
        miniBubbleNearBody,
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
  assert.strictEqual(smoke.petSizeApi, true)
  assert.strictEqual(smoke.feishuApi, true)
  assert.strictEqual(smoke.feishuAppApi, true)
  assert.strictEqual(smoke.longTaskFeishuApi, true)
  assert.strictEqual(smoke.hermesAgentApi, true)
  assert.strictEqual(smoke.configSyncApi, true)
  assert.strictEqual(smoke.feishuSettings, true)
  assert.strictEqual(smoke.longTaskSettings, true)
  assert.strictEqual(smoke.feishuIntervalMin, '1')
  assert.strictEqual(smoke.petSizeControls, true)
  assert.strictEqual(smoke.hermesSettings, true)
  assert.strictEqual(smoke.localStatusLeaksPath, false)
  assert.strictEqual(smoke.bodyDoubleShowsHat, true)
  assert.strictEqual(smoke.petBodyPinned, true)
  assert.strictEqual(smoke.petDraggingFreezes, true)
  assert.strictEqual(smoke.petPressKeepsLayout, true, `pet press moved layout: ${JSON.stringify(smoke.petPressLayoutDelta)}`)
  assert.strictEqual(smoke.petClickJumps, true)
  assert.strictEqual(smoke.petHeartNearBody, true)
  assert.strictEqual(smoke.petBubbleAvoidsTray, true)
  assert.strictEqual(smoke.petTrayNearBody, true)
  assert.strictEqual(smoke.miniBubbleNearBody, true)
  assert.strictEqual(smoke.taskRows, true)

  console.log('electron smoke passed')
}

main().finally(killTree).catch(error => {
  console.error(error)
  process.exitCode = 1
})
