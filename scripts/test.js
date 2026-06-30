const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.strictEqual(
    result.status,
    0,
    `${process.execPath} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`
  )
  return result.stdout.trim()
}

function assertScriptOrder(file, expected) {
  const html = fs.readFileSync(path.join(root, file), 'utf8')
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map(match => match[1])
  assert.deepStrictEqual(scripts.slice(-expected.length), expected, `${file} script order changed`)
}

function assertCSP(file) {
  const html = fs.readFileSync(path.join(root, file), 'utf8')
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)
  assert.ok(csp, `${file} must define a Content-Security-Policy`)
  assert.match(csp[1], /script-src 'self'/, `${file} must load scripts from self only`)
  assert.ok(!csp[1].includes("'unsafe-inline'") || !/script-src[^;]*'unsafe-inline'/.test(csp[1]), `${file} script-src must not allow unsafe-inline`)
  assert.ok(!/script-src[^;]*https:/.test(csp[1]), `${file} script-src must not allow remote scripts`)
}

function assertContains(file, expected) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  for (const item of expected) {
    assert.ok(text.includes(item), `${file} must contain ${item}`)
  }
}

function assertNotContains(file, unexpected) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  for (const item of unexpected) {
    assert.ok(!text.includes(item), `${file} must not contain ${item}`)
  }
}

const pkg = readJSON('package.json')
const lock = readJSON('package-lock.json')

assert.match(pkg.version, semverPattern, 'package.json version must be SemVer numeric identifiers without leading zeroes')
assert.strictEqual(lock.version, pkg.version, 'package-lock.json top-level version must match package.json')
assert.strictEqual(lock.packages[''].version, pkg.version, 'package-lock root package version must match package.json')

