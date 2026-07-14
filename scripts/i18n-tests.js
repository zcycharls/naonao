const assert = require('assert')
const path = require('path')

const root = path.resolve(__dirname, '..')
const i18n = require(path.join(root, 'app/js/i18n.js'))

const expectedLocales = ['en', 'fr', 'es', 'de', 'ja', 'ko', 'zh-Hant', 'zh-CN']
assert.deepStrictEqual(i18n.SUPPORTED_LOCALES, expectedLocales)

for (const locale of expectedLocales) {
  const bundle = require(path.join(root, `app/js/locales/${locale}.js`))
  assert.strictEqual(bundle.locale, locale)
  i18n.registerLocale(bundle)
}

const baseKeys = Object.keys(i18n.getBundle('zh-CN').messages).sort()
const baseKeySet = new Set(baseKeys)
assert.ok(baseKeys.length >= 100, 'the locale catalog must cover the primary UI')

function placeholders(message) {
  return [...String(message).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]).sort()
}

for (const locale of expectedLocales) {
  const bundle = i18n.getBundle(locale)
  assert.ok(bundle, `missing locale bundle: ${locale}`)
  assert.strictEqual(typeof bundle.nativeName, 'string')
  assert.strictEqual(typeof bundle.promptLanguage, 'string')
  assert.ok(Array.isArray(bundle.fallback) && bundle.fallback.length >= 3)
  assert.ok(Array.isArray(bundle.tips) && bundle.tips.length >= 3)
  assert.deepStrictEqual(Object.keys(bundle.messages).sort(), baseKeys, `${locale} message keys differ from zh-CN`)
  for (const key of baseKeys) {
    assert.ok(String(bundle.messages[key]).trim(), `${locale}.${key} is empty`)
    assert.deepStrictEqual(
      placeholders(bundle.messages[key]),
      placeholders(i18n.getBundle('zh-CN').messages[key]),
      `${locale}.${key} placeholders differ from zh-CN`
    )
  }
}

const html = require('fs').readFileSync(path.join(root, 'app/index.html'), 'utf8')
const htmlKeys = [...html.matchAll(/data-i18n(?:-placeholder|-title|-aria-label|-alt)?="([^"]+)"/g)].map(match => match[1])
for (const key of htmlKeys) assert.ok(baseKeySet.has(key), `unknown HTML locale key: ${key}`)

const appSource = require('fs').readFileSync(path.join(root, 'app/app.js'), 'utf8')
const appKeys = [
  ...appSource.matchAll(/\btr\(['"]([^'"]+)['"]/g),
  ...appSource.matchAll(/\bresultError\([^,]+,\s*['"]([^'"]+)['"]/g),
  ...appSource.matchAll(/\berrorKey\s*:\s*['"]([^'"]+)['"]/g),
].map(match => match[1])
for (const key of appKeys) assert.ok(baseKeySet.has(key), `unknown app locale key: ${key}`)

const mainSource = require('fs').readFileSync(path.join(root, 'main.js'), 'utf8')
const mainErrorKeys = [
  ...mainSource.matchAll(/\berrorResult\(['"]([^'"]+)['"]/g),
  ...mainSource.matchAll(/\bi18nError\(['"]([^'"]+)['"]/g),
  ...mainSource.matchAll(/\bcaughtErrorResult\([^,]+,\s*['"]([^'"]+)['"]/g),
  ...mainSource.matchAll(/\berrorKey\s*:\s*['"]([^'"]+)['"]/g),
].map(match => match[1])
for (const key of mainErrorKeys) assert.ok(baseKeySet.has(key), `unknown main-process locale key: ${key}`)

assert.strictEqual(i18n.normalizeLocale('zh-TW'), 'zh-Hant')
assert.strictEqual(i18n.normalizeLocale('zh-HK'), 'zh-Hant')
assert.strictEqual(i18n.normalizeLocale('zh-SG'), 'zh-CN')
assert.strictEqual(i18n.normalizeLocale('fr-FR'), 'fr')
assert.strictEqual(i18n.normalizeLocale('unsupported'), 'zh-CN')
assert.strictEqual(i18n.translate('fr', 'settings.title'), 'Paramètres')
assert.strictEqual(i18n.translate('ja', 'settings.title'), '設定')
assert.strictEqual(i18n.translate('ko', 'settings.title'), '설정')
assert.strictEqual(
  i18n.translate('en', 'status.longTaskCount', { count: 2, max: 8 }),
  '2/8 long-term tasks configured'
)
assert.strictEqual(
  i18n.translate('de', 'error.feishuResponse', { code: 42 }),
  'Feishu hat Code 42 zurückgegeben'
)
assert.strictEqual(
  i18n.translate('en', 'error.feishuResponse', { code: 42 }),
  'Feishu returned code 42'
)

const translatedNode = {
  dataset: {
    i18n: 'onboarding.step',
    i18nParamCurrent: '2',
    i18nParamTotal: '3',
  },
  textContent: '',
  setAttribute() {},
}
const fakeDocument = {
  nodeType: 9,
  documentElement: { lang: '' },
  defaultView: null,
  querySelectorAll: () => [translatedNode],
}
i18n.init(fakeDocument, 'en')
assert.strictEqual(translatedNode.textContent, 'Step 2 of 3')
assert.strictEqual(fakeDocument.documentElement.lang, 'en')

console.log('i18n tests passed')
