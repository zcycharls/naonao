'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const repo = path.resolve(__dirname, '..');
const appJs = fs.readFileSync(path.join(repo, 'android', 'src', 'main', 'assets', 'app.js'), 'utf8');

function makeElement(id) {
  const classes = new Set();
  const listeners = new Map();
  const attributes = new Map();
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    checked: false,
    disabled: false,
    dataset: {},
    style: { setProperty() {} },
    offsetWidth: 1,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) {
            classes.delete(name);
            return false;
          }
          classes.add(name);
          return true;
        }
        if (force) classes.add(name);
        else classes.delete(name);
        return !!force;
      },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    click() {
      this.dispatchEvent({ type: 'click', target: this });
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach(fn => fn(event));
    },
    querySelector() { return null; },
    scrollTop: 0,
    scrollHeight: 0,
  };
}

function makeFixedDate(nowMs) {
  function FixedDate(...args) {
    if (!(this instanceof FixedDate)) {
      return args.length ? Date(...args) : new Date(nowMs).toString();
    }
    return args.length ? new Date(...args) : new Date(nowMs);
  }
  Object.setPrototypeOf(FixedDate, Date);
  FixedDate.prototype = Date.prototype;
  FixedDate.now = () => nowMs;
  FixedDate.parse = Date.parse;
  FixedDate.UTC = Date.UTC;
  return FixedDate;
}

