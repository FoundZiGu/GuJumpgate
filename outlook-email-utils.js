(function outlookEmailUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.OutlookEmailUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOutlookEmailUtils() {
  const OUTLOOK_EMAIL_PROVIDER = 'outlook-email';
  const OUTLOOK_EMAIL_GENERATOR = 'outlook-email';

  function firstNonEmptyString(values) {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
    return '';
  }

  function normalizeOutlookEmailBaseUrl(rawValue = '') {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value) ? value : `https://${value}`;
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      parsed.hash = '';
      parsed.search = '';
      let pathname = String(parsed.pathname || '').replace(/\/+/g, '/');
      pathname = pathname.replace(/\/api(?:\/.*)?$/i, '');
      pathname = pathname === '/' ? '' : pathname.replace(/\/+$/g, '');
      return `${parsed.origin}${pathname}`;
    } catch {
      return '';
    }
  }

  function joinOutlookEmailUrl(baseUrl, path) {
    const normalizedBase = normalizeOutlookEmailBaseUrl(baseUrl);
    const normalizedPath = String(path || '').trim();
    if (!normalizedBase || !normalizedPath) return normalizedBase || '';
    return `${normalizedBase}${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;
  }

  function buildOutlookEmailApiHeaders(config = {}, options = {}) {
    const headers = {};
    const apiKey = firstNonEmptyString([config.apiKey, config.outlookEmailApiKey, options.apiKey]);
    if (apiKey) headers['X-API-Key'] = apiKey;
    if (options.json) headers['Content-Type'] = 'application/json';
    if (options.acceptJson !== false) headers.Accept = 'application/json';
    return headers;
  }

  function normalizeOutlookEmailAddress(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function parseOutlookEmailAddressParts(value = '') {
    const normalized = normalizeOutlookEmailAddress(value);
    const atIndex = normalized.lastIndexOf('@');
    if (atIndex <= 0 || atIndex >= normalized.length - 1) return null;
    return {
      local: normalized.slice(0, atIndex),
      domain: normalized.slice(atIndex + 1),
    };
  }

  function normalizeOutlookEmailDomain(value = '') {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^@+/, '')
      .replace(/[^\w.-]+/g, '');
  }

  function replaceOutlookEmailDomain(address = '', domain = '') {
    const parts = parseOutlookEmailAddressParts(address);
    const normalizedDomain = normalizeOutlookEmailDomain(domain);
    if (!parts || !normalizedDomain) return normalizeOutlookEmailAddress(address);
    return `${parts.local}@${normalizedDomain}`;
  }

  function normalizeOutlookEmailProjectKey(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeOutlookEmailCallerIdPrefix(value = '') {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '');
  }

  function normalizeOutlookEmailTimestamp(value) {
    if (value === undefined || value === null || value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1e12 ? Math.floor(numeric * 1000) : Math.floor(numeric);
    }
    const parsed = Date.parse(String(value).trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeOutlookEmailAccount(value = {}) {
    const source = value?.data && typeof value.data === 'object' && !Array.isArray(value.data)
      ? value.data
      : (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    return {
      accountId: firstNonEmptyString([source.account_id, source.accountId, source.id]),
      address: normalizeOutlookEmailAddress(firstNonEmptyString([source.email, source.address, source.normalized_email])),
      primaryEmail: normalizeOutlookEmailAddress(firstNonEmptyString([source.primary_email, source.primaryEmail])),
      groupId: firstNonEmptyString([source.group_id, source.groupId]),
      groupName: firstNonEmptyString([source.group_name, source.groupName]),
      provider: String(firstNonEmptyString([source.provider, source.account_type, source.accountType])).trim().toLowerCase(),
      claimToken: firstNonEmptyString([source.claim_token, source.claimToken, source.token]),
      claimedAt: firstNonEmptyString([source.claimed_at, source.claimedAt]),
      leaseExpiresAt: firstNonEmptyString([source.lease_expires_at, source.leaseExpiresAt]),
      tags: normalizeOutlookEmailTags(source.tags || source.tag_list || source.tagList),
      raw: source,
    };
  }

  function normalizeOutlookEmailTags(value = []) {
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(/[\r\n,，、;；]+/);
    return source
      .map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return {
            id: firstNonEmptyString([item.id, item.tag_id, item.tagId]),
            name: firstNonEmptyString([item.name, item.tag_name, item.tagName]),
            color: firstNonEmptyString([item.color]),
            raw: item,
          };
        }
        const name = String(item || '').trim();
        return name ? { id: '', name, color: '', raw: item } : null;
      })
      .filter((item) => item && item.name);
  }

  function normalizeOutlookEmailMessage(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const sender = source.from && typeof source.from === 'object'
      ? firstNonEmptyString([source.from.emailAddress?.address, source.from.address, source.from.email, source.from.name])
      : firstNonEmptyString([source.from, source.sender, source.sender_email, source.senderEmail]);
    return {
      id: firstNonEmptyString([source.id, source.message_id, source.messageId, source.mail_id, source.mailId]),
      subject: firstNonEmptyString([source.subject, source.title]),
      from: sender,
      to: firstNonEmptyString([source.to, source.recipient, source.recipient_email, source.recipientEmail]),
      date: firstNonEmptyString([source.date, source.received_at, source.receivedAt, source.timestamp, source.created_at]),
      timestamp: normalizeOutlookEmailTimestamp(firstNonEmptyString([
        source.received_at,
        source.receivedAt,
        source.date,
        source.timestamp,
        source.created_at,
      ])),
      bodyPreview: firstNonEmptyString([source.body_preview, source.bodyPreview, source.preview, source.snippet]),
      body: firstNonEmptyString([source.body, source.text, source.html]),
      folder: firstNonEmptyString([source.folder, source.mail_folder]),
      raw: source,
    };
  }

  function normalizeOutlookEmailMessages(value = {}) {
    const source = value?.data && typeof value.data === 'object' && !Array.isArray(value.data)
      ? value.data
      : value;
    const rawMessages = Array.isArray(source?.emails)
      ? source.emails
      : (Array.isArray(source?.messages) ? source.messages : (Array.isArray(source) ? source : []));
    return rawMessages.map(normalizeOutlookEmailMessage);
  }

  function normalizeOutlookEmailVerificationCode(value = '') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const source = value?.data && typeof value.data === 'object' && !Array.isArray(value.data)
        ? value.data
        : value;
      return {
        code: normalizeOutlookEmailVerificationCode(firstNonEmptyString([
          source.code,
          source.verification_code,
          source.verificationCode,
        ])),
        emailTimestamp: normalizeOutlookEmailTimestamp(firstNonEmptyString([
          source.email_timestamp,
          source.emailTimestamp,
          source.received_at,
          source.receivedAt,
          source.timestamp,
        ])),
        mailId: firstNonEmptyString([source.message_id, source.messageId, source.mail_id, source.mailId, source.id]),
        raw: source,
      };
    }
    return String(value || '').trim();
  }

  function buildOutlookEmailResponseError(payload = {}) {
    const message = firstNonEmptyString([payload.message, payload.error, payload.msg, payload.detail])
      || 'outlookEmail business error';
    const error = new Error(message);
    error.payload = payload;
    return error;
  }

  function unwrapOutlookEmailResponse(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
    if (payload.success === false || payload.ok === false) {
      throw buildOutlookEmailResponseError(payload);
    }
    if (payload.success === true || payload.ok === true) {
      return Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
    }
    return payload;
  }

  return {
    OUTLOOK_EMAIL_GENERATOR,
    OUTLOOK_EMAIL_PROVIDER,
    buildOutlookEmailApiHeaders,
    joinOutlookEmailUrl,
    normalizeOutlookEmailAccount,
    normalizeOutlookEmailAddress,
    normalizeOutlookEmailBaseUrl,
    normalizeOutlookEmailCallerIdPrefix,
    normalizeOutlookEmailDomain,
    normalizeOutlookEmailMessages,
    normalizeOutlookEmailProjectKey,
    normalizeOutlookEmailTags,
    normalizeOutlookEmailTimestamp,
    normalizeOutlookEmailVerificationCode,
    replaceOutlookEmailDomain,
    unwrapOutlookEmailResponse,
  };
});