assertScriptOrder('app/index.html', [
  'js/pet-dialog.js',
  'js/provider-defaults.js',
  'js/fallback-data.js',
  'js/local-model.js',
  'app.js',
])
const providerDefaults = require(path.join(root, 'app/js/provider-defaults.js'))
assert.deepStrictEqual(providerDefaults.DEFAULT_MODEL, {
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o-mini',
})
assertNotContains('app/js/fallback-data.js', ['claude-haiku-4-5-20251001', "openai:'gpt-4o'"])
assertCSP('app/index.html')
assertContains('app/index.html', ['id="feishu-enabled"', 'id="feishu-webhook"', 'id="feishu-interval"', 'min="1"', '每隔多少分钟提醒一次', 'id="feishu-app-id"', 'id="feishu-app-secret"'])
assertContains('app/index.html', ['长远任务监督', 'id="tray-long-tasks"', 'id="lt-page-panel"', 'id="long-task-add-btn"', 'id="long-task-list"', 'id="long-task-status"', 'id="long-task-save-btn"'])
assertContains('app/index.html', ['id="pet-size-handle"', 'class="pet-size-handle"', 'aria-label="调整宠物大小"'])
assertNotContains('app/index.html', ['id="tray-size-down"', 'id="tray-size-up"', 'aria-label="缩小宠物"', 'aria-label="放大宠物"'])
assertContains('app/index.html', ['id="hermes-agent-enabled"', 'id="hermes-agent-base"', 'id="hermes-agent-key"', 'id="hermes-agent-test-btn"', 'Hermes Agent（官方 sidecar）', 'id="hermes-enabled"', '本地记忆 fallback', '查看记忆摘要', '清空记忆'])
assertNotContains('app/index.html', ['corsproxy.io', '浏览器版本', '网页版仍'])
assertContains('preload.js', ['notifyConfigChanged', 'onConfigChanged', 'config:changed', 'setPetSize', 'setPetShape', 'startPetDrag', 'movePetDrag', 'endPetDrag', 'openLongTasks', 'open-long-tasks', 'hasSecret', 'chatProvider', 'ai:chat', 'configureFeishuSupervisor', 'feishuSupervisorStatus', 'testFeishuSupervisor', 'onFeishuSupervisorStatus', 'configureLongTaskSupervisor', 'longTaskSupervisorStatus', 'testLongTaskSupervisor', 'onLongTaskSupervisorStatus', 'hasHermesApiKey', 'setHermesApiKey', 'testHermesAgent', 'chatHermesAgent', 'hasLongTaskWebhook', 'setLongTaskWebhook', 'sendLongTaskFeishu'])
assertNotContains('preload.js', ['getSecret', 'getFeishuWebhook', 'getLongTaskWebhook', 'getFeishuAppSecret', 'getHermesApiKey'])
assertContains('main.js', ['config:changed', 'workArea', 'const W = workArea.width, H = workArea.height', 'x: workArea.x', 'y: workArea.y', 'screen.getCursorScreenPoint', 'petDragTimer', 'setInterval(movePetWindowToCursor, 16)', 'stopPetDragTimer', 'applyPetWindowShape', 'cursor.x - petDragAnchor.dx', 'cursor.y - petDragAnchor.dy', 'petWindowShape = shape', 'pet:drag-start', 'pet:drag-move', 'pet:drag-end', 'pet:shape:set', 'win.setHasShadow(false)', 'pet:size:set', 'lockWindowSize', 'setMinimumSize', 'setMaximumSize', 'will-resize', 'restoreSize', 'longTasksWin', 'open-long-tasks', "mode: 'long-tasks'", 'secret:has', 'ai:chat', 'normalizeOpenAIBaseUrl', 'PROVIDER_MAX_TEXT', 'FEISHU_SUPERVISOR_FILE', 'configureFeishuSupervisor', 'restoreFeishuSupervisor', 'runFeishuSupervisorTick', 'feishu:supervisor:configure', 'feishu:supervisor:status', 'feishu:supervisor:test', 'feishu:supervisor-status', 'LONG_TASK_SUPERVISOR_FILE', 'configureLongTaskSupervisor', 'restoreLongTaskSupervisor', 'runLongTaskSupervisorTick', 'feishu:long-task-supervisor:configure', 'feishu:long-task-supervisor:status', 'feishu:long-task-supervisor:test', 'feishu:long-task-supervisor-status', 'LONG_TASK_WEBHOOKS_FILE', 'feishu:long-task-webhook:has', 'feishu:long-task-webhook:set', 'feishu:long-task-send', 'sendFeishuWebhookMessage', 'hermes:api-key:has', 'hermes:api-key:set', 'hermes:test', 'hermes:chat', "require('./app/js/provider-defaults.js')", 'MODEL_REVISION', 'MODEL_REQUIRED_FILES', 'verifyLocalModelFiles', 'sha256File', 'model integrity check failed', '068cad70fa3850652e6ebc0ad7a49847568f32e6eda5a8527e5893de9a7b8939', 'const PET_MIN_SCALE = 0.35'])
assertNotContains('main.js', ["ipcMain.handle('secret:get'"])
assertContains('main.js', ["backgroundColor: '#00000000'", "win.setBackgroundColor('#00000000')"])
assertNotContains('main.js', ["backgroundColor: '#00000001'"])
assertNotContains('main.js', ['win.setShape('])
assertContains('app/app.js', ['applyExternalConfigUpdate', 'buildFeishuSupervisorConfig', 'getFeishuSupervisorTaskSnapshot', 'scheduleFeishuSupervisorSync', 'configureFeishuSupervisor', 'testFeishuSupervisor', 'onFeishuSupervisorStatus', 'Feishu supervisor moved to main'])
assertNotContains('app/app.js', ['if(cfg.feishuEnabled) await sendFeishuSupervisorCheckin(false)'])
assertContains('app/app.js', ["'naonao_freezer':'nono_freezer'", "localStorage.getItem('nono_fz')", "localStorage.setItem('nono_freezer',legacyFreezer)", 'hasFeishuWebhook', 'hasFeishuAppSecret', 'hasHermesApiKey', 'hasLongTaskWebhook'])
assertNotContains('app/app.js', ['window.petBridge.getFeishuWebhook', 'window.petBridge.getLongTaskWebhook', 'window.petBridge.getFeishuAppSecret', 'window.petBridge.getHermesApiKey', 'corsproxy.io'])
assertContains('app/app.js', ['transparent work-area overlay', 'PET_SIZE_KEY', 'PET_POS_KEY', 'const PET_SIZE_MIN=.35', 'applyPetSize', 'applyPetPosition', 'dragStartPos', 'setPetShape', 'if(dragging) return', 'getPetEffectPoint', '__nonoPetEffectPoint', 'pausePetAnimations', 'resumePetAnimations', 'requestPetShapeSync', "document.documentElement.classList.add('pet-mode-html')", "pw.classList.add('dragging')", "pw.classList.remove('dragging')", 'miniBubbleNode.classList.toggle', 'petWrap.appendChild', 'computeAlphaBounds', 'syncPetAnchors', '__nonoPetVisibleRect', 'hoverPad', 'underlying app', 'bubbleGap', 'pet-size-handle', 'resizingPet', 'cyclePetSize', '--pet-size-left', '--pet-size-top', 'hasApiKey', 'refreshProviderKeyState', 'saveProviderApiKeyIfNeeded', 'chatProvider', 'IS_LONG_TASKS_WIN', 'longTaskSaveBtn', 'saveLongTaskSettings', 'openLongTasks', 'LONG_TASK_MAX', 'normalizeLongTasks', 'renderLongTaskSettings', 'saveLongTaskWebhooks', 'buildLongTaskCheckinText', 'buildLongTaskSupervisorConfig', 'applyLongTaskSupervisorState', 'configureLongTaskSupervisor', 'testLongTaskSupervisor', 'onLongTaskSupervisorStatus', 'Long task supervisor moved to main', 'restartLongTaskSupervisor', 'sendLongTaskCheckin', 'HERMES_MEMORY_KEY', 'HERMES_SENSITIVE_RE', 'buildHermesSystemPrompt', 'learnHermesFromText', 'buildHermesLocalPrompt', 'normalizeHermesAgentBaseUrl', 'requestHermesAgentReply', 'streamHermesAgent'])
assertNotContains('app/app.js', ['tickLongTaskSupervisor', 'setInterval(()=>tickLongTaskSupervisor'])
assertNotContains('app/app.js', ['window.petBridge.getSecret'])
assertContains('app/styles.css', ['html.pet-mode-html', 'background-image:none !important', 'body.pet-mode *', 'cursor:default !important', '#pw.dragging{cursor:default}', 'body.chat-only-mode #dlg-header{cursor:default', '#s-header-drag:active,#lt-header-drag:active{cursor:default}', 'body.chat-only-mode', 'width:380px', 'right:auto !important', 'width:356px !important', 'body.pet-mode #pw:not(.jumping) .pet-img-wrap', 'body.pet-mode #pw.jumping .pet-img-wrap', '#mini-bubble.left-side::after', 'left:var(--pet-left, 60vw) !important', 'top:var(--pet-top, 50vh) !important', 'body.pet-mode #pw .pet-sway-wrap', 'body.pet-mode #pw #pet-img', 'left:calc(18px * var(--pet-size-scale, 1))', '--pet-size-scale', '--pet-tray-left', '--pet-tray-top', '--pet-size-left', '--pet-size-top', '--pet-bubble-left', '--pet-bubble-top', '.pet-size-handle', '#pet-size-handle', 'nwse-resize', 'long-tasks-only-mode', '#lt-page-panel', '#long-task-save-btn', '.long-task-panel', '.lt-card', '.lt-grid', '.tray-btn:disabled'])
assertNotContains('app/styles.css', ['cursor:grab', 'cursor:grabbing'])
assertNotContains('app/styles.css', ['#pw.dragging #pet-img{\n  transform:none'])

for (const file of [
  'main.js',
  'preload.js',
  'app/app.js',
  'app/js/pet-dialog.js',
  'app/js/fallback-data.js',
  'app/js/local-model.js',
  'scripts/start-electron.js',
  'scripts/bump-version.js',
  'scripts/electron-smoke.js',
]) {
  runNode(['--check', file])
}

const dryRun = runNode(['scripts/bump-version.js', '--dry-run', '--now=2026-05-21T09:07:00+08:00'])
assert.match(dryRun, /1\.521\.907$/, 'version:bump dry-run should strip leading zeroes')

console.log('basic tests passed')
