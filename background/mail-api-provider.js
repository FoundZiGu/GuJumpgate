(function mailApiProviderModule(root, factory) {
  root.MultiPageBackgroundMailApiProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createMailApiProviderModule() {
  const DEFAULT_MAIL_API_LEASE_DAYS = 30;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function createMailApiProvider(deps = {}) {
    const {
      addLog = async () => {},
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getState = async () => ({}),
      normalizeHotmailMailApiMessages = (messages) => (Array.isArray(messages) ? messages : []),
      persistRegistrationEmailState = null,
      pickVerificationMessageWithTimeFallback,
      setEmailState = async () => {},
      setPersistentSettings = async () => {},
      setState = async () => {},
      sleepWithStop = async () => {},
      throwIfStopped = () => {},
    } = deps;

    function normalizeMailApiBaseUrl(value = '') {
      const rawValue = String(value || '').trim();
      if (!rawValue) return '';
      const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawValue) ? rawValue : `https://${rawValue}`;
      try {
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        parsed.hash = '';
        parsed.search = '';
        const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/g, '');
        return `${parsed.origin}${pathname}`;
      } catch {
        return '';
      }
    }

    function normalizeMailApiGroupId(value = '') {
      const rawValue = String(value || '').trim();
      if (!rawValue) return '';
      const numeric = Number(rawValue);
      return Number.isSafeInteger(numeric) && numeric > 0 ? String(numeric) : '';
    }

    function normalizeMailApiLeaseDays(value, fallback = DEFAULT_MAIL_API_LEASE_DAYS) {
      const rawValue = String(value ?? '').trim();
      const fallbackValue = Math.max(1, Math.min(365, Math.floor(Number(fallback) || DEFAULT_MAIL_API_LEASE_DAYS)));
      if (!rawValue) return fallbackValue;
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) return fallbackValue;
      return Math.max(1, Math.min(365, Math.floor(numeric)));
    }

    function normalizeMailApiAddress(value = '') {
      return String(value || '').trim().toLowerCase();
    }

    function normalizeMailApiLeases(value = {}) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
      }
      const leases = {};
      for (const [rawEmail, rawLease] of Object.entries(value)) {
        const email = normalizeMailApiAddress(rawLease?.email || rawEmail);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          continue;
        }
        const expiresAt = Number(rawLease?.expiresAt ?? rawLease?.leaseExpiresAt ?? rawLease);
        if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
          continue;
        }
        leases[email] = {
          email,
          expiresAt,
          lastUsedAt: Math.max(0, Number(rawLease?.lastUsedAt) || 0),
        };
      }
      return leases;
    }

    function getMailApiConfig(state = {}) {
      return {
        baseUrl: normalizeMailApiBaseUrl(state.mailApiBaseUrl),
        apiKey: String(state.mailApiKey || '').trim(),
        groupId: normalizeMailApiGroupId(state.mailApiGroupId),
        leaseDays: normalizeMailApiLeaseDays(state.mailApiLeaseDays),
      };
    }

    function ensureMailApiConfig(state = {}) {
      const config = getMailApiConfig(state);
      if (!config.baseUrl) {
        throw new Error('Mail API 地址为空或格式无效。');
      }
      if (!config.apiKey) {
        throw new Error('Mail API Key 为空。');
      }
      return config;
    }

    async function requestMailApiJson(config, path, options = {}) {
      if (!fetchImpl) {
        throw new Error('Mail API 当前运行环境不支持 fetch。');
      }
      const { searchParams = {}, timeoutMs = 20000 } = options;
      const url = new URL(`${config.baseUrl}${String(path || '').startsWith('/') ? '' : '/'}${path}`);
      Object.entries(searchParams || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value) !== '') {
          url.searchParams.set(key, String(value));
        }
      });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-API-Key': config.apiKey,
          },
          signal: controller.signal,
        });
      } catch (error) {
        const message = error?.name === 'AbortError'
          ? `Mail API 请求超时（>${Math.round(timeoutMs / 1000)} 秒）`
          : `Mail API 请求失败：${error?.message || error}`;
        throw new Error(message);
      } finally {
        clearTimeout(timeoutId);
      }

      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = text;
      }
      if (!response.ok) {
        const payloadError = payload && typeof payload === 'object'
          ? (payload.message || payload.error || payload.msg)
          : '';
        throw new Error(`Mail API 请求失败：${payloadError || text || `HTTP ${response.status}`}`);
      }
      if (payload && typeof payload === 'object' && payload.success === false) {
        throw new Error(`Mail API 业务错误：${payload.message || payload.error || 'success=false'}`);
      }
      return payload;
    }

    function normalizeMailApiAccount(row = {}) {
      if (!row || typeof row !== 'object') return null;
      const email = normalizeMailApiAddress(row.email || row.mail || row.address);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
      return {
        id: String(row.id || email),
        email,
        aliases: Array.isArray(row.aliases)
          ? row.aliases.map((alias) => normalizeMailApiAddress(alias)).filter(Boolean)
          : [],
        status: String(row.status || '').trim().toLowerCase(),
        groupName: String(row.group_name || row.groupName || '').trim(),
      };
    }

    function getMailApiAccountRows(payload) {
      if (Array.isArray(payload)) return payload;
      if (!payload || typeof payload !== 'object') return [];
      if (Array.isArray(payload.accounts)) return payload.accounts;
      if (Array.isArray(payload.data)) return payload.data;
      if (Array.isArray(payload.items)) return payload.items;
      return [];
    }

    async function listMailApiAccounts(state = {}) {
      const config = ensureMailApiConfig(state);
      const payload = await requestMailApiJson(config, '/api/external/accounts', {
        searchParams: {
          limit: 10000,
          offset: 0,
          sort_by: 'created_at',
          sort_order: 'asc',
          group_id: config.groupId,
        },
      });
      return getMailApiAccountRows(payload)
        .map((row) => normalizeMailApiAccount(row))
        .filter(Boolean);
    }

    function isMailApiLeaseActive(leases = {}, email = '', now = Date.now()) {
      const normalizedEmail = normalizeMailApiAddress(email);
      const lease = normalizeMailApiLeases(leases)[normalizedEmail];
      return Boolean(lease && Number(lease.expiresAt) > now);
    }

    function isMailApiAccountAvailable(account = {}, leases = {}, now = Date.now()) {
      if (!account?.email) return false;
      if (['disabled', 'inactive', 'deleted'].includes(String(account.status || '').toLowerCase())) {
        return false;
      }
      return !isMailApiLeaseActive(leases, account.email, now);
    }

    async function persistResolvedEmailState(state = null, email, options = {}) {
      if (typeof persistRegistrationEmailState === 'function') {
        await persistRegistrationEmailState(state, email, options);
        return;
      }
      await setEmailState(email, options);
    }

    async function leaseMailApiEmail(state = {}, account = {}, options = {}) {
      const email = normalizeMailApiAddress(account.email);
      const leaseDays = normalizeMailApiLeaseDays(state.mailApiLeaseDays);
      const now = Date.now();
      const leases = normalizeMailApiLeases(state.mailApiLeases);
      const nextLease = {
        email,
        expiresAt: now + leaseDays * MS_PER_DAY,
        lastUsedAt: now,
      };
      const nextLeases = {
        ...leases,
        [email]: nextLease,
      };
      const updates = {
        mailApiLeases: nextLeases,
        currentMailApiEmail: email,
      };
      await setPersistentSettings(updates);
      await setState(updates);
      await persistResolvedEmailState(state, email, {
        source: 'mail-api',
        preserveAccountIdentity: Boolean(options?.preserveAccountIdentity),
      });
      return nextLease;
    }

    async function ensureMailApiAccountForFlow(options = {}) {
      throwIfStopped();
      const state = await getState();
      ensureMailApiConfig(state);
      const now = Date.now();
      const currentEmail = normalizeMailApiAddress(state.currentMailApiEmail || state.email);
      if (options?.allowReuse !== false && currentEmail && isMailApiLeaseActive(state.mailApiLeases, currentEmail, now)) {
        await persistResolvedEmailState(state, currentEmail, { source: 'mail-api:reuse' });
        return { email: currentEmail, reused: true };
      }

      const accounts = await listMailApiAccounts(state);
      const leases = normalizeMailApiLeases(state.mailApiLeases);
      const account = accounts.find((candidate) => isMailApiAccountAvailable(candidate, leases, now));
      if (!account) {
        throw new Error('Mail API 没有可用邮箱账号：账号池为空或全部仍在有效期内。');
      }
      const lease = await leaseMailApiEmail(state, account, options);
      await addLog(`Mail API：已分配邮箱 ${account.email}，有效期 ${normalizeMailApiLeaseDays(state.mailApiLeaseDays)} 天。`, 'ok');
      return { ...account, lease };
    }

    function normalizeMailApiMessage(row = {}) {
      return {
        ...row,
        bodyPreview: row.bodyPreview || row.body_preview || row.preview || '',
        receivedDateTime: row.receivedDateTime || row.received_at || row.receivedAt || row.date || row.created_at || '',
      };
    }

    function normalizeMailApiMessages(payload) {
      const rows = payload && typeof payload === 'object' && Array.isArray(payload.emails)
        ? payload.emails
        : getMailApiAccountRows(payload);
      return normalizeHotmailMailApiMessages(rows.map((row) => normalizeMailApiMessage(row)));
    }

    function summarizeMailApiMessagesForLog(messages = []) {
      return messages
        .slice()
        .sort((left, right) => (Date.parse(right.receivedDateTime || '') || 0) - (Date.parse(left.receivedDateTime || '') || 0))
        .slice(0, 3)
        .map((message) => {
          const receivedAt = message?.receivedDateTime || '未知时间';
          const sender = message?.from?.emailAddress?.address || '未知发件人';
          const subject = message?.subject || '（无主题）';
          const preview = String(message?.bodyPreview || '').replace(/\s+/g, ' ').trim().slice(0, 80);
          return `${receivedAt} | ${sender} | ${subject} | ${preview}`;
        })
        .join(' || ');
    }

    async function listMailApiMessages(state = {}, options = {}) {
      const config = ensureMailApiConfig(state);
      const targetEmail = normalizeMailApiAddress(options.email || state.email || state.currentMailApiEmail);
      if (!targetEmail) {
        throw new Error('Mail API 查信前缺少目标邮箱。');
      }
      const payload = await requestMailApiJson(config, '/api/external/emails', {
        searchParams: {
          email: targetEmail,
          folder: options.folder || 'all',
          top: options.top || 10,
          skip: options.skip || 0,
        },
      });
      return {
        config,
        messages: normalizeMailApiMessages(payload),
      };
    }

    async function pollMailApiVerificationCode(step, state, pollPayload = {}) {
      const latestState = state || await getState();
      const targetEmail = normalizeMailApiAddress(pollPayload.targetEmail || latestState.email || latestState.currentMailApiEmail);
      if (!targetEmail) {
        throw new Error('Mail API 轮询前缺少目标邮箱地址。');
      }
      await addLog(`步骤 ${step}：正在通过 Mail API 轮询邮件（${targetEmail}）...`, 'info');
      const maxAttempts = Number(pollPayload.maxAttempts) || 5;
      const intervalMs = Number(pollPayload.intervalMs) || 3000;
      let lastError = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfStopped();
        try {
          const { messages } = await listMailApiMessages(latestState, {
            email: targetEmail,
            top: pollPayload.limit || 10,
          });
          const matchResult = pickVerificationMessageWithTimeFallback(messages, {
            afterTimestamp: pollPayload.filterAfterTimestamp || 0,
            senderFilters: pollPayload.senderFilters || [],
            subjectFilters: pollPayload.subjectFilters || [],
            requiredKeywords: pollPayload.requiredKeywords || [],
            codePatterns: pollPayload.codePatterns || [],
            excludeCodes: pollPayload.excludeCodes || [],
          });
          const match = matchResult.match;
          if (match?.code) {
            if (matchResult.usedRelaxedFilters) {
              const fallbackLabel = matchResult.usedTimeFallback ? '宽松匹配 + 时间回退' : '宽松匹配';
              await addLog(`步骤 ${step}：严格规则未命中，已改用 ${fallbackLabel} 并命中 Mail API 验证码。`, 'warn');
            }
            return {
              ok: true,
              code: match.code,
              emailTimestamp: match.receivedAt || Date.now(),
              mailId: match.message?.id || '',
            };
          }
          lastError = new Error(`步骤 ${step}：暂未在 Mail API 中找到匹配验证码（${attempt}/${maxAttempts}）。`);
          await addLog(lastError.message, attempt === maxAttempts ? 'warn' : 'info');
          const sample = summarizeMailApiMessagesForLog(messages);
          if (sample) {
            await addLog(`步骤 ${step}：最近邮件样本：${sample}`, 'info');
          }
        } catch (error) {
          lastError = error;
          await addLog(`步骤 ${step}：Mail API 轮询失败：${error?.message || error}`, 'warn');
        }
        if (attempt < maxAttempts) {
          await sleepWithStop(intervalMs);
        }
      }
      throw lastError || new Error(`步骤 ${step}：未在 Mail API 中找到新的匹配验证码。`);
    }

    return {
      DEFAULT_MAIL_API_LEASE_DAYS,
      ensureMailApiAccountForFlow,
      getMailApiConfig,
      listMailApiAccounts,
      listMailApiMessages,
      normalizeMailApiBaseUrl,
      normalizeMailApiGroupId,
      normalizeMailApiLeaseDays,
      normalizeMailApiLeases,
      pollMailApiVerificationCode,
    };
  }

  return {
    DEFAULT_MAIL_API_LEASE_DAYS,
    createMailApiProvider,
  };
});
