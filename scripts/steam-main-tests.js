const assert = require('assert/strict')
const fs = require('fs')
const http = require('http')
const https = require('https')
const os = require('os')
const path = require('path')
const Module = require('module')

const root = path.resolve(__dirname, '..')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'naonao-steam-main-test-'))
const originalLoad = Module._load

const TLS_PFX = Buffer.from('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', 'base64')
const TLS_CA = `-----BEGIN CERTIFICATE-----\n${'MIIDGzCCAgOgAwIBAgIQXQ+KL+VYyaxMt69I4loP0jANBgkqhkiG9w0BAQsFADAVMRMwEQYDVQQDDApib3VuZC50ZXN0MB4XDTIwMDEwMTAwMDAwMFoXDTQwMDEwMTAwMDAwMFowFTETMBEGA1UEAwwKYm91bmQudGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALpWtIF6PDOMRyNFUc/Naq9yLfrDed/IYm8FjqF1vWBNQuzMMn0KLNxPE8YKavUMkdp3iM41M7Ih6X2kdqrgUbg0M5eBnCZ+HOHXkEWtJ0OMAzS7lCe/HtFRPPdaEba12JCA9ti1lV/KPeEb+eqdfyDNDF5iYlHnag1daqaaGRhjZAqDiS/O5jxtajkk6D1i0hPFx1n7oeid/khQKJAroYgL0L3rtNDT9PHO16B0E8JJcQc2F88fEIiaJNnYKm3UpXhS7NnhKi1ZEg/DiFxNtmpFUtpfQPEIIaQnVo3Ksn/FwwLx2SUmYXLW9JsIUgpap6wdU2RRPf0NyZTNIxhbc7kCAwEAAaNnMGUwDgYDVR0PAQH/BAQDAgWgMB0GA1UdJQQWMBQGCCsGAQUFBwMCBggrBgEFBQcDATAVBgNVHREEDjAMggpib3VuZC50ZXN0MB0GA1UdDgQWBBR0QTOkqKpkUPwrFWDuG+EtfPpi8TANBgkqhkiG9w0BAQsFAAOCAQEApu/gwWcU/YnnCvW4nR2s1IyebV3JC9wUfBrL68jaqmlWKr6Bwg/qgH5Zk5gIuGG11HE6ZBLjM6Y6wyXNZIdqJiDBYRkAVDoEl82VYOo5qWhLjhqiSfppmQf8blVpLU8fv+eIugEuA5C+/SF8MTVnZTsvJJ7SvOmUZd8PmcLFGSfN7l4xOVF6DLg9lT8Tj7EZO1Kjw4Em6k+NoK6WIylVX4Ynwvg0iqNJi+SU4WiPJ6HSAB20P9XpXA4huXg78hSiuH+pbkxuUClebRR/yNQC9fS1pGhAhQSj5t+oVVuqaJVOjevNbxZpmrEoGqyHtohFiAHBab56fzsirG+zVfcOfw=='.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`

const electronMock = {
  app: {
    isPackaged: false,
    setName() {},
    setPath(name, value) {
      if (name === 'userData') this.userData = value
    },
    getPath(name) {
      if (name === 'userData') return this.userData || userData
      if (name === 'appData') return userData
      return userData
    },
    requestSingleInstanceLock: () => true,
    quit() {},
    on() {},
    whenReady: () => ({ then() {} }),
  },
  BrowserWindow: {
    fromWebContents: () => null,
  },
  ipcMain: {
    handle() {},
    on() {},
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => value.toString('utf8'),
  },
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }),
  },
}

Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') return electronMock
  return originalLoad.call(this, request, parent, isMain)
}

const Main = require('../steam-main.js')
const Engine = require('../app/js/steam-game-engine.js')
Module._load = originalLoad

async function testResponseLimits() {
  await assert.rejects(
    Main.responseJson(new Response('0123456789', { headers: { 'content-length': '10' } }), 5),
    /too large/i,
  )

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('1234'))
      controller.enqueue(Buffer.from('5678'))
      controller.close()
    },
  })
  await assert.rejects(Main.responseJson(new Response(stream), 5), /too large/i)
}

