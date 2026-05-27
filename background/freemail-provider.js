(function freemailProviderModule(root, factory) {
  root.MultiPageBackgroundFreemailProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createFreemailProviderModule() {
  function createFreemailProvider(deps = {}) {
    const {
      addLog = async () => {},
      buildFreemailHeaders,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      FREEMAIL_DEFAULT_PAGE_SIZE = 20,
      FREEMAIL_GENERATOR = 'freemail',
      FREEMAIL_PROVIDER = 'freemail',
      getFreemailAddressFromResponse,
      getState = async () => ({}),
      joinFreemailUrl,
      normalizeFreemailAddress,
      normalizeFreemailBaseUrl,
      normalizeFreemailDomain,
      normalizeFreemailDomains,
      normalizeFreemailMessages,
      persistRegistrationEmailState = null,
      pickVerificationMessageWithTimeFallback,
      setEmailState = async () => {},
      setPersistentSettings = async () => {},
      sleepWithStop = async () => {},
      throwIfStopped = () => {},
    } = deps;

    function normalizeFreemailReceiveMailbox(value = '') {
      const normalized = normalizeFreemailAddress(value);
      if (!normalized) return '';
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
    }

    function getFreemailConfig(state = {}) {
      return {
        baseUrl: normalizeFreemailBaseUrl(state.freemailBaseUrl),
        adminUsername: String(state.freemailAdminUsername || '').trim(),
        adminPassword: String(state.freemailAdminPassword || ''),
        domain: normalizeFreemailDomain(state.freemailDomain),
        domains: normalizeFreemailDomains(state.freemailDomains),
      };
    }

    function ensureFreemailConfig(state, options = {}) {
      const { requireAuth = false, requireDomain = false } = options;
      const config = getFreemailConfig(state);
      if (!config.baseUrl) throw new Error('freemail 服务地址为空或格式无效。');
      if (requireAuth && (!config.adminUsername || !config.adminPassword)) {
        throw new Error('freemail 缺少管理员账号或密码。');
      }
      if (requireDomain && !config.domain) {
        throw new Error('freemail 域名为空或格式无效。');
      }
      return config;
    }

    async function requestFreemailJson(config, path, options = {}) {
      if (!fetchImpl) throw new Error('freemail 当前运行环境不支持 fetch。');
      const { method = 'GET', payload, searchParams, timeoutMs = 20000 } = options;
      const url = new URL(joinFreemailUrl(config.baseUrl, path));
      if (searchParams && typeof searchParams === 'object') {
        for (const [key, value] of Object.entries(searchParams)) {
          if (value === undefined || value === null || value === '') continue;
          url.searchParams.set(key, String(value));
        }
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method,
          credentials: 'include',
          headers: buildFreemailHeaders(config, { json: payload !== undefined }),
          body: payload !== undefined ? JSON.stringify(payload) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        const message = err?.name === 'AbortError'
          ? `freemail 请求超时（>${Math.round(timeoutMs / 1000)} 秒）`
          : `freemail 请求失败：${err.message}`;
        throw new Error(message);
      } finally {
        clearTimeout(timeoutId);
      }
      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = text;
      }
      if (!response.ok) {
        const payloadError = typeof parsed === 'object' && parsed
          ? (parsed.message || parsed.error || parsed.msg)
          : '';
        throw new Error(
          `freemail 请求失败：${payloadError || text || `HTTP ${response.status}`}`
        );
      }
      return parsed;
    }

    async function ensureFreemailSession(state) {
      const config = ensureFreemailConfig(state || await getState(), { requireAuth: true });
      const result = await requestFreemailJson(config, '/api/login', {
        method: 'POST',
        payload: { username: config.adminUsername, password: config.adminPassword },
      });
      if (result?.success === false) throw new Error('freemail 管理员登录失败。');
      return config;
    }

    async function persistResolvedEmailState(state = null, email, options = {}) {
      if (typeof persistRegistrationEmailState === 'function') {
        await persistRegistrationEmailState(state, email, options);
        return;
      }
      await setEmailState(email, options);
    }

    async function fetchFreemailDomains(state = null, sessionConfig = null) {
      const latestState = state || await getState();
      const config = sessionConfig || await ensureFreemailSession(latestState);
      const payload = await requestFreemailJson(config, '/api/domains');
      const domains = normalizeFreemailDomains(payload);
      if (domains.length) {
        await setPersistentSettings({
          freemailDomains: domains,
          freemailDomain: domains[0],
        });
      }
      return domains;
    }

    async function fetchFreemailAddress(state, options = {}) {
      throwIfStopped();
      const latestState = state || await getState();
      const config = await ensureFreemailSession(latestState);
      const domains = config.domains.length
        ? config.domains
        : await fetchFreemailDomains(latestState, config);
      const activeDomain = config.domain || domains[0] || '';
      const domainIndex = domains.indexOf(activeDomain);
      if (activeDomain && domainIndex < 0) {
        throw new Error(`freemail 主域名 ${activeDomain} 不在 /api/domains 返回列表中。`);
      }
      const local = String(options.localPart || options.name || '').trim().toLowerCase();
      const path = local ? '/api/create' : '/api/generate';
      const payload = local ? { local, domainIndex } : undefined;
      const result = await requestFreemailJson(config, path, {
        method: local ? 'POST' : 'GET',
        payload,
        searchParams: local ? undefined : { domainIndex: Math.max(0, domainIndex) },
      });
      const address = normalizeFreemailAddress(getFreemailAddressFromResponse(result));
      if (!address) throw new Error('freemail 未返回可用邮箱地址。');
      await persistResolvedEmailState(latestState, address, {
        source: 'generated:freemail',
        preserveAccountIdentity: Boolean(options?.preserveAccountIdentity),
      });
      await addLog(`freemail：已生成 ${address}`, 'ok');
      return address;
    }

    function resolveFreemailPollTargetEmail(state = {}, pollPayload = {}) {
      const mailProvider = String(state?.mailProvider || '').trim().toLowerCase();
      const emailGenerator = String(state?.emailGenerator || '').trim().toLowerCase();
      const shouldUseCurrentEmail = mailProvider === FREEMAIL_PROVIDER
        && emailGenerator !== FREEMAIL_GENERATOR;
      if (shouldUseCurrentEmail) return normalizeFreemailReceiveMailbox(state.email);
      return normalizeFreemailReceiveMailbox(pollPayload.targetEmail)
        || normalizeFreemailReceiveMailbox(state.email);
    }

    async function listFreemailMessages(state, options = {}) {
      const latestState = state || await getState();
      const config = await ensureFreemailSession(latestState);
      const address = normalizeFreemailReceiveMailbox(options.address);
      const payload = await requestFreemailJson(config, '/api/emails', {
        searchParams: {
          mailbox: address,
          limit: Number(options.limit) || FREEMAIL_DEFAULT_PAGE_SIZE,
        },
      });
      return { config, messages: normalizeFreemailMessages(payload) };
    }

    async function pollFreemailVerificationCode(step, state, pollPayload = {}) {
      const latestState = state || await getState();
      ensureFreemailConfig(latestState, { requireAuth: true });
      const targetEmail = resolveFreemailPollTargetEmail(latestState, pollPayload);
      if (!targetEmail) {
        throw new Error('freemail 轮询前缺少目标邮箱地址，请先生成或填写注册邮箱。');
      }
      await addLog(`步骤 ${step}：正在轮询 freemail 邮件（${targetEmail}）...`, 'info');
      const maxAttempts = Number(pollPayload.maxAttempts) || 5;
      const intervalMs = Number(pollPayload.intervalMs) || 3000;
      let lastError = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        throwIfStopped();
        try {
          const { messages } = await listFreemailMessages(latestState, {
            address: targetEmail,
            limit: pollPayload.limit || FREEMAIL_DEFAULT_PAGE_SIZE,
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
            return {
              ok: true,
              code: match.code,
              emailTimestamp: match.receivedAt || Date.now(),
              mailId: match.message?.id || '',
            };
          }
          lastError = new Error(`步骤 ${step}：暂未在 freemail 中找到匹配验证码（${attempt}/${maxAttempts}）。`);
          await addLog(lastError.message, attempt === maxAttempts ? 'warn' : 'info');
        } catch (err) {
          lastError = err;
          await addLog(`步骤 ${step}：freemail 轮询失败：${err.message}`, 'warn');
        }
        if (attempt < maxAttempts) await sleepWithStop(intervalMs);
      }
      throw lastError || new Error(`步骤 ${step}：未在 freemail 中找到新的匹配验证码。`);
    }

    return {
      ensureFreemailConfig,
      fetchFreemailAddress,
      fetchFreemailDomains,
      getFreemailConfig,
      listFreemailMessages,
      normalizeFreemailReceiveMailbox,
      pollFreemailVerificationCode,
      requestFreemailJson,
      resolveFreemailPollTargetEmail,
    };
  }

  return { createFreemailProvider };
});