function makeContext(seedState = {}, options = {}) {
  const nowMs = options.nowMs || 1782992636435;
  const FixedDate = makeFixedDate(nowMs);
  const bridgeCalls = { saved: [], deleted: [], notified: [], reminders: [] };
  bridgeCalls.shares = [];
  const bridge = options.withBridge ? {
    hasSecret() { return false; },
    saveSecret(name, value) {
      bridgeCalls.saved.push({ name, value });
      return true;
    },
    deleteSecret(name) {
      bridgeCalls.deleted.push(name);
      return true;
    },
    notifyNow(title, body) {
      bridgeCalls.notified.push({ title, body });
    },
    scheduleReminder(id, title, body, delayMs, repeatMs) {
      bridgeCalls.reminders.push({ id, title, body, delayMs, repeatMs });
    },
    cancelReminder(id) {
      bridgeCalls.reminders.push({ id, cancelled: true });
    },
    cancelAllReminders() {
      bridgeCalls.reminders.push({ all: true, cancelled: true });
    },
    ensureNotificationPermission() {
      return options.notificationPermission !== false;
    },
    shareText(title, text) {
      bridgeCalls.shares.push({ title, text });
      return options.shareTextResult !== false;
    },
    vibrate() {},
  } : null;
  const store = new Map([
    ['naonao_android_state_v1', JSON.stringify(seedState)],
  ]);
  const elements = new Map();
  const dynamicInputs = [];
  const views = ['home', 'tasks', 'focus', 'freezer', 'stats', 'settings'].map(view => {
    const el = makeElement(`view-${view}`);
    el.dataset.view = view;
    if (view === 'home') el.classList.add('active');
    return el;
  });
  const navButtons = ['home', 'tasks', 'focus', 'freezer', 'stats'].map(view => {
    const el = makeElement(`nav-${view}`);
    el.dataset.target = view;
    if (view === 'home') el.classList.add('active');
    return el;
  });
  const providerButtons = ['anthropic', 'openai'].map(provider => {
    const el = makeElement(`provider-${provider}`);
    el.dataset.provider = provider;
    if (provider === 'anthropic') el.classList.add('active');
    return el;
  });
  const ids = [
    ...views.map(view => view.id),
    'toast','active-task-title','task-done-btn','next-step-text','focus-badge','today-line','body-double-toggle','android-pet','pet-hat',
    'chat-messages','task-list','timer-ring','timer-mode','timer-time','timer-sub','timer-start','focus-intent-input',
    'freezer-list','stat-freezer','stat-today','stat-week','stat-streak','trend-bars','mood-list',
    'api-key-input','model-input','base-url-input','confirm-base-url','hermes-enabled','hermes-base-input',
    'hermes-key-input','hermes-model-input','confirm-hermes-url','memory-enabled','notifications-enabled',
    'idle-frequency','feishu-webhook-input','provider-segment','long-task-list','quick-task-add','quick-task-input',
    'task-add','task-input','chat-send','chat-input','chat-clear','timer-reset','mood-row','freezer-add',
    'freezer-input','freezer-list','save-model-settings','save-hermes-settings','review-memory','save-feishu',
    'test-feishu','long-add','long-title-input','export-data','clear-data','settings-shortcut',
    'app-dialog','dialog-title','dialog-message','dialog-cancel','dialog-ok'
  ];
  ids.forEach(id => elements.set(id, makeElement(id)));
  views.forEach(view => elements.set(view.id, view));
  elements.get('provider-segment').querySelector = (selector) => {
    if (selector === '.active') return providerButtons.find(btn => btn.classList.contains('active')) || null;
    return null;
  };
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll(selector) {
      if (selector === '.bottom-nav button') return navButtons;
      if (selector === '.view') return views;
      if (selector === '#provider-segment button') return providerButtons;
      return [];
    },
    querySelector(selector) {
      if (selector === '.view.active') return views.find(view => view.classList.contains('active')) || null;
      const dataActionId = selector.match(/^\[data-action="([^"]+)"\]\[data-id="([^"]+)"\]$/);
      if (dataActionId) {
        return dynamicInputs.find(input => input.dataset.action === dataActionId[1] && input.dataset.id === dataActionId[2]) || null;
      }
      return null;
    },
  };
  const location = {
    reloaded: false,
    reload() { this.reloaded = true; },
  };
  const window = { CSS: { escape: (value) => String(value).replace(/"/g, '\\"') }, document };
  window.__NAONAO_AUTO_CONFIRM = options.autoConfirm === false ? false : true;
  if (bridge) window.AndroidBridge = bridge;
  const context = {
    console,
    assert,
    setTimeout(fn, delay) {
      if (options.runShortTimeouts && typeof fn === 'function' && Number(delay) <= 500) fn();
      if (options.runLongTaskSyncTimeouts && typeof fn === 'function' && Number(delay) === 800) fn();
      return 1;
    },
    clearTimeout() {},
    setInterval() { return 2; },
    clearInterval() {},
    location,
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); },
    },
    document,
    window,
    Date: FixedDate,
    Math,
    JSON,
    RegExp,
    String,
    Number,
    Array,
  };
  context.__setNow = (value) => {
    context.Date = makeFixedDate(value);
  };
  context.window.__bridgeCalls = bridgeCalls;
  context.window.__dynamicInputs = dynamicInputs;
  context.globalThis = context;
  return { context, store, elements, bridgeCalls };
}

function runScenario(source, options = {}) {
  const { context, store, bridgeCalls } = makeContext(options.seedState, options);
  vm.createContext(context);
  const testable = appJs.replace(/\ninit\(\);\n\}\)\(\);\s*$/, `
window.__testApi = {
  state, config, addTask, addSubtask, nextStep, activeTask, addFreezer,
  startOrPauseTimer, resetTimer, longTaskSecretName, buildMessages,
  saveLongTaskWebhook, clearData, completeTimerPhase, syncEnabledLongTaskReminders
};
init();
})();`);
  vm.runInContext(`${testable}\nconst { state, config, addTask, addSubtask, nextStep, activeTask, addFreezer, startOrPauseTimer, resetTimer, longTaskSecretName, buildMessages, saveLongTaskWebhook, clearData, completeTimerPhase, syncEnabledLongTaskReminders } = window.__testApi;\n${source}`, context, { filename: 'android-app-test.js' });
  return { context, store, bridgeCalls };
}

