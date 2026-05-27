(function freemailUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.FreemailUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createFreemailUtils() {
  const DEFAULT_MAIL_PAGE_SIZE = 20;

  function firstNonEmptyString(values) {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
    return '';
  }

  function normalizeFreemailBaseUrl(rawValue = '') {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value) ? value : `https://${value}`;
    try {
      const parsed = new URL(candidate);
      parsed.hash = '';
      parsed.search = '';
      const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
      return `${parsed.origin}${pathname}`;
    } catch {
      return '';
    }
  }

  function normalizeFreemailDomain(rawValue = '') {
    let value = String(rawValue || '').trim().toLowerCase();
    if (!value) return '';
    value = value.replace(/^@+/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) ? value : '';
  }

  function normalizeFreemailDomains(values) {
    const domains = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const normalized = normalizeFreemailDomain(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      domains.push(normalized);
    }
    return domains;
  }

  function normalizeFreemailAddress(value) {
    return String(value || '').trim().toLowerCase();
  }

  function buildFreemailHeaders(_config = {}, options = {}) {
    const headers = {};
    if (options.json) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.acceptJson !== false) {
      headers.Accept = 'application/json';
    }
    return headers;
  }

  function joinFreemailUrl(baseUrl, path) {
    const normalizedBase = normalizeFreemailBaseUrl(baseUrl);
    const normalizedPath = String(path || '').trim();
    if (!normalizedBase || !normalizedPath) return normalizedBase || '';
    return `${normalizedBase}${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;
  }

  function getFreemailRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    const candidates = [payload.data, payload.items, payload.rows, payload.results, payload.list];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  }

  function stripHtmlTags(value = '') {
    return String(value || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeFreemailDate(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const parsed = Date.parse(String(value).trim().replace(' ', 'T'));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value).trim();
  }

  function normalizeFreemailMessage(row = {}) {
    if (!row || typeof row !== 'object') return null;
    const htmlContent = firstNonEmptyString([row.html_content, row.html, row.content_html]);
    const textContent = firstNonEmptyString([row.content, row.text, row.preview]);
    const code = firstNonEmptyString([row.verification_code, row.verificationCode, row.code]);
    const bodyPreview = [code, textContent || stripHtmlTags(htmlContent)].filter(Boolean).join(' ');
    return {
      id: firstNonEmptyString([row.id, row.emailId, row.mailId]),
      address: normalizeFreemailAddress(firstNonEmptyString([
        row.to_addrs,
        row.mailbox,
        row.address,
      ])),
      subject: firstNonEmptyString([row.subject, row.title]),
      from: {
        emailAddress: {
          address: firstNonEmptyString([row.sender, row.from, row.mailFrom]),
        },
      },
      bodyPreview,
      raw: htmlContent || textContent || code,
      receivedDateTime: normalizeFreemailDate(firstNonEmptyString([
        row.received_at,
        row.receivedDateTime,
        row.created_at,
        row.date,
      ])),
    };
  }

  function normalizeFreemailMessages(payload) {
    return getFreemailRows(payload).map((row) => normalizeFreemailMessage(row)).filter(Boolean);
  }

  function getFreemailAddressFromResponse(payload = {}) {
    return firstNonEmptyString([
      payload.email,
      payload.address,
      payload.data?.email,
      payload.data?.address,
    ]);
  }

  return {
    DEFAULT_MAIL_PAGE_SIZE,
    buildFreemailHeaders,
    getFreemailAddressFromResponse,
    joinFreemailUrl,
    normalizeFreemailAddress,
    normalizeFreemailBaseUrl,
    normalizeFreemailDomain,
    normalizeFreemailDomains,
    normalizeFreemailMessages,
    normalizeFreemailMessage,
  };
});
