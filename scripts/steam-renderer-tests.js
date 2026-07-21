const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..')
const gameSource = fs.readFileSync(path.join(root, 'app', 'steam-game.js'), 'utf8')
const companionSource = fs.readFileSync(path.join(root, 'app', 'steam-companion.js'), 'utf8')

class FakeClassList {
  constructor() {
    this.values = new Set()
  }

  add(...values) {
    values.forEach(value => this.values.add(value))
  }

  remove(...values) {
    values.forEach(value => this.values.delete(value))
  }

  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force)
    if (enabled) this.values.add(value)
    else this.values.delete(value)
    return enabled
  }

  contains(value) {
    return this.values.has(value)
  }
}

class FakeElement {
  constructor(id = '') {
    this.id = id
    this.children = []
    this.dataset = {}
    this.style = {}
    this.classList = new FakeClassList()
    this.listeners = new Map()
    this.attributes = new Map()
    this.textContent = ''
    this.className = ''
    this.value = ''
    this.checked = false
    this.disabled = false
    this.hidden = false
    this.title = ''
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  async emit(type, event = {}) {
    const payload = {
      preventDefault() {},
      target: this,
      ...event,
    }
    for (const listener of this.listeners.get(type) || []) await listener(payload)
  }

  append(...children) {
    this.children.push(...children)
  }

  replaceChildren(...children) {
    this.children = [...children]
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }
}

function createDocument() {
  const elements = new Map()
  const body = new FakeElement('body')
  const durationButtons = [10, 25, 45, 60].map(duration => {
    const element = new FakeElement()
    element.dataset.duration = String(duration)
    return element
  })
  const directorTabs = ['quest', 'connections'].map(tab => {
    const element = new FakeElement()
    element.dataset.directorTab = tab
    return element
  })
  const directorPanels = ['quest', 'connections'].map(panel => {
    const element = new FakeElement()
    element.dataset.directorPanel = panel
    return element
  })
  const selectors = new Map([
    ['.duration-selector', new FakeElement('duration-selector')],
    ['.drawer-tabs', new FakeElement('drawer-tabs')],
    ['.companion-scene', new FakeElement('companion-scene')],
  ])

  return {
    body,
    createElement: () => new FakeElement(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id))
      return elements.get(id)
    },
    querySelector(selector) {
      return selectors.get(selector) || null
    },
    querySelectorAll(selector) {
      if (selector === '[data-duration]') return durationButtons
      if (selector === '[data-director-tab]') return directorTabs
      if (selector === '[data-director-panel]') return directorPanels
      return []
    },
    addEventListener() {},
  }
}

function defaultState(tasks = []) {
  return {
    schemaVersion: 1,
    profile: {
      level: 1,
      xp: 0,
      leaves: 0,
      bond: 0,
      streak: 0,
      energy: 50,
      totalSessions: 0,
      totalFocusMinutes: 0,
    },
    tasks,
    run: {
      status: 'idle',
      taskId: null,
      durationMinutes: 25,
      remainingSeconds: 1500,
      endsAt: null,
    },
    settings: { focusMinutes: 25, companion: false, sound: false },
    daily: { date: '2026-07-15', quests: [] },
    journey: { chapter: 1, step: 0, totalSteps: 0 },
    unlocks: ['classic'],
    achievements: {},
  }
}

function defaultIntegrations() {
  return {
    ai: {
      enabled: false,
      provider: 'hermes',
      baseUrl: 'http://127.0.0.1:8642/v1',
      model: 'hermes-agent',
      networkConsent: false,
      shareMemory: false,
      hasKey: false,
    },
    feishu: {
      enabled: false,
      notifyFocus: true,
      notifyTask: true,
      hasWebhook: false,
    },
  }
}

const Engine = {
  ROUTE_LENGTH: 6,
  UNLOCKS: [{ id: 'classic', name: '经典', level: 1 }],
  ACHIEVEMENTS: [],
  levelThreshold: () => 100,
}

