'use strict';

(function exposeProviderDefaults(root) {
  const DEFAULT_MODEL = Object.freeze({
    anthropic: 'claude-3-5-sonnet-20241022',
    openai: 'gpt-4o-mini',
  });

  const MODEL_HINT = Object.freeze({
    anthropic: `留空默认 ${DEFAULT_MODEL.anthropic}`,
    openai: `留空默认 ${DEFAULT_MODEL.openai}`,
  });

  root.DEFAULT_MODEL = DEFAULT_MODEL;
  root.MODEL_HINT = MODEL_HINT;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DEFAULT_MODEL, MODEL_HINT };
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
