(function outlookEmailProviderModule(root, factory) {
  root.MultiPageBackgroundOutlookEmailProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOutlookEmailProviderModule() {
  function createOutlookEmailProvider(deps = {}) {
    const {
      addLog = async () => {},
      broadcastDataUpdate = null,
      buildOutlookEmailApiHeaders,
      extractVerificationCodeFromMessage = null,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getState = async () => ({}),
      joinOutlookEmailUrl,
      normalizeOutlookEmailAccount,
      normalizeOutlookEmailAddress,
      normalizeOutlookEmailBaseUrl,
      normalizeOutlookEmailCallerIdPrefix,
      normalizeOutlookEmailDomain,
      normalizeOutlookEmailMessages,
      normalizeOutlookEmailProjectKey,
      normalizeOutlookEmailTags = null,
      normalizeOutlookEmailVerificationCode,
      persistRegistrationEmailState = null,
      pickVerificationMessageWithTimeFallback = null,
      replaceOutlookEmailDomain,
      setEmailState = async () => {},
      setState = async () => {},
      sleepWithStop = async () => {},
      throwIfStopped = () => {},
      unwrapOutlookEmailResponse,
      OUTLOOK_EMAIL_GENERATOR = 'outlook-email',
    } = deps;

    const activeClaims = new Map();
    let sessionReady = false;
    let csrfToken = '';

    async function persistResolvedEmailState(state = null, email, options = {}) {
      if (typeof persistRegistrationEmailState === 'function') {
        await persistRegistrationEmailState(state, email, options);
        return;
      }
      await setEmailState(email, options);
    }

    function getOutlookEmailConfig(state = {}) {
      return {
        baseUrl: normalizeOutlookEmailBaseUrl(state.outlookEmailBaseUrl),
        apiKey: String(state.outlookEmailApiKey || '').trim(),
        password: String(state.outlookEmailPassword || ''),
        projectKey: normalizeOutlookEmailProjectKey(state.outlookEmailProjectKey),
        groupId: String(state.outlookEmailGroupId || '').trim(),
        groupName: String(state.outlookEmailGroupName || '').trim(),
        domain: normalizeOutlookEmailDomain(state.outlookEmailDomain),
        registeredTagName: String(state.outlookEmailRegisteredTagName || '').trim(),
        plusTagName: String(state.outlookEmailPlusTagName || '').trim(),
        skipTagName: String(state.outlookEmailSkipTagName || '').trim(),
        callerIdPrefix: normalizeOutlookEmailCallerIdPrefix(state.outlookEmailCallerIdPrefix) || 'gujumpgate',
      };
    }

    function ensureOutlookEmailConfig(state, options = {}) {
      const { requireApiKey = true, requirePassword = false } = options;
      const config = getOutlookEmailConfig(state);
      if (!config.baseUrl) throw new Error('outlookEmail 服务地址为空或格式无效。');
      if (requireApiKey && !config.apiKey) throw new Error('outlookEmail API Key 为空。');
      if (requirePassword && !config.password) throw new Error('outlookEmail 密码为空，无法使用分组、项目领取或标签写入。');
      return config;
    }

    async function requestJson(config, path, options = {}) {
      if (!fetchImpl) throw new Error('outlookEmail 当前运行环境不支持 fetch。');
      const {
        method = 'GET',
        payload,
        searchParams = null,
        timeoutMs = 20000,
        auth = 'api',
      } = options;
      const rawPath = String(path || '').trim();
      const url = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawPath)
        ? new URL(rawPath)
        : new URL(joinOutlookEmailUrl(config.baseUrl, rawPath));
      if (searchParams && typeof searchParams === 'object') {
        for (const [key, value] of Object.entries(searchParams)) {
          if (value === undefined || value === null || value === '') continue;
          url.searchParams.set(key, String(value));
        }
      }

      const headers = auth === 'session'
        ? {
          ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
          Accept: 'application/json',
          ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
        }
        : buildOutlookEmailApiHeaders(config, { json: payload !== undefined });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method,
          headers,
          body: payload !== undefined ? JSON.stringify(payload) : undefined,
          credentials: auth === 'session' ? 'include' : 'omit',
          redirect: 'follow',
          signal: controller.signal,
        });
      } catch (err) {
        const message = err?.name === 'AbortError'
          ? `outlookEmail 请求超时（>${Math.round(timeoutMs / 1000)} 秒）`
          : `outlookEmail 请求失败：${err?.message || err}`;
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
        const parsedError = parsed && typeof parsed === 'object' ? (parsed.error || parsed.message || parsed.msg) : '';
        throw new Error(`outlookEmail 请求失败：${parsedError || text || `HTTP ${response.status}`}`);
      }
      return unwrapOutlookEmailResponse(parsed);
    }

    async function ensureSession(config) {
      if (sessionReady && csrfToken) return true;
      const login = await requestJson(config, '/api/extension/login', {
        method: 'POST',
        payload: { password: config.password, next: '/' },
        auth: 'session',
        timeoutMs: 15000,
      });
      const launchUrl = String(login?.launch_url || '').trim();
      if (!launchUrl) throw new Error('outlookEmail 登录未返回 launch_url。');
      await requestJson(config, launchUrl, { auth: 'session', timeoutMs: 15000 });
      const csrf = await requestJson(config, '/api/csrf-token', { auth: 'session', timeoutMs: 15000 });
      csrfToken = String(csrf?.csrf_token || '').trim();
      sessionReady = true;
      return true;
    }

    function buildRandomIdentifier() {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function normalizeIdentifierPart(value = '') {
      return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-._]+|[-._]+$/g, '');
    }

    function buildCallerId(config, state = {}, taskId = '') {
      const explicit = normalizeIdentifierPart(state.currentOutlookEmailClaim?.callerId);
      if (explicit) return explicit;
      const suffix = normalizeIdentifierPart(state.runId || state.activeRunId || taskId) || normalizeIdentifierPart(buildRandomIdentifier());
      return `${config.callerIdPrefix}-${suffix}`;
    }

    function resolveTaskId(state = {}) {
      return normalizeIdentifierPart(
        state.currentOutlookEmailClaim?.taskId
        || state.taskId
        || state.activeRunId
        || state.runId
      ) || buildRandomIdentifier();
    }

    function rememberClaim(claim = {}) {
      for (const key of [claim.taskId, claim.accountId, claim.address].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)) {
        activeClaims.set(key, claim);
      }
    }

    function getRememberedClaim(claim = {}) {
      for (const key of [claim.taskId, claim.accountId, claim.address].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)) {
        const remembered = activeClaims.get(key);
        if (remembered) return remembered;
      }
      return null;
    }

    async function resolveGroupId(config) {
      if (config.groupId) return config.groupId;
      if (!config.groupName) return '';
      await ensureSession(config);
      const result = await requestJson(config, '/api/groups', { auth: 'session' });
      const groups = Array.isArray(result?.groups) ? result.groups : [];
      const group = groups.find((item) => String(item?.name || '').trim() === config.groupName);
      if (!group?.id) throw new Error(`outlookEmail 未找到邮箱分组：${config.groupName}`);
      return String(group.id);
    }

    async function findAccountByEmail(config, email) {
      const normalizedEmail = normalizeOutlookEmailAddress(email);
      if (!normalizedEmail) return null;
      const groupId = await resolveGroupId(config).catch(() => '');
      const result = await requestJson(config, '/api/external/accounts', {
        searchParams: { group_id: groupId || undefined },
      });
      const accounts = Array.isArray(result?.accounts) ? result.accounts : [];
      return accounts
        .map(normalizeOutlookEmailAccount)
        .find((account) => account.address === normalizedEmail || account.primaryEmail === normalizedEmail)
        || null;
    }

    async function listExternalAccounts(config) {
      const groupId = await resolveGroupId(config).catch(() => config.groupId || '');
      const result = await requestJson(config, '/api/external/accounts', {
        searchParams: { group_id: groupId || undefined },
      });
      return (Array.isArray(result?.accounts) ? result.accounts : [])
        .map(normalizeOutlookEmailAccount)
        .filter((account) => account.accountId && (account.address || account.primaryEmail));
    }

    async function getAccountDetail(config, accountId) {
      const normalizedId = String(accountId || '').trim();
      if (!normalizedId) return null;
      await ensureSession(config);
      const result = await requestJson(config, `/api/accounts/${encodeURIComponent(normalizedId)}`, {
        auth: 'session',
      });
      return normalizeOutlookEmailAccount(result?.account || result);
    }

    function normalizeTagName(value = '') {
      return String(value || '').trim().toLowerCase();
    }

    async function resolveAccountTags(config, account = {}) {
      const directTags = typeof normalizeOutlookEmailTags === 'function'
        ? normalizeOutlookEmailTags(account.tags || account.raw?.tags || [])
        : (Array.isArray(account.tags) ? account.tags : []);
      if (directTags.length) return directTags;
      const detail = await getAccountDetail(config, account.accountId).catch(() => null);
      return typeof normalizeOutlookEmailTags === 'function'
        ? normalizeOutlookEmailTags(detail?.tags || detail?.raw?.tags || [])
        : (Array.isArray(detail?.tags) ? detail.tags : []);
    }

    async function accountHasSkipTag(config, account = {}) {
      const skipTagName = normalizeTagName(config.skipTagName);
      if (!skipTagName) return false;
      const tags = await resolveAccountTags(config, account);
      return tags.some((tag) => normalizeTagName(tag?.name || tag) === skipTagName);
    }

    function resolveRegistrationAddress(account, config) {
      const address = normalizeOutlookEmailAddress(account.address || account.primaryEmail);
      return config.domain ? replaceOutlookEmailDomain(address, config.domain) : address;
    }

    async function requestProjectClaim(config, taskId, callerId) {
      return normalizeOutlookEmailAccount(await requestJson(config, `/api/projects/${encodeURIComponent(config.projectKey)}/claim-random`, {
        method: 'POST',
        auth: 'session',
        payload: {
          caller_id: callerId,
          task_id: taskId,
          lease_seconds: 600,
        },
      }));
    }

    async function releaseProjectClaim(config, claim = {}, options = {}) {
      if (!config.projectKey || !claim?.claimToken) {
        return { released: false, reason: 'not_project_claim' };
      }
      await requestJson(config, `/api/projects/${encodeURIComponent(claim.projectKey || config.projectKey)}/release`, {
        method: 'POST',
        auth: 'session',
        payload: {
          account_id: claim.accountId,
          claim_token: claim.claimToken,
          caller_id: claim.callerId || '',
          task_id: claim.taskId || '',
          reason: options.reason || 'skip_tag_matched',
          detail: options.detail || '',
        },
      });
      await addLog(`outlookEmail：已释放项目邮箱 ${claim.address || claim.accountId}`, options.level || 'warn');
      return { released: true };
    }

    async function pickDirectAccountClaim(config, latestState = {}, options = {}) {
      const accounts = await listExternalAccounts(config);
      if (!accounts.length) {
        throw new Error(config.groupId || config.groupName
          ? 'outlookEmail 分组内没有可用邮箱账号。'
          : 'outlookEmail 没有可用邮箱账号。');
      }
      const shuffled = accounts
        .map((account) => ({ account, sort: Math.random() }))
        .sort((left, right) => left.sort - right.sort)
        .map((entry) => entry.account);
      let skippedByTag = 0;
      for (const account of shuffled) {
        throwIfStopped();
        if (config.skipTagName && await accountHasSkipTag(config, account)) {
          skippedByTag += 1;
          await addLog(`outlookEmail：邮箱 ${account.primaryEmail || account.address} 已有标签 ${config.skipTagName}，已跳过。`, 'warn');
          continue;
        }
        const address = resolveRegistrationAddress(account, config);
        if (!address) continue;
        return {
          accountId: account.accountId,
          address,
          primaryEmail: account.primaryEmail || account.address,
          claimToken: '',
          projectKey: '',
          taskId: resolveTaskId(latestState),
          callerId: buildCallerId(config, latestState, resolveTaskId(latestState)),
          groupId: account.groupId || config.groupId || '',
          groupName: account.groupName || config.groupName || '',
          claimedAt: '',
          leaseExpiresAt: '',
          mode: 'direct',
        };
      }
      throw new Error(config.skipTagName
        ? `outlookEmail 分组内 ${skippedByTag} 个邮箱均命中跳过标签 ${config.skipTagName}，未找到可用邮箱。`
        : 'outlookEmail 分组内未找到可用邮箱。');
    }

    async function claimOutlookEmailAddress(state, options = {}) {
      throwIfStopped();
      const latestState = state || await getState();
      const config = ensureOutlookEmailConfig(latestState, { requirePassword: true });
      await ensureSession(config);
      const taskId = resolveTaskId(latestState);
      const callerId = buildCallerId(config, latestState, taskId);
      const maxSkipAttempts = Math.max(1, Math.min(20, Math.floor(Number(options.maxSkipAttempts || latestState.outlookEmailSkipTagMaxAttempts) || 10)));
      let skippedByTag = 0;

      if (!config.projectKey) {
        const storedClaim = await pickDirectAccountClaim(config, latestState, options);
        rememberClaim(storedClaim);
        await setState({ currentOutlookEmailClaim: storedClaim });
        await persistResolvedEmailState(latestState, storedClaim.address, {
          source: `generated:${OUTLOOK_EMAIL_GENERATOR}`,
          preserveAccountIdentity: Boolean(options?.preserveAccountIdentity),
        });
        await addLog(`outlookEmail：已从${config.groupId || config.groupName ? '指定分组' : '账号列表'}取用 ${storedClaim.primaryEmail || storedClaim.address}，注册使用 ${storedClaim.address}`, 'ok');
        return storedClaim.address;
      }

      for (let attempt = 1; attempt <= maxSkipAttempts; attempt += 1) {
        throwIfStopped();
        const claim = await requestProjectClaim(config, taskId, callerId);
        const address = resolveRegistrationAddress(claim, config);
        if (!claim.accountId || !address || !claim.claimToken) {
          throw new Error('outlookEmail 未返回有效的项目邮箱认领信息。');
        }
        const storedClaim = {
          accountId: claim.accountId,
          address,
          primaryEmail: claim.primaryEmail || claim.address,
          claimToken: claim.claimToken,
          projectKey: config.projectKey,
          taskId,
          callerId,
          groupId: claim.groupId || config.groupId || '',
          claimedAt: claim.claimedAt,
          leaseExpiresAt: claim.leaseExpiresAt,
          mode: 'project',
        };

        if (config.skipTagName && await accountHasSkipTag(config, {
          ...claim,
          ...storedClaim,
        })) {
          skippedByTag += 1;
          await addLog(`outlookEmail：邮箱 ${claim.primaryEmail || claim.address || address} 已有标签 ${config.skipTagName}，跳过并重新认领。`, 'warn');
          await releaseProjectClaim(config, storedClaim, {
            reason: 'skip_tag_matched',
            detail: `tag:${config.skipTagName}`,
            level: 'warn',
          });
          continue;
        }

        rememberClaim(storedClaim);
        await setState({ currentOutlookEmailClaim: storedClaim });
        await persistResolvedEmailState(latestState, address, {
          source: `generated:${OUTLOOK_EMAIL_GENERATOR}`,
          preserveAccountIdentity: Boolean(options?.preserveAccountIdentity),
        });
        await addLog(`outlookEmail：已认领 ${claim.primaryEmail || claim.address}，注册使用 ${address}`, 'ok');
        return address;
      }

      throw new Error(`outlookEmail 连续 ${skippedByTag} 个邮箱命中跳过标签 ${config.skipTagName}，未找到可用邮箱。`);
    }

    function resolveLifecycleClaim(state = {}, options = {}) {
      const stored = options.claim && typeof options.claim === 'object'
        ? options.claim
        : (state.currentOutlookEmailClaim || {});
      if (!stored || typeof stored !== 'object') return null;
      return {
        ...(getRememberedClaim(stored) || {}),
        ...stored,
        claimToken: stored.claimToken || getRememberedClaim(stored)?.claimToken || '',
      };
    }

    async function clearStoredClaim() {
      await setState({ currentOutlookEmailClaim: null });
    }

    async function completeOutlookEmailClaim(state, options = {}) {
      const latestState = state || await getState();
      const config = ensureOutlookEmailConfig(latestState, { requirePassword: true });
      const claim = resolveLifecycleClaim(latestState, options);
      if (!claim?.accountId) return { completed: false, reason: 'missing_claim' };
      if (!claim?.claimToken || !config.projectKey) {
        await clearStoredClaim();
        return { completed: true, reason: 'direct_account_no_project' };
      }
      await ensureSession(config);
      await requestJson(config, `/api/projects/${encodeURIComponent(claim.projectKey || config.projectKey)}/complete-success`, {
        method: 'POST',
        auth: 'session',
        payload: {
          account_id: claim.accountId,
          claim_token: claim.claimToken,
          caller_id: claim.callerId || '',
          task_id: claim.taskId || '',
          detail: options.detail || options.result || 'success',
        },
      });
      await clearStoredClaim();
      await addLog(`outlookEmail：已完成项目邮箱 ${claim.address || claim.accountId}`, 'ok');
      return { completed: true };
    }

    async function releaseOutlookEmailClaim(state, options = {}) {
      const latestState = state || await getState();
      const config = ensureOutlookEmailConfig(latestState, { requirePassword: true });
      const claim = resolveLifecycleClaim(latestState, options);
      if (!claim?.accountId || !claim?.claimToken) return { released: false, reason: 'missing_claim' };
      await ensureSession(config);
      await releaseProjectClaim(config, claim, {
        reason: options.reason || 'flow_abandoned',
        detail: options.detail || '',
        level: options.level || 'warn',
      });
      await clearStoredClaim();
      return { released: true };
    }

    async function ensureTag(config, tagName) {
      const name = String(tagName || '').trim();
      if (!name) return null;
      await ensureSession(config);
      const tagsResult = await requestJson(config, '/api/tags', { auth: 'session' });
      const tags = Array.isArray(tagsResult?.tags) ? tagsResult.tags : [];
      const existing = tags.find((tag) => String(tag?.name || '').trim() === name);
      if (existing?.id) return existing;
      const created = await requestJson(config, '/api/tags', {
        method: 'POST',
        auth: 'session',
        payload: { name, color: '#1a1a1a' },
      });
      return created?.tag || created;
    }

    async function markOutlookEmailTag(state = {}, tagName = '', options = {}) {
      const name = String(tagName || '').trim();
      if (!name) return { handled: false, reason: 'empty_tag' };
      const latestState = state || await getState();
      const config = ensureOutlookEmailConfig(latestState, { requirePassword: true });
      const claim = resolveLifecycleClaim(latestState, options);
      const email = normalizeOutlookEmailAddress(claim?.primaryEmail || claim?.address || latestState.email);
      const account = claim?.accountId ? claim : await findAccountByEmail(config, email);
      if (!account?.accountId) {
        await addLog(`outlookEmail：未找到可写入标签的邮箱账号 ${email || '(空)'}`, options.level || 'warn');
        return { handled: false, reason: 'missing_account' };
      }
      const tag = await ensureTag(config, name);
      if (!tag?.id) throw new Error(`outlookEmail 标签不可用：${name}`);
      await requestJson(config, '/api/accounts/tags', {
        method: 'POST',
        auth: 'session',
        payload: {
          account_ids: [Number(account.accountId)],
          tag_id: Number(tag.id),
          action: 'add',
        },
      });
      await addLog(`outlookEmail：已给 ${email || account.accountId} 打标签 ${name}`, options.level || 'ok');
      return { handled: true, accountId: account.accountId, tagId: tag.id, tagName: name };
    }

    function resolvePollTargetEmail(state = {}, pollPayload = {}) {
      return normalizeOutlookEmailAddress(
        pollPayload.targetEmail
        || state.registrationEmailState?.current
        || state.email
        || state.currentOutlookEmailClaim?.address
        || ''
      );
    }

    function resolveSinceMinutes(pollPayload = {}) {
      const configured = Math.floor(Number(pollPayload.sinceMinutes || pollPayload.since_minutes) || 0);
      if (configured > 0) return configured;
      const afterTimestamp = Number(pollPayload.filterAfterTimestamp) || 0;
      if (afterTimestamp <= 0) return 0;
      return Math.max(1, Math.ceil(Math.max(0, Date.now() - afterTimestamp) / 60000));
    }

    function extractCodeFromMessage(message = {}, pollPayload = {}) {
      const excludeCodes = new Set((Array.isArray(pollPayload.excludeCodes) ? pollPayload.excludeCodes : [])
        .map((value) => normalizeOutlookEmailVerificationCode(value))
        .filter(Boolean));
      const codeLength = Math.max(0, Math.floor(Number(pollPayload.codeLength) || 0));
      const codeRegex = String(pollPayload.codeRegex || '').trim();
      const text = [message.subject, message.bodyPreview, message.body].filter(Boolean).join('\n');
      let code = '';
      if (typeof extractVerificationCodeFromMessage === 'function') {
        code = extractVerificationCodeFromMessage({
          subject: message.subject,
          bodyPreview: [message.bodyPreview, message.body].filter(Boolean).join('\n'),
          from: message.from,
        }, {
          codeLength,
          codeRegex,
        }) || '';
      }
      if (!code) {
        const pattern = codeRegex
          ? new RegExp(codeRegex)
          : new RegExp(`\\b\\d{${codeLength > 0 ? codeLength : '4,8'}}\\b`);
        code = String(text.match(pattern)?.[1] || text.match(pattern)?.[0] || '').trim();
      }
      if (!code || excludeCodes.has(code)) return null;
      return {
        code,
        emailTimestamp: message.timestamp || Date.now(),
        mailId: message.id || '',
      };
    }

    function summarizeMessages(messages = []) {
      return messages
        .slice(0, 3)
        .map((message) => `${message.subject || '无主题'} @ ${message.date || message.timestamp || '无时间'}`)
        .join('；');
    }

    function extractCodeFromMessages(messages = [], pollPayload = {}) {
      const filterAfterTimestamp = Number(pollPayload.filterAfterTimestamp) || 0;
      const timeToleranceMs = Math.max(0, Number(pollPayload.timeToleranceMs) || 120000);
      const minTimestamp = filterAfterTimestamp > 0 ? filterAfterTimestamp - timeToleranceMs : 0;
      const sortedMessages = (Array.isArray(messages) ? messages : [])
        .slice()
        .sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0));
      const candidates = sortedMessages.filter((message) => !minTimestamp || !message.timestamp || message.timestamp >= minTimestamp);
      for (const message of candidates) {
        const verification = extractCodeFromMessage(message, pollPayload);
        if (verification?.code) {
          return {
            ...verification,
            matchedMessageSummary: summarizeMessages([message]),
          };
        }
      }
      return null;
    }

    async function pollOutlookEmailVerificationCode(step, state, pollPayload = {}) {
      const latestState = state || await getState();
      const config = ensureOutlookEmailConfig(latestState);
      const targetEmail = resolvePollTargetEmail(latestState, pollPayload);
      if (!targetEmail) throw new Error('outlookEmail 轮询前缺少目标邮箱地址，请先获取注册邮箱。');
      const maxAttempts = Math.max(1, Math.floor(Number(pollPayload.maxAttempts) || 5));
      const intervalMs = Math.max(0, Number(pollPayload.intervalMs) || 3000);
      const sinceMinutes = resolveSinceMinutes(pollPayload);
      let lastError = null;

      await addLog(`步骤 ${step}：正在轮询 outlookEmail 邮件（${targetEmail}）...`, 'info');
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfStopped();
        try {
          const payload = await requestJson(config, '/api/external/emails', {
            searchParams: {
              email: targetEmail,
              folder: 'all',
              top: 10,
              subject_contains: pollPayload.subjectContains || pollPayload.subject_contains || undefined,
              from_contains: pollPayload.fromContains || pollPayload.from_contains || undefined,
              keyword: pollPayload.keyword || undefined,
              since_minutes: sinceMinutes > 0 ? sinceMinutes : undefined,
            },
          });
          const messages = normalizeOutlookEmailMessages(payload);
          const verification = extractCodeFromMessages(messages, pollPayload);
          if (verification?.code) return { ok: true, ...verification };
          lastError = new Error(`步骤 ${step}：暂未在 outlookEmail 中找到匹配验证码（${attempt}/${maxAttempts}）。`);
          if (attempt === 1 && messages.length) {
            await addLog(`步骤 ${step}：outlookEmail 已返回 ${messages.length} 封邮件，最近邮件：${summarizeMessages(messages)}`, 'info');
          }
          await addLog(lastError.message, attempt === maxAttempts ? 'warn' : 'info');
        } catch (err) {
          lastError = err;
          await addLog(`步骤 ${step}：outlookEmail 轮询失败：${err?.message || err}`, 'warn');
        }
        if (attempt < maxAttempts) await sleepWithStop(intervalMs);
      }
      throw lastError || new Error(`步骤 ${step}：outlookEmail 轮询失败。`);
    }

    return {
      claimOutlookEmailAddress,
      completeOutlookEmailClaim,
      getOutlookEmailConfig,
      markOutlookEmailTag,
      pollOutlookEmailVerificationCode,
      releaseOutlookEmailClaim,
      requestOutlookEmailJson: requestJson,
    };
  }

  return { createOutlookEmailProvider };
});
