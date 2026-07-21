const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const asar = require('@electron/asar')

const root = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const expectedFiles = [
  'steam-main.js',
  'steam-preload.js',
  'steam-companion-preload.js',
  'app/steam-game.html',
  'app/steam-game.css',
  'app/steam-game.js',
  'app/steam-companion.html',
  'app/steam-companion.css',
  'app/steam-companion.js',
  'app/js/steam-game-engine.js',
  'app/js/steam-director-engine.js',
  'app/assets/naonao-pet.png',
  'app/assets/hat.png',
  'app/assets/metal-brushed-light.png',
  'app/assets/metal-brushed-dark.png',
]

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex')
}

function normalizeArchiveEntries(files) {
  return files
    .map(file => {
      const extractPath = String(file).replace(/^[/\\]/, '')
      return { comparePath: extractPath.replaceAll('\\', '/'), extractPath }
    })
    .filter(entry => path.posix.extname(entry.comparePath))
    .sort((left, right) => left.comparePath < right.comparePath ? -1 : left.comparePath > right.comparePath ? 1 : 0)
}

function verifySource() {
  const rendererFiles = expectedFiles.filter(file => /^app\/steam-.*\.(?:js|html)$/.test(file))
  const forbiddenClientDependencyImport = /(?:require\s*\(\s*['"](?:@larksuite|onnx|@xenova)|from\s+['"](?:@larksuite|onnx|@xenova))/i

  assert.strictEqual(packageJson.main, 'steam-main.js')
  assert.strictEqual(packageJson.build.productName, 'Naonao Focus Quest')
  assert.deepStrictEqual(packageJson.dependencies, {})
  assert.deepStrictEqual(packageJson.build.files, expectedFiles)
  assert.deepStrictEqual(packageJson.build.electronLanguages, ['zh-CN', 'en-US'])
  assert.ok(!packageJson.build.nsis, 'Steam build must not contain NSIS configuration')

  for (const file of expectedFiles) {
    assert.ok(fs.existsSync(path.join(root, file)), `Missing Steam build file: ${file}`)
  }

  for (const file of rendererFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\b/.test(source), `${file} contains forbidden network API`)
  }

  for (const file of expectedFiles.filter(file => file.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.ok(!forbiddenClientDependencyImport.test(source), `${file} imports an excluded original-client dependency`)
  }

  const mainSource = fs.readFileSync(path.join(root, 'steam-main.js'), 'utf8')
  assert.ok(mainSource.includes('safeStorage'), 'Integration secrets must use Electron safeStorage')
  assert.ok(mainSource.includes('lookup: createPinnedLookup'), 'Integration requests must pin validated DNS results')
  assert.ok(mainSource.includes("throw new TypeError('Redirects are not allowed')"), 'Integration requests must reject redirects')
  assert.ok(mainSource.includes("setAppUserModelId('help.naonao.focusquest')"), 'Windows AppUserModelID must match the package appId')

  for (const htmlFile of ['app/steam-game.html', 'app/steam-companion.html']) {
    const html = fs.readFileSync(path.join(root, htmlFile), 'utf8')
    assert.ok(html.includes("connect-src 'none'"), `${htmlFile} CSP must deny renderer connections`)
  }
  assert.ok(fs.statSync(path.join(root, 'app', 'assets', 'naonao-pet.png')).size > 100000, 'Pet asset looks incomplete')
}

function verifyDepot(depot = path.join(root, 'dist', 'steam', 'win-unpacked')) {
  assert.ok(fs.existsSync(depot), `Steam depot is missing: ${depot}`)

  const executable = path.join(depot, 'NaonaoFocusQuest.exe')
  const archive = path.join(depot, 'resources', 'app.asar')
  const requiredRuntimeFiles = [
    [executable, 10 * 1024 * 1024],
    [archive, 100 * 1024],
    [path.join(depot, 'LICENSE.electron.txt'), 100],
    [path.join(depot, 'LICENSES.chromium.html'), 1000],
  ]
  for (const [file, minimumBytes] of requiredRuntimeFiles) {
    assert.ok(fs.existsSync(file), `Packaged runtime file is missing: ${file}`)
    assert.ok(fs.statSync(file).size >= minimumBytes, `Packaged runtime file is unexpectedly small: ${file}`)
  }

  const forbiddenTopLevel = ['naonao.exe', '孬孬.exe']
  forbiddenTopLevel.forEach(name => assert.ok(!fs.existsSync(path.join(depot, name)), `Unexpected original client executable: ${name}`))

  const packagedEntries = normalizeArchiveEntries(asar.listPackage(archive))
  const packagedFiles = packagedEntries.map(entry => entry.comparePath)
  const expectedArchiveFiles = [...expectedFiles, 'package.json'].sort()
  assert.deepStrictEqual(packagedFiles, expectedArchiveFiles, 'Packaged ASAR file set does not match the Steam allowlist')
  const extractPaths = new Map(packagedEntries.map(entry => [entry.comparePath, entry.extractPath]))

  for (const file of expectedFiles) {
    const source = fs.readFileSync(path.join(root, file))
    const packaged = asar.extractFile(archive, extractPaths.get(file))
    assert.strictEqual(sha256(packaged), sha256(source), `Packaged file is stale or modified: ${file}`)
  }

  const packagedManifest = JSON.parse(asar.extractFile(archive, extractPaths.get('package.json')).toString('utf8'))
  assert.strictEqual(packagedManifest.name, packageJson.name)
  assert.strictEqual(packagedManifest.version, packageJson.version)
  assert.strictEqual(packagedManifest.main, packageJson.main)
}

function main() {
  verifySource()
  if (process.argv.includes('--source-only')) {
    console.log('steam source verification passed')
    return
  }
  verifyDepot()
  console.log('steam release verification passed')
}

if (require.main === module) main()

module.exports = { expectedFiles, normalizeArchiveEntries, verifySource, verifyDepot }
