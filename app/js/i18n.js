'use strict';

(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.nonoI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'de', 'ja', 'ko', 'zh-Hant', 'zh-CN'];
  const DEFAULT_LOCALE = 'zh-CN';
  const bundles = new Map();
  let currentLocale = DEFAULT_LOCALE;
  let currentDocument = null;

  function normalizeLocale(value) {
    const raw = String(value || '').trim().replace(/_/g, '-');
    if (SUPPORTED_LOCALES.includes(raw)) return raw;
    const lower = raw.toLowerCase();
    if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo' || lower === 'zh-hant') return 'zh-Hant';
    if (lower.startsWith('zh')) return 'zh-CN';
    const language = lower.split('-')[0];
    return SUPPORTED_LOCALES.includes(language) ? language : DEFAULT_LOCALE;
  }

  function registerLocale(bundle) {
    if (!bundle || typeof bundle !== 'object') throw new TypeError('locale bundle must be an object');
    const locale = normalizeLocale(bundle.locale);
    if (locale !== bundle.locale || !SUPPORTED_LOCALES.includes(locale)) {
      throw new Error(`unsupported locale bundle: ${bundle.locale}`);
    }
    if (!bundle.messages || typeof bundle.messages !== 'object') {
      throw new TypeError(`locale ${locale} must define messages`);
    }
    bundles.set(locale, Object.freeze({
      locale,
      nativeName: String(bundle.nativeName || locale),
      promptLanguage: String(bundle.promptLanguage || locale),
      messages: Object.freeze({ ...bundle.messages }),
      fallback: Object.freeze([...(bundle.fallback || [])]),
      tips: Object.freeze([...(bundle.tips || [])]),
    }));
    return bundles.get(locale);
  }

  function getBundle(locale) {
    return bundles.get(normalizeLocale(locale));
  }

  function interpolate(message, values) {
    if (!values) return message;
    return String(message).replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
    ));
  }

  function translate(locale, key, values) {
    const normalized = normalizeLocale(locale);
    const selected = bundles.get(normalized);
    const fallback = bundles.get(DEFAULT_LOCALE);
    const message = selected?.messages?.[key] ?? fallback?.messages?.[key] ?? key;
    return interpolate(message, values);
  }

  function t(key, values) {
    return translate(currentLocale, key, values);
  }

  function applyTranslations(rootNode) {
    const doc = rootNode?.ownerDocument || (rootNode?.nodeType === 9 ? rootNode : currentDocument);
    if (!rootNode || !doc) return;
    const nodes = rootNode.nodeType === 1 ? [rootNode, ...rootNode.querySelectorAll('*')] : [...rootNode.querySelectorAll('*')];
    for (const node of nodes) {
      const values = {};
      const parameterPrefix = 'i18nParam';
      for (const [name, value] of Object.entries(node.dataset || {})) {
        if (!name.startsWith(parameterPrefix) || name.length === parameterPrefix.length) continue;
        const suffix = name.slice(parameterPrefix.length);
        const key = suffix.charAt(0).toLowerCase() + suffix.slice(1);
        values[key] = value;
      }
      if (node.dataset?.i18n) node.textContent = t(node.dataset.i18n, values);
      if (node.dataset?.i18nPlaceholder) node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
      if (node.dataset?.i18nTitle) node.setAttribute('title', t(node.dataset.i18nTitle));
      if (node.dataset?.i18nAriaLabel) node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
      if (node.dataset?.i18nAlt) node.setAttribute('alt', t(node.dataset.i18nAlt));
    }
    doc.documentElement.lang = currentLocale;
  }

  function setLocale(locale, options = {}) {
    const next = normalizeLocale(locale);
    const changed = next !== currentLocale;
    currentLocale = next;
    if (currentDocument) applyTranslations(currentDocument);
    if ((changed || options.force) && options.emit !== false && currentDocument?.defaultView) {
      currentDocument.defaultView.dispatchEvent(new CustomEvent('nono:locale-changed', {
        detail: { locale: currentLocale },
      }));
    }
    return currentLocale;
  }

  function init(doc, locale) {
    currentDocument = doc || null;
    return setLocale(locale, { emit: false, force: true });
  }

  function getLocale() {
    return currentLocale;
  }

  function getIntlLocale(locale = currentLocale) {
    const normalized = normalizeLocale(locale);
    return normalized === 'zh-Hant' ? 'zh-TW' : normalized;
  }

  function getPromptLanguage(locale = currentLocale) {
    return getBundle(locale)?.promptLanguage || getBundle(DEFAULT_LOCALE)?.promptLanguage || 'Simplified Chinese';
  }

  function random(kind, locale = currentLocale) {
    const bundle = getBundle(locale) || getBundle(DEFAULT_LOCALE);
    const fallback = getBundle(DEFAULT_LOCALE);
    const values = bundle?.[kind]?.length ? bundle[kind] : fallback?.[kind] || [];
    return values.length ? values[Math.floor(Math.random() * values.length)] : '';
  }

  return {
    SUPPORTED_LOCALES,
    DEFAULT_LOCALE,
    registerLocale,
    getBundle,
    normalizeLocale,
    translate,
    t,
    init,
    setLocale,
    getLocale,
    getIntlLocale,
    getPromptLanguage,
    applyTranslations,
    random,
  };
});
