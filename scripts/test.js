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
  'js/fallback-data.js',
  'js/local-model.js',
  'app.js',
])
assertScriptOrder('index.html', [
  'app/js/pet-dialog.js',
  'app/js/fallback-data.js',
  'app/js/local-model.js',
  'app/app.js',
])
assertCSP('app/index.html')
assertCSP('index.html')
assertContains('app/index.html', ['id="feishu-enabled"', 'id="feishu-webhook"', 'id="feishu-interval"', 'min="1"', '每隔多少分钟提醒一次', 'id="feishu-app-id"', 'id="feishu-app-secret"'])
assertContains('index.html', ['id="feishu-enabled"', 'id="feishu-webhook"', 'id="feishu-interval"', 'min="1"', '每隔多少分钟提醒一次', 'id="feishu-app-id"', 'id="feishu-app-secret"'])
assertContains('app/index.html', ['长远任务监督', 'id="long-task-add-btn"', 'id="long-task-list"', 'id="long-task-status"'])
assertContains('index.html', ['长远任务监督', 'id="long-task-add-btn"', 'id="long-task-list"', 'id="long-task-status"'])
assertContains('app/index.html', ['id="pet-size-handle"', 'class="pet-size-handle"', 'aria-label="调整宠物大小"'])
assertContains('index.html', ['id="pet-size-handle"', 'class="pet-size-handle"', 'aria-label="调整宠物大小"'])
assertNotContains('app/index.html', ['id="tray-size-down"', 'id="tray-size-up"', 'aria-label="缩小宠物"', 'aria-label="放大宠物"'])
assertNotContains('index.html', ['id="tray-size-down"', 'id="tray-size-up"', 'aria-label="缩小宠物"', 'aria-label="放大宠物"'])
assertContains('app/index.html', ['id="hermes-agent-enabled"', 'id="hermes-agent-base"', 'id="hermes-agent-key"', 'id="hermes-agent-test-btn"', 'Hermes Agent（官方 sidecar）', 'id="hermes-enabled"', '本地记忆 fallback', '查看记忆摘要', '清空记忆'])
assertContains('index.html', ['id="hermes-agent-enabled"', 'id="hermes-agent-base"', 'id="hermes-agent-key"', 'id="hermes-agent-test-btn"', 'Hermes Agent（官方 sidecar）', 'id="hermes-enabled"', '本地记忆 fallback', '查看记忆摘要', '清空记忆'])
assertContains('preload.js', ['notifyConfigChanged', 'onConfigChanged', 'config:changed', 'setPetSize', 'setPetShape', 'startPetDrag', 'movePetDrag', 'endPetDrag', 'getHermesApiKey', 'setHermesApiKey', 'testHermesAgent', 'chatHermesAgent', 'getLongTaskWebhook', 'setLongTaskWebhook', 'sendLongTaskFeishu'])
assertContains('main.js', ['config:changed', 'workArea', 'const W = workArea.width, H = workArea.height', 'x: workArea.x', 'y: workArea.y', 'screen.getCursorScreenPoint', 'petDragTimer', 'setInterval(movePetWindowToCursor, 16)', 'stopPetDragTimer', 'applyPetWindowShape', 'cursor.x - petDragAnchor.dx', 'cursor.y - petDragAnchor.dy', 'petWindowShape = shape', 'pet:drag-start', 'pet:drag-move', 'pet:drag-end', 'pet:shape:set', 'win.setHasShadow(false)', 'pet:size:set', 'HERMES_API_KEY_FILE', 'LONG_TASK_WEBHOOKS_FILE', 'feishu:long-task-webhook:get', 'feishu:long-task-webhook:set', 'feishu:long-task-send', 'sendFeishuWebhookMessage', 'hermes:api-key:get', 'hermes:api-key:set', 'hermes:test', 'hermes:chat'])
assertContains('main.js', ["backgroundColor: '#00000000'", "win.setBackgroundColor('#00000000')"])
assertNotContains('main.js', ["backgroundColor: '#00000001'"])
assertNotContains('main.js', ['win.setShape('])
assertContains('app/app.js', ['applyExternalConfigUpdate', '飞书监督计时器已启动', 'if(cfg.feishuEnabled) await sendFeishuSupervisorCheckin(false)'])
assertContains('app/app.js', ['transparent work-area overlay', 'PET_SIZE_KEY', 'PET_POS_KEY', 'applyPetSize', 'applyPetPosition', 'dragStartPos', 'setPetShape', 'if(dragging) return', 'getPetEffectPoint', '__nonoPetEffectPoint', 'pausePetAnimations', 'resumePetAnimations', 'requestPetShapeSync', "document.documentElement.classList.add('pet-mode-html')", "pw.classList.add('dragging')", "pw.classList.remove('dragging')", 'miniBubbleNode.classList.toggle', 'petWrap.appendChild', 'computeAlphaBounds', 'syncPetAnchors', '__nonoPetVisibleRect', 'pet-size-handle', 'resizingPet', 'cyclePetSize', '--pet-size-left', '--pet-size-top', 'LONG_TASK_MAX', 'normalizeLongTasks', 'renderLongTaskSettings', 'saveLongTaskWebhooks', 'buildLongTaskCheckinText', 'restartLongTaskSupervisor', 'sendLongTaskCheckin', 'HERMES_MEMORY_KEY', 'HERMES_SENSITIVE_RE', 'buildHermesSystemPrompt', 'learnHermesFromText', 'buildHermesLocalPrompt', 'normalizeHermesAgentBaseUrl', 'requestHermesAgentReply', 'streamHermesAgent'])
assertContains('app/styles.css', ['html.pet-mode-html', 'background-image:none !important', '#pw.dragging{cursor:grabbing}', 'body.pet-mode #pw:not(.jumping) .pet-img-wrap', 'body.pet-mode #pw.jumping .pet-img-wrap', '#mini-bubble.left-side::after', 'left:var(--pet-left, 60vw) !important', 'top:var(--pet-top, 50vh) !important', 'body.pet-mode #pw .pet-sway-wrap', 'body.pet-mode #pw #pet-img', 'left:calc(18px * var(--pet-size-scale, 1))', '--pet-size-scale', '--pet-tray-left', '--pet-tray-top', '--pet-size-left', '--pet-size-top', '--pet-bubble-left', '--pet-bubble-top', '.pet-size-handle', '#pet-size-handle', 'nwse-resize', '.long-task-panel', '.lt-card', '.lt-grid', '.tray-btn:disabled'])
assertNotContains('app/styles.css', ['#pw.dragging #pet-img{\n  transform:none'])

for (const file of [
  'main.js',
  'preload.js',
  'app/app.js',
  'app/js/pet-dialog.js',
  'app/js/fallback-data.js',
  'app/js/local-model.js',
  'scripts/bump-version.js',
  'scripts/electron-smoke.js',
]) {
  runNode(['--check', file])
}

const dryRun = runNode(['scripts/bump-version.js', '--dry-run', '--now=2026-05-21T09:07:00+08:00'])
assert.match(dryRun, /1\.521\.907$/, 'version:bump dry-run should strip leading zeroes')

console.log('basic tests passed')
