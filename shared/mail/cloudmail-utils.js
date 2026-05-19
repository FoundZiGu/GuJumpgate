(function cloudMailUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.CloudMailUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createCloudMailUtils() {
  const DEFAULT_MAIL_PAGE_SIZE = 20;

  function firstNonEmptyString(values) {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
    return '';
  }

  function normalizeCloudMailBaseUrl(rawValue = '') {
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

  function normalizeCloudMailDomain(rawValue = '') {
    let value = String(rawValue || '').trim().toLowerCase();
    if (!value) return '';
    value = value.replace(/^@+/, '');
    value = value.replace(/^https?:\/\//, '');
    value = value.replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) {
      return '';
    }
    return value;
  }

  function normalizeCloudMailDomains(values) {
    const domains = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const normalized = normalizeCloudMailDomain(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      domains.push(normalized);
    }
    return domains;
  }

  function buildCloudMailHeaders(config = {}, options = {}) {
    const headers = {};
    const token = firstNonEmptyString([
      config.token,
      config.cloudMailToken,
      options.token,
    ]);
    if (token) {
      headers.Authorization = token;
    }
    if (options.json) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.acceptJson !== false) {
      headers.Accept = 'application/json';
    }
    return headers;
  }

  function joinCloudMailUrl(baseUrl, path) {
    const normalizedBase = normalizeCloudMailBaseUrl(baseUrl);
    const normalizedPath = String(path || '').trim();
    if (!normalizedBase || !normalizedPath) return normalizedBase || '';
    return `${normalizedBase}${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;
  }

  function getCloudMailMailRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];

    const candidates = [
      payload.data,
      payload.list,
      payload.items,
      payload.rows,
      payload.records,
      payload?.data?.list,
      payload?.data?.records,
      payload?.data?.rows,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }

    return [];
  }

  function normalizeCloudMailAddress(value) {
    return String(value || '').trim().toLowerCase();
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

  function parseCloudMailCreateTime(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    const source = String(value).trim();
    if (!source) return '';

    // Cloud Mail returns UTC time like "2099-12-30 23:59:59"; treat as UTC.
    const match = source.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-]\d{2}:?\d{2}))?$/);
    if (match) {
      const [, year, month, day, hour, minute, second, ms, offset] = match;
      let iso = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
      if (ms) iso += `.${ms}`;
      if (offset) {
        iso += offset.includes(':') ? offset : `${offset.slice(0, 3)}:${offset.slice(3)}`;
      } else {
        iso += 'Z';
      }
      const parsed = Date.parse(iso);
      return Number.isFinite(parsed) ? new Date(parsed).toISOString() : iso;
    }

    const parsed = Date.parse(source);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : source;
  }

  function normalizeCloudMailMessage(row = {}) {
    if (!row || typeof row !== 'object') return null;

    const address = normalizeCloudMailAddress(firstNonEmptyString([
      row.toEmail,
      row.to_email,
      row.recipient,
      row.address,
      row.email,
    ]));
    const subject = firstNonEmptyString([row.subject, row.title]);
    const fromAddress = firstNonEmptyString([
      row.sendEmail,
      row.send_email,
      row.from,
      row.sender,
      row.mailFrom,
    ]);
    const htmlContent = firstNonEmptyString([row.content, row.html]);
    const textContent = firstNonEmptyString([row.text, row.plainText, row.content_text]);
    const bodyPreview = (textContent
      || stripHtmlTags(htmlContent)
      || '').replace(/\s+/g, ' ').trim();

    return {
      id: firstNonEmptyString([row.emailId, row.id, row.mailId, row.mail_id]),
      address,
      addressId: '',
      subject,
      from: {
        emailAddress: {
          address: fromAddress,
        },
      },
      bodyPreview,
      raw: htmlContent || textContent || '',
      receivedDateTime: parseCloudMailCreateTime(firstNonEmptyString([
        row.createTime,
        row.create_time,
        row.createdAt,
        row.created_at,
        row.receivedDateTime,
        row.date,
      ])),
    };
  }

  function normalizeCloudMailMailApiMessages(payload) {
    return getCloudMailMailRows(payload)
      .map((row) => normalizeCloudMailMessage(row))
      .filter(Boolean);
  }

  function getCloudMailTokenFromResponse(payload = {}) {
    return firstNonEmptyString([
      payload?.data?.token,
      payload?.token,
      payload?.data?.accessToken,
      payload?.accessToken,
    ]);
  }

  return {
    DEFAULT_MAIL_PAGE_SIZE,
    buildCloudMailHeaders,
    getCloudMailTokenFromResponse,
    joinCloudMailUrl,
    normalizeCloudMailAddress,
    normalizeCloudMailBaseUrl,
    normalizeCloudMailDomain,
    normalizeCloudMailDomains,
    normalizeCloudMailMailApiMessages,
    normalizeCloudMailMessage,
  };
});