async function settleInitialization(document) {
  for (let index = 0; index < 20 && document.body.dataset.ready !== 'true'; index += 1) {
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(document.body.dataset.ready, 'true', 'renderer did not initialize')
}

async function loadGameRenderer({ state = defaultState(), integrations = defaultIntegrations(), overrides = {} } = {}) {
  const document = createDocument()
  let currentIntegrations = structuredClone(integrations)
  const game = {
    getState: async () => ({ state }),
    environment: async () => ({ edition: 'test' }),
    getIntegrationConfig: async () => structuredClone(currentIntegrations),
    updateIntegrationConfig: async partial => {
      currentIntegrations = {
        ...currentIntegrations,
        ...(partial.ai ? { ai: { ...currentIntegrations.ai, ...partial.ai } } : {}),
        ...(partial.feishu ? { feishu: { ...currentIntegrations.feishu, ...partial.feishu } } : {}),
      }
      return { success: true, config: structuredClone(currentIntegrations) }
    },
    setAiKey: async () => ({ success: true }),
    setFeishuWebhook: async () => ({ success: true }),
    testAi: async () => ({ success: true }),
    testFeishu: async () => ({ success: true }),
    addTask: async () => ({ state }),
    onState() {},
    minimize() {},
    toggleMaximize() {},
    close() {},
    ...overrides,
  }
  const window = {
    NaonaoGameEngine: Engine,
    naonaoGame: game,
  }
  vm.runInNewContext(gameSource, {
    window,
    document,
    URL,
    Date,
    Object,
    Math,
    Number,
    String,
    Boolean,
    Set,
    Array,
    Promise,
    console,
    setInterval: () => 1,
    setTimeout: () => 1,
    clearTimeout() {},
  }, { filename: 'steam-game.js' })
  await settleInitialization(document)
  return { document, game, window }
}

async function loadCompanion(overrides = {}) {
  const document = createDocument()
  const state = defaultState()
  const game = {
    getState: async () => ({ state }),
    startRun: async () => ({ state }),
    pauseRun: async () => ({ state }),
    resumeRun: async () => ({ state }),
    showMain() {},
    disableCompanion() {},
    onState() {},
    ...overrides,
  }
  vm.runInNewContext(companionSource, {
    window: { naonaoGame: game },
    document,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Promise,
    setInterval: () => 1,
  }, { filename: 'steam-companion.js' })
  await settleInitialization(document)
  return { document, game }
}

function findDescendant(element, predicate) {
  if (predicate(element)) return element
  for (const child of element.children || []) {
    const result = findDescendant(child, predicate)
    if (result) return result
  }
  return null
}

const tests = []

function test(name, run) {
  tests.push({ name, run })
}

test('task form keeps input and reports a rejected save', async () => {
  const { document } = await loadGameRenderer({
    overrides: { addTask: async () => { throw new Error('disk full') } },
  })
  const input = document.getElementById('task-input')
  input.value = '保留这项任务'
  await document.getElementById('task-form').emit('submit')
  assert.equal(input.value, '保留这项任务')
  assert.match(document.getElementById('save-status').textContent, /失败/)
})

test('AI and Feishu submissions send only their own partial sections', async () => {
  const calls = []
  let authoritative = defaultIntegrations()
  const { document, window } = await loadGameRenderer({
    overrides: {
      getIntegrationConfig: async () => structuredClone(authoritative),
      updateIntegrationConfig: async input => {
        calls.push(input)
        authoritative = {
          ...authoritative,
          ...(input.ai ? { ai: { ...authoritative.ai, ...input.ai } } : {}),
          ...(input.feishu ? { feishu: { ...authoritative.feishu, ...input.feishu } } : {}),
        }
        return { success: true }
      },
    },
  })
  document.getElementById('ai-enabled').checked = true
  document.getElementById('feishu-enabled').checked = true
  await Promise.all([
    document.getElementById('ai-config-form').emit('submit'),
    document.getElementById('feishu-config-form').emit('submit'),
  ])
  assert.deepEqual(Object.keys(calls[0]), ['ai'])
  assert.deepEqual(Object.keys(calls[1]), ['feishu'])
  assert.match(document.getElementById('ai-status').className, /success/)
  assert.match(document.getElementById('feishu-status').className, /success/)
  assert.equal(window.__naonaoSteamGame.integrations().ai.enabled, true)
  assert.equal(window.__naonaoSteamGame.integrations().feishu.enabled, true)
  assert.equal(document.getElementById('ai-enabled').checked, true)
  assert.equal(document.getElementById('feishu-enabled').checked, true)
})

test('integration form rejections remain visible failures', async () => {
  const { document } = await loadGameRenderer({
    overrides: { updateIntegrationConfig: async () => { throw new Error('write rejected') } },
  })
  await document.getElementById('ai-config-form').emit('submit')
  await document.getElementById('feishu-config-form').emit('submit')
  assert.match(document.getElementById('ai-status').className, /error/)
  assert.match(document.getElementById('feishu-status').className, /error/)
  assert.doesNotMatch(document.getElementById('ai-status').textContent, /正在/)
  assert.doesNotMatch(document.getElementById('feishu-status').textContent, /正在/)
})

test('secret, clear, and connection-test rejections remain visible failures', async () => {
  const { document } = await loadGameRenderer({
    overrides: {
      setAiKey: async () => { throw new Error('key rejected') },
      setFeishuWebhook: async () => { throw new Error('webhook rejected') },
      testAi: async () => { throw new Error('AI test rejected') },
      testFeishu: async () => { throw new Error('Feishu test rejected') },
    },
  })

  document.getElementById('ai-key').value = 'new-key'
  await document.getElementById('ai-config-form').emit('submit')
  assert.match(document.getElementById('ai-status').className, /error/)

  document.getElementById('feishu-webhook').value = 'https://open.feishu.cn/open-apis/bot/v2/hook/test'
  await document.getElementById('feishu-config-form').emit('submit')
  assert.match(document.getElementById('feishu-status').className, /error/)

  await document.getElementById('ai-clear-key').emit('click')
  assert.match(document.getElementById('ai-status').className, /error/)
  await document.getElementById('feishu-clear-webhook').emit('click')
  assert.match(document.getElementById('feishu-status').className, /error/)

  await document.getElementById('ai-test').emit('click')
  assert.match(document.getElementById('ai-status').className, /error/)
  await document.getElementById('feishu-test').emit('click')
  assert.match(document.getElementById('feishu-status').className, /error/)
})

test('director request rejections report failure and release their busy lock', async () => {
  let onlineAttempts = 0
  let offlineAttempts = 0
  const task = { id: 'task_1', text: '任务', done: false, quest: null }
  const integrations = defaultIntegrations()
  integrations.ai.enabled = true
  const { document } = await loadGameRenderer({
    state: defaultState([task]),
    integrations,
    overrides: {
      generateQuest: async () => {
        onlineAttempts += 1
        throw new Error('director rejected')
      },
      generateOfflineQuest: async () => {
        offlineAttempts += 1
        throw new Error('offline rejected')
      },
    },
  })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    document.getElementById('director-consent').checked = true
    await document.getElementById('director-generate').emit('click')
    assert.match(document.getElementById('director-status').className, /error/)
    await document.getElementById('director-offline').emit('click')
    assert.match(document.getElementById('director-status').className, /error/)
  }
  assert.equal(onlineAttempts, 2)
  assert.equal(offlineAttempts, 2)
})

