const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { execFileSync, spawn } = require('child_process')

const root = path.resolve(__dirname, '..')
const port = 9633 + Math.floor(Math.random() * 250)
const mockPort = 10333 + Math.floor(Math.random() * 500)
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'naonao-steam-smoke-'))
const mockRequests = []
const mockQuest = {
  title: '商店信号校准',
  briefing: '把发布资料整理成三个可验证关卡。',
  steps: ['核对商店描述', '整理真实截图', '完成提交检查'],
  coachLine: '一次只处理一个面板。',
  rewardName: '黄铜发行章',
}
const mockServer = http.createServer((request, response) => {
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    mockRequests.push({ method: request.method, url: request.url, authorization: request.headers.authorization || '', body })
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET' && (request.url === '/health' || request.url === '/v1/models')) {
      response.end(JSON.stringify({ status: 'ok', data: [{ id: 'naonao-test-model' }] }))
      return
    }
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(mockQuest) } }] }))
      return
    }
    if (request.method === 'POST' && request.url === '/open-apis/bot/v2/hook/naonao_test') {
      response.end(JSON.stringify({ code: 0, msg: 'ok' }))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: { message: 'not found' } }))
  })
})
const mockReady = new Promise((resolve, reject) => {
  mockServer.once('error', reject)
  mockServer.listen(mockPort, '127.0.0.1', resolve)
})
const packaged = process.argv.includes('--packaged')
const runtimePath = packaged
  ? path.join(root, 'dist', 'steam', 'win-unpacked', 'NaonaoFocusQuest.exe')
  : require('electron')
const env = { ...process.env, NAONAO_STEAM_TEST_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE

assert.ok(fs.existsSync(runtimePath), `Runtime is missing: ${runtimePath}`)
const runtimeArguments = packaged
  ? [`--remote-debugging-port=${port}`, '--naonao-steam-test']
  : [`--remote-debugging-port=${port}`, '.', '--naonao-steam-test']
const childOutput = []
const child = spawn(runtimePath, runtimeArguments, {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
child.stdout.on('data', chunk => childOutput.push(chunk.toString()))
child.stderr.on('data', chunk => childOutput.push(chunk.toString()))

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function killTree() {
  if (child.exitCode !== null) return
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  } catch {
    child.kill('SIGKILL')
  }
}

async function waitForChildExit(timeout = 5000) {
  if (child.exitCode !== null) return
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    delay(timeout),
  ])
}

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json`)
  return response.json()
}

async function getGameTarget() {
  const started = Date.now()
  while (Date.now() - started < 30000) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited before opening the game page (code ${child.exitCode}).\n${childOutput.join('')}`)
    }
    try {
      const page = (await targets()).find(target => target.type === 'page' && target.url.endsWith('/steam-game.html'))
      if (page?.webSocketDebuggerUrl) return page
    } catch {}
    await delay(250)
  }
  throw new Error(`No Steam game page target found.\n${childOutput.join('')}`)
}

