(function attachGuJumpgateI18n(globalScope) {
  const FALLBACK_LOCALE = 'vi-VN';
  const STORAGE_KEY = 'gujumpgate:locale';
  const locales = globalScope.GUJUMPGATE_LOCALES || (globalScope.GUJUMPGATE_LOCALES = {});

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function resolvePath(source, key) {
    if (!isObject(source) || !key) {
      return undefined;
    }
    return String(key)
      .split('.')
      .reduce((current, part) => (isObject(current) || Array.isArray(current) ? current[part] : undefined), source);
  }

  function interpolate(template, params = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_, name) => {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : `{${name}}`;
    });
  }

  function getStoredLocale() {
    try {
      return String(globalScope.localStorage?.getItem(STORAGE_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  function persistLocale(locale) {
    try {
      globalScope.localStorage?.setItem(STORAGE_KEY, locale);
    } catch {
      // Ignore storage errors in restricted contexts.
    }
  }

  function determineInitialLocale() {
    const candidates = [
      getStoredLocale(),
      String(globalScope.GUJUMPGATE_LOCALE || '').trim(),
      String(globalScope.navigator?.language || '').trim(),
      FALLBACK_LOCALE,
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (locales[candidate]) {
        return candidate;
      }
    }
    return FALLBACK_LOCALE;
  }

  let currentLocale = determineInitialLocale();

  function registerLocale(locale, messages) {
    if (!locale || !isObject(messages)) {
      return;
    }
    locales[String(locale)] = messages;
    if (!currentLocale) {
      currentLocale = String(locale);
    }
  }

  function getLocaleMessages(locale) {
    return locales[String(locale)] || {};
  }

  function getDocument() {
    if (globalScope.document) {
      return globalScope.document;
    }
    if (typeof document !== 'undefined') {
      return document;
    }
    return null;
  }

  function setDocumentLang(locale) {
    const documentRef = getDocument();
    if (documentRef?.documentElement && locale) {
      documentRef.documentElement.lang = locale;
    }
  }

  function t(key, params = {}, fallback = '') {
    const direct = resolvePath(getLocaleMessages(currentLocale), key);
    const fallbackValue = resolvePath(getLocaleMessages(FALLBACK_LOCALE), key);
    const message = direct ?? fallbackValue ?? fallback;
    if (message === undefined || message === null || message === '') {
      return key;
    }
    return interpolate(message, params);
  }

  function applyTranslations(root = getDocument()) {
    if (!root?.querySelectorAll) {
      setDocumentLang(currentLocale);
      return;
    }

    root.querySelectorAll('[data-i18n]').forEach((node) => {
      const key = node.dataset?.i18n;
      if (!key) return;
      node.textContent = t(key);
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      const key = node.dataset?.i18nPlaceholder;
      if (!key) return;
      node.placeholder = t(key);
    });

    root.querySelectorAll('[data-i18n-title]').forEach((node) => {
      const key = node.dataset?.i18nTitle;
      if (!key) return;
      const value = t(key);
      node.title = value;
      node.setAttribute?.('title', value);
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
      const key = node.dataset?.i18nAriaLabel;
      if (!key) return;
      node.setAttribute?.('aria-label', t(key));
    });

    setDocumentLang(currentLocale);
  }

  function setLocale(locale, options = {}) {
    const normalized = String(locale || '').trim();
    if (!normalized || !locales[normalized]) {
      return currentLocale;
    }
    currentLocale = normalized;
    if (options.persist !== false) {
      persistLocale(currentLocale);
    }
    applyTranslations(options.root || globalScope.document);
    return currentLocale;
  }

  const api = {
    FALLBACK_LOCALE,
    STORAGE_KEY,
    getLocale: () => currentLocale,
    getLocales: () => ({ ...locales }),
    registerLocale,
    t,
    applyTranslations,
    setLocale,
  };

  globalScope.GuJumpgateI18n = api;
  setDocumentLang(currentLocale);
})(typeof window !== 'undefined' ? window : globalThis);
