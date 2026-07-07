(function(){
'use strict';

const DEFAULT_MODEL = {
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o-mini',
};

const STORAGE_KEY = 'naonao_android_state_v1';
const CONFIG_KEY = 'naonao_android_config_v1';
const MEMORY_KEY = 'naonao_android_memory_v1';
const FOCUS_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;
const IDLE_MS = { off: 0, low: 20 * 60 * 1000, mid: 10 * 60 * 1000, high: 5 * 60 * 1000 };

const RESPONSE_POOLS = [
  [/走神|分心|刷手机|飘走/, ['走神没关系，回来就行。现在只看下一步。', '先把注意力放回手边这件事，其他想法可以冻起来。']],
  [/焦虑|紧张|慌|害怕/, ['先慢慢呼气。现在只处理眼前 5 分钟能做的事。', '焦虑是在催你保护自己，不是命令。先写下一步。']],
  [/拖延|不想做|启动|动不了/, ['启动最难，先做 2 分钟版本。', '不要等状态好，先打开材料。孬孬陪着你。']],
  [/累|困|疲惫|没睡好/, ['累的时候目标要变小，不要变凶。先喝水或休息 5 分钟。', '今天可以慢一点，先做最小的一步。']],
  [/谢谢|感谢/, ['不客气。你回来继续做，就是最重要的事。']],
  [/你好|在吗|嗨|hi|hello/, ['我在。今天先抓住哪一件事？', '在呢。写个任务锚，我们从小步开始。']],
];
const DEFAULT_RESPONSES = [
  '我听到了。把它落到一个小动作上：下一步是什么？',
  '先不要同时想太多，只保留眼前这一件事。',
  '可以慢慢来。现在做一个小到不会害怕的版本。',
  '把会打断你的想法先冻起来，当前任务继续往前挪一点。',
];

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const bridge = window.AndroidBridge || null;
const nativeCalls = new Map();
let nativeSeq = 0;
window.NAONAO_NATIVE = {
  resolve(id, payload){
    const call = nativeCalls.get(id);
    if(!call) return;
    nativeCalls.delete(id);
    call.resolve(payload || { success:false, error:'empty native payload' });
  }
};

function callNative(method, ...args){
  if(!bridge || typeof bridge[method] !== 'function'){
    return Promise.reject(new Error('Android 原生桥不可用'));
  }
  const id = 'cb_' + (++nativeSeq) + '_' + Date.now().toString(36);
  return new Promise((resolve) => {
    nativeCalls.set(id, { resolve });
    try{
      bridge[method](...args, id);
    }catch(e){
      nativeCalls.delete(id);
      resolve({ success:false, error:e.message || String(e) });
    }
    setTimeout(() => {
      if(!nativeCalls.has(id)) return;
      nativeCalls.delete(id);
      resolve({ success:false, error:'请求超时' });
    }, 60000);
  });
}

function loadJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch{
    return fallback;
  }
}

function saveJSON(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

function uid(prefix){
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}

function todayKey(date = new Date()){
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function clampText(value, max){
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function escapeHTML(value){
  return String(value || '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[ch]));
}

function escapeSelector(value){
  if(window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
  return String(value).replace(/["\\\]\[]/g, '\\$&');
}

function minutes(ms){
  return Math.max(0, Math.ceil(ms / 60000));
}

const state = normalizeState(loadJSON(STORAGE_KEY, {}));
let config = normalizeConfig(loadJSON(CONFIG_KEY, {}));
let timerInterval = null;
let idleTimer = null;
let toastTimer = null;
let dialogResolve = null;
const longTaskSyncTimers = new Map();

function normalizeState(raw){
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(t => ({
    id: String(t.id || uid('task')),
    title: clampText(t.title, 60) || '未命名任务',
    done: !!t.done,
    createdAt: Number(t.createdAt) || Date.now(),
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(s => ({
      id: String(s.id || uid('sub')),
      text: clampText(s.text, 80),
      done: !!s.done,
    })).filter(s => s.text).slice(0, 8) : [],
  })).slice(0, 30) : [];
  const activeId = tasks.some(t => t.id === raw.activeId) ? raw.activeId : (tasks[0]?.id || null);
  const timer = raw.timer && typeof raw.timer === 'object' ? raw.timer : {};
  const timerMode = timer.mode === 'break' ? 'break' : 'focus';
  const timerDuration = timerMode === 'break' ? BREAK_MS : FOCUS_MS;
  return {
    tasks,
    activeId,
    freezer: Array.isArray(raw.freezer) ? raw.freezer.map(item => ({
      id: String(item.id || uid('fridge')),
      text: clampText(item.text, 100),
      createdAt: Number(item.createdAt) || Date.now(),
    })).filter(item => item.text).slice(0, 80) : [],
    stats: raw.stats && typeof raw.stats === 'object' ? raw.stats : { days:{} },
    moods: Array.isArray(raw.moods) ? raw.moods.slice(-50) : [],
    chat: Array.isArray(raw.chat) ? raw.chat.slice(-40) : [],
    bodyDouble: !!raw.bodyDouble,
    timer: {
      running: !!timer.running,
      mode: timerMode,
      startedAt: Number(timer.startedAt) || 0,
      durationMs: timerDuration,
      remainingMs: Math.max(0, Math.min(timerDuration, Number(timer.remainingMs) || timerDuration)),
      completed: Number(timer.completed) || 0,
      intent: clampText(timer.intent, 60),
    },
    longTasks: Array.isArray(raw.longTasks) ? raw.longTasks.map(t => ({
      id: String(t.id || uid('long')),
      title: clampText(t.title, 60) || '未命名长远任务',
      goal: clampText(t.goal, 220),
      interval: Math.max(1, Math.min(10080, Number(t.interval) || 1440)),
      enabled: !!t.enabled,
      hasWebhook: !!t.hasWebhook,
      createdAt: Number(t.createdAt) || Date.now(),
      nextDueAt: Number(t.nextDueAt) || 0,
      lastSentAt: Number(t.lastSentAt) || 0,
    })).slice(0, 12) : [],
    lastActivityAt: Number(raw.lastActivityAt) || Date.now(),
  };
}

function normalizeConfig(raw){
  return {
    provider: raw.provider === 'openai' ? 'openai' : 'anthropic',
    model: clampText(raw.model, 160),
    baseUrl: clampText(raw.baseUrl, 260),
    confirmedBaseUrl: !!raw.confirmedBaseUrl,
    hermesEnabled: !!raw.hermesEnabled,
    hermesBaseUrl: clampText(raw.hermesBaseUrl, 260) || 'http://127.0.0.1:8642/v1',
    hermesModel: clampText(raw.hermesModel, 120) || 'hermes-agent',
    confirmedHermesUrl: !!raw.confirmedHermesUrl,
    memoryEnabled: raw.memoryEnabled !== false,
    notificationsEnabled: raw.notificationsEnabled !== false,
    idleFrequency: ['off','low','mid','high'].includes(raw.idleFrequency) ? raw.idleFrequency : 'mid',
  };
}

function normalizeImportedConfig(raw){
  const imported = normalizeConfig(raw || {});
  imported.confirmedBaseUrl = false;
  imported.confirmedHermesUrl = false;
  return imported;
}

function persist(){
  saveJSON(STORAGE_KEY, state);
  saveJSON(CONFIG_KEY, config);
}

function activeTask(){
  return state.tasks.find(t => t.id === state.activeId) || null;
}

function nextStep(task = activeTask()){
  if(!task) return null;
  return task.subtasks.find(s => !s.done) || null;
}

function toast(message){
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2400);
}

function closeDialog(value){
  const dialog = $('app-dialog');
  if(dialog) dialog.hidden = true;
  const resolve = dialogResolve;
  dialogResolve = null;
  if(resolve) resolve(value);
}

function showDialog({ title, message, confirmText = '确定', cancelText = '取消', confirmOnly = false, onConfirm = null }){
  if(window.__NAONAO_AUTO_CONFIRM !== undefined){
    if((confirmOnly || window.__NAONAO_AUTO_CONFIRM) && onConfirm) onConfirm();
    return;
  }
  const dialog = $('app-dialog');
  if(!dialog){
    if(confirmOnly && onConfirm) onConfirm();
    return;
  }
  $('dialog-title').textContent = title;
  $('dialog-message').textContent = message;
  $('dialog-ok').textContent = confirmText;
  $('dialog-cancel').textContent = cancelText;
  $('dialog-cancel').hidden = confirmOnly;
  dialog.hidden = false;
  dialogResolve = value => {
    if(value && onConfirm) onConfirm();
  };
}

const confirmAction = (title, message, confirmText, onConfirm) => showDialog({ title, message, confirmText, onConfirm });
const showMessage = (title, message) => showDialog({ title, message, confirmOnly:true });

function touchActivity(){
  state.lastActivityAt = Date.now();
  persist();
  scheduleIdleReminder();
}

function nativeVibrate(ms = 40){
  try{ bridge?.vibrate?.(ms); }catch{}
}

function nativeNotify(title, body){
  if(!config.notificationsEnabled) return;
  try{ bridge?.notifyNow?.(title, body); }catch{}
}

function timerNativeMessage(timer = state.timer){
  if(timer.mode === 'break'){
    return { title:'休息结束', body:'回来看看当前任务。' };
  }
  return { title:'番茄完成', body:'休息 5 分钟，然后回来继续下一步。' };
}

function scheduleNativeTimerReminder(){
  if(!config.notificationsEnabled) return;
  const timer = state.timer;
  if(!timer.running || !bridge?.scheduleReminder) return;
  const message = timerNativeMessage(timer);
  try{
    bridge.scheduleReminder('timer', message.title, message.body, Math.max(1000, timer.remainingMs), 0);
  }catch{}
}

function cancelNativeTimerReminder(){
  try{ bridge?.cancelReminder?.('timer'); }catch{}
}

function cancelLongTaskReminders(tasks = state.longTasks){
  tasks.forEach(task => {
    try{ bridge?.cancelReminder?.(`long:${task.id}`); }catch{}
  });
}

function cancelLocalReminders(tasks = state.longTasks){
  if(bridge?.cancelAllReminders){
    try{
      bridge.cancelAllReminders();
      return;
    }catch{}
  }
  cancelNativeTimerReminder();
  cancelLongTaskReminders(tasks);
}

function shouldNotifyTimerFromJs(timer){
  const dueAt = (Number(timer.startedAt) || Date.now()) + (Number(timer.durationMs) || FOCUS_MS);
  return Date.now() - dueAt < 5000;
}

function scheduleIdleReminder(){
  clearTimeout(idleTimer);
  const delay = IDLE_MS[config.idleFrequency] || 0;
  if(!delay) return;
  idleTimer = setTimeout(() => {
    if(state.timer.running) {
      scheduleIdleReminder();
      return;
    }
    const task = activeTask();
    const msg = task ? `回来看看「${task.title}」的下一步。` : '回来写一个任务锚点。';
    addChat('pet', msg);
    nativeNotify('孬孬提醒', msg);
    scheduleIdleReminder();
  }, delay);
}

function render(){
  renderNav();
  renderHome();
  renderChat();
  renderTasks();
  renderTimer();
  renderFreezer();
  renderStats();
  renderSettings();
  renderLongTasks();
}

function renderNav(){
  $$('.bottom-nav button').forEach(btn => {
    btn.classList.toggle('active', $(`view-${btn.dataset.target}`).classList.contains('active'));
  });
}

function renderHome(){
  const task = activeTask();
  $('active-task-title').textContent = task ? task.title : '还没有当前任务';
  $('task-done-btn').disabled = !task;
  $('task-done-btn').textContent = task?.done ? '恢复' : '完成';
  const step = nextStep(task);
  $('next-step-text').textContent = step ? `下一步：${step.text}` : (task ? '没有子步骤了，可以加一个更小的下一步。' : '写下一个具体任务，孬孬会帮你守住它。');
  $('focus-badge').textContent = state.timer.running ? (state.timer.mode === 'focus' ? '专注中' : '休息中') : (state.bodyDouble ? '陪你专注' : '待命');
  $('today-line').textContent = task ? `现在守住：${task.title}` : '今天先抓住一件事。';
  $('body-double-toggle').classList.toggle('on', state.bodyDouble);
  $('body-double-toggle').setAttribute('aria-pressed', String(state.bodyDouble));
  $('android-pet').classList.toggle('has-hat', state.bodyDouble);
}

function animatePet(){
  const pet = $('android-pet');
  if(!pet) return;
  pet.classList.remove('pet-bop');
  void pet.offsetWidth;
  pet.classList.add('pet-bop');
}

function renderChat(){
  const wrap = $('chat-messages');
  if(!state.chat.length){
    state.chat.push({ role:'pet', text:'我在。写一个任务锚，我们从小步开始。', at:Date.now() });
  }
  wrap.innerHTML = state.chat.slice(-30).map(msg => `<div class="msg ${msg.role === 'user' ? 'user' : msg.role === 'error' ? 'error' : 'pet'}">${escapeHTML(msg.text)}</div>`).join('');
  wrap.scrollTop = wrap.scrollHeight;
}

function renderTasks(){
  const list = $('task-list');
  if(!state.tasks.length){
    list.innerHTML = '<div class="empty">还没有任务。新增一个“现在要做什么”，就够了。</div>';
    return;
  }
  list.innerHTML = state.tasks.map(task => {
    const subs = task.subtasks.map(sub => `
      <label class="subtask">
        <input type="checkbox" data-action="toggle-sub" data-task="${task.id}" data-sub="${sub.id}" ${sub.done?'checked':''}>
        <span>${escapeHTML(sub.text)}</span>
      </label>
    `).join('');
    return `
      <article class="task-card ${task.id === state.activeId ? 'active' : ''}" data-task="${task.id}">
        <div class="task-title-row">
          <label class="task-title-main">
            <input type="checkbox" data-action="task-done" data-task="${task.id}" ${task.done?'checked':''} aria-label="完成任务">
            <strong>${escapeHTML(task.title)}</strong>
          </label>
          <div class="task-actions">
            <button class="mini-btn" data-action="set-active" data-task="${task.id}" type="button">锚定</button>
            <button class="mini-btn danger" data-action="delete-task" data-task="${task.id}" type="button">删</button>
          </div>
        </div>
        <div class="subtasks">${subs || '<div class="subtask">还没有子步骤</div>'}</div>
        <div class="sub-add-row">
          <input type="text" maxlength="80" data-sub-input="${task.id}" placeholder="加一个下一步">
          <button data-action="add-sub" data-task="${task.id}" type="button">+</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderTimer(){
  updateTimerState();
  const timer = state.timer;
  const total = timer.durationMs || FOCUS_MS;
  const remain = Math.max(0, timer.remainingMs);
  const elapsed = Math.max(0, total - remain);
  const deg = Math.min(360, Math.round((elapsed / total) * 360));
  $('timer-ring').style.setProperty('--progress', `${deg}deg`);
  $('timer-mode').textContent = timer.mode === 'break' ? '休息' : '专注';
  $('timer-time').textContent = formatTime(remain);
  $('timer-sub').textContent = `完成 ${timer.completed || 0} 个番茄`;
  $('timer-start').textContent = timer.running ? '暂停' : '开始';
  $('focus-intent-input').value = timer.intent || activeTask()?.title || '';
}

function renderFreezer(){
  const list = $('freezer-list');
  $('stat-freezer').textContent = String(state.freezer.length);
  if(!state.freezer.length){
    list.innerHTML = '<div class="empty">没有冷冻的想法。专注中冒出来的事，可以先放这里。</div>';
    return;
  }
  list.innerHTML = state.freezer.map(item => `
    <article class="freezer-card">
      <div class="freezer-row">
        <strong>${escapeHTML(item.text)}</strong>
        <button class="mini-btn" data-action="freezer-task" data-id="${item.id}" type="button">取用</button>
        <button class="mini-btn danger" data-action="freezer-delete" data-id="${item.id}" type="button">删</button>
      </div>
      <p>${new Date(item.createdAt).toLocaleString('zh-CN')}</p>
    </article>
  `).join('');
}

function renderStats(){
  const days = state.stats.days || {};
  const today = todayKey();
  $('stat-today').textContent = String(days[today]?.pomos || 0);
  $('stat-week').textContent = String(sumLastDays(7));
  $('stat-streak').textContent = String(streakDays());
  $('stat-freezer').textContent = String(state.freezer.length);
  const trendKeys = lastNDays(14);
  const trendCounts = trendKeys.map(key => days[key]?.pomos || 0);
  if(!trendCounts.some(Boolean)){
    $('trend-bars').innerHTML = '<div class="trend-empty">完成第一颗番茄后，这里会出现近 14 天趋势。</div>';
  }else{
    const max = Math.max(1, ...trendCounts);
    $('trend-bars').innerHTML = trendKeys.map((key, index) => {
      const count = days[key]?.pomos || 0;
      const height = Math.max(4, Math.round((count / max) * 112));
      const showLabel = index === 0 || index === 7 || index === trendKeys.length - 1;
      const label = showLabel ? key.slice(5).replace('-', '/') : '';
      return `<div class="trend-day"><div class="trend-bar" title="${key}: ${count}" style="height:${height}px"></div><span class="trend-label">${label}</span></div>`;
    }).join('');
  }
  const moods = state.moods.slice(-8).reverse();
  $('mood-list').innerHTML = moods.length ? moods.map(m => `<div>${escapeHTML(new Date(m.at).toLocaleString('zh-CN'))} · ${escapeHTML(m.mood)}${m.task ? ` · ${escapeHTML(m.task)}` : ''}</div>`).join('') : '<div class="empty">还没有心情记录。</div>';
}

function renderSettings(){
  $('api-key-input').placeholder = bridge?.hasSecret?.('provider_api_key') ? '已保存，留空继续使用当前 Key' : '粘贴 API Key';
  $('model-input').value = config.model;
  $('base-url-input').value = config.baseUrl;
  $('confirm-base-url').checked = config.confirmedBaseUrl;
  $('hermes-enabled').checked = config.hermesEnabled;
  $('hermes-base-input').value = config.hermesBaseUrl;
  $('hermes-key-input').placeholder = bridge?.hasSecret?.('hermes_api_key') ? '已保存，留空继续使用当前 Key' : '可选';
  $('hermes-model-input').value = config.hermesModel;
  $('confirm-hermes-url').checked = config.confirmedHermesUrl;
  $('memory-enabled').checked = config.memoryEnabled;
  $('notifications-enabled').checked = config.notificationsEnabled;
  $('idle-frequency').value = config.idleFrequency;
  $('feishu-webhook-input').placeholder = bridge?.hasSecret?.('feishu_webhook') ? '已保存，留空继续使用当前 Webhook' : 'https://open.feishu.cn/open-apis/bot/v2/hook/...';
  $$('#provider-segment button').forEach(btn => btn.classList.toggle('active', btn.dataset.provider === config.provider));
}

function renderLongTasks(){
  const list = $('long-task-list');
  if(!state.longTasks.length){
    list.innerHTML = '<div class="empty">还没有长远任务。它们适合论文、项目、考试这类长期目标。</div>';
    return;
  }
  list.innerHTML = state.longTasks.map(task => `
    <article class="long-card" data-long="${task.id}">
      <div class="long-title-row">
        <input type="checkbox" data-action="long-toggle" data-id="${task.id}" ${task.enabled?'checked':''}>
        <strong>${escapeHTML(task.title)}</strong>
        <button class="mini-btn" data-action="long-test" data-id="${task.id}" type="button">测试</button>
        <button class="mini-btn danger" data-action="long-delete" data-id="${task.id}" type="button">删</button>
      </div>
      <input type="text" maxlength="220" data-action="long-goal" data-id="${task.id}" placeholder="目标说明" value="${escapeHTML(task.goal)}">
      <input type="number" min="1" max="10080" data-action="long-interval" data-id="${task.id}" value="${task.interval}" placeholder="提醒间隔（分钟）">
      <input type="password" data-action="long-webhook" data-id="${task.id}" placeholder="${task.hasWebhook ? '已保存，留空继续使用当前任务 Webhook' : '任务专用飞书 Webhook（可选）'}">
      <p>${task.enabled ? `已启用 · 下次提醒约 ${task.nextDueAt ? new Date(task.nextDueAt).toLocaleString('zh-CN') : '待调度'}` : '未启用'}</p>
    </article>
  `).join('');
}

function addTask(title){
  const text = clampText(title, 60);
  if(!text) return null;
  const task = { id: uid('task'), title:text, done:false, createdAt:Date.now(), subtasks:[] };
  state.tasks.unshift(task);
  state.activeId = task.id;
  touchActivity();
  persist();
  render();
  return task;
}

function addSubtask(taskId, text){
  const task = state.tasks.find(t => t.id === taskId);
  const value = clampText(text, 80);
  if(!task || !value) return;
  if(task.subtasks.length >= 8) {
    toast('子步骤最多 8 个');
    return;
  }
  task.subtasks.push({ id: uid('sub'), text:value, done:false });
  touchActivity();
  persist();
  render();
}

function addFreezer(text){
  const value = clampText(text, 100);
  if(!value) return;
  state.freezer.unshift({ id: uid('fridge'), text:value, createdAt:Date.now() });
  touchActivity();
  persist();
  render();
  toast('已冷冻');
}

function addChat(role, text){
  const value = clampText(text, 2000);
  if(!value) return;
  state.chat.push({ role, text:value, at:Date.now() });
  state.chat = state.chat.slice(-60);
  if(role === 'user') touchActivity();
  persist();
  renderChat();
}

async function sendChat(){
  const input = $('chat-input');
  const text = clampText(input.value, 400);
  if(!text) return;
  input.value = '';
  addChat('user', text);
  try{
    const answer = await getAssistantReply(text);
    addChat('pet', answer);
    maybeRemember(text, answer);
  }catch(e){
    addChat('error', e.message || String(e));
  }
}

async function getAssistantReply(text){
  if(config.hermesEnabled && bridge){
    const result = await callNative('chatHermes', JSON.stringify({
      baseUrl: config.hermesBaseUrl,
      allowThirdPartyBaseUrl: config.confirmedHermesUrl,
      model: config.hermesModel,
      maxTokens: 300,
      messages: buildMessages(text),
    }));
    if(result.success && result.text) return result.text.trim();
    if(result.error && bridge.hasSecret?.('hermes_api_key')) throw new Error(result.error);
  }
  if(bridge?.hasSecret?.('provider_api_key')){
    const result = await callNative('chatProvider', JSON.stringify({
      provider: config.provider,
      baseUrl: config.baseUrl,
      allowThirdPartyBaseUrl: config.confirmedBaseUrl,
      model: config.model || DEFAULT_MODEL[config.provider],
      system: systemPrompt(),
      maxTokens: 300,
      messages: buildMessages(text),
    }));
    if(result.success && result.text) return result.text.trim();
    throw new Error(result.error || 'AI 请求失败');
  }
  return smartFallback(text);
}

function buildMessages(text){
  const recent = state.chat.slice(-12).map(msg => ({
    role: msg.role === 'user' ? 'user' : 'assistant',
    content: msg.text,
  }));
  const last = recent[recent.length - 1];
  if(!last || last.role !== 'user' || last.content !== text){
    recent.push({ role:'user', content:text });
  }
  return recent;
}

function systemPrompt(){
  const task = activeTask();
  const step = nextStep(task);
  const memory = config.memoryEnabled ? summarizeMemory() : '';
  return [
    '你是一只叫“孬孬”的 ADHD 数字陪伴宠物。',
    '回复极简短，中文，温柔、接纳、非评判。',
    '每次只抓一个重点，帮助用户回到当下任务。',
    task ? `当前任务：${task.title}` : '',
    step ? `下一步：${step.text}` : '',
    memory ? `长期记忆：${memory}` : '',
  ].filter(Boolean).join('\n');
}

function smartFallback(input){
  for(const [pattern, pool] of RESPONSE_POOLS){
    if(pattern.test(input)) return pool[Math.floor(Math.random()*pool.length)];
  }
  return DEFAULT_RESPONSES[Math.floor(Math.random()*DEFAULT_RESPONSES.length)];
}

function maybeRemember(userText, answer){
  if(!config.memoryEnabled) return;
  if(!/(我喜欢|我不喜欢|以后|下次|适合我|我总是|我容易|记住|偏好|习惯)/.test(userText + answer)) return;
  const memory = loadJSON(MEMORY_KEY, []);
  memory.push({ at:Date.now(), text:clampText(`用户说：${userText}；孬孬回应：${answer}`, 240) });
  saveJSON(MEMORY_KEY, memory.slice(-40));
}

function summarizeMemory(){
  const memory = loadJSON(MEMORY_KEY, []);
  return memory.slice(-8).map(item => item.text).join(' / ');
}

function startOrPauseTimer(){
  updateTimerState();
  const timer = state.timer;
  if(timer.running){
    timer.running = false;
    timer.remainingMs = Math.max(0, timer.remainingMs);
    cancelNativeTimerReminder();
    clearInterval(timerInterval);
    timerInterval = null;
    persist();
    renderTimer();
    return;
  }
  const intent = clampText($('focus-intent-input').value, 60);
  if(intent){
    timer.intent = intent;
    if(!activeTask()) addTask(intent);
  }
  timer.durationMs = timer.mode === 'break' ? BREAK_MS : FOCUS_MS;
  if(timer.remainingMs <= 0 || timer.remainingMs > timer.durationMs) timer.remainingMs = timer.durationMs;
  timer.running = true;
  timer.startedAt = Date.now() - (timer.durationMs - timer.remainingMs);
  nativeVibrate(30);
  scheduleNativeTimerReminder();
  persist();
  runTimerLoop();
  render();
}

function resetTimer(){
  cancelNativeTimerReminder();
  state.timer.running = false;
  state.timer.mode = 'focus';
  state.timer.remainingMs = FOCUS_MS;
  state.timer.durationMs = FOCUS_MS;
  state.timer.startedAt = 0;
  clearInterval(timerInterval);
  timerInterval = null;
  persist();
  render();
}

function runTimerLoop(){
  clearInterval(timerInterval);
  if(!state.timer.running) return;
  timerInterval = setInterval(() => {
    updateTimerState();
    renderTimer();
  }, 1000);
}

function updateTimerState(){
  const timer = state.timer;
  if(!timer.running) return;
  const elapsed = Date.now() - timer.startedAt;
  timer.remainingMs = Math.max(0, timer.durationMs - elapsed);
  if(timer.remainingMs > 0) return;
  completeTimerPhase();
}

function completeTimerPhase(){
  const timer = state.timer;
  const shouldNotify = shouldNotifyTimerFromJs(timer);
  timer.running = false;
  cancelNativeTimerReminder();
  clearInterval(timerInterval);
  timerInterval = null;
  if(timer.mode === 'focus'){
    timer.completed += 1;
    recordPomodoro();
    timer.mode = 'break';
    timer.remainingMs = BREAK_MS;
    timer.durationMs = BREAK_MS;
    if(shouldNotify) nativeNotify('番茄完成', '休息 5 分钟，然后回来继续下一步。');
    addChat('pet', completionMessage());
  }else{
    timer.mode = 'focus';
    timer.remainingMs = FOCUS_MS;
    timer.durationMs = FOCUS_MS;
    if(shouldNotify) nativeNotify('休息结束', '回来看看当前任务。');
    addChat('pet', '休息结束。回来只看下一步就好。');
  }
  nativeVibrate(180);
  persist();
  render();
}

function completionMessage(){
  const task = activeTask();
  const step = nextStep(task);
  if(step) return `这颗番茄完成了。下一步可以继续：${step.text}`;
  if(task) return `这颗番茄完成了。「${task.title}」已经往前挪了一步。`;
  return '这颗番茄完成了。休息一下，再写下下一段目标。';
}

function recordPomodoro(){
  const key = todayKey();
  if(!state.stats.days) state.stats.days = {};
  const day = state.stats.days[key] || { pomos:0, minutes:0 };
  day.pomos += 1;
  day.minutes += 25;
  state.stats.days[key] = day;
}

function recordMood(mood){
  state.moods.push({ at:Date.now(), mood, task:activeTask()?.title || '' });
  state.moods = state.moods.slice(-80);
  persist();
  renderStats();
  toast('已记录');
}

function formatTime(ms){
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function lastNDays(n){
  const keys = [];
  const now = new Date();
  for(let i=n-1;i>=0;i--){
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    keys.push(todayKey(d));
  }
  return keys;
}

function sumLastDays(n){
  const days = state.stats.days || {};
  return lastNDays(n).reduce((sum, key) => sum + (days[key]?.pomos || 0), 0);
}

function streakDays(){
  const days = state.stats.days || {};
  let streak = 0;
  const now = new Date();
  for(let i=0;i<365;i++){
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    if((days[todayKey(d)]?.pomos || 0) > 0) streak += 1;
    else break;
  }
  return streak;
}

function switchView(name){
  $$('.view').forEach(view => view.classList.toggle('active', view.dataset.view === name));
  renderNav();
}

async function saveModelSettings(){
  config.provider = $('provider-segment').querySelector('.active')?.dataset.provider || 'anthropic';
  config.model = clampText($('model-input').value, 160);
  config.baseUrl = clampText($('base-url-input').value, 260);
  config.confirmedBaseUrl = $('confirm-base-url').checked;
  const key = $('api-key-input').value.trim();
  if(key && !bridge?.saveSecret?.('provider_api_key', key)){
    toast('API Key 保存失败');
    return;
  }
  $('api-key-input').value = '';
  persist();
  renderSettings();
  toast('模型设置已保存');
}

async function saveHermesSettings(){
  config.hermesEnabled = $('hermes-enabled').checked;
  config.hermesBaseUrl = clampText($('hermes-base-input').value, 260) || 'http://127.0.0.1:8642/v1';
  config.hermesModel = clampText($('hermes-model-input').value, 120) || 'hermes-agent';
  config.confirmedHermesUrl = $('confirm-hermes-url').checked;
  config.memoryEnabled = $('memory-enabled').checked;
  const key = $('hermes-key-input').value.trim();
  if(key && !bridge?.saveSecret?.('hermes_api_key', key)){
    toast('Hermes Key 保存失败');
    return;
  }
  $('hermes-key-input').value = '';
  persist();
  renderSettings();
  toast('Hermes 设置已保存');
}

function saveFeishu(){
  const webhook = $('feishu-webhook-input').value.trim();
  if(!webhook){
    toast('留空则继续使用已保存 Webhook');
    return;
  }
  if(!/^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\//.test(webhook)){
    toast('Webhook 格式不正确');
    return;
  }
  if(!bridge?.saveSecret?.('feishu_webhook', webhook)){
    toast('Webhook 保存失败');
    return;
  }
  $('feishu-webhook-input').value = '';
  renderSettings();
  toast('Webhook 已保存');
}

async function testFeishu(secretName = 'feishu_webhook', text){
  const msg = text || buildSupervisorText();
  const result = await callNative('sendFeishu', secretName, msg);
  if(result.success) toast('飞书测试已发送');
  else toast(result.error || '飞书发送失败');
}

function longTaskSecretName(id){
  return `long_task_webhook_${String(id || '').replace(/[^A-Za-z0-9_.:-]/g, '_')}`;
}

function buildSupervisorText(task = activeTask()){
  const step = nextStep(task);
  const lines = ['孬孬提醒：请回来汇报一下进度。'];
  if(task) lines.push(`当前任务：${task.title}`);
  if(step) lines.push(`下一步：${step.text}`);
  return lines.join('\n');
}

function addLongTask(title){
  const text = clampText(title, 60);
  if(!text) return;
  state.longTasks.unshift({
    id: uid('long'),
    title:text,
    goal:'',
    interval:1440,
    enabled:false,
    hasWebhook:false,
    createdAt:Date.now(),
    nextDueAt:0,
    lastSentAt:0,
  });
  persist();
  renderLongTasks();
}

function scheduleLongTaskReminder(task, delay){
  const safeDelay = Math.max(1000, delay);
  try{
    bridge?.scheduleReminder?.(
      `long:${task.id}`,
      `长远任务：${task.title}`,
      task.goal ? `${task.goal}\n\n请回来汇报进度。` : '请回来汇报进度。',
      safeDelay,
      task.interval * 60 * 1000
      );
  }catch{}
}

function rescheduleLongTask(task){
  const delay = task.interval * 60 * 1000;
  task.nextDueAt = Date.now() + delay;
  scheduleLongTaskReminder(task, delay);
}

function syncEnabledLongTaskReminders(tasks = state.longTasks){
  const now = Date.now();
  tasks.filter(task => task.enabled).forEach(task => {
    if(!task.nextDueAt || task.nextDueAt <= now) {
      rescheduleLongTask(task);
      return;
    }
    scheduleLongTaskReminder(task, task.nextDueAt - now);
  });
}

function scheduleLongTaskSync(task, delayMs = 800){
  if(!task || !task.enabled) return;
  clearTimeout(longTaskSyncTimers.get(task.id));
  const handle = setTimeout(() => {
    longTaskSyncTimers.delete(task.id);
    syncEnabledLongTaskReminders([task]);
    persist();
  }, delayMs);
  longTaskSyncTimers.set(task.id, handle);
}

function saveLongTaskWebhook(task, value){
  const webhook = String(value || '').trim();
  if(!webhook) return true;
  if(!/^https:\/\/open\.(feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\//.test(webhook)){
    toast('任务 Webhook 格式不正确');
    return false;
  }
  const ok = !!bridge?.saveSecret?.(longTaskSecretName(task.id), webhook);
  if(!ok){
    toast('任务 Webhook 保存失败');
    return false;
  }
  task.hasWebhook = true;
  return true;
}

function deleteLongTaskWebhookSecrets(tasks = state.longTasks){
  try{
    tasks.forEach(task => bridge?.deleteSecret?.(longTaskSecretName(task.id)));
  }catch{}
}

function exportData(){
  const payload = JSON.stringify({
    state,
    config: { ...config, confirmedBaseUrl:false, confirmedHermesUrl:false, secrets: bridge ? 'Android Keystore 中，未导出' : '不可用' },
    memory: loadJSON(MEMORY_KEY, []),
    exportedAt: new Date().toISOString(),
  }, null, 2);
  $('data-export').value = payload;
  if(bridge?.shareText?.('孬孬 Android 数据导出', payload)){
    toast('已打开系统分享');
  }else{
    toast('导出内容已生成');
  }
}

function normalizeMemory(raw){
  return Array.isArray(raw) ? raw.map(item => ({
    at: Number(item?.at) || Date.now(),
    text: clampText(item?.text, 240),
  })).filter(item => item.text).slice(-40) : [];
}

function importData(){
  const raw = $('data-export').value.trim();
  if(!raw){
    toast('请先粘贴导出的 JSON');
    return;
  }
  let parsed;
  try{
    parsed = JSON.parse(raw);
  }catch{
    toast('JSON 格式不正确');
    return;
  }
  if(!parsed || typeof parsed !== 'object' || !parsed.state){
    toast('不是孬孬 Android 导出数据');
    return;
  }
  confirmAction('导入数据', '导入会覆盖当前任务、统计、冰箱、对话和本地记忆，但不会恢复 API Key/Webhook。继续吗？', '导入', () => {
    cancelLocalReminders();
    deleteLongTaskWebhookSecrets();
    const importedState = normalizeState(parsed.state);
    syncEnabledLongTaskReminders(importedState.longTasks);
    saveJSON(STORAGE_KEY, importedState);
    saveJSON(CONFIG_KEY, normalizeImportedConfig(parsed.config));
    saveJSON(MEMORY_KEY, normalizeMemory(parsed.memory));
    toast('导入完成，正在刷新');
    setTimeout(() => location.reload(), 300);
  });
}

function clearData(){
  confirmAction('清空本地数据', '确定清空任务、统计、冰箱和对话吗？密钥也会从 Android Keystore 删除。', '清空', () => {
    cancelLocalReminders();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(MEMORY_KEY);
    deleteLongTaskWebhookSecrets();
    try{
      bridge?.deleteSecret?.('provider_api_key');
      bridge?.deleteSecret?.('feishu_webhook');
      bridge?.deleteSecret?.('hermes_api_key');
    }catch{}
    location.reload();
  });
}

function bindEvents(){
  $$('.bottom-nav button').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.target)));
  $('settings-shortcut').addEventListener('click', () => switchView('settings'));
  $('quick-task-add').addEventListener('click', () => {
    const task = addTask($('quick-task-input').value);
    if(task) $('quick-task-input').value = '';
  });
  $('quick-task-input').addEventListener('keydown', e => {
    if(e.key === 'Enter') $('quick-task-add').click();
  });
  $('task-add').addEventListener('click', () => {
    const task = addTask($('task-input').value);
    if(task) $('task-input').value = '';
  });
  $('task-input').addEventListener('keydown', e => {
    if(e.key === 'Enter') $('task-add').click();
  });
  $('task-done-btn').addEventListener('click', () => {
    const task = activeTask();
    if(!task) return;
    task.done = !task.done;
    persist();
    render();
  });
  $('task-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const id = btn.dataset.task;
    const task = state.tasks.find(t => t.id === id);
    if(btn.dataset.action === 'set-active' && task) state.activeId = id;
    if(btn.dataset.action === 'delete-task') state.tasks = state.tasks.filter(t => t.id !== id);
    if(btn.dataset.action === 'add-sub') {
      addSubtask(id, document.querySelector(`[data-sub-input="${escapeSelector(id)}"]`)?.value);
      return;
    }
    if(!state.tasks.some(t => t.id === state.activeId)) state.activeId = state.tasks[0]?.id || null;
    touchActivity();
    persist();
    render();
  });
  $('task-list').addEventListener('change', e => {
    const input = e.target;
    const action = input.dataset.action;
    if(action === 'task-done'){
      const task = state.tasks.find(t => t.id === input.dataset.task);
      if(task) task.done = input.checked;
    }
    if(action === 'toggle-sub'){
      const task = state.tasks.find(t => t.id === input.dataset.task);
      const sub = task?.subtasks.find(s => s.id === input.dataset.sub);
      if(sub) sub.done = input.checked;
    }
    touchActivity();
    persist();
    render();
  });
  $('chat-send').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', e => {
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendChat();
    }
  });
  $('chat-input').addEventListener('input', e => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 110) + 'px';
  });
  $('chat-clear').addEventListener('click', () => {
    state.chat = [];
    persist();
    renderChat();
  });
  $('android-pet').addEventListener('click', animatePet);
  $('android-pet').addEventListener('animationend', () => {
    $('android-pet').classList.remove('pet-bop');
  });
  $('body-double-toggle').addEventListener('click', () => {
    state.bodyDouble = !state.bodyDouble;
    nativeVibrate(35);
    persist();
    renderHome();
    animatePet();
  });
  $('timer-start').addEventListener('click', startOrPauseTimer);
  $('timer-reset').addEventListener('click', resetTimer);
  $('mood-row').addEventListener('click', e => {
    const btn = e.target.closest('button[data-mood]');
    if(btn) recordMood(btn.dataset.mood);
  });
  $('freezer-add').addEventListener('click', () => {
    addFreezer($('freezer-input').value);
    $('freezer-input').value = '';
  });
  $('freezer-input').addEventListener('keydown', e => {
    if(e.key === 'Enter') $('freezer-add').click();
  });
  $('freezer-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const item = state.freezer.find(x => x.id === btn.dataset.id);
    if(btn.dataset.action === 'freezer-task' && item){
      addTask(item.text);
      state.freezer = state.freezer.filter(x => x.id !== item.id);
      switchView('tasks');
    }
    if(btn.dataset.action === 'freezer-delete'){
      state.freezer = state.freezer.filter(x => x.id !== btn.dataset.id);
    }
    persist();
    render();
  });
  $('provider-segment').addEventListener('click', e => {
    const btn = e.target.closest('button[data-provider]');
    if(!btn) return;
    $$('#provider-segment button').forEach(item => item.classList.toggle('active', item === btn));
  });
  $('save-model-settings').addEventListener('click', saveModelSettings);
  $('save-hermes-settings').addEventListener('click', saveHermesSettings);
  $('review-memory').addEventListener('click', () => {
    const summary = summarizeMemory();
    showMessage('长期记忆', summary || '还没有沉淀出长期记忆。');
  });
  $('notifications-enabled').addEventListener('change', e => {
    if(e.target.checked && bridge?.ensureNotificationPermission && !bridge.ensureNotificationPermission()){
      e.target.checked = false;
      config.notificationsEnabled = false;
      persist();
      toast('请允许通知权限后再开启提醒');
      return;
    }
    config.notificationsEnabled = e.target.checked;
    if(!config.notificationsEnabled) cancelNativeTimerReminder();
    else scheduleNativeTimerReminder();
    persist();
  });
  $('idle-frequency').addEventListener('change', e => {
    config.idleFrequency = e.target.value;
    persist();
    scheduleIdleReminder();
  });
  $('save-feishu').addEventListener('click', saveFeishu);
  $('test-feishu').addEventListener('click', () => testFeishu());
  $('long-add').addEventListener('click', () => {
    addLongTask($('long-title-input').value);
    $('long-title-input').value = '';
  });
  $('long-task-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const task = state.longTasks.find(t => t.id === btn.dataset.id);
    if(btn.dataset.action === 'long-delete'){
      try{ bridge?.cancelReminder?.(`long:${btn.dataset.id}`); }catch{}
      try{ bridge?.deleteSecret?.(longTaskSecretName(btn.dataset.id)); }catch{}
      clearTimeout(longTaskSyncTimers.get(btn.dataset.id));
      longTaskSyncTimers.delete(btn.dataset.id);
      state.longTasks = state.longTasks.filter(t => t.id !== btn.dataset.id);
    }
    if(btn.dataset.action === 'long-test' && task){
      const secret = task.hasWebhook ? longTaskSecretName(task.id) : 'feishu_webhook';
      testFeishu(secret, `长远任务提醒：${task.title}\n${task.goal || '请回来汇报进度。'}`);
    }
    persist();
    renderLongTasks();
  });
  $('long-task-list').addEventListener('change', e => {
    const target = e.target;
    const task = state.longTasks.find(t => t.id === target.dataset.id);
    if(!task) return;
    if(target.dataset.action === 'long-webhook'){
      if(saveLongTaskWebhook(task, target.value)) {
        target.value = '';
        persist();
        renderLongTasks();
      }
    }
    if(target.dataset.action === 'long-toggle'){
      const webhookInput = document.querySelector(`[data-action="long-webhook"][data-id="${escapeSelector(task.id)}"]`);
      if(webhookInput && webhookInput.value.trim() && !saveLongTaskWebhook(task, webhookInput.value)){
        target.checked = false;
        return;
      }
      task.enabled = target.checked;
      if(task.enabled) rescheduleLongTask(task);
      else {
        task.nextDueAt = 0;
        try{ bridge?.cancelReminder?.(`long:${task.id}`); }catch{}
      }
    }
    if(target.dataset.action === 'long-interval'){
      task.interval = Math.max(1, Math.min(10080, Math.round(Number(target.value) || 1440)));
      if(task.enabled) rescheduleLongTask(task);
    }
    persist();
    renderLongTasks();
  });
  $('long-task-list').addEventListener('input', e => {
    const target = e.target;
    const task = state.longTasks.find(t => t.id === target.dataset.id);
    if(!task) return;
    if(target.dataset.action === 'long-goal') {
      task.goal = clampText(target.value, 220);
      scheduleLongTaskSync(task);
    }
    persist();
  });
  $('long-task-list').addEventListener('focusout', e => {
    const target = e.target;
    if(target.dataset.action !== 'long-goal') return;
    const task = state.longTasks.find(t => t.id === target.dataset.id);
    if(!task || !task.enabled) return;
    clearTimeout(longTaskSyncTimers.get(task.id));
    longTaskSyncTimers.delete(task.id);
    syncEnabledLongTaskReminders([task]);
    persist();
  });
  $('export-data').addEventListener('click', exportData);
  $('import-data').addEventListener('click', importData);
  $('clear-data').addEventListener('click', clearData);
  $('dialog-ok').addEventListener('click', () => closeDialog(true));
  $('dialog-cancel').addEventListener('click', () => closeDialog(false));
  $('app-dialog').addEventListener('click', e => {
    if(e.target.id === 'app-dialog') closeDialog(false);
  });
}

window.NAONAO = {
  onAndroidBack(){
    const active = document.querySelector('.view.active')?.dataset.view;
    if(active && active !== 'home'){
      switchView('home');
      return true;
    }
    return false;
  }
};

function init(){
  bindEvents();
  if(!state.chat.length) addChat('pet', '我在。写一个任务锚，我们从小步开始。');
  runTimerLoop();
  scheduleIdleReminder();
  syncEnabledLongTaskReminders();
  render();
}

init();
})();