async function inspectCompanion(target, outputFile) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  const errors = []
  let nextId = 1

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(request.timer)
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result)
      return
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry)
  })
  function send(method, params = {}) {
    const id = nextId++
    socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Companion CDP timeout: ${method}`)), 5000)
      pending.set(id, { resolve, reject, timer })
    })
  }

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
  const result = await send('Runtime.evaluate', {
    expression: `new Promise(resolve => {
      const finish = () => resolve({
        ready: document.body.dataset.ready,
        width: window.innerWidth,
        height: window.innerHeight,
        timer: document.getElementById('timer')?.textContent,
        label: document.getElementById('run-label')?.textContent,
      })
      document.body.dataset.ready === 'true' ? finish() : setTimeout(finish, 500)
    })`,
    returnByValue: true,
    awaitPromise: true,
  })
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails, null, 2))
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(outputFile, Buffer.from(screenshot.data, 'base64'))
  await send('Runtime.evaluate', {
    expression: 'setTimeout(() => window.close(), 100); true',
    returnByValue: true,
  })
  socket.close()
  assert.deepStrictEqual(errors, [], `Companion errors: ${JSON.stringify(errors, null, 2)}`)
  return result.result.value
}

async function main() {
  await mockReady
  assert.ok(child.pid, 'Electron did not start')
  const page = await getGameTarget()
  const runtimeErrors = []
  const logErrors = []
  const pending = new Map()
  let nextId = 1
  const socket = new WebSocket(page.webSocketDebuggerUrl)

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(request.timer)
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result)
      return
    }
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails)
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') logErrors.push(message.params.entry)
  })

  function send(method, params = {}) {
    const id = nextId++
    socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 15000)
      pending.set(id, { resolve, reject, timer })
    })
  }

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails, null, 2))
    return result.result.value
  }

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
  const initial = await evaluate(`(async () => {
    const waitFor = async test => {
      for (let i = 0; i < 80; i++) {
        if (test()) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('UI readiness timeout')
    }
    await waitFor(() => window.__naonaoSteamGame?.snapshot().ready === 'true')
    return {
      environment: window.__naonaoSteamGame.environment,
      snapshot: window.__naonaoSteamGame.snapshot(),
      integrations: window.__naonaoSteamGame.integrations(),
    }
  })()`)
  assert.deepStrictEqual(initial.environment, {
    edition: 'steam-game',
    localCoreOffline: true,
    optionalOnline: true,
    testMode: !packaged,
    savePath: packaged ? null : path.join(userData, 'focus-quest-save.json'),
  })
  assert.deepStrictEqual(initial.snapshot, {
    ready: 'true',
    timer: '25:00',
    tasks: 0,
    quests: 3,
    journeyNodes: 6,
    unlocks: 5,
    achievements: 6,
    directorDrawer: true,
    integrationStatus: 'AI OFF',
  })
  assert.strictEqual(initial.integrations.ai.enabled, false)
  assert.strictEqual(initial.integrations.ai.shareMemory, false)
  assert.strictEqual(initial.integrations.feishu.enabled, false)

  const offlineFlow = await evaluate(`(async () => {
    const waitFor = async test => {
      for (let i = 0; i < 80; i++) {
        if (test()) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('Offline director timeout')
    }
    const input = document.getElementById('task-input')
    input.value = '离线整理任务'
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitFor(() => window.__naonaoSteamGame.state().tasks.length === 1)
    document.querySelector('[data-action="director"]').click()
    document.getElementById('director-offline').click()
    await waitFor(() => window.__naonaoSteamGame.state().tasks[0].quest?.source === 'offline')
    document.getElementById('director-close').click()
    document.querySelector('[data-action="remove"]').click()
    await waitFor(() => window.__naonaoSteamGame.state().tasks.length === 0)
    return true
  })()`)
  assert.strictEqual(offlineFlow, true)
  assert.strictEqual(mockRequests.length, 0, 'Offline director unexpectedly used the network')

  const flow = await evaluate(`(async () => {
    const waitFor = async test => {
      for (let i = 0; i < 80; i++) {
        if (test()) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('Game flow timeout')
    }
    document.getElementById('integration-open').click()
    document.getElementById('ai-enabled').checked = true
    document.getElementById('ai-provider').value = 'hermes'
    document.getElementById('ai-base-url').value = 'http://127.0.0.1:${mockPort}/v1'
    document.getElementById('ai-model').value = 'hermes-agent'
    document.getElementById('ai-key').value = 'test-hermes-key'
    document.getElementById('ai-network-consent').checked = true
    document.getElementById('ai-share-memory').checked = true
    document.getElementById('ai-config-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitFor(() => window.__naonaoSteamGame.integrations().ai.enabled && window.__naonaoSteamGame.integrations().ai.hasKey)
    document.getElementById('ai-test').click()
    await waitFor(() => document.getElementById('ai-status').textContent === '模型连接成功')

    if (${!packaged}) {
      document.getElementById('feishu-enabled').checked = true
      document.getElementById('feishu-webhook').value = 'http://127.0.0.1:${mockPort}/open-apis/bot/v2/hook/naonao_test'
      document.getElementById('feishu-notify-focus').checked = true
      document.getElementById('feishu-notify-task').checked = true
      document.getElementById('feishu-config-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitFor(() => window.__naonaoSteamGame.integrations().feishu.enabled && window.__naonaoSteamGame.integrations().feishu.hasWebhook)
      document.getElementById('feishu-test').click()
      await waitFor(() => document.getElementById('feishu-status').textContent === '飞书测试消息已发送')
    }

    const input = document.getElementById('task-input')
    input.value = '完成 Steam 商店资料'
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitFor(() => window.__naonaoSteamGame.state().tasks.length === 1)
    document.querySelector('[data-action="director"]').click()
    const denied = await window.naonaoGame.generateQuest(window.__naonaoSteamGame.state().tasks[0].id, false)
    if (!denied.error?.includes('确认')) throw new Error('Director consent gate did not reject the request')
    if (window.__naonaoSteamGame.state().tasks[0].quest) throw new Error('Quest was generated without consent')
    document.getElementById('director-consent').checked = true
    document.getElementById('director-generate').click()
    await waitFor(() => window.__naonaoSteamGame.state().tasks[0].quest?.source === 'hermes')
    const firstStep = document.querySelector('[data-action="quest-step"]')
    firstStep.click()
    await waitFor(() => window.__naonaoSteamGame.state().tasks[0].quest.steps[0].done)
    document.getElementById('director-close').click()
    document.querySelector('[data-duration="10"]').click()
    await waitFor(() => window.__naonaoSteamGame.state().settings.focusMinutes === 10)
    document.getElementById('run-primary').click()
    await waitFor(() => window.__naonaoSteamGame.state().run.status === 'running')
    document.getElementById('run-primary').click()
    await waitFor(() => window.__naonaoSteamGame.state().run.status === 'paused')
    document.getElementById('run-primary').click()
    await waitFor(() => window.__naonaoSteamGame.state().run.status === 'running')
    if (${packaged}) {
      document.getElementById('run-cancel').click()
      await waitFor(() => window.__naonaoSteamGame.state().run.status === 'idle')
    } else {
      await window.__naonaoSteamGame.completeRun()
      await waitFor(() => window.__naonaoSteamGame.state().profile.totalSessions === 1)
    }
    while (!window.__naonaoSteamGame.state().tasks[0].done) {
      const completedBefore = window.__naonaoSteamGame.state().tasks[0].quest.steps.filter(step => step.done).length
      document.querySelector('[data-action="quest-step"]:not(:disabled)').click()
      await waitFor(() => window.__naonaoSteamGame.state().tasks[0].quest.steps.filter(step => step.done).length > completedBefore)
    }
    await waitFor(() => window.__naonaoSteamGame.state().profile.totalTasks === 1)
    document.getElementById('integration-open').click()
    document.getElementById('ai-provider').value = 'openai'
    document.getElementById('ai-base-url').value = 'http://127.0.0.1:${mockPort}/v1'
    document.getElementById('ai-model').value = 'naonao-test-model'
    document.getElementById('ai-key').value = 'test-api-key'
    document.getElementById('ai-network-consent').checked = true
    document.getElementById('ai-config-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitFor(() => window.__naonaoSteamGame.integrations().ai.provider === 'openai' && window.__naonaoSteamGame.integrations().ai.hasKey)
    document.getElementById('ai-test').click()
    await waitFor(() => document.getElementById('ai-status').textContent === '模型连接成功')
    document.getElementById('director-close').click()
    input.value = '规划下一次版本发布'
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitFor(() => window.__naonaoSteamGame.state().tasks.length === 2)
    document.querySelector('[data-action="director"]').click()
    document.getElementById('director-consent').checked = true
    document.getElementById('director-generate').click()
    await waitFor(() => window.__naonaoSteamGame.state().tasks[0].quest?.source === 'openai')
    document.getElementById('director-close').click()
    document.getElementById('companion-toggle').click()
    await waitFor(() => window.__naonaoSteamGame.state().settings.companion === true)
    return {
      state: window.__naonaoSteamGame.state(),
      snapshot: window.__naonaoSteamGame.snapshot(),
      integrations: window.__naonaoSteamGame.integrations(),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
      testCompleteRun: typeof window.naonaoGame.testCompleteRun,
    }
  })()`)
  assert.strictEqual(flow.state.profile.totalSessions, packaged ? 0 : 1)
  assert.strictEqual(flow.state.profile.totalFocusMinutes, packaged ? 0 : 10)
  assert.strictEqual(flow.state.profile.totalTasks, 1)
  assert.strictEqual(flow.state.run.status, 'idle')
  assert.strictEqual(flow.snapshot.tasks, 2)
  assert.strictEqual(flow.state.tasks.find(task => task.done).quest.steps.every(step => step.done), true)
  assert.strictEqual(flow.state.tasks.find(task => !task.done).quest.source, 'openai')
  assert.strictEqual(Object.hasOwn(flow.integrations.ai, 'apiKey'), false)
  assert.strictEqual(Object.hasOwn(flow.integrations.feishu, 'webhook'), false)
  assert.ok(flow.csp.includes("connect-src 'none'"))
  assert.strictEqual(flow.testCompleteRun, packaged ? 'undefined' : 'function')

  await delay(800)
  const companion = (await targets()).find(target => target.type === 'page' && target.url.endsWith('/steam-companion.html'))
  assert.ok(companion, 'Opt-in companion window did not open')

  const deliverables = path.join(root, 'deliverables', 'steam')
  fs.mkdirSync(deliverables, { recursive: true })
  const suffix = packaged ? '-packaged' : '-source'
  const companionState = await inspectCompanion(companion, path.join(deliverables, `steam-companion${suffix}.png`))
  assert.strictEqual(companionState.ready, 'true')
  assert.strictEqual(companionState.width, 280)
  assert.ok(companionState.height >= 330 && companionState.height <= 332)
  assert.strictEqual(companionState.timer, '10:00')
  assert.strictEqual(companionState.label, '待机')

  await evaluate(`(async () => {
    document.getElementById('integration-open').click()
    await new Promise(resolve => setTimeout(resolve, 250))
  })()`)
  const connectionScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(deliverables, `steam-connections${suffix}.png`), Buffer.from(connectionScreenshot.data, 'base64'))
  await evaluate(`document.getElementById('director-close').click()`)

  const minimumLayout = await evaluate(`(async () => {
    window.resizeTo(1000, 700)
    await new Promise(resolve => setTimeout(resolve, 500))
    const panels = [...document.querySelectorAll('.mission-deck > section')].map(panel => ({
      name: panel.className,
      clientHeight: panel.clientHeight,
      scrollHeight: panel.scrollHeight,
    }))
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      verticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
      panels,
    }
  })()`)
  assert.ok(minimumLayout.width >= 1000 && minimumLayout.width <= 1002)
  assert.ok(minimumLayout.height >= 700 && minimumLayout.height <= 702)
  assert.strictEqual(minimumLayout.horizontalOverflow, false)
  assert.strictEqual(minimumLayout.verticalOverflow, false)
  const clippedPanels = minimumLayout.panels.filter(panel => panel.scrollHeight > panel.clientHeight + 1)
  assert.deepStrictEqual(clippedPanels, [], JSON.stringify(minimumLayout.panels))

  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(deliverables, `steam-game${suffix}.png`), Buffer.from(screenshot.data, 'base64'))

  assert.deepStrictEqual(runtimeErrors, [], `Runtime exceptions: ${JSON.stringify(runtimeErrors, null, 2)}`)
  assert.deepStrictEqual(logErrors, [], `Browser errors: ${JSON.stringify(logErrors, null, 2)}`)
  assert.ok(fs.existsSync(path.join(userData, 'focus-quest-save.json')), 'Atomic save file was not created')
  const integrationFile = fs.readFileSync(path.join(userData, 'integrations.json'), 'utf8')
  assert.ok(!integrationFile.includes('test-api-key'), 'API key leaked into integration config')
  assert.ok(!integrationFile.includes('test-hermes-key'), 'Hermes key leaked into integration config')
  assert.ok(!integrationFile.includes('naonao_test'), 'Feishu webhook leaked into integration config')
  assert.ok(fs.existsSync(path.join(userData, 'openai-api-key.bin')), 'Encrypted AI key was not created')
  assert.ok(fs.existsSync(path.join(userData, 'hermes-api-key.bin')), 'Encrypted Hermes key was not created')
  assert.strictEqual(fs.existsSync(path.join(userData, 'feishu-webhook.bin')), !packaged, 'Feishu test secret boundary differs from the runtime mode')
  assert.strictEqual(fs.readFileSync(path.join(userData, 'openai-api-key.bin')).includes(Buffer.from('test-api-key')), false)
  assert.strictEqual(fs.readFileSync(path.join(userData, 'hermes-api-key.bin')).includes(Buffer.from('test-hermes-key')), false)
  if (!packaged) assert.strictEqual(fs.readFileSync(path.join(userData, 'feishu-webhook.bin')).includes(Buffer.from('naonao_test')), false)
  assert.ok(mockRequests.some(request => request.url === '/v1/models' && request.authorization === 'Bearer test-api-key'))
  assert.ok(mockRequests.some(request => request.url === '/v1/chat/completions' && request.authorization === 'Bearer test-api-key'))
  assert.ok(mockRequests.some(request => request.url === '/v1/chat/completions' && request.authorization === 'Bearer test-hermes-key'))
  const openAiGeneration = mockRequests.find(request => (
    request.url === '/v1/chat/completions' && request.authorization === 'Bearer test-api-key'
  ))
  const disclosedContext = JSON.parse(JSON.parse(openAiGeneration.body).messages[1].content)
  assert.deepStrictEqual(disclosedContext, {
    task: '规划下一次版本发布',
    profile: {
      level: flow.state.profile.level,
      streak: flow.state.profile.streak,
      totalFocusMinutes: flow.state.profile.totalFocusMinutes,
    },
    recentCompletedTasks: ['完成 Steam 商店资料'],
  })
  await delay(300)
  assert.strictEqual(
    mockRequests.filter(request => request.url.includes('/open-apis/bot/v2/hook/')).length >= 3,
    !packaged,
  )
  await evaluate('setTimeout(() => window.close(), 100); true')
  socket.close()
}

main().finally(async () => {
  await waitForChildExit(2000)
  killTree()
  await waitForChildExit()
  await new Promise(resolve => mockServer.close(resolve))
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
}).then(() => {
  console.log(`steam ${packaged ? 'packaged ' : ''}electron smoke passed`)
}).catch(error => {
  console.error(error)
  process.exitCode = 1
})