async function testBodyTimeout() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.flushHeaders()
    setTimeout(() => response.end('{"ok":true}'), 150)
  })
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()))
  const { port } = server.address()
  try {
    await assert.rejects(
      Main.fetchJsonWithTimeout(`http://127.0.0.1:${port}/slow`, {}, 30, 1024, { allowLoopback: true }),
      error => error?.name === 'AbortError',
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

async function testPinnedDnsConnectionAndRedirects() {
  const requests = []
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, host: request.headers.host })
    response.setHeader('content-type', 'application/json')
    if (request.url === '/redirect-safe') {
      response.writeHead(302, { location: '/final' })
      response.end()
      return
    }
    if (request.url === '/redirect-private') {
      response.writeHead(302, { location: `http://private.test:${server.address().port}/final` })
      response.end()
      return
    }
    response.end(JSON.stringify({ ok: true, url: request.url }))
  })
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()))
  const { port } = server.address()
  try {
    let calls = 0
    const rebindingLookup = async hostname => {
      calls += 1
      assert.equal(hostname, 'bound.test')
      return [{ address: calls === 1 ? '127.0.0.1' : '10.0.0.8', family: 4 }]
    }
    const direct = await Main.fetchJsonWithTimeout(
      `http://bound.test:${port}/direct`,
      {},
      1000,
      1024,
      { allowLoopback: true, lookup: rebindingLookup },
    )
    assert.equal(direct.body.ok, true)
    assert.equal(calls, 1, 'The socket must reuse the one validated DNS answer')
    assert.equal(requests.at(-1).host, `bound.test:${port}`)

    const redirectLookups = []
    const redirectLookup = async hostname => {
      redirectLookups.push(hostname)
      return [{ address: hostname === 'private.test' ? '10.0.0.9' : '127.0.0.1', family: 4 }]
    }
    await assert.rejects(
      Main.fetchJsonWithTimeout(
        `http://bound.test:${port}/redirect-safe`,
        { redirect: 'follow' },
        1000,
        1024,
        { allowLoopback: true, lookup: redirectLookup },
      ),
      /redirects are not allowed/i,
    )
    assert.deepEqual(redirectLookups, ['bound.test'])
    assert.equal(requests.some(request => request.url === '/final'), false)

    redirectLookups.length = 0
    await assert.rejects(
      Main.fetchJsonWithTimeout(
        `http://bound.test:${port}/redirect-private`,
        { redirect: 'follow' },
        1000,
        1024,
        { allowLoopback: true, lookup: redirectLookup },
      ),
      /redirects are not allowed/i,
    )
    assert.deepEqual(redirectLookups, ['bound.test'])
    assert.equal(requests.some(request => request.host?.startsWith('private.test')), false)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

async function testTlsHostnameVerification() {
  const requests = []
  const serverNames = []
  const server = https.createServer({ pfx: TLS_PFX, passphrase: 'naonao-test-only' }, (request, response) => {
    requests.push(request.headers.host)
    response.setHeader('content-type', 'application/json')
    response.end('{"secure":true}')
  })
  server.on('secureConnection', socket => serverNames.push(socket.servername))
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()))
  const { port } = server.address()
  const networkOptions = {
    allowLoopback: true,
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    ca: TLS_CA,
  }
  try {
    const response = await Main.fetchJsonWithTimeout(
      `https://bound.test:${port}/secure`,
      {},
      1000,
      1024,
      networkOptions,
    )
    assert.equal(response.body.secure, true)
    assert.equal(requests[0], `bound.test:${port}`)
    assert.equal(serverNames[0], 'bound.test')

    await assert.rejects(
      Main.fetchJsonWithTimeout(
        `https://wrong.test:${port}/secure`,
        {},
        1000,
        1024,
        networkOptions,
      ),
      error => error?.code === 'ERR_TLS_CERT_ALTNAME_INVALID',
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

function testPinnedTransportSource() {
  const source = fs.readFileSync(path.join(root, 'steam-main.js'), 'utf8')
  assert.match(source, /lookup:\s*createPinnedLookup/)
  assert.match(source, /const tlsServername = net\.isIP\(hostname\) \? '' : hostname/)
  assert.match(source, /servername:\s*tlsServername/)
  assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false/)
}

function testNetworkAddresses() {
  assert.equal(Main.classifyNetworkAddress('127.0.0.1'), 'loopback')
  assert.equal(Main.classifyNetworkAddress('10.0.0.1'), 'private')
  assert.equal(Main.classifyNetworkAddress('::1'), 'loopback')
  assert.equal(Main.classifyNetworkAddress('fc00::1'), 'private')
  assert.equal(Main.classifyNetworkAddress('fe80::1'), 'private')
  assert.equal(Main.classifyNetworkAddress('::ffff:127.0.0.1'), 'loopback')
  assert.equal(Main.classifyNetworkAddress('::ffff:10.0.0.1'), 'private')
  assert.equal(Main.classifyNetworkAddress('2606:4700:4700::1111'), 'public')
}

async function testDnsValidation() {
  const fakeLookup = async () => [
    { address: '203.0.113.10', family: 4 },
    { address: '::ffff:10.0.0.5', family: 6 },
  ]
  await assert.rejects(
    Main.validateNetworkTarget('https://models.example.test/v1', { lookup: fakeLookup }),
    /private network/i,
  )
}

function testModeGate() {
  const isolated = path.join(os.tmpdir(), 'naonao-steam-mode-test')
  assert.equal(Main.computeIsolatedTestRun({
    argv: ['NaonaoFocusQuest.exe', '--naonao-steam-test'],
    testUserData: isolated,
    temporaryRoot: os.tmpdir(),
  }), true)
  assert.equal(Main.computeTestMode({
    isPackaged: false,
    argv: ['electron', '.', '--naonao-steam-test'],
    testUserData: isolated,
    temporaryRoot: os.tmpdir(),
  }), true)
  assert.equal(Main.computeTestMode({
    isPackaged: true,
    argv: ['NaonaoFocusQuest.exe', '--naonao-steam-test'],
    testUserData: isolated,
    temporaryRoot: os.tmpdir(),
  }), false)
  assert.equal(Main.computeTestMode({
    isPackaged: false,
    argv: ['electron', '.', '--naonao-steam-test'],
    testUserData: path.join(root, 'real-user-data'),
    temporaryRoot: os.tmpdir(),
  }), false)

  const mainSource = fs.readFileSync(path.join(root, 'steam-main.js'), 'utf8')
  assert.match(mainSource, /if \(TEST_MODE\) \{\s*handle\('game:test-complete-run'/)
  assert.match(mainSource, /if \(ISOLATED_TEST_RUN\) \{\s*app\.setPath\('userData'/)
}

function testPartialConfigMerge() {
  const current = {
    version: 1,
    ai: {
      enabled: false,
      provider: 'hermes',
      baseUrl: 'http://127.0.0.1:8642/v1',
      model: 'hermes-agent',
      networkConsent: false,
      shareMemory: false,
    },
    feishu: { enabled: true, notifyFocus: true, notifyTask: false },
  }
  const next = Main.mergeIntegrationConfig(current, { ai: { enabled: true, shareMemory: true } })
  assert.equal(next.ai.enabled, true)
  assert.equal(next.ai.shareMemory, true)
  assert.deepEqual(next.feishu, current.feishu)
}

function testCompanionProjection() {
  const state = Engine.createDefaultState(new Date('2026-07-15T09:00:00+08:00'))
  state.tasks.push({ id: 'secret', text: 'private task' })
  const projected = Main.companionState(state)
  assert.deepEqual(Object.keys(projected).sort(), ['run', 'settings'])
  assert.deepEqual(Object.keys(projected.settings), ['focusMinutes'])
  assert.equal(Object.hasOwn(projected, 'tasks'), false)
  assert.equal(Object.hasOwn(projected, 'profile'), false)
}

function testSenderValidation() {
  const frame = { url: Main.GAME_PAGE_URL }
  const contents = { mainFrame: frame }
  const browserWindow = { isDestroyed: () => false, webContents: contents }
  assert.equal(Main.isTrustedSender({ sender: contents, senderFrame: frame }, browserWindow, Main.GAME_PAGE_URL), true)
  assert.equal(Main.isTrustedSender({ sender: contents, senderFrame: { url: Main.GAME_PAGE_URL } }, browserWindow, Main.GAME_PAGE_URL), false)
  assert.equal(Main.isTrustedSender({ sender: contents, senderFrame: frame }, browserWindow, Main.COMPANION_PAGE_URL), false)
}

function testRunCompletionEvent() {
  const run = { taskId: 'task-1', durationMinutes: 25 }
  assert.deepEqual(Main.runEvent({ completed: true }, 'run-paused', run), {
    type: 'run-completed',
    taskId: 'task-1',
    durationMinutes: 25,
  })
  assert.deepEqual(Main.runEvent({ completed: false }, 'run-paused', run), { type: 'run-paused' })
}

function testSaveRecoveryAndCommit() {
  electronMock.app.setPath('userData', userData)
  const at = new Date('2026-07-15T09:00:00+08:00')
  const state = Engine.createDefaultState(at)
  Main.writeState(state)

  const save = path.join(userData, 'focus-quest-save.json')
  const backup = `${save}.bak`
  assert.equal(fs.existsSync(save), true)
  assert.equal(fs.existsSync(backup), true)

  fs.writeFileSync(save, '{broken json', 'utf8')
  const recovered = Main.readState(at)
  assert.equal(recovered.profile.level, 1)
  assert.equal(fs.existsSync(`${save}.corrupt`), true)
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(save, 'utf8')))

  fs.writeFileSync(save, '{broken again', 'utf8')
  fs.writeFileSync(backup, '{broken backup', 'utf8')
  const defaulted = Main.readState(at)
  assert.equal(defaulted.tasks.length, 0)
  assert.equal(fs.existsSync(`${backup}.corrupt`), true)
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(backup, 'utf8')))

  const staleBackup = Engine.createDefaultState(at)
  staleBackup.profile.leaves = 99
  fs.rmSync(save)
  fs.writeFileSync(backup, `${JSON.stringify(staleBackup)}\n`, 'utf8')
  const resetAfterDeletion = Main.readState(at)
  assert.equal(resetAfterDeletion.profile.leaves, 0)
  assert.equal(JSON.parse(fs.readFileSync(backup, 'utf8')).profile.leaves, 0)

  const originalReadFileSync = fs.readFileSync
  fs.readFileSync = function failTransient(file, ...args) {
    if (path.resolve(String(file)) === path.resolve(save)) {
      const error = new Error('transient read failure')
      error.code = 'EACCES'
      throw error
    }
    return originalReadFileSync.call(this, file, ...args)
  }
  try {
    assert.throws(() => Main.readState(at), error => error?.code === 'EACCES')
  } finally {
    fs.readFileSync = originalReadFileSync
  }

  Main.setGameStateForTest(recovered)
  const candidate = JSON.parse(JSON.stringify(recovered))
  candidate.profile.leaves += 10
  const originalWriteFileSync = fs.writeFileSync
  fs.writeFileSync = function failSave(file, ...args) {
    if (String(file).includes('focus-quest-save.json.tmp')) {
      const error = new Error('disk full')
      error.code = 'ENOSPC'
      throw error
    }
    return originalWriteFileSync.call(this, file, ...args)
  }
  try {
    const originalConsoleError = console.error
    console.error = () => {}
    try {
      const result = Main.applyResult({ state: candidate })
      assert.match(result.error, /save failed/i)
      assert.equal(Main.getGameStateForTest().profile.leaves, recovered.profile.leaves)
    } finally {
      console.error = originalConsoleError
    }
  } finally {
    fs.writeFileSync = originalWriteFileSync
  }
}

function testCompanionPreloadSurface() {
  const companionPreload = fs.readFileSync(path.join(root, 'steam-companion-preload.js'), 'utf8')
  for (const forbidden of ['integration:', 'director:', 'game:cancel-run', 'game:complete-task', 'game:test-complete-run']) {
    assert.equal(companionPreload.includes(forbidden), false, `Companion preload exposes ${forbidden}`)
  }
}

async function main() {
  try {
    testModeGate()
    testNetworkAddresses()
    await testDnsValidation()
    await testPinnedDnsConnectionAndRedirects()
    await testTlsHostnameVerification()
    testPinnedTransportSource()
    await testResponseLimits()
    await testBodyTimeout()
    testPartialConfigMerge()
    testCompanionProjection()
    testSenderValidation()
    testRunCompletionEvent()
    testSaveRecoveryAndCommit()
    testCompanionPreloadSurface()
    console.log('steam main-process tests passed')
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
