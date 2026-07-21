const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function readJson(file) {
  assert.ok(fs.existsSync(file), `Steam submission metadata is missing: ${file}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function oneVdf(directory, prefix) {
  const matches = fs.readdirSync(directory)
    .filter(name => name.startsWith(prefix) && name.endsWith('.vdf') && !name.endsWith('.example'))
  assert.strictEqual(matches.length, 1, `Expected exactly one ${prefix}*.vdf file, found ${matches.length}`)
  return matches[0]
}

function numericField(source, name) {
  const match = source.match(new RegExp(`"${name}"\\s+"(\\d+)"`, 'i'))
  assert.ok(match, `${name} must be a numeric Steamworks ID`)
  return match[1]
}

function verifySubmission(base = root) {
  const steamDir = path.join(base, 'steam')
  const scriptsDir = path.join(steamDir, 'scripts')
  const metadata = readJson(path.join(steamDir, 'submission.json'))
  const appVdfName = oneVdf(scriptsDir, 'app_build_')
  const depotVdfName = oneVdf(scriptsDir, 'depot_build_')
  const appVdf = fs.readFileSync(path.join(scriptsDir, appVdfName), 'utf8')
  const depotVdf = fs.readFileSync(path.join(scriptsDir, depotVdfName), 'utf8')

  assert.ok(!/YOUR_|CHANGE_ME|EXAMPLE/i.test(`${appVdf}\n${depotVdf}`), 'Steam VDF files still contain placeholders')
  const appId = numericField(appVdf, 'AppID')
  const depotId = numericField(depotVdf, 'DepotID')
  assert.ok(appVdf.includes(`"${depotId}" "${depotVdfName}"`), 'App VDF does not reference the configured depot VDF')

  assert.ok(typeof metadata.publisherName === 'string' && metadata.publisherName.trim().length >= 2, 'publisherName is required')
  const contact = String(metadata.contact || '')
  assert.ok(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || /^https:\/\/[^\s]+$/i.test(contact), 'contact must be an email address or public HTTPS URL')
  assert.match(String(metadata.privacyPolicyUrl || ''), /^https:\/\/[^\s]+$/i, 'privacyPolicyUrl must be a public HTTPS URL')
  assert.strictEqual(metadata.assetRightsConfirmed, true, 'Asset commercial rights must be confirmed')
  assert.strictEqual(metadata.aiDisclosureConfirmed, true, 'Generated AI disclosure must be confirmed')
  assert.strictEqual(metadata.minimumRequirementsVerified, true, 'Minimum system requirements must be verified on target hardware')
  assert.ok(['signed', 'steam-unsigned-approved'].includes(metadata.codeSigningDecision), 'codeSigningDecision must be signed or steam-unsigned-approved')

  const privacy = fs.readFileSync(path.join(steamDir, 'privacy-policy-zh-CN.md'), 'utf8')
  assert.ok(!/待发行方填写|待填写/.test(privacy), 'Privacy policy still contains publisher placeholders')
  assert.ok(privacy.includes(metadata.publisherName.trim()), 'Privacy policy does not contain publisherName')
  assert.ok(privacy.includes(contact.trim()), 'Privacy policy does not contain the configured contact')

  return { appId, depotId, metadata }
}

if (require.main === module) {
  const result = verifySubmission()
  console.log(`steam submission verification passed for AppID ${result.appId}, DepotID ${result.depotId}`)
}

module.exports = { verifySubmission }
