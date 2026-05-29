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
assertContains('app/index.html', ['id="feishu-enabled"', 'id="feishu-webhook"', 'id="feishu-interval"', 'id="feishu-app-id"', 'id="feishu-app-secret"'])
assertContains('index.html', ['id="feishu-enabled"', 'id="feishu-webhook"', 'id="feishu-interval"', 'id="feishu-app-id"', 'id="feishu-app-secret"'])

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
