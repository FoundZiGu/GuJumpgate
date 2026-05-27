(function attachChatGptApiPhoneProvider(root, factory) {
  root.PhoneSmsChatGptApiProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createChatGptApiPhoneProviderModule() {
  const PROVIDER_ID = 'chatgpt-api';
  const PROVIDER_LABEL = 'ChatGPT API 接码';
  const DEFAULT_SERVICE_LABEL = 'OpenAI / ChatGPT';
  const DEFAULT_SERVICE_CODE = 'custom-api';
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
  const MAX_SUCCESS_USES = 3;
  const POOL_SEPARATOR = '----';
  const AUTO_DISABLE_THRESHOLD = 2;
  const COUNTRY_BY_PHONE_PREFIX = Object.freeze([
    { prefix: '63', id: 4, label: 'Philippines' },
    { prefix: '254', id: 8, label: 'Kenya' },
    { prefix: '84', id: 10, label: 'Vietnam' },
    { prefix: '48', id: 15, label: 'Poland' },
    { prefix: '44', id: 16, label: 'United Kingdom' },
    { prefix: '40', id: 32, label: 'Romania' },
    { prefix: '57', id: 33, label: 'Colombia' },
    { prefix: '62', id: 6, label: 'Indonesia' },
    { prefix: '66', id: 52, label: 'Thailand' },
    { prefix: '49', id: 43, label: 'Germany' },
    { prefix: '55', id: 73, label: 'Brazil' },
    { prefix: '33', id: 78, label: 'France' },
    { prefix: '56', id: 151, label: 'Chile' },
    { prefix: '81', id: 182, label: 'Japan' },
    { prefix: '1', id: 187, label: 'USA' },
  ]);
  const POOL_TEXT_KEY = 'chatGptApiSmsPoolText';
  const POOL_USAGE_KEY = 'chatGptApiSmsPoolUsage';
  const CURRENT_ENTRY_KEY = 'chatGptApiCurrentSmsEntry';
  const AUTO_DISABLE_ENABLED_KEY = 'chatGptApiSmsPoolAutoDisableEnabled';

  function normalizeText(value = '') {
    return String(value || '').trim();
  }

  function normalizePoolText(value = '') {
    return String(value || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }

  function normalizePoolPhone(value = '') {
    const rawValue = normalizeText(value);
    const digits = rawValue.replace(/\D+/g, '');
    return digits || rawValue;
  }

  function normalizePoolUrl(value = '') {
    const rawValue = normalizeText(value);
    if (!rawValue) {
      return '';
    }
    try {
      const parsed = new URL(rawValue);
      parsed.searchParams.delete('t');
      return parsed.toString();
    } catch {
      return rawValue
        .replace(/([?&])t=\d+(?=(&|$))/i, '$1')
        .replace(/[?&]$/g, '');
    }
  }

  function buildPoolKey(phone = '', verificationUrl = '') {
    const normalizedPhone = normalizePoolPhone(phone);
    const normalizedUrl = normalizePoolUrl(verificationUrl);
    return normalizedPhone && normalizedUrl ? `${normalizedPhone}${POOL_SEPARATOR}${normalizedUrl}` : '';
  }

  function parsePoolKey(value = '') {
    const normalized = normalizeText(value);
    const separatorIndex = normalized.indexOf(POOL_SEPARATOR);
    if (separatorIndex <= 0) {
      return null;
    }
    const phone = normalizePoolPhone(normalized.slice(0, separatorIndex));
    const verificationUrl = normalizePoolUrl(normalized.slice(separatorIndex + POOL_SEPARATOR.length));
    const key = buildPoolKey(phone, verificationUrl);
    if (!phone || !verificationUrl || !key) {
      return null;
    }
    return {
      key,
      phone,
      verificationUrl,
    };
  }

  function parseEntries(text = '') {
    const lines = normalizePoolText(text).split('\n').filter(Boolean);
    const seen = new Set();
    const entries = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const separatorIndex = line.indexOf(POOL_SEPARATOR);
      const hasSeparator = separatorIndex > 0;
      const phone = hasSeparator
        ? normalizePoolPhone(line.slice(0, separatorIndex))
        : normalizePoolPhone(line);
      const verificationUrl = hasSeparator
        ? normalizePoolUrl(line.slice(separatorIndex + POOL_SEPARATOR.length))
        : normalizePoolUrl(lines[index + 1] || '');
      if (!hasSeparator && verificationUrl) {
        index += 1;
      }
      const key = buildPoolKey(phone, verificationUrl);
      if (!phone || !verificationUrl || !key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({
        index: entries.length,
        key,
        phone,
        verificationUrl,
      });
    }
    return entries;
  }

  function normalizeUsage(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      const usage = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      const legacyUsedCount = Number(usage.usedAt) > 0 ? 1 : 0;
      const useCount = Math.max(0, Math.floor(Number(usage.useCount ?? usage.usageCount ?? legacyUsedCount) || 0));
      return [normalizeText(key), {
        useCount,
        usedAt: Math.max(0, Number(usage.usedAt) || 0),
        lastAttemptAt: Math.max(0, Number(usage.lastAttemptAt) || 0),
        lastError: normalizeText(usage.lastError),
        enabled: usage.enabled !== false,
        disabledReason: normalizeText(usage.disabledReason),
        disabledAt: Math.max(0, Number(usage.disabledAt) || 0),
        failureCount: Math.max(0, Math.floor(Number(usage.failureCount) || 0)),
      }];
    }).filter(([key]) => Boolean(key)));
  }

  function parsePayloadText(text = '') {
    const rawText = String(text || '');
    try {
      return rawText ? JSON.parse(rawText) : {};
    } catch {
      return rawText;
    }
  }

  function collectPayloadCandidates(value, path = '', seen = new Set()) {
    if (value === null || value === undefined) {
      return [];
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      return text ? [{
        key: String(path).split('.').pop() || '',
        path,
        text,
      }] : [];
    }
    if (typeof value !== 'object') {
      return [];
    }
    if (seen.has(value)) {
      return [];
    }
    seen.add(value);
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => collectPayloadCandidates(item, `${path}[${index}]`, seen));
    }
    return Object.entries(value).flatMap(([key, child]) => (
      collectPayloadCandidates(child, path ? `${path}.${key}` : key, seen)
    ));
  }

  function extractVerificationCode(payload = {}) {
    const contextualCodePattern = /(?:verification\s*code|one[-\s]?time\s*(?:passcode|code)|passcode|otp|code|验证码|安全码)[\s\S]{0,50}?(\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d)|(\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d)[\s\S]{0,50}?(?:verification\s*code|one[-\s]?time\s*(?:passcode|code)|passcode|otp|code|验证码|安全码)/i;
    const exactCodePattern = /^\D*(\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d[\s-]?\d)\D*$/;
    const trustedTextKeyPattern = /^(sms|message|msg|text|content|body|code|otp|verification_code|verificationCode)$/i;
    const metadataKeyPattern = /(^|[_-])(phone|mobile|tel|id|order|time|date|expired|expire|status)([_-]|$)/i;
    const candidates = collectPayloadCandidates(payload);

    for (const candidate of candidates) {
      const match = String(candidate.text || '').match(contextualCodePattern);
      const code = match ? (match[1] || match[2]).replace(/\D+/g, '') : '';
      if (code) {
        return code;
      }
    }

    for (const candidate of candidates) {
      const key = String(candidate.key || '');
      const path = String(candidate.path || '');
      const isRootText = !path;
      if (!isRootText && (!trustedTextKeyPattern.test(key) || metadataKeyPattern.test(key) || metadataKeyPattern.test(path))) {
        continue;
      }
      const match = String(candidate.text || '').match(exactCodePattern);
      if (match) {
        return match[1].replace(/\D+/g, '');
      }
    }

    return '';
  }

  function describePayload(payload) {
    if (typeof payload === 'string') {
      return payload.trim();
    }
    if (payload && typeof payload === 'object') {
      const direct = String(payload.message || payload.msg || payload.error || payload.title || payload.status || '').trim();
      if (direct) {
        return direct;
      }
      try {
        return JSON.stringify(payload);
      } catch {
        return String(payload);
      }
    }
    return String(payload || '').trim();
  }

  function buildNoCodeMessage(payload = {}) {
    const preview = describePayload(payload).replace(/\s+/g, ' ').trim().slice(0, 180);
    return preview
      ? `验证码接口暂未返回有效验证码：${preview}`
      : '验证码接口暂未返回有效验证码。';
  }

  function chooseEntry(entries = [], usage = {}) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return null;
    }
    const normalizedUsage = normalizeUsage(usage);
    return entries
      .map((entry, index) => {
        const itemUsage = normalizedUsage[entry.key] || {};
        return {
          ...entry,
          index: Number.isFinite(entry.index) ? entry.index : index,
          useCount: Math.max(0, Math.floor(Number(itemUsage.useCount) || 0)),
          usedAt: Math.max(0, Number(itemUsage.usedAt) || 0),
          enabled: itemUsage.enabled !== false,
        };
      })
      .filter((entry) => entry.enabled && entry.useCount < MAX_SUCCESS_USES)
      .sort((left, right) => {
        if (left.useCount !== right.useCount) {
          return left.useCount - right.useCount;
        }
        if (left.usedAt !== right.usedAt) {
          return left.usedAt - right.usedAt;
        }
        return left.index - right.index;
      })[0] || null;
  }

  function inferCountryFromPhoneNumber(phoneNumber = '') {
    const digits = String(phoneNumber || '').replace(/\D+/g, '');
    if (!digits) {
      return null;
    }
    const match = COUNTRY_BY_PHONE_PREFIX.find((entry) => digits.startsWith(entry.prefix));
    if (!match) {
      return null;
    }
    return {
      id: Math.max(0, Math.floor(Number(match.id) || 0)),
      label: normalizeText(match.label),
    };
  }

  function createProvider(deps = {}) {
    const {
      addLog = async () => {},
      fetchImpl = (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
      sleepWithStop = async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      throwIfStopped = () => {},
      getState = async () => ({}),
      setState = async () => {},
      broadcastDataUpdate = null,
    } = deps;

    async function applyRuntimePatch(patch = {}) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
        return;
      }
      await setState(patch);
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate(patch);
      }
    }

    async function getPoolState() {
      const state = await getState().catch(() => ({}));
      const entries = parseEntries(state?.[POOL_TEXT_KEY] || '');
      const usage = normalizeUsage(state?.[POOL_USAGE_KEY] || {});
      const currentEntry = parsePoolKey(
        state?.[CURRENT_ENTRY_KEY]?.key
        || buildPoolKey(state?.[CURRENT_ENTRY_KEY]?.phone, state?.[CURRENT_ENTRY_KEY]?.verificationUrl)
      );
      const autoDisableEnabled = Boolean(state?.[AUTO_DISABLE_ENABLED_KEY]);
      return {
        state,
        entries,
        usage,
        currentEntry,
        autoDisableEnabled,
      };
    }

    async function updateUsage(entry, options = {}) {
      if (!entry?.key) {
        return null;
      }
      const { state, usage } = await getPoolState();
      const previous = usage[entry.key] || {};
      const now = Date.now();
      const success = options.success === true;
      const enabled = options.enabled === undefined ? previous.enabled !== false : Boolean(options.enabled);
      const nextUsage = {
        ...usage,
        [entry.key]: {
          useCount: options.incrementUseCount
            ? Math.min(MAX_SUCCESS_USES, Math.max(0, Math.floor(Number(previous.useCount) || 0)) + 1)
            : Math.max(0, Math.floor(Number(previous.useCount) || 0)),
          usedAt: options.incrementUseCount
            ? now
            : Math.max(0, Number(previous.usedAt) || 0),
          lastAttemptAt: now,
          lastError: success ? '' : normalizeText(options.error),
          enabled,
          disabledReason: enabled ? '' : normalizeText(options.disabledReason || options.error),
          disabledAt: enabled ? 0 : Math.max(0, Number(options.disabledAt) || now),
          failureCount: options.failureCount === undefined
            ? (
              success
                ? 0
                : Math.max(0, Math.floor(Number(previous.failureCount) || 0)) + (options.incrementFailureCount === true ? 1 : 0)
            )
            : Math.max(0, Math.floor(Number(options.failureCount) || 0)),
        },
      };
      await applyRuntimePatch({
        [POOL_USAGE_KEY]: nextUsage,
        [CURRENT_ENTRY_KEY]: options.clearCurrent ? null : (options.currentEntry || state?.[CURRENT_ENTRY_KEY] || entry),
      });
      return nextUsage;
    }

    async function markEntryFailure(entry, reason = '', options = {}) {
      if (!entry?.key) {
        return null;
      }
      const { autoDisableEnabled, usage } = await getPoolState();
      const previous = usage[entry.key] || {};
      const nextFailureCount = Math.max(0, Math.floor(Number(previous.failureCount) || 0)) + 1;
      const shouldDisable = Boolean(
        (options.forceDisable === true)
        || (autoDisableEnabled && nextFailureCount >= AUTO_DISABLE_THRESHOLD)
      );
      const nextUsage = await updateUsage(entry, {
        success: false,
        error: reason,
        incrementFailureCount: true,
        enabled: !shouldDisable,
        disabledReason: shouldDisable ? (reason || '连续取码失败') : '',
        currentEntry: entry,
      });
      if (shouldDisable) {
        await addLog(`步骤 9：${PROVIDER_LABEL}号码 ${entry.phone} 已自动禁用。原因：${reason || '连续取码失败'}`, 'warn');
      }
      return nextUsage;
    }

    async function requestActivation(state = {}, _options = {}) {
      const entries = parseEntries(state?.[POOL_TEXT_KEY] || '');
      const usage = normalizeUsage(state?.[POOL_USAGE_KEY] || {});
      const selectedEntry = chooseEntry(entries, usage);
      if (!selectedEntry) {
        const enabledEntries = entries.filter((entry) => (usage?.[entry.key] || {}).enabled !== false);
        const exhaustedEntries = enabledEntries.filter((entry) => (
          Math.max(0, Math.floor(Number(usage?.[entry.key]?.useCount) || 0)) >= MAX_SUCCESS_USES
        ));
        if (enabledEntries.length > 0 && exhaustedEntries.length === enabledEntries.length) {
          throw new Error(`${PROVIDER_LABEL}号池暂无可用号码，当前全部启用号码都已达到成功使用上限 ${MAX_SUCCESS_USES} 次。`);
        }
        throw new Error(`${PROVIDER_LABEL}号池暂无可用号码，请先导入号码或启用可用号码。`);
      }
      await updateUsage(selectedEntry, {
        success: true,
        incrementUseCount: true,
        currentEntry: selectedEntry,
      });
      await addLog(`步骤 9：${PROVIDER_LABEL}已选择号码 ${selectedEntry.phone}。`, 'info');
      const inferredCountry = inferCountryFromPhoneNumber(selectedEntry.phone);
      return {
        activationId: selectedEntry.key,
        phoneNumber: selectedEntry.phone,
        provider: PROVIDER_ID,
        serviceCode: DEFAULT_SERVICE_CODE,
        ...(inferredCountry
          ? {
            countryId: inferredCountry.id,
            countryLabel: inferredCountry.label,
          }
          : {}),
      };
    }

    async function finishActivation(_state = {}, activation = null) {
      const entry = parsePoolKey(activation?.activationId);
      if (!entry?.key) {
        return '';
      }
      await updateUsage(entry, {
        success: true,
        currentEntry: entry,
        clearCurrent: true,
      });
      return 'OK';
    }

    async function cancelActivation(_state = {}, activation = null) {
      const entry = parsePoolKey(activation?.activationId);
      if (!entry?.key) {
        return '';
      }
      await markEntryFailure(entry, '取消接码订单', { forceDisable: false });
      await applyRuntimePatch({ [CURRENT_ENTRY_KEY]: null });
      return 'CANCELLED';
    }

    async function banActivation(_state = {}, activation = null) {
      const entry = parsePoolKey(activation?.activationId);
      if (!entry?.key) {
        return '';
      }
      await markEntryFailure(entry, '号码被目标站拒绝', { forceDisable: true });
      await applyRuntimePatch({ [CURRENT_ENTRY_KEY]: null });
      return 'BANNED';
    }

    async function requestAdditionalSms() {
      return 'UNSUPPORTED';
    }

    async function pollActivationCode(_state = {}, activation = null, options = {}) {
      const entry = parsePoolKey(activation?.activationId);
      if (!entry?.key || !entry.verificationUrl) {
        throw new Error(`${PROVIDER_LABEL}激活记录缺少验证码接口地址。`);
      }
      if (typeof fetchImpl !== 'function') {
        throw new Error(`${PROVIDER_LABEL}网络请求实现不可用。`);
      }
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 180000);
      const intervalMs = Math.max(1000, Number(options.intervalMs) || 5000);
      const maxRoundsRaw = Math.floor(Number(options.maxRounds));
      const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? maxRoundsRaw : 0;
      const startedAt = Date.now();
      let pollCount = 0;
      let lastStatus = '';

      while (Date.now() - startedAt < timeoutMs) {
        if (maxRounds > 0 && pollCount >= maxRounds) {
          break;
        }
        throwIfStopped();
        pollCount += 1;

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeoutId = controller
          ? setTimeout(() => controller.abort(), Math.max(1000, Number(requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS))
          : null;
        try {
          const response = await fetchImpl(entry.verificationUrl, {
            method: 'GET',
            cache: 'no-store',
            credentials: 'include',
            headers: {
              Accept: 'application/json,text/plain,*/*',
              'Cache-Control': 'no-cache, no-store, max-age=0',
              Pragma: 'no-cache',
            },
            signal: controller?.signal,
          });
          const text = await response.text().catch(() => '');
          const payload = parsePayloadText(text);
          if (!response.ok) {
            lastStatus = describePayload(payload) || `HTTP ${response.status}`;
          } else {
            const code = extractVerificationCode(payload);
            if (code) {
              await updateUsage(entry, {
                success: true,
                currentEntry: entry,
              });
              return code;
            }
            lastStatus = buildNoCodeMessage(payload);
          }
        } catch (error) {
          if (error?.name === 'AbortError') {
            lastStatus = '验证码接口请求超时。';
          } else {
            lastStatus = error?.message || String(error || '未知错误');
          }
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }

        if (typeof options.onStatus === 'function') {
          await options.onStatus({
            activation,
            elapsedMs: Date.now() - startedAt,
            pollCount,
            statusText: lastStatus || '等待验证码',
            timeoutMs,
          });
        }
        if (typeof options.onWaitingForCode === 'function') {
          await options.onWaitingForCode({
            activation,
            elapsedMs: Date.now() - startedAt,
            pollCount,
            statusText: lastStatus || '等待验证码',
            timeoutMs,
          });
        }
        if (Date.now() - startedAt >= timeoutMs) {
          break;
        }
        await sleepWithStop(intervalMs);
      }

      await markEntryFailure(entry, lastStatus || '等待手机验证码超时');
      throw new Error(`PHONE_CODE_TIMEOUT::等待手机验证码超时。${lastStatus ? ` 最后状态：${lastStatus}` : ''}`);
    }

    async function fetchBalance() {
      throw new Error(`${PROVIDER_LABEL}使用自定义号码池，无余额接口。`);
    }

    function resolveCountryCandidates() {
      return [];
    }

    function normalizeCountryId(value, fallback = 0) {
      const parsed = Math.floor(Number(value));
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
      const fallbackParsed = Math.floor(Number(fallback));
      return Number.isFinite(fallbackParsed) && fallbackParsed >= 0 ? fallbackParsed : 0;
    }

    function normalizeCountryLabel(value = '', fallback = '') {
      return normalizeText(value) || normalizeText(fallback);
    }

    function normalizeMaxPrice(value = '') {
      return normalizeText(value);
    }

    return {
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      defaultProduct: DEFAULT_SERVICE_LABEL,
      defaultServiceCode: DEFAULT_SERVICE_CODE,
      normalizeCountryId,
      normalizeCountryLabel,
      normalizeMaxPrice,
      resolveCountryCandidates,
      requestActivation,
      finishActivation,
      cancelActivation,
      banActivation,
      requestAdditionalSms,
      pollActivationCode,
      fetchBalance,
    };
  }

  return {
    PROVIDER_ID,
    PROVIDER_LABEL,
    DEFAULT_SERVICE_CODE,
    DEFAULT_SERVICE_LABEL,
    POOL_TEXT_KEY,
    POOL_USAGE_KEY,
    CURRENT_ENTRY_KEY,
    AUTO_DISABLE_ENABLED_KEY,
    AUTO_DISABLE_THRESHOLD,
    buildPoolKey,
    parseEntries,
    extractVerificationCode,
    createProvider,
  };
});
