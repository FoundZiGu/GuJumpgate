(function outlookEmailPlusProviderModule(root, factory) {
  root.MultiPageBackgroundOutlookEmailPlusProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOutlookEmailPlusProviderModule() {
  function createOutlookEmailPlusProvider(deps = {}) {
    const {
      addLog = async () => {},
      buildOutlookEmailPlusHeaders,
      buildOutlookEmailPlusPayPalAliasAddress,
      deriveOutlookEmailPlusBaseAddress,
      getOutlookEmailPlusPayPalAliasIndex,
      isOutlookEmailPlusTaggedAlias,
      joinOutlookEmailPlusUrl,
      normalizeOutlookEmailPlusAddress,
      normalizeOutlookEmailPlusBaseUrl,
      normalizeOutlookEmailPlusCallerIdPrefix,
      normalizeOutlookEmailPlusClaim,
      normalizeOutlookEmailPlusProjectKey,
      normalizeOutlookEmailPlusProvider,
      normalizeOutlookEmailPlusVerificationCode,
      OUTLOOK_EMAIL_PLUS_GENERATOR = 'outlook-email-plus',
      OUTLOOK_EMAIL_PLUS_PROVIDER = 'outlook-email-plus',
      broadcastDataUpdate = null,
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      getState = async () => ({}),
      normalizeHotmailAliasUsage: normalizeHotmailAliasUsageDep = null,
      persistRegistrationEmailState = null,
      setEmailState = async () => {},
      setPersistentSettings = async () => {},
      setState = async () => {},
      sleepWithStop = async () => {},
      throwIfStopped = () => {},
      unwrapOutlookEmailPlusResponse,
    } = deps;

    const activeClaims = new Map();
    const DEFAULT_ALIAS_MAX_PER_MAILBOX = 5;

    async function persistResolvedEmailState(state = null, email, options = {}) {
      if (typeof persistRegistrationEmailState === 'function') {
        await persistRegistrationEmailState(state, email, options);
        return;
      }
      await setEmailState(email, options);
    }

    function getOutlookEmailPlusConfig(state = {}) {
      return {
        baseUrl: normalizeOutlookEmailPlusBaseUrl(state.outlookEmailPlusBaseUrl),
        apiKey: String(state.outlookEmailPlusApiKey || '').trim(),
        provider: normalizeOutlookEmailPlusProvider(state.outlookEmailPlusProvider) || 'outlook',
        projectKey: normalizeOutlookEmailPlusProjectKey(state.outlookEmailPlusProjectKey) || 'openai',
        callerIdPrefix: normalizeOutlookEmailPlusCallerIdPrefix(state.outlookEmailPlusCallerIdPrefix) || 'gujumpgate',
      };
    }

    function ensureOutlookEmailPlusConfig(state, options = {}) {
      const { requireApiKey = true } = options;
      const config = getOutlookEmailPlusConfig(state);
      if (!config.baseUrl) {
        throw new Error('Outlook Email Plus 服务地址为空或格式无效。');
      }
      if (requireApiKey && !config.apiKey) {
        throw new Error('Outlook Email Plus API Key 为空。');
      }
      if (!config.provider) {
        throw new Error('Outlook Email Plus 邮箱提供商为空。');
      }
      if (!config.projectKey) {
        throw new Error('Outlook Email Plus Project Key 为空。');
      }
      return config;
    }

    async function requestOutlookEmailPlusJson(config, path, options = {}) {
      if (!fetchImpl) {
        throw new Error('Outlook Email Plus 当前运行环境不支持 fetch。');
      }

      const {
        method = 'GET',
        payload,
        searchParams = null,
        timeoutMs = 20000,
      } = options;
      const url = new URL(joinOutlookEmailPlusUrl(config.baseUrl, path));
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
          headers: buildOutlookEmailPlusHeaders(config, {
            json: payload !== undefined,
          }),
          body: payload !== undefined ? JSON.stringify(payload) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        const errorMessage = err?.name === 'AbortError'
          ? `Outlook Email Plus 请求超时（>${Math.round(timeoutMs / 1000)} 秒）`
          : `Outlook Email Plus 请求失败：${err?.message || err}`;
        throw new Error(errorMessage);
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
        let payloadMessage = '';
        try {
          payloadMessage = String(unwrapOutlookEmailPlusResponse(parsed)?.message || '');
        } catch (error) {
          payloadMessage = String(error?.message || '');
        }
        if (!payloadMessage && parsed && typeof parsed === 'object') {
          payloadMessage = String(parsed.message || parsed.error || parsed.msg || '');
        }
        throw new Error(`Outlook Email Plus 请求失败：${payloadMessage || text || `HTTP ${response.status}`}`);
      }

      return unwrapOutlookEmailPlusResponse(parsed);
    }

    function buildRandomIdentifier() {
      if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
      }
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

    function normalizeAliasMax(value, fallback = DEFAULT_ALIAS_MAX_PER_MAILBOX) {
      const fallbackNumber = Number(fallback);
      const rawValue = String(value ?? '').trim();
      if (!rawValue) {
        return Number.isFinite(fallbackNumber) && fallbackNumber > 0
          ? Math.max(1, Math.min(50, Math.floor(fallbackNumber)))
          : DEFAULT_ALIAS_MAX_PER_MAILBOX;
      }
      const numeric = Math.floor(Number(rawValue));
      if (!Number.isFinite(numeric)) {
        return Number.isFinite(fallbackNumber) && fallbackNumber > 0
          ? Math.max(1, Math.min(50, Math.floor(fallbackNumber)))
          : DEFAULT_ALIAS_MAX_PER_MAILBOX;
      }
      return Math.max(1, Math.min(50, numeric));
    }

    function getAliasMaxForState(state = {}, fallback = DEFAULT_ALIAS_MAX_PER_MAILBOX) {
      return normalizeAliasMax(state.outlookEmailPlusAliasMaxPerMailbox, fallback);
    }

    function normalizeUsageKey(value = '') {
      return String(value || '').trim().toLowerCase();
    }

    function normalizeAliasUsageEntry(value = {}, fallbackEmail = '') {
      const email = String(value.email || fallbackEmail || '').trim();
      if (!email) return null;
      return {
        email,
        used: Boolean(value.used),
        lastCheckedAt: Math.max(0, Math.floor(Number(value.lastCheckedAt) || 0)),
        reason: String(value.reason || '').trim(),
      };
    }

    function normalizeOutlookEmailPlusAliasUsage(value = {}) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
      }
      const usage = {};
      for (const [rawKey, rawBucket] of Object.entries(value)) {
        const usageKey = normalizeUsageKey(rawKey);
        if (!usageKey || !rawBucket || typeof rawBucket !== 'object' || Array.isArray(rawBucket)) {
          continue;
        }
        const rawAliases = rawBucket.aliases && typeof rawBucket.aliases === 'object' && !Array.isArray(rawBucket.aliases)
          ? rawBucket.aliases
          : rawBucket;
        const aliases = {};
        for (const [rawEmail, rawEntry] of Object.entries(rawAliases || {})) {
          const entry = normalizeAliasUsageEntry(
            rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry) ? rawEntry : {},
            rawEntry?.email || rawEmail
          );
          if (!entry) continue;
          aliases[normalizeOutlookEmailPlusAddress(entry.email)] = entry;
        }
        usage[usageKey] = {
          aliases,
          updatedAt: Math.max(0, Math.floor(Number(rawBucket.updatedAt) || 0)),
        };
      }
      return usage;
    }

    function normalizeAliasUsage(value = {}) {
      if (typeof normalizeHotmailAliasUsageDep === 'function') {
        return normalizeHotmailAliasUsageDep(value);
      }
      return normalizeOutlookEmailPlusAliasUsage(value);
    }

    function resolveClaimTaskId(state = {}, options = {}) {
      return normalizeIdentifierPart(
        options.taskId
        || state.currentOutlookEmailPlusClaim?.taskId
        || state.taskId
        || state.activeRunId
        || state.runId
      ) || buildRandomIdentifier();
    }

    function buildCallerId(config, state = {}, options = {}, taskId = '') {
      const prefix = normalizeOutlookEmailPlusCallerIdPrefix(
        options.callerIdPrefix || config.callerIdPrefix || state.outlookEmailPlusCallerIdPrefix || 'gujumpgate'
      ) || 'gujumpgate';
      const explicitCallerId = normalizeIdentifierPart(options.callerId || state.currentOutlookEmailPlusClaim?.callerId);
      if (explicitCallerId) {
        return explicitCallerId;
      }
      const suffix = normalizeIdentifierPart(options.runId || state.runId || taskId) || normalizeIdentifierPart(buildRandomIdentifier());
      return `${prefix}-${suffix}`;
    }

    function getClaimKeys(claim = {}) {
      return [claim.taskId, claim.accountId, claim.address]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
    }

    function rememberClaim(claim = {}, storedClaim = {}) {
      const secretClaim = {
        ...storedClaim,
        claimToken: claim.claimToken || '',
      };
      for (const key of getClaimKeys(storedClaim)) {
        activeClaims.set(key, secretClaim);
      }
    }

    function forgetClaim(claim = {}) {
      for (const key of getClaimKeys(claim)) {
        activeClaims.delete(key);
      }
    }

    function getRememberedClaim(storedClaim = {}) {
      for (const key of getClaimKeys(storedClaim)) {
        const remembered = activeClaims.get(key);
        if (remembered) return remembered;
      }
      return null;
    }

    function buildOutlookEmailPlusAliasUsageKey(claim = {}) {
      const explicitKey = normalizeUsageKey(claim.usageKey);
      if (explicitKey) return explicitKey;
      const accountId = normalizeIdentifierPart(claim.accountId);
      if (accountId) return `outlook-email-plus:${accountId}`;
      const baseAddress = normalizeOutlookEmailPlusAddress(claim.baseAddress)
        || deriveOutlookEmailPlusBaseAddress(claim.address)
        || normalizeOutlookEmailPlusAddress(claim.address);
      return baseAddress ? `outlook-email-plus:${baseAddress}` : '';
    }

    function getAliasEntriesForClaimFromUsage(usage = {}, claim = {}) {
      const usageKey = buildOutlookEmailPlusAliasUsageKey(claim);
      if (!usageKey) return [];
      return Object.values(normalizeAliasUsage(usage)[usageKey]?.aliases || {});
    }

    function countUsedAliasEntries(entries = []) {
      return entries.filter((entry) => Boolean(entry?.used)).length;
    }

    async function setOutlookEmailPlusAliasUsageEntry(state = {}, claim = {}, aliasEmail = '', updates = {}) {
      const usageKey = buildOutlookEmailPlusAliasUsageKey(claim);
      const emailKey = normalizeOutlookEmailPlusAddress(aliasEmail);
      if (!usageKey || !emailKey) {
        return { usage: normalizeAliasUsage(state?.hotmailAliasUsage), entry: null };
      }

      const latestState = state || await getState();
      const usage = normalizeAliasUsage(latestState.hotmailAliasUsage);
      const bucket = usage[usageKey] || { aliases: {}, updatedAt: 0 };
      const previous = bucket.aliases[emailKey] || {};
      const entry = normalizeAliasUsageEntry({
        ...previous,
        email: String(aliasEmail || previous.email || '').trim(),
        ...updates,
      }, aliasEmail);
      if (!entry) {
        return { usage, entry: null };
      }

      const nextUsage = {
        ...usage,
        [usageKey]: {
          aliases: {
            ...(bucket.aliases || {}),
            [emailKey]: entry,
          },
          updatedAt: Date.now(),
        },
      };

      await setPersistentSettings({ hotmailAliasUsage: nextUsage });
      await setState({ hotmailAliasUsage: nextUsage });
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate({ hotmailAliasUsage: nextUsage });
      }
      return { usage: nextUsage, entry };
    }

    async function ensureOutlookEmailPlusClaimAliasUsage(state = {}, storedClaim = {}) {
      const usageKey = buildOutlookEmailPlusAliasUsageKey(storedClaim);
      if (!usageKey) {
        return normalizeAliasUsage(state.hotmailAliasUsage);
      }

      const baseAddress = normalizeOutlookEmailPlusAddress(storedClaim.baseAddress)
        || deriveOutlookEmailPlusBaseAddress(storedClaim.address)
        || normalizeOutlookEmailPlusAddress(storedClaim.address);
      const aliasMax = getAliasMaxForState(state, storedClaim.aliasMax);
      const aliasIndex = Math.min(aliasMax, Math.max(
        getOutlookEmailPlusPayPalAliasIndex(storedClaim.registrationEmail, baseAddress) || 0,
        Math.floor(Number(storedClaim.aliasIndex) || 0)
      ));
      let usage = normalizeAliasUsage(state.hotmailAliasUsage);
      for (let index = 1; index <= aliasMax; index += 1) {
        const aliasEmail = buildOutlookEmailPlusPayPalAliasAddress(baseAddress, index);
        if (!aliasEmail) continue;
        const shouldBeUsed = index < aliasIndex || Boolean(storedClaim.aliasUsed && index === aliasIndex);
        const currentEntry = usage[usageKey]?.aliases?.[normalizeOutlookEmailPlusAddress(aliasEmail)] || null;
        if (currentEntry) {
          continue;
        }
        const result = await setOutlookEmailPlusAliasUsageEntry(
          { ...state, hotmailAliasUsage: usage },
          { ...storedClaim, usageKey },
          aliasEmail,
          {
            used: shouldBeUsed,
            reason: shouldBeUsed ? 'restored_claim_usage' : 'allocated',
          }
        );
        usage = result.usage;
      }
      return usage;
    }

    function buildStoredOutlookEmailPlusClaim(claim = {}, context = {}) {
      return {
        accountId: claim.accountId || '',
        address: claim.address || '',
        baseAddress: claim.baseAddress || '',
        registrationEmail: claim.registrationEmail || claim.address || '',
        isAliasClaim: Boolean(claim.isAliasClaim),
        domain: claim.domain || '',
        claimedAt: claim.claimedAt || '',
        leaseExpiresAt: claim.leaseExpiresAt || '',
        callerId: context.callerId || claim.callerId || '',
        provider: context.provider || claim.provider || '',
        projectKey: context.projectKey || claim.projectKey || '',
        taskId: context.taskId || claim.taskId || '',
        aliasIndex: Math.max(0, Math.floor(Number(claim.aliasIndex) || 0)),
        aliasMax: normalizeAliasMax(claim.aliasMax || context.aliasMax),
        aliasUsed: Boolean(claim.aliasUsed),
        usageKey: buildOutlookEmailPlusAliasUsageKey({ ...claim, usageKey: claim.usageKey || context.usageKey }),
        claimToken: claim.claimToken || context.claimToken || '',
      };
    }

    function buildLifecyclePayload(claim = {}, options = {}) {
      return {
        account_id: claim.accountId || undefined,
        email: claim.address || undefined,
        claim_token: claim.claimToken || undefined,
        caller_id: claim.callerId || undefined,
        task_id: claim.taskId || undefined,
        project_key: claim.projectKey || undefined,
        result: options.result || undefined,
        reason: options.reason || undefined,
      };
    }

    async function clearStoredClaim(storedClaim = {}) {
      forgetClaim(storedClaim);
      await setState({ currentOutlookEmailPlusClaim: null });
    }

    function resolveLifecycleClaim(state = {}, options = {}) {
      const storedClaim = options.claim && typeof options.claim === 'object'
        ? options.claim
        : (state.currentOutlookEmailPlusClaim || {});
      if (!storedClaim || typeof storedClaim !== 'object') {
        return null;
      }
      const rememberedClaim = getRememberedClaim(storedClaim) || {};
      return {
        ...rememberedClaim,
        ...storedClaim,
        claimToken: storedClaim.claimToken || rememberedClaim.claimToken || '',
      };
    }

    function resolveClaimRegistration(claim = {}, context = {}) {
      const claimedAddress = normalizeOutlookEmailPlusAddress(claim.address);
      const baseAddress = deriveOutlookEmailPlusBaseAddress(claimedAddress) || claimedAddress;
      const isAliasClaim = Boolean(isOutlookEmailPlusTaggedAlias(claimedAddress));
      const aliasMax = normalizeAliasMax(context.aliasMax);
      return {
        ...claim,
        address: claimedAddress,
        baseAddress,
        registrationEmail: buildOutlookEmailPlusPayPalAliasAddress(baseAddress, 1),
        isAliasClaim,
        aliasIndex: 1,
        aliasMax,
        aliasUsed: false,
      };
    }

    function getReusableStoredClaim(state = {}) {
      const storedClaim = state.currentOutlookEmailPlusClaim;
      if (!storedClaim || typeof storedClaim !== 'object') {
        return null;
      }
      const rememberedClaim = getRememberedClaim(storedClaim);
      const address = normalizeOutlookEmailPlusAddress(storedClaim.address);
      const baseAddress = normalizeOutlookEmailPlusAddress(storedClaim.baseAddress)
        || deriveOutlookEmailPlusBaseAddress(address)
        || address;
      if (!address && !baseAddress) {
        return null;
      }
      return {
        ...storedClaim,
        address,
        baseAddress,
        registrationEmail: String(storedClaim.registrationEmail || '').trim(),
        aliasIndex: Math.max(0, Math.floor(Number(storedClaim.aliasIndex) || 0)),
        aliasMax: getAliasMaxForState(state, storedClaim.aliasMax),
        aliasUsed: Boolean(storedClaim.aliasUsed),
        usageKey: buildOutlookEmailPlusAliasUsageKey({ ...storedClaim, address, baseAddress }),
        claimToken: storedClaim.claimToken || rememberedClaim?.claimToken || '',
      };
    }

    function sortAliasEntriesByIndex(entries = [], baseAddress = '') {
      return [...entries].sort((left, right) => {
        const leftIndex = getOutlookEmailPlusPayPalAliasIndex(left?.email, baseAddress);
        const rightIndex = getOutlookEmailPlusPayPalAliasIndex(right?.email, baseAddress);
        return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER);
      });
    }

    function buildReusableRegistrationClaim(storedClaim = {}, context = {}) {
      const state = context.state || {};
      const aliasMax = getAliasMaxForState(state, storedClaim.aliasMax);
      const usage = normalizeAliasUsage(context.hotmailAliasUsage || state.hotmailAliasUsage);
      const usageKey = buildOutlookEmailPlusAliasUsageKey(storedClaim);
      const entries = getAliasEntriesForClaimFromUsage(usage, { ...storedClaim, usageKey });
      if (countUsedAliasEntries(entries) >= aliasMax) {
        return {
          ...storedClaim,
          aliasMax,
          usageKey,
          exhausted: true,
        };
      }

      if (storedClaim.registrationEmail && !storedClaim.aliasUsed) {
        const currentEntry = usage[usageKey]?.aliases?.[normalizeOutlookEmailPlusAddress(storedClaim.registrationEmail)] || null;
        if (!currentEntry?.used) {
          return {
            ...storedClaim,
            aliasMax,
            usageKey,
            exhausted: false,
          };
        }
      }

      const unusedEntry = sortAliasEntriesByIndex(entries, storedClaim.baseAddress)
        .find((entry) => !entry.used);
      if (unusedEntry) {
        const aliasIndex = getOutlookEmailPlusPayPalAliasIndex(unusedEntry.email, storedClaim.baseAddress)
          || Math.max(1, Math.floor(Number(storedClaim.aliasIndex) || 1));
        return {
          ...storedClaim,
          aliasMax,
          usageKey,
          registrationEmail: unusedEntry.email,
          aliasIndex,
          aliasUsed: false,
          exhausted: false,
        };
      }

      const knownAliases = new Set(entries.map((entry) => normalizeOutlookEmailPlusAddress(entry.email)).filter(Boolean));
      for (let index = 1; index <= aliasMax; index += 1) {
        const registrationEmail = buildOutlookEmailPlusPayPalAliasAddress(storedClaim.baseAddress, index);
        const emailKey = normalizeOutlookEmailPlusAddress(registrationEmail);
        if (registrationEmail && !knownAliases.has(emailKey)) {
          return {
            ...storedClaim,
            aliasMax,
            usageKey,
            registrationEmail,
            aliasIndex: index,
            aliasUsed: false,
            exhausted: false,
          };
        }
      }

      return {
        ...storedClaim,
        aliasMax,
        usageKey,
        exhausted: true,
      };
    }

    async function reuseOutlookEmailPlusClaimAddress(state = {}, config = {}, options = {}) {
      const storedClaim = getReusableStoredClaim(state);
      if (!storedClaim) {
        return { reused: false };
      }
      const hotmailAliasUsage = await ensureOutlookEmailPlusClaimAliasUsage(state, storedClaim);
      const claim = buildReusableRegistrationClaim(storedClaim, {
        state,
        hotmailAliasUsage,
      });
      if (claim.exhausted) {
        return { reused: false, exhausted: true, claim };
      }

      await persistResolvedEmailState(state, claim.registrationEmail, {
        source: `generated:${OUTLOOK_EMAIL_PLUS_GENERATOR}`,
        preserveAccountIdentity: Boolean(options?.preserveAccountIdentity),
      });
      const nextStoredClaim = buildStoredOutlookEmailPlusClaim(claim, {
        callerId: storedClaim.callerId,
        taskId: storedClaim.taskId,
        projectKey: storedClaim.projectKey || config.projectKey,
        provider: storedClaim.provider || config.provider,
        usageKey: storedClaim.usageKey,
        claimToken: storedClaim.claimToken,
      });
      await setState({ currentOutlookEmailPlusClaim: nextStoredClaim });
      rememberClaim(nextStoredClaim, nextStoredClaim);
      await setOutlookEmailPlusAliasUsageEntry(
        { ...state, hotmailAliasUsage },
        nextStoredClaim,
        claim.registrationEmail,
        { used: false, reason: 'allocated' }
      );
      await addLog(`Outlook Email Plus：复用 ${claim.address}，本次注册使用 ${claim.registrationEmail}`, 'ok');
      return { reused: true, address: claim.registrationEmail };
    }

    async function claimOutlookEmailPlusAddress(state, options = {}) {
      throwIfStopped();
      let latestState = state || await getState();
      const config = ensureOutlookEmailPlusConfig(latestState);
      const reuseResult = await reuseOutlookEmailPlusClaimAddress(latestState, config, options);
      if (reuseResult.reused) {
        return reuseResult.address;
      }
      if (reuseResult.exhausted) {
        await completeOutlookEmailPlusClaim(latestState, { result: 'success' });
        latestState = await getState();
      }

      const taskId = resolveClaimTaskId(latestState, options);
      const callerId = buildCallerId(config, latestState, options, taskId);
      const payload = {
        provider: config.provider,
        project_key: config.projectKey,
        caller_id: callerId,
        task_id: taskId,
      };
      const result = await requestOutlookEmailPlusJson(config, '/api/external/pool/claim-random', {
        method: 'POST',
        payload,
      });
      const claim = resolveClaimRegistration(normalizeOutlookEmailPlusClaim(result), {
        aliasMax: getAliasMaxForState(latestState),
      });
      if (!claim.address) {
        throw new Error('Outlook Email Plus 未返回可用邮箱地址。');
      }

      await persistResolvedEmailState(latestState, claim.registrationEmail, {
        source: `generated:${OUTLOOK_EMAIL_PLUS_GENERATOR}`,
        preserveAccountIdentity: Boolean(options?.preserveAccountIdentity),
      });
      const storedClaim = buildStoredOutlookEmailPlusClaim(claim, {
        callerId,
        taskId,
        projectKey: config.projectKey,
        provider: config.provider,
        claimToken: claim.claimToken,
      });
      rememberClaim(claim, storedClaim);
      await setState({ currentOutlookEmailPlusClaim: storedClaim });
      await setOutlookEmailPlusAliasUsageEntry(latestState, storedClaim, claim.registrationEmail, {
        used: false,
        reason: 'allocated',
      });
      await addLog(`Outlook Email Plus：已认领 ${claim.address}，注册使用 ${claim.registrationEmail}`, 'ok');
      return claim.registrationEmail;
    }

    async function markOutlookEmailPlusAliasUsed(state = {}) {
      const latestState = state || await getState();
      const storedClaim = getReusableStoredClaim(latestState) || latestState.currentOutlookEmailPlusClaim;
      if (!storedClaim || typeof storedClaim !== 'object') {
        return { handled: false, reason: 'missing_claim' };
      }

      const aliasMax = getAliasMaxForState(latestState, storedClaim.aliasMax);
      const registrationEmail = String(storedClaim.registrationEmail || storedClaim.address || '').trim();
      const normalizedAliasIndex = Math.max(
        1,
        getOutlookEmailPlusPayPalAliasIndex(registrationEmail, storedClaim.baseAddress)
          || Math.floor(Number(storedClaim.aliasIndex) || 1)
      );
      const hotmailAliasUsage = await ensureOutlookEmailPlusClaimAliasUsage(latestState, storedClaim);
      const usageKey = buildOutlookEmailPlusAliasUsageKey(storedClaim);
      const usageBefore = normalizeAliasUsage(hotmailAliasUsage);
      const existingEntry = usageBefore[usageKey]?.aliases?.[normalizeOutlookEmailPlusAddress(registrationEmail)] || null;
      const alreadyUsed = Boolean(existingEntry?.used || storedClaim.aliasUsed);
      const usageResult = await setOutlookEmailPlusAliasUsageEntry(
        { ...latestState, hotmailAliasUsage },
        { ...storedClaim, usageKey },
        registrationEmail,
        {
          used: true,
          lastCheckedAt: Date.now(),
          reason: 'flow_completed',
        }
      );
      const usedAliasCount = countUsedAliasEntries(
        getAliasEntriesForClaimFromUsage(usageResult.usage, { ...storedClaim, usageKey })
      );
      const nextStoredClaim = {
        ...storedClaim,
        aliasIndex: normalizedAliasIndex,
        aliasMax,
        aliasUsed: true,
      };
      await setState({ currentOutlookEmailPlusClaim: nextStoredClaim });
      rememberClaim(nextStoredClaim, nextStoredClaim);
      return {
        handled: true,
        registrationEmail,
        aliasIndex: normalizedAliasIndex,
        aliasMax,
        exhausted: usedAliasCount >= aliasMax,
        alreadyUsed,
      };
    }

    function resolvePollTargetEmail(state = {}, pollPayload = {}) {
      return normalizeOutlookEmailPlusAddress(
        pollPayload.targetEmail
        || state.registrationEmailState?.current
        || state.email
        || state.currentOutlookEmailPlusClaim?.registrationEmail
        || state.currentOutlookEmailPlusClaim?.address
        || ''
      );
    }

    function resolveSinceMinutes(pollPayload = {}) {
      const configured = Math.floor(Number(pollPayload.sinceMinutes || pollPayload.since_minutes) || 0);
      if (configured > 0) {
        return configured;
      }
      const afterTimestamp = Number(pollPayload.filterAfterTimestamp) || 0;
      if (afterTimestamp <= 0) {
        return 0;
      }
      const ageMs = Math.max(0, Date.now() - afterTimestamp);
      return Math.max(1, Math.ceil(ageMs / 60000));
    }

    async function pollOutlookEmailPlusVerificationCode(step, state, pollPayload = {}) {
      const latestState = state || await getState();
      const config = ensureOutlookEmailPlusConfig(latestState);
      const targetEmail = resolvePollTargetEmail(latestState, pollPayload);
      if (!targetEmail) {
        throw new Error('Outlook Email Plus 轮询前缺少目标邮箱地址，请先获取注册邮箱。');
      }

      const maxAttempts = Math.max(1, Math.floor(Number(pollPayload.maxAttempts) || 5));
      const intervalMs = Math.max(0, Number(pollPayload.intervalMs) || 3000);
      const excludeCodes = new Set(
        (Array.isArray(pollPayload.excludeCodes) ? pollPayload.excludeCodes : [])
          .map((value) => normalizeOutlookEmailPlusVerificationCode(value))
          .filter((value) => typeof value === 'string' && value)
      );
      const sinceMinutes = resolveSinceMinutes(pollPayload);
      const codeLength = Math.max(0, Math.floor(Number(pollPayload.codeLength) || 0));
      const codeRegex = String(pollPayload.codeRegex || '').trim();
      const codeSource = String(pollPayload.codeSource || '').trim();
      let lastError = null;
      let sawNoCode = false;

      await addLog(`步骤 ${step}：正在轮询 Outlook Email Plus 邮件（${targetEmail}）...`, 'info');
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfStopped();
        try {
          const result = await requestOutlookEmailPlusJson(config, '/api/external/verification-code', {
            method: 'GET',
            searchParams: {
              email: targetEmail,
              since_minutes: sinceMinutes > 0 ? sinceMinutes : undefined,
              code_length: codeLength > 0 ? codeLength : undefined,
              code_regex: codeRegex || undefined,
              code_source: codeSource || undefined,
            },
          });
          const verification = normalizeOutlookEmailPlusVerificationCode(result);
          if (verification.code) {
            if (!excludeCodes.has(verification.code)) {
              return {
                ok: true,
                code: verification.code,
                emailTimestamp: verification.emailTimestamp || Date.now(),
                mailId: verification.mailId || '',
              };
            }
            sawNoCode = true;
            lastError = new Error(`步骤 ${step}：Outlook Email Plus 返回了已排除的旧验证码。`);
            await addLog(`步骤 ${step}：Outlook Email Plus 命中过滤掉的旧验证码，继续轮询（${attempt}/${maxAttempts}）。`, 'info');
          } else {
            sawNoCode = true;
            lastError = new Error(`步骤 ${step}：暂未在 Outlook Email Plus 中找到匹配验证码（${attempt}/${maxAttempts}）。`);
            await addLog(lastError.message, attempt === maxAttempts ? 'warn' : 'info');
          }
        } catch (err) {
          lastError = err;
          await addLog(`步骤 ${step}：Outlook Email Plus 轮询失败：${err?.message || err}`, 'warn');
        }
        if (attempt < maxAttempts) {
          await sleepWithStop(intervalMs);
        }
      }

      if (sawNoCode) {
        await completeOutlookEmailPlusClaim(latestState, { result: 'verification_timeout' }).catch(() => {});
        throw new Error(`步骤 ${step}：未在 Outlook Email Plus 中找到新的匹配验证码。`);
      }
      throw lastError || new Error(`步骤 ${step}：Outlook Email Plus 轮询失败。`);
    }

    async function completeOutlookEmailPlusClaim(state, options = {}) {
      const latestState = state || await getState();
      const config = ensureOutlookEmailPlusConfig(latestState);
      const claim = resolveLifecycleClaim(latestState, options);
      if (!claim?.address && !claim?.accountId) {
        return { completed: false, reason: 'missing_claim' };
      }
      if (!claim.claimToken) {
        return { completed: false, reason: 'missing_claim_token' };
      }
      await requestOutlookEmailPlusJson(config, '/api/external/pool/claim-complete', {
        method: 'POST',
        payload: buildLifecyclePayload(claim, { result: options.result || 'success' }),
      });
      await clearStoredClaim(claim);
      await addLog(`Outlook Email Plus：已完成认领 ${claim.address || claim.accountId}`, 'ok');
      return { completed: true };
    }

    async function releaseOutlookEmailPlusClaim(state, options = {}) {
      const latestState = state || await getState();
      const config = ensureOutlookEmailPlusConfig(latestState);
      const claim = resolveLifecycleClaim(latestState, options);
      if (!claim?.address && !claim?.accountId) {
        return { released: false, reason: 'missing_claim' };
      }
      if (!claim.claimToken) {
        return { released: false, reason: 'missing_claim_token' };
      }
      await requestOutlookEmailPlusJson(config, '/api/external/pool/claim-release', {
        method: 'POST',
        payload: buildLifecyclePayload(claim, { reason: options.reason || 'flow_abandoned' }),
      });
      await clearStoredClaim(claim);
      await addLog(`Outlook Email Plus：已释放认领 ${claim.address || claim.accountId}`, 'warn');
      return { released: true };
    }

    return {
      claimOutlookEmailPlusAddress,
      completeOutlookEmailPlusClaim,
      ensureOutlookEmailPlusConfig,
      getOutlookEmailPlusConfig,
      markOutlookEmailPlusAliasUsed,
      pollOutlookEmailPlusVerificationCode,
      releaseOutlookEmailPlusClaim,
      requestOutlookEmailPlusJson,
    };
  }

  return {
    createOutlookEmailPlusProvider,
  };
});