runScenario(`
  const t = addTask('写周报第一段');
  assert.strictEqual(activeTask().title, '写周报第一段');
  addSubtask(t.id, '打开文档');
  assert.strictEqual(nextStep().text, '打开文档');
  addFreezer('突然想到买牛奶');
  assert.strictEqual(state.freezer.length, 1);
`);

runScenario(`
  state.timer.mode = 'focus';
  state.timer.remainingMs = 10 * 60 * 1000;
  state.timer.running = false;
  startOrPauseTimer();
  assert.strictEqual(state.timer.durationMs, 25 * 60 * 1000);
  assert.strictEqual(state.timer.startedAt, 1782992636435 - (15 * 60 * 1000));
  assert.strictEqual(JSON.stringify(window.__bridgeCalls.reminders), JSON.stringify([
    { id:'timer', title:'番茄完成', body:'休息 5 分钟，然后回来继续下一步。', delayMs:10 * 60 * 1000, repeatMs:0 },
  ]));
`, { withBridge: true });

runScenario(`
  state.timer.mode = 'focus';
  state.timer.remainingMs = 10 * 60 * 1000;
  startOrPauseTimer();
  startOrPauseTimer();
  assert.strictEqual(window.__bridgeCalls.reminders[1].id, 'timer');
  assert.strictEqual(window.__bridgeCalls.reminders[1].cancelled, true);
`, { withBridge: true });

runScenario(`
  state.timer.mode = 'break';
  state.timer.remainingMs = 2 * 60 * 1000;
  startOrPauseTimer();
  assert.strictEqual(state.timer.durationMs, 5 * 60 * 1000);
  assert.strictEqual(state.timer.startedAt, 1782992636435 - (3 * 60 * 1000));
`);

runScenario(`
  state.timer.mode = 'focus';
  state.timer.running = true;
  state.timer.startedAt = 1782992636435 - (25 * 60 * 1000);
  state.timer.durationMs = 25 * 60 * 1000;
  state.timer.remainingMs = 0;
  completeTimerPhase();
  assert.strictEqual(JSON.stringify(window.__bridgeCalls.notified), JSON.stringify([
    { title:'番茄完成', body:'休息 5 分钟，然后回来继续下一步。' },
  ]));
  assert.strictEqual(window.__bridgeCalls.reminders[0].id, 'timer');
  assert.strictEqual(window.__bridgeCalls.reminders[0].cancelled, true);
`, { withBridge: true });

runScenario(`
  state.timer.mode = 'focus';
  state.timer.running = true;
  state.timer.startedAt = 1782992636435 - (25 * 60 * 1000);
  state.timer.durationMs = 25 * 60 * 1000;
  state.timer.remainingMs = 0;
  __setNow(1782992636435 + 60 * 60 * 1000);
  completeTimerPhase();
  assert.strictEqual(JSON.stringify(window.__bridgeCalls.notified), '[]');
  assert.strictEqual(window.__bridgeCalls.reminders[0].cancelled, true);
`, { withBridge: true });

runScenario(`
  state.chat = [
    { role:'pet', text:'我在。', at:1 },
    { role:'user', text:'我要开始写论文', at:2 },
  ];
  const messages = buildMessages('我要开始写论文');
  assert.strictEqual(messages.filter(msg => msg.role === 'user' && msg.content === '我要开始写论文').length, 1);
  assert.deepStrictEqual(messages[messages.length - 1], { role:'user', content:'我要开始写论文' });
`);

runScenario(`
  document.querySelectorAll('.bottom-nav button').find(btn => btn.dataset.target === 'tasks').click();
  assert.strictEqual(document.querySelector('.view.active').dataset.view, 'tasks');
  document.querySelectorAll('.bottom-nav button').find(btn => btn.dataset.target === 'focus').click();
  assert.strictEqual(document.querySelector('.view.active').dataset.view, 'focus');
  document.getElementById('settings-shortcut').click();
  assert.strictEqual(document.querySelector('.view.active').dataset.view, 'settings');
  assert.strictEqual(window.NAONAO.onAndroidBack(), true);
  assert.strictEqual(document.querySelector('.view.active').dataset.view, 'home');
  assert.strictEqual(window.NAONAO.onAndroidBack(), false);
`);