test('companion releases its busy lock after a rejected control action', async () => {
  let attempts = 0
  const { document } = await loadCompanion({
    startRun: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('rejected')
      return { state: defaultState() }
    },
  })
  const control = document.getElementById('run-control')
  await control.emit('click')
  await control.emit('click')
  assert.equal(attempts, 2)
  assert.equal(control.disabled, false)
})

test('partially completed quests cannot be regenerated from the UI', async () => {
  const task = {
    id: 'task_1',
    text: '已开始的任务',
    done: false,
    quest: {
      title: '关卡',
      briefing: '简报',
      coachLine: '继续',
      rewardName: '奖励',
      source: 'offline',
      steps: [
        { id: 'step_1', text: '第一步', done: true },
        { id: 'step_2', text: '第二步', done: false },
      ],
    },
  }
  const { document } = await loadGameRenderer({ state: defaultState([task]) })
  assert.equal(document.getElementById('director-generate').disabled, true)
  assert.equal(document.getElementById('director-offline').disabled, true)
  const taskButton = findDescendant(
    document.getElementById('task-list'),
    element => element.dataset?.action === 'director',
  )
  assert.ok(taskButton)
  assert.equal(taskButton.disabled, true)
})

test('AI data disclosure is explicit and identical in all public copy', () => {
  const disclosure = '每次 AI 生成请求都会固定发送当前任务、等级、连续天数和累计专注分钟；“最近 5 条已完成任务名称”选项默认关闭，玩家开启后才会额外发送这些任务名称。'
  const files = [
    path.join(root, 'app', 'steam-game.html'),
    path.join(root, 'steam', 'privacy-policy-zh-CN.md'),
    path.join(root, 'steam', 'content-survey-draft.md'),
    path.join(root, 'steam', 'store-page-zh-CN.md'),
  ]
  files.forEach(file => assert.ok(fs.readFileSync(file, 'utf8').includes(disclosure), `${file} disclosure differs`))
})

;(async () => {
  const failures = []
  for (const { name, run } of tests) {
    try {
      await run()
      console.log(`PASS ${name}`)
    } catch (error) {
      failures.push({ name, error })
      console.error(`FAIL ${name}: ${error.message}`)
    }
  }
  if (failures.length) process.exitCode = 1
  else console.log('steam renderer tests passed')
})()
