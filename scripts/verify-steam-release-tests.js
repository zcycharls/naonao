const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { normalizeArchiveEntries, verifySource, verifyDepot } = require('./verify-steam-release.js')
const { verifySubmission } = require('./verify-steam-submission.js')

assert.deepStrictEqual(normalizeArchiveEntries([
  '\\app\\steam-game.js',
  '\\steam-main.js',
  '/package.json',
]), [
  { comparePath: 'app/steam-game.js', extractPath: 'app\\steam-game.js' },
  { comparePath: 'package.json', extractPath: 'package.json' },
  { comparePath: 'steam-main.js', extractPath: 'steam-main.js' },
])

verifySource()

const missingDepot = path.join(os.tmpdir(), `naonao-missing-depot-${process.pid}`)
assert.throws(() => verifyDepot(missingDepot), /depot is missing/)

const fakeDepot = fs.mkdtempSync(path.join(os.tmpdir(), 'naonao-fake-depot-'))
try {
  fs.mkdirSync(path.join(fakeDepot, 'resources'), { recursive: true })
  fs.writeFileSync(path.join(fakeDepot, 'NaonaoFocusQuest.exe'), '')
  fs.writeFileSync(path.join(fakeDepot, 'resources', 'app.asar'), '')
  assert.throws(() => verifyDepot(fakeDepot), /unexpectedly small/)
} finally {
  fs.rmSync(fakeDepot, { recursive: true, force: true })
}

const submissionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'naonao-submission-'))
try {
  const steamDir = path.join(submissionRoot, 'steam')
  const scriptsDir = path.join(steamDir, 'scripts')
  fs.mkdirSync(scriptsDir, { recursive: true })
  fs.writeFileSync(path.join(scriptsDir, 'app_build_123.vdf'), `"AppBuild"\n{\n  "AppID" "123"\n  "Depots" { "456" "depot_build_456.vdf" }\n}\n`)
  fs.writeFileSync(path.join(scriptsDir, 'depot_build_456.vdf'), `"DepotBuildConfig"\n{\n  "DepotID" "456"\n}\n`)
  fs.writeFileSync(path.join(steamDir, 'submission.json'), JSON.stringify({
    publisherName: 'Naonao Studio',
    contact: 'https://naonao.test/support',
    privacyPolicyUrl: 'https://naonao.test/privacy',
    assetRightsConfirmed: true,
    aiDisclosureConfirmed: true,
    minimumRequirementsVerified: true,
    codeSigningDecision: 'steam-unsigned-approved',
  }))
  fs.writeFileSync(path.join(steamDir, 'privacy-policy-zh-CN.md'), '发行方名称：Naonao Studio\n联系渠道：https://naonao.test/support\n')
  const submission = verifySubmission(submissionRoot)
  assert.deepStrictEqual({ appId: submission.appId, depotId: submission.depotId }, { appId: '123', depotId: '456' })

  const metadataFile = path.join(steamDir, 'submission.json')
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
  fs.writeFileSync(metadataFile, JSON.stringify({ ...metadata, assetRightsConfirmed: false }))
  assert.throws(() => verifySubmission(submissionRoot), /rights must be confirmed/)
} finally {
  fs.rmSync(submissionRoot, { recursive: true, force: true })
}

console.log('steam release verifier tests passed')
