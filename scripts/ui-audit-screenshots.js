const fs = require('fs')
const path = require('path')
const { execFileSync, spawn } = require('child_process')

const root = path.resolve(__dirname, '..')
const localeArg = process.argv.find(arg => arg.startsWith('--locale='))?.slice('--locale='.length) || ''
const outputArg = process.argv.find(arg => arg.startsWith('--out='))?.slice('--out='.length) || ''
const settingsOnly = process.argv.includes('--settings-only')
const outDir = outputArg ? path.resolve(root, outputArg) : path.join(root, 'deliverables', 'ui-audit')
const port = 9440 + Math.floor(Math.random() * 300)
const electronPath = require('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

fs.mkdirSync(outDir, { recursive: true })

const child = spawn(electronPath, [`--remote-debugging-port=${port}`, '.'], {
  cwd: root,
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

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json`)
  return response.json()
}

async function waitForTarget(match, timeout = 16000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      const targets = await listTargets()
      const target = targets.find(match)
      if (target?.webSocketDebuggerUrl) return target
    } catch {}
    await delay(300)
  }
  throw new Error('No matching Electron target found')
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let nextId = 1
  const pending = new Map()
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data)
    if (!msg.id || !pending.has(msg.id)) return
    const item = pending.get(msg.id)
    pending.delete(msg.id)
    clearTimeout(item.timer)
    msg.error ? item.reject(new Error(msg.error.message)) : item.resolve(msg.result)
  })
  function send(method, params = {}) {
    const id = nextId++
    ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 8000)
      pending.set(id, { resolve, reject, timer })
    })
  }
  await send('Runtime.enable')
  await send('Page.enable')
  return { ws, send }
}

async function evalIn(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`Runtime exception: ${JSON.stringify(result.exceptionDetails)}`)
  }
  return result.result?.value
}

async function screenshot(client, name) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  })
  const file = path.join(outDir, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
  console.log(file)
}

async function main() {
  if (!child.pid) throw new Error('Electron did not start')
  const mainTarget = await waitForTarget(t => t.type === 'page' && !String(t.url || '').includes('mode='))
  const main = await connect(mainTarget)
  await delay(2500)

  if (settingsOnly) {
    const previousLocale = await evalIn(main, `
      (() => {
        const previous = window.nonoI18n?.getLocale() || 'zh-CN';
        const select = document.getElementById('language-select');
        if (select && ${JSON.stringify(localeArg)}) {
          select.value = ${JSON.stringify(localeArg)};
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return previous;
      })()
    `)
    await delay(500)
    await evalIn(main, `window.petBridge.openSettings(); true`)
    const settingsTarget = await waitForTarget(t => String(t.url || '').includes('mode=settings'))
    const settings = await connect(settingsTarget)
    await delay(1600)
    await evalIn(settings, `
      document.querySelector('[data-settings-tab="appearance"]')?.click();
      true
    `)
    await delay(300)
    await screenshot(settings, `settings-${localeArg || 'current'}`)
    await evalIn(main, `
      (() => {
        const select = document.getElementById('language-select');
        if (select) {
          select.value = ${JSON.stringify(previousLocale)};
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      })()
    `)
    settings.ws.close()
    main.ws.close()
    return
  }

  await evalIn(main, `
    (async () => {
      localStorage.setItem('nono_onboarding_done','true');
      window.petBridge?.privateStoreSet?.('nono_tasks','[]');
      window.petBridge?.privateStoreSet?.('nono_freezer','[]');
      window.petBridge?.privateStoreSet?.('nono_stats', JSON.stringify({version:1,pomodoro:{records:[]},fridge:{frozen:0,retrieved:0,records:[]}}));
      document.body.style.background = 'linear-gradient(145deg,#f1ece2,#d7d1c4)';
      document.documentElement.style.background = '#d7d1c4';
      const pos = { x: Math.round(window.innerWidth * .48), y: Math.round(window.innerHeight * .34) };
      localStorage.setItem('nono_pet_pos', JSON.stringify(pos));
      localStorage.setItem('nono_pet_size', '1');
      document.documentElement.style.setProperty('--pet-left', pos.x + 'px');
      document.documentElement.style.setProperty('--pet-top', pos.y + 'px');
      document.documentElement.style.setProperty('--pet-size-scale', '1');
      window.syncPetAnchors?.();
      const mini = document.getElementById('mini-bubble');
      if (mini) {
        mini.textContent = '下一步，只做一件小事。';
        mini.classList.add('show');
      }
      await new Promise(requestAnimationFrame);
      window.syncPetAnchors?.();
      await new Promise(resolve => setTimeout(resolve, 300));
    })()
  `)
  await screenshot(main, '01-pet-tray-bubble')

  await evalIn(main, `window.petBridge.expand(); true`)
  const chatTarget = await waitForTarget(t => String(t.url || '').includes('mode=chat'))
  const chat = await connect(chatTarget)
  await delay(1800)
  await evalIn(chat, `
    (async () => {
      localStorage.setItem('nono_onboarding_done','true');
      window.petBridge?.privateStoreSet?.('nono_tasks','[]');
      window.petBridge?.privateStoreSet?.('nono_freezer','[]');
      window.petBridge?.privateStoreSet?.('nono_stats', JSON.stringify({version:1,pomodoro:{records:[]},fridge:{frozen:0,retrieved:0,records:[]}}));
      const taskInput = document.getElementById('task-add-input');
      if (taskInput) {
        taskInput.value = '整理安卓版可行性结论';
        taskInput.dispatchEvent(new Event('input', { bubbles: true }));
        taskInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      }
      const msgs = document.getElementById('dlg-msgs');
      if (msgs) {
        msgs.innerHTML = [
          '<div class="dlg-row pet"><div class="dlg-avatar">孬</div><div class="dlg-msg-wrap"><div class="dlg-bubble">先把下一步缩小到 10 分钟内。</div><div class="dlg-time">15:20</div></div></div>',
          '<div class="dlg-row user"><div class="dlg-msg-wrap"><div class="dlg-bubble">我先写迁移方案。</div><div class="dlg-time">15:21</div></div></div>'
        ].join('');
      }
      window.setChatToolPanel?.(null);
      await new Promise(resolve => setTimeout(resolve, 400));
    })()
  `)
  const defaultChatLayout = await evalIn(chat, `
    (() => {
      const task = document.getElementById('task-list');
      const focus = document.getElementById('pomo-widget');
      const messages = document.getElementById('dlg-msgs');
      return {
        width: innerWidth,
        height: innerHeight,
        messagesHeight: messages?.getBoundingClientRect().height || 0,
        taskHidden: task?.hidden,
        taskDisplay: task ? getComputedStyle(task).display : null,
        focusHidden: focus?.hidden,
        focusDisplay: focus ? getComputedStyle(focus).display : null,
      };
    })()
  `)
  if (defaultChatLayout.width !== 560 || defaultChatLayout.height !== 680 ||
      defaultChatLayout.messagesHeight < defaultChatLayout.height * 0.5 || !defaultChatLayout.taskHidden ||
      defaultChatLayout.taskDisplay !== 'none' || !defaultChatLayout.focusHidden ||
      defaultChatLayout.focusDisplay !== 'none') {
    throw new Error(`Invalid default chat layout: ${JSON.stringify(defaultChatLayout)}`)
  }
  await screenshot(chat, '02-chat-default-collapsed')

  const tasksOpenLayout = await evalIn(chat, `
    (async () => {
      document.getElementById('task-toggle')?.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      const task = document.getElementById('task-list');
      const focus = document.getElementById('pomo-widget');
      return {
        taskHidden: task?.hidden,
        taskDisplay: task ? getComputedStyle(task).display : null,
        taskExpanded: document.getElementById('task-toggle')?.getAttribute('aria-expanded'),
        focusHidden: focus?.hidden,
        focusExpanded: document.getElementById('pomo-toggle')?.getAttribute('aria-expanded'),
      };
    })()
  `)
  if (tasksOpenLayout.taskHidden || tasksOpenLayout.taskDisplay !== 'flex' ||
      tasksOpenLayout.taskExpanded !== 'true' || !tasksOpenLayout.focusHidden ||
      tasksOpenLayout.focusExpanded !== 'false') {
    throw new Error(`Invalid expanded task layout: ${JSON.stringify(tasksOpenLayout)}`)
  }
  await screenshot(chat, '03-chat-tasks-open')

  const focusOpenLayout = await evalIn(chat, `
    (async () => {
      document.getElementById('pomo-toggle')?.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      const task = document.getElementById('task-list');
      const focus = document.getElementById('pomo-widget');
      return {
        taskHidden: task?.hidden,
        taskExpanded: document.getElementById('task-toggle')?.getAttribute('aria-expanded'),
        focusHidden: focus?.hidden,
        focusDisplay: focus ? getComputedStyle(focus).display : null,
        focusExpanded: document.getElementById('pomo-toggle')?.getAttribute('aria-expanded'),
      };
    })()
  `)
  if (!focusOpenLayout.taskHidden || focusOpenLayout.taskExpanded !== 'false' ||
      focusOpenLayout.focusHidden || focusOpenLayout.focusDisplay !== 'flex' ||
      focusOpenLayout.focusExpanded !== 'true') {
    throw new Error(`Invalid expanded focus layout: ${JSON.stringify(focusOpenLayout)}`)
  }
  await screenshot(chat, '04-chat-focus-open')

  await evalIn(chat, `
    (async () => {
      document.getElementById('task-toggle')?.click();
      document.getElementById('task-list')?.click();
      await new Promise(resolve => setTimeout(resolve, 500));
    })()
  `)
  await screenshot(chat, '05-stats-drawer')

  await evalIn(chat, `
    (async () => {
      document.getElementById('stats-close')?.click();
      const input = document.getElementById('freezer-input');
      const btn = document.getElementById('freezer-btn');
      btn?.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      if (input) input.value = '研究 Android 前台服务的用户提示';
      document.getElementById('freezer-add')?.click();
      await new Promise(resolve => setTimeout(resolve, 500));
    })()
  `)
  await screenshot(chat, '06-freezer-drawer')

  const freezerToTaskLayout = await evalIn(chat, `
    (async () => {
      document.querySelector('#freezer-list .fz-use')?.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      const task = document.getElementById('task-list');
      const focus = document.getElementById('pomo-widget');
      const input = document.getElementById('task-add-input');
      return {
        taskHidden: task?.hidden,
        taskExpanded: document.getElementById('task-toggle')?.getAttribute('aria-expanded'),
        focusHidden: focus?.hidden,
        inputValue: input?.value || '',
        inputFocused: document.activeElement === input,
        freezerOpen: document.getElementById('freezer-drawer')?.classList.contains('open'),
      };
    })()
  `)
  if (freezerToTaskLayout.taskHidden || freezerToTaskLayout.taskExpanded !== 'true' ||
      !freezerToTaskLayout.focusHidden || !freezerToTaskLayout.inputValue ||
      !freezerToTaskLayout.inputFocused || freezerToTaskLayout.freezerOpen) {
    throw new Error(`Invalid freezer-to-task layout: ${JSON.stringify(freezerToTaskLayout)}`)
  }
  await screenshot(chat, '07-freezer-to-task')

  await evalIn(main, `window.petBridge.openSettings(); true`)
  const settingsTarget = await waitForTarget(t => String(t.url || '').includes('mode=settings'))
  const settings = await connect(settingsTarget)
  await delay(1800)
  await evalIn(settings, `
    (async () => {
      localStorage.setItem('nono_onboarding_done','true');
      document.querySelector('[data-settings-tab="memory"]')?.click();
      await new Promise(resolve => setTimeout(resolve, 300));
    })()
  `)
  await screenshot(settings, '08-settings-memory')
  await evalIn(settings, `
    (async () => {
      document.querySelector('[data-settings-tab="providers"]')?.click();
      await new Promise(resolve => setTimeout(resolve, 300));
    })()
  `)
  await screenshot(settings, '09-settings-providers')

  await evalIn(main, `window.petBridge.openLongTasks(); true`)
  const longTarget = await waitForTarget(t => String(t.url || '').includes('mode=long-tasks'))
  const longTasks = await connect(longTarget)
  await delay(1600)
  await evalIn(longTasks, `
    (async () => {
      document.getElementById('long-task-add-btn')?.click();
      await new Promise(resolve => setTimeout(resolve, 300));
    })()
  `)
  await screenshot(longTasks, '10-long-tasks')

  await evalIn(main, `
    (async () => {
      localStorage.removeItem('nono_onboarding_done');
      location.reload();
    })()
  `)
  await delay(1800)
  await screenshot(main, '11-onboarding')

  main.ws.close()
  chat.ws.close()
  settings.ws.close()
  longTasks.ws.close()
}

main()
  .finally(killTree)
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
