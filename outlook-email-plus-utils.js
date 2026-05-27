(function outlookEmailPlusUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.OutlookEmailPlusUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOutlookEmailPlusUtils() {
  const DEFAULT_OUTLOOK_EMAIL_PLUS_BASE_URL = '';

  function firstNonEmptyString(values) {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
    return '';
  }

  function normalizeOutlookEmailPlusBaseUrl(rawValue = '') {
    const value = String(rawValue || '').trim();
    if (!value) return '';

    const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value) ? value : `https://${value}`;
    try {
      const parsed = new URL(candidate);
      parsed.hash = '';
      parsed.search = '';
      let pathname = String(parsed.pathname || '').replace(/\/+/g, '/');
      pathname = pathname.replace(/\/api\/external(?:\/.*)?$/i, '');
      pathname = pathname === '/' ? '' : pathname.replace(/\/+$/g, '');
      return `${parsed.origin}${pathname}`;
    } catch {
      return '';
    }
  }

  function buildOutlookEmailPlusHeaders(config = {}, options = {}) {
    const headers = {};
    const apiKey = firstNonEmptyString([
      config.apiKey,
      config.outlookEmailPlusApiKey,
      options.apiKey,
    ]);
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    if (options.json) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.acceptJson !== false) {
      headers.Accept = 'application/json';
    }
    return headers;
  }

  function joinOutlookEmailPlusUrl(baseUrl, path) {
    const normalizedBase = normalizeOutlookEmailPlusBaseUrl(baseUrl);
    const normalizedPath = String(path || '').trim();
    if (!normalizedBase || !normalizedPath) return normalizedBase || '';
    return `${normalizedBase}${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;
  }

  function normalizeOutlookEmailPlusAddress(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function parseOutlookEmailPlusAddressParts(value = '') {
    const normalized = normalizeOutlookEmailPlusAddress(value);
    const atIndex = normalized.lastIndexOf('@');
    if (atIndex <= 0 || atIndex >= normalized.length - 1) {
      return null;
    }

    const local = normalized.slice(0, atIndex);
    const domain = normalized.slice(atIndex + 1);
    const plusIndex = local.indexOf('+');
    const baseLocal = plusIndex >= 0 ? local.slice(0, plusIndex) : local;
    const tag = plusIndex >= 0 ? local.slice(plusIndex + 1) : '';
    return {
      local,
      domain,
      baseLocal,
      tag,
      isTaggedAlias: plusIndex >= 0 && Boolean(baseLocal) && Boolean(tag),
    };
  }

  function isOutlookEmailPlusTaggedAlias(value = '') {
    return Boolean(parseOutlookEmailPlusAddressParts(value)?.isTaggedAlias);
  }

  function deriveOutlookEmailPlusBaseAddress(value = '') {
    const parts = parseOutlookEmailPlusAddressParts(value);
    if (!parts?.baseLocal || !parts.domain) {
      return '';
    }
    return `${parts.baseLocal}@${parts.domain}`;
  }

  function sanitizeOutlookEmailPlusTag(value = '') {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '');
  }

  function generateOutlookEmailPlusTag(...values) {
    return sanitizeOutlookEmailPlusTag(
      values
        .filter((value) => value !== undefined && value !== null)
        .join('-')
    ).slice(0, 64);
  }

  function buildOutlookEmailPlusAliasAddress(baseAddress = '', tag = '') {
    const parts = parseOutlookEmailPlusAddressParts(baseAddress);
    const sanitizedTag = sanitizeOutlookEmailPlusTag(tag);
    if (!parts?.baseLocal || !parts.domain || !sanitizedTag) {
      return '';
    }
    return `${parts.baseLocal}+${sanitizedTag}@${parts.domain}`;
  }

  function buildOutlookEmailPlusPayPalAliasAddress(baseAddress = '', index = 1) {
    const parts = parseOutlookEmailPlusAddressParts(baseAddress);
    const numericIndex = Math.max(1, Math.floor(Number(index) || 1));
    if (!parts?.baseLocal || !parts.domain) {
      return '';
    }
    return `${parts.baseLocal}+PayPal${numericIndex}@${parts.domain}`;
  }

  function getOutlookEmailPlusPayPalAliasIndex(aliasAddress = '', baseAddress = '') {
    const aliasParts = parseOutlookEmailPlusAddressParts(aliasAddress);
    const baseParts = parseOutlookEmailPlusAddressParts(baseAddress);
    if (!aliasParts || !baseParts || aliasParts.domain !== baseParts.domain) {
      return null;
    }
    const prefix = `${baseParts.baseLocal}+paypal`;
    if (!aliasParts.local.startsWith(prefix)) {
      return null;
    }
    const numeric = Number(aliasParts.local.slice(prefix.length));
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
  }

  function normalizeOutlookEmailPlusCallerIdPrefix(value = '') {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '');
  }

  function normalizeOutlookEmailPlusProjectKey(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeOutlookEmailPlusProvider(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeOutlookEmailPlusTimestamp(value) {
    if (value === undefined || value === null || value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1e12 ? Math.floor(numeric * 1000) : Math.floor(numeric);
    }
    const parsed = Date.parse(String(value).trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeOutlookEmailPlusVerificationCode(value = '') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const source = value?.data && typeof value.data === 'object' && !Array.isArray(value.data)
        ? value.data
        : value;
      return {
        code: normalizeOutlookEmailPlusVerificationCode(firstNonEmptyString([
          source.code,
          source.verification_code,
          source.verificationCode,
        ])),
        emailTimestamp: normalizeOutlookEmailPlusTimestamp(firstNonEmptyString([
          source.email_timestamp,
          source.emailTimestamp,
          source.received_at,
          source.receivedAt,
          source.timestamp,
        ])),
        mailId: firstNonEmptyString([
          source.message_id,
          source.messageId,
          source.mail_id,
          source.mailId,
          source.id,
        ]),
        raw: source,
      };
    }

    return String(value || '').trim();
  }

  function normalizeOutlookEmailPlusClaim(value = {}) {
    const source = value?.data && typeof value.data === 'object' && !Array.isArray(value.data)
      ? value.data
      : (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    return {
      accountId: firstNonEmptyString([
        source.account_id,
        source.accountId,
        source.id,
      ]),
      address: normalizeOutlookEmailPlusAddress(firstNonEmptyString([
        source.email,
        source.address,
      ])),
      domain: String(firstNonEmptyString([
        source.email_domain,
        source.emailDomain,
        source.domain,
      ])).trim().toLowerCase(),
      claimToken: firstNonEmptyString([
        source.claim_token,
        source.claimToken,
        source.token,
      ]),
      claimedAt: firstNonEmptyString([
        source.claimed_at,
        source.claimedAt,
      ]),
      leaseExpiresAt: firstNonEmptyString([
        source.lease_expires_at,
        source.leaseExpiresAt,
      ]),
      raw: source,
    };
  }

  function buildOutlookEmailPlusResponseError(payload = {}) {
    const code = firstNonEmptyString([
      payload.code,
      payload.error_code,
      payload.errorCode,
    ]);
    const message = firstNonEmptyString([
      payload.message,
      payload.error,
      payload.msg,
      payload.detail,
    ]) || 'Outlook Email Plus business error';
    const error = new Error(code ? `${message} (${code})` : message);
    if (code) error.code = code;
    error.payload = payload;
    return error;
  }

  function unwrapOutlookEmailPlusResponse(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload;
    }

    if (payload.success === false || payload.ok === false) {
      throw buildOutlookEmailPlusResponseError(payload);
    }

    if (payload.success === true || payload.ok === true) {
      return Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
    }

    return payload;
  }

  return {
    DEFAULT_OUTLOOK_EMAIL_PLUS_BASE_URL,
    buildOutlookEmailPlusAliasAddress,
    buildOutlookEmailPlusHeaders,
    buildOutlookEmailPlusPayPalAliasAddress,
    deriveOutlookEmailPlusBaseAddress,
    generateOutlookEmailPlusTag,
    getOutlookEmailPlusPayPalAliasIndex,
    isOutlookEmailPlusTaggedAlias,
    joinOutlookEmailPlusUrl,
    normalizeOutlookEmailPlusAddress,
    normalizeOutlookEmailPlusBaseUrl,
    normalizeOutlookEmailPlusCallerIdPrefix,
    normalizeOutlookEmailPlusClaim,
    normalizeOutlookEmailPlusProjectKey,
    normalizeOutlookEmailPlusProvider,
    normalizeOutlookEmailPlusTimestamp,
    normalizeOutlookEmailPlusVerificationCode,
    parseOutlookEmailPlusAddressParts,
    sanitizeOutlookEmailPlusTag,
    unwrapOutlookEmailPlusResponse,
  };
});