runScenario(`
  const task = { id:'long/123', hasWebhook:false };
  assert.strictEqual(longTaskSecretName(task.id), 'long_task_webhook_long_123');
  assert.strictEqual(saveLongTaskWebhook(task, 'bad-url'), false);
  assert.strictEqual(task.hasWebhook, false);
  assert.strictEqual(JSON.stringify(window.__bridgeCalls.saved), '[]');

  const webhook = 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token';
  assert.strictEqual(saveLongTaskWebhook(task, webhook), true);
  assert.strictEqual(task.hasWebhook, true);
  assert.strictEqual(JSON.stringify(window.__bridgeCalls.saved), JSON.stringify([
    { name:'long_task_webhook_long_123', value:webhook },
  ]));
`, { withBridge: true });

runScenario(`
  const input = document.getElementById('long-webhook-test');
  input.dataset.action = 'long-webhook';
  input.dataset.id = 'webhook_long';
  input.value = 'https://open.feishu.cn/open-apis/bot/v2/hook/task-token';
  document.getElementById('long-task-list').dispatchEvent({ type:'change', target:input });
  const stored = JSON.parse(localStorage.getItem('naonao_android_state_v1'));
  assert.strictEqual(stored.longTasks[0].hasWebhook, true);
  assert.strictEqual(input.value, '');
  assert.strictEqual(JSON.stringify(window.__bridgeCalls.saved), JSON.stringify([
    { name:'long_task_webhook_webhook_long', value:'https://open.feishu.cn/open-apis/bot/v2/hook/task-token' },
  ]));
`, {
  withBridge: true,
  seedState: {
    longTasks: [
      { id:'webhook_long', title:'任务专用 Webhook', interval:30, enabled:false, hasWebhook:false },
    ],
  },
});

runScenario(`
  assert.strictEqual(state.longTasks.length, 2);
  clearData();
  assert.strictEqual(localStorage.getItem('naonao_android_state_v1'), null);
  assert.strictEqual(localStorage.getItem('naonao_android_config_v1'), null);
  assert.strictEqual(localStorage.getItem('naonao_android_memory_v1'), null);
  assert.strictEqual(JSON.stringify(window.__bridgeCalls.deleted), JSON.stringify([
    'long_task_webhook_long_a',
    'long_task_webhook_long_b',
    'provider_api_key',
    'feishu_webhook',
    'hermes_api_key',
  ]));
  assert.ok(window.__bridgeCalls.reminders.some(item => item.all === true && item.cancelled));
  assert.strictEqual(location.reloaded, true);
`, {
  withBridge: true,
  seedState: {
    longTasks: [
      { id:'long_a', title:'论文' },
      { id:'long/b', title:'考试' },
    ],
  },
});

runScenario(`
  const toggle = document.getElementById('notifications-enabled');
  toggle.checked = true;
  toggle.dispatchEvent({ type:'change', target:toggle });
  assert.strictEqual(config.notificationsEnabled, false);
  assert.strictEqual(toggle.checked, false);
`, { withBridge: true, notificationPermission: false });

runScenario(`
  addTask('准备导出数据');
  config.confirmedBaseUrl = true;
  config.confirmedHermesUrl = true;
  document.getElementById('export-data').click();
  const exported = document.getElementById('data-export').value;
  const payload = JSON.parse(exported);
  assert.ok(exported.includes('准备导出数据'));
  assert.strictEqual(payload.config.confirmedBaseUrl, false);
  assert.strictEqual(payload.config.confirmedHermesUrl, false);
  assert.ok(!exported.includes('sk-test-secret'));
  assert.strictEqual(window.__bridgeCalls.shares.length, 1);
  assert.strictEqual(window.__bridgeCalls.shares[0].title, '孬孬 Android 数据导出');
  assert.strictEqual(window.__bridgeCalls.shares[0].text, exported);
`, { withBridge: true });

