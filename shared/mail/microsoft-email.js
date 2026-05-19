(function attachMicrosoftEmailHelpers(globalScope) {
  const CODE_PATTERN = /\b(\d{6})\b/;
  const GRAPH_SCOPES = 'offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read';
  const GRAPH_DEFAULT_SCOPE = 'https://graph.microsoft.com/.default';
  const TOKEN_STRATEGIES = [
    {
      name: 'entra-common-delegated',
      url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      extraData: { scope: GRAPH_SCOPES },
    },
    {
      name: 'entra-consumers-delegated',
      url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      extraData: { scope: GRAPH_SCOPES },
    },
    {
      name: 'entra-common-default',
      url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      extraData: { scope: GRAPH_DEFAULT_SCOPE },
    },
    {
      name: 'entra-common-outlook',
      url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      extraData: {},
    },
  ];
  const TRANSPORT_PLANS = [
    {
      transport: 'graph',
      strategyNames: ['entra-common-delegated', 'entra-consumers-delegated', 'entra-common-default'],
    },
    {
      transport: 'outlook',
      strategyNames: ['entra-common-outlook', 'entra-common-delegated', 'entra-consumers-delegated'],
    },
  ];
  const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0/me/mailFolders';
  const OUTLOOK_API_BASE = 'https://outlook.office.com/api/v2.0/me/mailfolders';

  function getFetchImpl(fetchImpl) {
    const resolved = fetchImpl || globalScope.fetch;
    if (typeof resolved !== 'function') {
      throw new Error('Microsoft email helper requires a fetch implementation.');
    }
    return resolved;
  }

  function resolveTokenStrategy(name) {
    return TOKEN_STRATEGIES.find((item) => item.name === name) || TOKEN_STRATEGIES[0];
  }

  function normalizeMailboxLabel(mailbox = 'INBOX') {
    return /^junk(?:\s*e-?mail|\s*email)?$/i.test(String(mailbox || '').trim()) ? 'Junk' : 'INBOX';
  }

  function normalizeMailboxId(mailbox = 'INBOX') {
    return normalizeMailboxLabel(mailbox) === 'Junk' ? 'junkemail' : 'inbox';
  }

  function normalizeMailboxList(mailboxes) {
    const list = Array.isArray(mailboxes) && mailboxes.length ? mailboxes : ['INBOX'];
    return [...new Set(list.map((mailbox) => normalizeMailboxLabel(mailbox)))];
  }

  async function getResponseErrorText(response) {
    const text = await response.text().catch(() => '');
    if (!text) {
      return response.statusText || `HTTP ${response.status}`;
    }
    try {
      const parsed = JSON.parse(text);
      return parsed.error_description || parsed.error?.message || parsed.error || parsed.message || text;
    } catch {
      return text;
    }
  }

  async function exchangeRefreshToken(clientId, refreshToken, options = {}) {
    const fetchImpl = getFetchImpl(options.fetchImpl);
    const strategy = resolveTokenStrategy(options.strategyName);
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      ...(strategy.extraData || {}),
    });
    const response = await fetchImpl(strategy.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`${strategy.name}: ${await getResponseErrorText(response)}`);
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error(`${strategy.name}: token response missing access_token`);
    }

    return {
      ...data,
      tokenStrategy: strategy.name,
    };
  }

  async function fetchGraphMessages(accessToken, options = {}) {
    const fetchImpl = getFetchImpl(options.fetchImpl);
    const mailbox = normalizeMailboxLabel(options.mailbox);
    const top = Math.max(1, Math.min(Number(options.top) || 5, 30));
    const url = `${GRAPH_API_BASE}/${normalizeMailboxId(mailbox)}/messages?$top=${encodeURIComponent(top)}&$select=id,internetMessageId,subject,from,bodyPreview,receivedDateTime,toRecipients,ccRecipients,bccRecipients&$orderby=receivedDateTime desc`;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`graph: ${await getResponseErrorText(response)}`);
    }

    const payload = await response.json();
    return Array.isArray(payload?.value) ? payload.value : [];
  }

  async function fetchOutlookMessages(accessToken, options = {}) {
    const fetchImpl = getFetchImpl(options.fetchImpl);
    const mailbox = normalizeMailboxLabel(options.mailbox);
    const top = Math.max(1, Math.min(Number(options.top) || 5, 30));
    const url = `${OUTLOOK_API_BASE}/${normalizeMailboxId(mailbox)}/messages?$top=${encodeURIComponent(top)}&$select=Id,Subject,From,BodyPreview,Body,ReceivedDateTime,ToRecipients,CcRecipients,BccRecipients&$orderby=ReceivedDateTime desc`;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`outlook: ${await getResponseErrorText(response)}`);
    }

    const payload = await response.json();
    return Array.isArray(payload?.value) ? payload.value : [];
  }

  function normalizeRecipientAddress(rawValue) {
    if (!rawValue) return '';
    if (typeof rawValue === 'string') {
      return rawValue.trim();
    }
    if (typeof rawValue === 'object') {
      const emailAddress = rawValue.EmailAddress || rawValue.emailAddress || {};
      return String(
        emailAddress.Address
        || emailAddress.address
        || rawValue.Address
        || rawValue.address
        || rawValue.email
        || ''
      ).trim();
    }
    return '';
  }

  function normalizeRecipientList(rawValue) {
    const source = Array.isArray(rawValue)
      ? rawValue
      : (rawValue ? [rawValue] : []);
    const results = [];
    const seen = new Set();
    for (const item of source) {
      const address = normalizeRecipientAddress(item);
      const key = address.toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      results.push(address);
    }
    return results;
  }

  function normalizeMessage(message, mailbox = 'INBOX') {
    const sender = message?.From || message?.from || {};
    const emailAddress = sender?.EmailAddress || sender?.emailAddress || {};
    const recipients = {
      to: normalizeRecipientList(message?.ToRecipients || message?.toRecipients || message?.to),
      cc: normalizeRecipientList(message?.CcRecipients || message?.ccRecipients || message?.cc),
      bcc: normalizeRecipientList(message?.BccRecipients || message?.bccRecipients || message?.bcc),
    };
    recipients.all = [...new Set([...recipients.to, ...recipients.cc, ...recipients.bcc])];
    return {
      mailbox: normalizeMailboxLabel(mailbox || message?.mailbox),
      from: {
        emailAddress: {
          address: String(emailAddress?.Address || emailAddress?.address || '').trim(),
          name: String(emailAddress?.Name || emailAddress?.name || '').trim(),
        },
      },
      subject: String(message?.Subject || message?.subject || '').trim(),
      receivedDateTime: String(message?.ReceivedDateTime || message?.receivedDateTime || '').trim(),
      bodyPreview: String(message?.BodyPreview || message?.bodyPreview || '').trim(),
      body: {
        content: String(message?.Body?.Content || message?.body?.content || '').trim(),
      },
      recipients,
      id: String(message?.Id || message?.id || message?.internetMessageId || '').trim(),
    };
  }

  function normalizeFilterValue(value) {
    return String(value || '').trim().toLowerCase();
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

    const matchStandalone = source.match(CODE_PATTERN);
    return matchStandalone?.[1] || '';
  }

  function getMessageSender(message) {
    return String(
      message?.from?.emailAddress?.address
      || message?.sender?.emailAddress?.address
      || ''
    ).trim();
  }

  function getMessageTimestamp(message) {
    const value = Date.parse(message?.receivedDateTime || message?.createdDateTime || '');
    return Number.isFinite(value) ? value : 0;
  }

  function getMessageSearchText(message) {
    return [
      message?.subject,
      message?.bodyPreview,
      message?.body?.content,
      getMessageSender(message),
    ]
      .map((value) => String(value || ''))
      .join('\n');
  }

  function extractVerificationCodeFromMessages(messages, options = {}) {
    const filterAfterTimestamp = Number(options.filterAfterTimestamp || 0) || 0;
    const senderFilters = (options.senderFilters || []).map(normalizeFilterValue).filter(Boolean);
    const subjectFilters = (options.subjectFilters || []).map(normalizeFilterValue).filter(Boolean);
    const requiredKeywords = (options.requiredKeywords || []).map(normalizeFilterValue).filter(Boolean);
    const excludedCodes = new Set((options.excludeCodes || []).map((value) => String(value || '').trim()).filter(Boolean));
    const hasExplicitFilters = senderFilters.length > 0 || subjectFilters.length > 0 || requiredKeywords.length > 0;

    const sortedMessages = (Array.isArray(messages) ? messages : [])
      .map((raw) => normalizeMessage(raw, raw?.mailbox))
      .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));

    for (const message of sortedMessages) {
      const receivedAt = getMessageTimestamp(message);
      if (receivedAt && receivedAt < filterAfterTimestamp) {
        continue;
      }

      const sender = normalizeFilterValue(getMessageSender(message));
      const subject = normalizeFilterValue(message?.subject);
      const preview = normalizeFilterValue(message?.bodyPreview);
      const searchText = normalizeFilterValue(getMessageSearchText(message));
      const code = extractVerificationCode(getMessageSearchText(message), {
        codePatterns: options.codePatterns,
      });
      if (!code || excludedCodes.has(code)) {
        continue;
      }

      const senderMatched = senderFilters.length === 0
        ? false
        : senderFilters.some((filter) => sender.includes(filter) || preview.includes(filter) || searchText.includes(filter));
      const subjectMatched = subjectFilters.length === 0
        ? false
        : subjectFilters.some((filter) => subject.includes(filter) || preview.includes(filter) || searchText.includes(filter));
      const keywordMatched = requiredKeywords.length === 0
        ? false
        : requiredKeywords.some((filter) => preview.includes(filter) || searchText.includes(filter));
      if (hasExplicitFilters && !senderMatched && !subjectMatched && !keywordMatched) {
        continue;
      }

      return {
        code,
        emailTimestamp: receivedAt || Date.now(),
        messageId: message?.id || null,
        sender: getMessageSender(message),
        subject: String(message?.subject || ''),
        mailbox: message?.mailbox || 'INBOX',
        message,
      };
    }

    return null;
  }

  async function fetchMicrosoftMailboxMessages(options = {}) {
    const {
      clientId,
      refreshToken,
      mailbox = 'INBOX',
      top = 5,
      fetchImpl,
      signal,
      log = null,
    } = options;

    if (!refreshToken) {
      throw new Error('Microsoft refresh token is empty.');
    }
    if (!clientId) {
      throw new Error('Microsoft client_id is empty.');
    }

    const errors = [];
    for (const plan of TRANSPORT_PLANS) {
      for (const strategyName of plan.strategyNames) {
        try {
          const tokenData = await exchangeRefreshToken(clientId, refreshToken, {
            fetchImpl,
            signal,
            strategyName,
          });
          const rawMessages = plan.transport === 'graph'
            ? await fetchGraphMessages(tokenData.access_token, { mailbox, top, fetchImpl, signal })
            : await fetchOutlookMessages(tokenData.access_token, { mailbox, top, fetchImpl, signal });

          return {
            tokenData,
            nextRefreshToken: String(tokenData?.refresh_token || '').trim(),
            tokenStrategy: strategyName,
            transport: plan.transport,
            mailbox: normalizeMailboxLabel(mailbox),
            messages: rawMessages.map((message) => normalizeMessage(message, mailbox)),
          };
        } catch (error) {
          const message = error?.message || String(error);
          errors.push(`${plan.transport}/${strategyName}: ${message}`);
          if (typeof log === 'function') {
            log(`mailbox=${normalizeMailboxLabel(mailbox)} ${plan.transport}/${strategyName} failed: ${message}`);
          }
        }
      }
    }

    throw new Error(`Microsoft mailbox request failed: ${errors.join(' | ')}`);
  }

  function delay(timeoutMs, signal) {
    if (timeoutMs <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);
      const onAbort = () => {
        cleanup();
        reject(signal.reason || new Error('Aborted'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };

      if (signal?.aborted) {
        cleanup();
        reject(signal.reason || new Error('Aborted'));
        return;
      }

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function fetchMicrosoftVerificationCode(options = {}) {
    const {
      token,
      refreshToken,
      clientId,
      maxRetries = 3,
      retryDelayMs = 10000,
      top = 5,
      log = null,
      filterAfterTimestamp = 0,
      senderFilters = [],
      subjectFilters = [],
      excludeCodes = [],
      mailboxes = ['INBOX'],
      fetchImpl,
      signal,
    } = options;

    let workingRefreshToken = String(refreshToken || token || '').trim();
    if (!workingRefreshToken) {
      throw new Error('Microsoft refresh token is empty.');
    }
    if (!clientId) {
      throw new Error('Microsoft client_id is empty.');
    }

    const normalizedMailboxes = normalizeMailboxList(mailboxes);
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const collectedMessages = [];
        for (const mailbox of normalizedMailboxes) {
          const result = await fetchMicrosoftMailboxMessages({
            clientId,
            refreshToken: workingRefreshToken,
            mailbox,
            top,
            fetchImpl,
            signal,
            log,
          });
          if (result.nextRefreshToken) {
            workingRefreshToken = result.nextRefreshToken;
          }
          collectedMessages.push(...result.messages);
        }

        const match = extractVerificationCodeFromMessages(collectedMessages, {
          filterAfterTimestamp,
          senderFilters,
          subjectFilters,
          requiredKeywords: options.requiredKeywords,
          codePatterns: options.codePatterns,
          excludeCodes,
        });
        if (match) {
          return {
            ...match,
            nextRefreshToken: workingRefreshToken,
            messages: collectedMessages,
          };
        }

        lastError = new Error('No matching Microsoft verification email found.');
      } catch (error) {
        lastError = error;
      }

      if (attempt < maxRetries) {
        if (typeof log === 'function') {
          log(`attempt ${attempt}/${maxRetries} found no matching Microsoft mail, retrying...`);
        }
        await delay(retryDelayMs, signal);
      }
    }

    throw lastError || new Error('No matching Microsoft verification email found.');
  }

  const api = {
    CODE_PATTERN,
    exchangeRefreshToken,
    extractVerificationCodeFromMessages,
    fetchGraphMessages,
    fetchMicrosoftMailboxMessages,
    fetchMicrosoftVerificationCode,
    fetchOutlookMessages,
    getMessageSender,
    getMessageTimestamp,
    normalizeMailboxId,
    normalizeMailboxLabel,
    normalizeMessage,
  };

  globalScope.MultiPageMicrosoftEmail = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
