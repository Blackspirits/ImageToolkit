// ============================================================
// ImageToolkit – i18n with optional in-app language override
// Chrome's chrome.i18n always follows the browser language, so a user-chosen
// locale is loaded from _locales/<locale>/messages.json and formatted the same way.
// Requires lib/core.js.
// ============================================================

(function (root) {
  'use strict';

  const core = root.ITK;
  // Right-to-left languages the extension ships a locale for.
  const RTL_LANGUAGES = new Set(['ar']);

  let customMessages = null;
  let fallbackMessages = null;
  let currentLocale = 'auto';
  let queue = Promise.resolve();

  async function fetchLocale(locale) {
    try {
      const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  async function doLoad(locale) {
    const next = locale && locale !== 'auto' ? locale : 'auto';
    if (next === currentLocale && (next === 'auto' || customMessages)) return;
    if (next === 'auto') {
      customMessages = null;
      currentLocale = 'auto';
      return;
    }
    const [messages, english] = await Promise.all([fetchLocale(next), fallbackMessages || fetchLocale('en')]);
    fallbackMessages = english;
    customMessages = messages;
    currentLocale = messages ? next : 'auto';
  }

  // Serialised so concurrent callers (e.g. storage change + menu click) never interleave.
  function load(locale) {
    queue = queue.then(() => doLoad(locale), () => doLoad(locale));
    return queue;
  }

  function t(key, substitutions) {
    if (customMessages) {
      const text = core.formatMessage(customMessages[key], substitutions)
        ?? core.formatMessage(fallbackMessages?.[key], substitutions);
      if (text != null) return text;
    }
    try {
      return chrome.i18n.getMessage(key, substitutions) || key;
    } catch {
      return key;
    }
  }

  // Singular/plural pair chosen with the active locale's plural rules ("one" vs the rest).
  // Locales without that distinction use the same text for both keys.
  function plural(count, oneKey, otherKey, substitutions = [String(count)]) {
    let category = 'other';
    try { category = new Intl.PluralRules(activeLocale().replace('_', '-')).select(count); } catch {}
    return t(category === 'one' ? oneKey : otherKey, substitutions);
  }

  function activeLocale() {
    if (currentLocale !== 'auto') return currentLocale;
    try {
      return chrome.i18n.getMessage('@@ui_locale') || 'en';
    } catch {
      return 'en';
    }
  }

  function direction() {
    const base = activeLocale().split(/[_-]/)[0].toLowerCase();
    return RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr';
  }

  function apply(scope) {
    const doc = scope || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    const translate = (el, attr, setter) => {
      const key = el.getAttribute(attr);
      const text = t(key);
      if (text && text !== key) setter(el, text);
    };
    doc.querySelectorAll('[data-i18n]').forEach((el) => translate(el, 'data-i18n', (e, s) => { e.textContent = s; }));
    doc.querySelectorAll('[data-i18n-placeholder]').forEach((el) => translate(el, 'data-i18n-placeholder', (e, s) => { e.placeholder = s; }));
    doc.querySelectorAll('[data-i18n-title]').forEach((el) => translate(el, 'data-i18n-title', (e, s) => {
      e.title = s;
      if (!e.textContent.trim() || e.hasAttribute('data-i18n-aria')) e.setAttribute('aria-label', s);
    }));
    doc.querySelectorAll('[data-i18n-aria]').forEach((el) => translate(el, 'data-i18n-aria', (e, s) => { e.setAttribute('aria-label', s); }));

    const html = doc.documentElement || doc.ownerDocument?.documentElement;
    if (html) {
      html.lang = activeLocale().replace('_', '-');
      html.dir = direction();
    }
  }

  root.ITK = Object.assign(root.ITK || {}, { i18n: { load, t, plural, apply, activeLocale, direction } });
})(typeof globalThis !== 'undefined' ? globalThis : self);