runScenario(`
  const payload = {
    state: {
      tasks: [{ id:'restored_task', title:'恢复后的任务', subtasks:[{ id:'s1', text:'恢复子步骤', done:false }] }],
      activeId: 'restored_task',
      freezer: [{ id:'fridge', text:'恢复冰箱', createdAt:1 }],
      stats: { days: { '2026-07-02': { pomos: 2, minutes: 50 } } },
      longTasks: [{ id:'restored_long', title:'恢复长远任务', goal:'持续推进', interval:30, enabled:true }],
    },
    config: {
      provider:'openai',
      notificationsEnabled:false,
      idleFrequency:'high',
      baseUrl:'https://third-party.example/v1',
      confirmedBaseUrl:true,
      hermesBaseUrl:'https://hermes.example/v1',
      confirmedHermesUrl:true,
    },
    memory: [{ at:1, text:'恢复记忆' }],
  };
  document.getElementById('data-export').value = JSON.stringify(payload);
  document.getElementById('import-data').click();
  const restoredState = JSON.parse(localStorage.getItem('naonao_android_state_v1'));
  const restoredConfig = JSON.parse(localStorage.getItem('naonao_android_config_v1'));
  const restoredMemory = JSON.parse(localStorage.getItem('naonao_android_memory_v1'));
  assert.strictEqual(restoredState.tasks[0].title, '恢复后的任务');
  assert.strictEqual(restoredState.freezer[0].text, '恢复冰箱');
  assert.strictEqual(restoredConfig.provider, 'openai');
  assert.strictEqual(restoredConfig.notificationsEnabled, false);
  assert.strictEqual(restoredConfig.baseUrl, 'https://third-party.example/v1');
  assert.strictEqual(restoredConfig.confirmedBaseUrl, false);
  assert.strictEqual(restoredConfig.hermesBaseUrl, 'https://hermes.example/v1');
  assert.strictEqual(restoredConfig.confirmedHermesUrl, false);
  assert.strictEqual(restoredMemory[0].text, '恢复记忆');
  assert.strictEqual(JSON.stringify(window.__bridgeCalls.deleted), JSON.stringify(['long_task_webhook_old_long']));
  assert.ok(window.__bridgeCalls.reminders.some(item => item.all === true && item.cancelled));
  const reminder = window.__bridgeCalls.reminders.find(item => item.id === 'long:restored_long');
  assert.ok(reminder);
  assert.strictEqual(reminder.title, '长远任务：恢复长远任务');
  assert.strictEqual(reminder.delayMs, 30 * 60 * 1000);
  assert.strictEqual(reminder.repeatMs, 30 * 60 * 1000);
  assert.strictEqual(location.reloaded, true);
`, {
  withBridge: true,
  runShortTimeouts: true,
  seedState: {
    longTasks: [
      { id:'old_long', title:'旧提醒', interval:15, enabled:true },
    ],
  },
});

runScenario(`
  const before = localStorage.getItem('naonao_android_state_v1');
  const payload = { state: { tasks: [{ id:'new_task', title:'不应导入' }] } };
  document.getElementById('data-export').value = JSON.stringify(payload);
  document.getElementById('import-data').click();
  assert.strictEqual(localStorage.getItem('naonao_android_state_v1'), before);
  assert.strictEqual(location.reloaded, false);
`, {
  autoConfirm: false,
  seedState: {
    tasks: [{ id:'old_task', title:'保留原任务' }],
  },
});

