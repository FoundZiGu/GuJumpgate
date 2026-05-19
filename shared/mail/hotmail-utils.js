(function hotmailUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.HotmailUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createHotmailUtils() {
  const HOTMAIL_SERVICE_MODE_REMOTE = 'remote';
  const HOTMAIL_SERVICE_MODE_LOCAL = 'local';
  const OUTLOOK_ALIAS_DEFAULT_MAX_PER_ACCOUNT = 5;
  const OUTLOOK_ALIAS_MAX_PER_ACCOUNT_LIMIT = 50;
  const OUTLOOK_SUBSCRIPTION_USED_KEYWORD = 'ChatGPT Plus Subscription';

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeTimestamp(value) {
    if (!value) return 0;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 0 ? value : 0;
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function normalizeHotmailServiceMode(rawValue = '') {
    return String(rawValue || '').trim().toLowerCase() === HOTMAIL_SERVICE_MODE_REMOTE
      ? HOTMAIL_SERVICE_MODE_REMOTE
      : HOTMAIL_SERVICE_MODE_LOCAL;
  }

  function normalizeRulePatternList(patterns = []) {
    return Array.isArray(patterns) ? patterns : [];
  }

  function extractCodeByRulePatterns(text, patterns = []) {
    const normalizedText = String(text || '');
    for (const pattern of normalizeRulePatternList(patterns)) {
      try {
        const source = String(pattern?.source || '').trim();
        if (!source) {
          continue;
        }
        const flags = String(pattern?.flags || '').replace(/[^dgimsuvy]/g, '');
        const match = normalizedText.match(new RegExp(source, flags));
        if (!match) {
          continue;
        }
        for (let index = 1; index < match.length; index += 1) {
          const candidate = String(match[index] || '').trim();
          if (candidate) {
            return candidate;
          }
        }
        if (String(match[0] || '').trim()) {
          return String(match[0] || '').trim();
        }
      } catch (_) {
        // Ignore invalid runtime rule patterns and continue with other candidates.
      }
    }
    return null;
  }

  function extractVerificationCode(text, options = {}) {
    const source = String(text || '');
    const matchedByRule = extractCodeByRulePatterns(source, options?.codePatterns);
    if (matchedByRule) return matchedByRule;

    const matchCn = source.match(/(?:代码为|验证码[^0-9]*?)[\s：:]*(\d{6})/i);
    if (matchCn) return matchCn[1];

    const matchLoginCode = source.match(/(?:log-?in\s+code|enter\s+this\s+code)[^0-9]{0,24}(\d{6})/i);
    if (matchLoginCode) return matchLoginCode[1];

    const matchEn = source.match(/code(?:\s+is|[\s:])+(\d{6})/i);
    if (matchEn) return matchEn[1];

    const matchStandalone = source.match(/\b(\d{6})\b/);
    return matchStandalone ? matchStandalone[1] : null;
  }

  function extractVerificationCodeFromMessage(message = {}, options = {}) {
    const sender = firstNonEmptyString([
      message?.from?.emailAddress?.address,
      message?.sender,
      message?.from,
    ]);
    const subject = firstNonEmptyString([message?.subject]);
    const preview = firstNonEmptyString([message?.bodyPreview, message?.preview, message?.text]);
    return extractVerificationCode([subject, preview, sender].filter(Boolean).join(' '), {
      codePatterns: options?.codePatterns,
    });
  }

  function getLatestHotmailMessage(messages) {
    return (Array.isArray(messages) ? messages : [])
      .slice()
      .sort((left, right) => {
        const leftTime = normalizeTimestamp(left?.receivedDateTime);
        const rightTime = normalizeTimestamp(right?.receivedDateTime);
        return rightTime - leftTime;
      })[0] || null;
  }

  function getHotmailListToggleLabel(expanded, count = 0) {
    const normalizedCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
    const suffix = normalizedCount > 0 ? `（${normalizedCount}）` : '';
    return `${expanded ? '收起列表' : '展开列表'}${suffix}`;
  }

  function filterHotmailAccountsByUsage(accounts, mode = 'all') {
    const list = Array.isArray(accounts) ? accounts.slice() : [];
    if (mode === 'used') {
      return list.filter((account) => Boolean(account?.used));
    }
    return list;
  }

  function getHotmailBulkActionLabel(mode = 'all', count = 0) {
    const normalizedCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
    const prefix = mode === 'used' ? '清空已用' : '全部删除';
    const suffix = normalizedCount > 0 ? `（${normalizedCount}）` : '';
    return `${prefix}${suffix}`;
  }

  function isAuthorizedHotmailAccount(account) {
    return Boolean(account)
      && account.status === 'authorized'
      && !account.used
      && Boolean(account.refreshToken);
  }

  function shouldClearHotmailCurrentSelection(account) {
    return Boolean(account) && account.used === true;
  }

  function upsertHotmailAccountInList(accounts, nextAccount) {
    const list = Array.isArray(accounts) ? accounts.slice() : [];
    if (!nextAccount?.id) return list;

    const existingIndex = list.findIndex((account) => account?.id === nextAccount.id);
    if (existingIndex === -1) {
      list.push(nextAccount);
      return list;
    }

    list[existingIndex] = nextAccount;
    return list;
  }

  function pickHotmailAccountForRun(accounts, options = {}) {
    const candidates = Array.isArray(accounts) ? accounts.filter(isAuthorizedHotmailAccount) : [];
    if (!candidates.length) return null;

    const excludeIds = new Set((options.excludeIds || []).filter(Boolean));
    const filtered = candidates.filter((account) => !excludeIds.has(account.id));
    const pool = filtered.length ? filtered : candidates;

    return pool
      .slice()
      .sort((left, right) => {
        const leftUsedAt = normalizeTimestamp(left.lastUsedAt);
        const rightUsedAt = normalizeTimestamp(right.lastUsedAt);
        if (leftUsedAt !== rightUsedAt) {
          return leftUsedAt - rightUsedAt;
        }

        return String(left.email || '').localeCompare(String(right.email || ''));
      })[0] || null;
  }

  function messageMatchesFilters(message, filters = {}) {
    const senderFilters = (filters.senderFilters || []).map(normalizeText).filter(Boolean);
    const subjectFilters = (filters.subjectFilters || []).map(normalizeText).filter(Boolean);
    const requiredKeywords = (filters.requiredKeywords || []).map(normalizeText).filter(Boolean);
    const hasSenderFilters = senderFilters.length > 0;
    const hasSubjectFilters = subjectFilters.length > 0;
    const hasKeywordHints = requiredKeywords.length > 0;
    const afterTimestamp = normalizeTimestamp(filters.afterTimestamp);
    const receivedAt = normalizeTimestamp(message?.receivedDateTime);
    if (afterTimestamp && receivedAt && receivedAt < afterTimestamp) {
      return null;
    }

    const sender = normalizeText(message?.from?.emailAddress?.address);
    const subject = normalizeText(message?.subject);
    const preview = String(message?.bodyPreview || '');
    const combinedText = [subject, sender, preview].filter(Boolean).join(' ');
    const code = extractVerificationCode(combinedText, {
      codePatterns: filters.codePatterns,
    });
    const excludedCodes = new Set((filters.excludeCodes || []).filter(Boolean));
    if (code && excludedCodes.has(code)) {
      return null;
    }

    const senderMatch = hasSenderFilters
      ? senderFilters.some((item) => sender.includes(item) || normalizeText(preview).includes(item))
      : false;
    const subjectMatch = hasSubjectFilters
      ? subjectFilters.some((item) => subject.includes(item) || normalizeText(preview).includes(item))
      : false;
    const keywordMatch = hasKeywordHints
      ? requiredKeywords.some((item) => normalizeText(combinedText).includes(item))
      : false;

    if ((hasSenderFilters || hasSubjectFilters || hasKeywordHints) && !senderMatch && !subjectMatch && !keywordMatch) {
      return null;
    }

    if (!code) {
      return null;
    }

    return {
      code,
      message,
      receivedAt,
    };
  }

  function pickVerificationMessage(messages, filters = {}) {
    const matches = (Array.isArray(messages) ? messages : [])
      .map((message) => messageMatchesFilters(message, filters))
      .filter(Boolean)
      .sort((left, right) => right.receivedAt - left.receivedAt);

    return matches[0] || null;
  }

  function pickVerificationMessageWithFallback(messages, filters = {}) {
    const strictMatch = pickVerificationMessage(messages, filters);
    return {
      match: strictMatch || null,
      usedRelaxedFilters: false,
      usedTimeFallback: false,
    };
  }

  function pickVerificationMessageWithTimeFallback(messages, filters = {}) {
    const strictOrRelaxedResult = pickVerificationMessageWithFallback(messages, filters);
    if (strictOrRelaxedResult.match) {
      return strictOrRelaxedResult;
    }

    const timeFallbackMatch = pickVerificationMessage(messages, {
      afterTimestamp: 0,
      excludeCodes: filters.excludeCodes,
      senderFilters: filters.senderFilters,
      subjectFilters: filters.subjectFilters,
    });

    return {
      match: timeFallbackMatch || null,
      usedRelaxedFilters: false,
      usedTimeFallback: Boolean(timeFallbackMatch),
    };
    /* c8 ignore stop */
  }

  function firstNonEmptyString(values) {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
    return '';
  }

  function normalizeMailAddress(rawValue) {
    if (!rawValue) return '';
    if (typeof rawValue === 'string') {
      return rawValue.trim();
    }
    if (typeof rawValue === 'object') {
      return firstNonEmptyString([
        rawValue.emailAddress?.address,
        rawValue.address,
        rawValue.email,
        rawValue.sender,
        rawValue.from,
      ]);
    }
    return '';
  }

  function normalizeMailAddressList(rawValue) {
    const source = Array.isArray(rawValue)
      ? rawValue
      : (rawValue ? [rawValue] : []);
    const results = [];
    const seen = new Set();
    for (const item of source) {
      const address = normalizeMailAddress(item).trim();
      const key = address.toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      results.push(address);
    }
    return results;
  }

  function normalizeMessageRecipients(message = {}) {
    const to = normalizeMailAddressList(
      message.toRecipients
      || message.ToRecipients
      || message.to_recipients
      || message.to
      || message.recipient
      || message.recipients
    );
    const cc = normalizeMailAddressList(
      message.ccRecipients
      || message.CcRecipients
      || message.cc_recipients
      || message.cc
    );
    const bcc = normalizeMailAddressList(
      message.bccRecipients
      || message.BccRecipients
      || message.bcc_recipients
      || message.bcc
    );
    return {
      to,
      cc,
      bcc,
      all: [...new Set([...to, ...cc, ...bcc].map((item) => item.trim()).filter(Boolean))],
    };
  }

  function stripHtmlTags(text) {
    return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeHotmailMailApiMessage(message = {}) {
    return {
      id: firstNonEmptyString([message.id, message.message_id, message.messageId, message.internetMessageId]),
      subject: firstNonEmptyString([message.subject, message.title]),
      from: {
        emailAddress: {
          address: normalizeMailAddress(
            message.from_email
            || message.sender_email
            || message.from
            || message.sender
            || message.emailAddress
          ),
        },
      },
      bodyPreview: firstNonEmptyString([
        message.bodyPreview,
        message.preview,
        message.snippet,
        message.text,
        message.body,
        stripHtmlTags(message.html || message.content || ''),
      ]),
      receivedDateTime: firstNonEmptyString([
        message.receivedDateTime,
        message.received_at,
        message.receivedAt,
        message.date,
        message.created_at,
        message.time,
      ]),
      recipients: normalizeMessageRecipients(message),
    };
  }

  function normalizeHotmailMailApiMessages(messages) {
    const list = Array.isArray(messages)
      ? messages
      : (messages ? [messages] : []);
    return list.map((message) => normalizeHotmailMailApiMessage(message));
  }

  function normalizeOutlookAliasMaxPerAccount(value, fallback = OUTLOOK_ALIAS_DEFAULT_MAX_PER_ACCOUNT) {
    const rawValue = String(value ?? '').trim();
    const fallbackNumber = Number(fallback);
    const normalizedFallback = Number.isFinite(fallbackNumber)
      ? Math.min(OUTLOOK_ALIAS_MAX_PER_ACCOUNT_LIMIT, Math.max(1, Math.floor(fallbackNumber)))
      : OUTLOOK_ALIAS_DEFAULT_MAX_PER_ACCOUNT;
    if (!rawValue) {
      return normalizedFallback;
    }
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) {
      return normalizedFallback;
    }
    return Math.min(OUTLOOK_ALIAS_MAX_PER_ACCOUNT_LIMIT, Math.max(1, Math.floor(numeric)));
  }

  function parseEmailAddressParts(email = '') {
    const normalized = String(email || '').trim();
    const atIndex = normalized.lastIndexOf('@');
    if (atIndex <= 0 || atIndex >= normalized.length - 1) {
      return null;
    }
    return {
      local: normalized.slice(0, atIndex),
      domain: normalized.slice(atIndex + 1),
    };
  }

  function buildOutlookPlusAliasEmail(baseEmail = '', tag = '') {
    const parts = parseEmailAddressParts(baseEmail);
    if (!parts) {
      return '';
    }
    const cleanedTag = String(tag || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '')
      .replace(/^[._-]+|[._-]+$/g, '');
    return cleanedTag ? `${parts.local}+${cleanedTag}@${parts.domain}` : '';
  }

  function normalizeHotmailAliasUsage(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const normalized = {};
    for (const [accountKey, rawBucket] of Object.entries(value)) {
      const key = String(accountKey || '').trim();
      if (!key) {
        continue;
      }
      const aliasesSource = rawBucket?.aliases && typeof rawBucket.aliases === 'object' && !Array.isArray(rawBucket.aliases)
        ? rawBucket.aliases
        : rawBucket;
      const aliases = {};
      for (const [aliasKey, rawEntry] of Object.entries(aliasesSource || {})) {
        const email = String(rawEntry?.email || aliasKey || '').trim();
        if (!email) {
          continue;
        }
        aliases[email.toLowerCase()] = {
          email,
          used: Boolean(rawEntry?.used),
          lastCheckedAt: Number.isFinite(Number(rawEntry?.lastCheckedAt)) ? Number(rawEntry.lastCheckedAt) : 0,
          reason: String(rawEntry?.reason || '').trim(),
        };
      }
      normalized[key] = {
        aliases,
        updatedAt: Number.isFinite(Number(rawBucket?.updatedAt)) ? Number(rawBucket.updatedAt) : 0,
      };
    }
    return normalized;
  }

  function getHotmailAliasUsageKey(account = {}) {
    return String(account?.id || account?.email || '').trim();
  }

  function getHotmailAliasEntriesForAccount(usage = {}, account = {}) {
    const key = getHotmailAliasUsageKey(account);
    return key ? Object.values(normalizeHotmailAliasUsage(usage)[key]?.aliases || {}) : [];
  }

  function isHotmailAliasCapacityExhausted(account = {}, usage = {}, maxAliases = OUTLOOK_ALIAS_DEFAULT_MAX_PER_ACCOUNT) {
    const normalizedMax = normalizeOutlookAliasMaxPerAccount(maxAliases);
    const usedCount = getHotmailAliasEntriesForAccount(usage, account).filter((entry) => entry?.used).length;
    return usedCount >= normalizedMax;
  }

  function messageContainsSubscriptionKeyword(message = {}, keyword = OUTLOOK_SUBSCRIPTION_USED_KEYWORD) {
    const needle = String(keyword || '').trim().toLowerCase();
    const body = typeof message?.body === 'string' ? message.body : (message?.body?.content || '');
    return [message?.subject, message?.bodyPreview, message?.preview, message?.text, body]
      .map((item) => String(item || '').toLowerCase())
      .join(' ')
      .includes(needle);
  }

  function findSubscriptionMessageForAlias(messages = [], aliasEmail = '') {
    const aliasKey = String(aliasEmail || '').trim().toLowerCase();
    let missingRecipients = false;
    for (const message of Array.isArray(messages) ? messages : []) {
      if (!messageContainsSubscriptionKeyword(message)) {
        continue;
      }
      const recipients = (Array.isArray(message?.recipients?.all) && message.recipients.all.length
        ? message.recipients.all
        : normalizeMessageRecipients(message).all
      ).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
      if (!recipients.length) {
        missingRecipients = true;
        continue;
      }
      if (recipients.includes(aliasKey)) {
        return { matched: true, missingRecipients: false, message };
      }
    }
    return { matched: false, missingRecipients, message: null };
  }

  function buildHotmailMailApiLatestUrl(options = {}) {
    const apiUrl = String(options?.apiUrl || '').trim();
    if (!apiUrl) {
      throw new Error('Hotmail mail API URL is required.');
    }
    const url = new URL(apiUrl);
    url.searchParams.set('refresh_token', String(options?.refreshToken || ''));
    url.searchParams.set('client_id', String(options?.clientId || ''));
    url.searchParams.set('email', String(options?.email || ''));
    url.searchParams.set('mailbox', String(options?.mailbox || 'INBOX'));
    const responseType = options?.responseType === undefined || options?.responseType === null
      ? 'json'
      : String(options.responseType).trim();
    if (responseType) {
      url.searchParams.set('response_type', responseType);
    }
    return url.toString();
  }

  function getHotmailVerificationPollConfig(step) {
    if (step === 4 || step === 7) {
      return {
        initialDelayMs: 5000,
        maxAttempts: 12,
        intervalMs: 5000,
        requestFreshCodeFirst: false,
        ignorePersistedLastCode: true,
      };
    }

    return {
      initialDelayMs: 5000,
      maxAttempts: 8,
      intervalMs: 4000,
      requestFreshCodeFirst: false,
      ignorePersistedLastCode: true,
    };
  }

  function getHotmailVerificationRequestTimestamp(step, state = {}, options = {}) {
    const bufferMs = Number(options.bufferMs) || 15_000;
    const signupRequestedAt = normalizeTimestamp(state.signupVerificationRequestedAt);
    const loginRequestedAt = normalizeTimestamp(state.loginVerificationRequestedAt);
    const lastEmailTimestamp = normalizeTimestamp(state.lastEmailTimestamp);
    const flowStartTime = normalizeTimestamp(state.flowStartTime);

    if (step === 4 && signupRequestedAt) {
      return Math.max(0, signupRequestedAt - bufferMs);
    }

    if (step === 7 && loginRequestedAt) {
      return Math.max(0, loginRequestedAt - bufferMs);
    }

    return step === 7
      ? (lastEmailTimestamp || flowStartTime || 0)
      : (flowStartTime || 0);
  }

  function getHotmailMailApiRequestConfig() {
    return {
      timeoutMs: 15000,
    };
  }

  function parseHotmailImportText(rawText) {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return lines
      .filter((line, index) => !(index === 0 && /^账号----密码----ID----Token$/i.test(line)))
      .map((line) => line.split('----').map((part) => part.trim()))
      .filter((parts) => parts.length >= 4 && parts[0] && parts[2])
      .map(([email, password, clientId, refreshToken]) => ({
        email,
        password,
        clientId,
        refreshToken,
      }));
  }

  return {
    buildHotmailMailApiLatestUrl,
    extractVerificationCodeFromMessage,
    filterHotmailAccountsByUsage,
    extractVerificationCode,
    getLatestHotmailMessage,
    getHotmailBulkActionLabel,
    getHotmailListToggleLabel,
    getHotmailMailApiRequestConfig,
    getHotmailVerificationPollConfig,
    getHotmailVerificationRequestTimestamp,
    getHotmailAliasEntriesForAccount,
    getHotmailAliasUsageKey,
    isAuthorizedHotmailAccount,
    isHotmailAliasCapacityExhausted,
    buildOutlookPlusAliasEmail,
    findSubscriptionMessageForAlias,
    normalizeHotmailAliasUsage,
    normalizeHotmailServiceMode,
    normalizeHotmailMailApiMessages,
    normalizeOutlookAliasMaxPerAccount,
    normalizeTimestamp,
    parseHotmailImportText,
    pickHotmailAccountForRun,
    pickVerificationMessage,
    pickVerificationMessageWithFallback,
    pickVerificationMessageWithTimeFallback,
    shouldClearHotmailCurrentSelection,
    upsertHotmailAccountInList,
  };
});