runScenario(`
  const reminder = window.__bridgeCalls.reminders.find(item => item.id === 'long:boot_long');
  assert.ok(reminder);
  assert.strictEqual(reminder.title, '长远任务：启动恢复任务');
  assert.strictEqual(reminder.delayMs, 20 * 60 * 1000);
  assert.strictEqual(reminder.repeatMs, 45 * 60 * 1000);
  assert.strictEqual(state.longTasks[0].nextDueAt, 1782992636435 + (20 * 60 * 1000));
`, {
  withBridge: true,
  seedState: {
    longTasks: [
      { id:'boot_long', title:'启动恢复任务', goal:'开机后恢复', interval:45, enabled:true, nextDueAt:1782992636435 + (20 * 60 * 1000) },
      { id:'boot_disabled', title:'关闭的任务', interval:10, enabled:false },
    ],
  },
});

runScenario(`
  const reminder = window.__bridgeCalls.reminders.find(item => item.id === 'long:expired_long');
  assert.ok(reminder);
  assert.strictEqual(reminder.delayMs, 25 * 60 * 1000);
  assert.strictEqual(reminder.repeatMs, 25 * 60 * 1000);
  assert.strictEqual(state.longTasks[0].nextDueAt, 1782992636435 + (25 * 60 * 1000));
`, {
  withBridge: true,
  seedState: {
    longTasks: [
      { id:'expired_long', title:'过期恢复任务', interval:25, enabled:true, nextDueAt:1782992636435 - 1000 },
    ],
  },
});

runScenario(`
  const input = document.getElementById('long-goal-test');
  input.dataset.action = 'long-goal';
  input.dataset.id = 'edit_long';
  input.value = '新的提醒正文';
  window.__dynamicInputs.push(input);
  document.getElementById('long-task-list').dispatchEvent({ type:'input', target:input });
  document.getElementById('long-task-list').dispatchEvent({ type:'focusout', target:input });
  const reminder = window.__bridgeCalls.reminders.filter(item => item.id === 'long:edit_long').pop();
  assert.ok(reminder);
  assert.ok(reminder.body.includes('新的提醒正文'));
`, {
  withBridge: true,
  seedState: {
    longTasks: [
      { id:'edit_long', title:'编辑提醒任务', goal:'旧正文', interval:30, enabled:true, nextDueAt:1782992636435 + (10 * 60 * 1000) },
    ],
  },
});

runScenario(`
  const input = document.getElementById('long-goal-debounce-test');
  input.dataset.action = 'long-goal';
  input.dataset.id = 'debounce_long';
  input.value = '防抖后的正文';
  document.getElementById('long-task-list').dispatchEvent({ type:'input', target:input });
  const reminder = window.__bridgeCalls.reminders.filter(item => item.id === 'long:debounce_long').pop();
  assert.ok(reminder);
  assert.ok(reminder.body.includes('防抖后的正文'));
`, {
  withBridge: true,
  runLongTaskSyncTimeouts: true,
  seedState: {
    longTasks: [
      { id:'debounce_long', title:'防抖同步任务', goal:'旧正文', interval:30, enabled:true, nextDueAt:1782992636435 + (10 * 60 * 1000) },
    ],
  },
});

runScenario(`
  localStorage.setItem('naonao_android_memory_v1', JSON.stringify([{ at:1, text:'这是沉淀下来的长期记忆' }]));
  window.__NAONAO_AUTO_CONFIRM = undefined;
  document.getElementById('review-memory').click();
  assert.strictEqual(document.getElementById('app-dialog').hidden, false);
  assert.strictEqual(document.getElementById('dialog-title').textContent, '长期记忆');
  assert.ok(document.getElementById('dialog-message').textContent.includes('长期记忆'));
  document.getElementById('dialog-ok').click();
  assert.strictEqual(document.getElementById('app-dialog').hidden, true);
`);

runScenario(`
  const before = localStorage.getItem('naonao_android_state_v1');
  document.getElementById('data-export').value = '{ bad json';
  document.getElementById('import-data').click();
  assert.strictEqual(localStorage.getItem('naonao_android_state_v1'), before);
  assert.strictEqual(location.reloaded, false);
`);

console.log('Android state tests passed');
