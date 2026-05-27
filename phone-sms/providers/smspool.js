// phone-sms/providers/smspool.js - SMSPool native API adapter
(function attachSmsPoolProvider(root, factory) {
  root.PhoneSmsPoolProvider = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function createSmsPoolProviderModule(_root) {
  const PROVIDER_ID = 'smspool';
  const DEFAULT_BASE_URL = 'https://api.smspool.net';
  const DEFAULT_COMPAT_BASE_URL = 'https://api.smspool.net/stubs/handler_api.php?setting=smspool';
  const DEFAULT_SERVICE_CODE = '671';
  const DEFAULT_SERVICE_LABEL = 'OpenAI / ChatGPT';
  const DEFAULT_COUNTRY_ID = 1;
  const DEFAULT_COUNTRY_LABEL = 'United States';
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
  const DEFAULT_ACTIVATION_RETRY_ROUNDS = 3;
  const ACTIVATION_RETRY_ROUNDS_MIN = 1;
  const ACTIVATION_RETRY_ROUNDS_MAX = 10;
  const DEFAULT_ACTIVATION_RETRY_DELAY_MS = 2000;

  function normalizeCountryId(value, fallback = DEFAULT_COUNTRY_ID) {
    const parsed = Math.floor(Number(value));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    const fallbackParsed = Math.floor(Number(fallback));
    return Number.isFinite(fallbackParsed) && fallbackParsed > 0 ? fallbackParsed : DEFAULT_COUNTRY_ID;
  }

  function normalizeCountryLabel(value = '', fallback = DEFAULT_COUNTRY_LABEL) {
    return String(value || '').trim() || fallback;
  }

  function normalizeCountryFallback(value = []) {
    const source = Array.isArray(value)
      ? value
      : String(value || '')
        .split(/[\r\n,，;；]+/)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    const seen = new Set();
    const normalized = [];
    for (const entry of source) {
      let id = 0;
      let label = '';
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        id = normalizeCountryId(entry.id ?? entry.countryId, 0);
        label = String((entry.label ?? entry.countryLabel) || '').trim();
      } else {
        const text = String(entry || '').trim();
        const structured = text.match(/^(\d+)\s*(?:[:|/-]\s*(.+))?$/);
        id = normalizeCountryId(structured?.[1] || text, 0);
        label = String(structured?.[2] || '').trim();
      }
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      normalized.push({ id, label: label || `Country #${id}` });
      if (normalized.length >= 20) {
        break;
      }
    }
    return normalized;
  }

  function normalizeMaxPrice(value = '') {
    const rawValue = String(value ?? '').trim();
    if (!rawValue) {
      return '';
    }
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return '';
    }
    return String(Math.round(numeric * 10000) / 10000);
  }

  function normalizeServiceCode(value = '', fallback = DEFAULT_SERVICE_CODE) {
    const normalized = String(value || '').trim();
    if (normalized) {
      return normalized;
    }
    return String(fallback || '').trim() || DEFAULT_SERVICE_CODE;
  }

  function normalizeBaseUrl(value = '') {
    const trimmed = String(value || '').trim() || DEFAULT_BASE_URL;
    try {
      const url = new URL(trimmed);
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return DEFAULT_BASE_URL;
    }
  }

  function normalizeCompatBaseUrl(value = '') {
    const trimmed = String(value || '').trim() || DEFAULT_COMPAT_BASE_URL;
    try {
      return new URL(trimmed).toString();
    } catch {
      return DEFAULT_COMPAT_BASE_URL;
    }
  }

  function buildCompatUrl(config = {}, query = {}) {
    const url = new URL(normalizeCompatBaseUrl(config.compatBaseUrl));
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  function parsePayload(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return '';
    }
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  function describePayload(raw) {
    if (typeof raw === 'string') {
      return raw.trim();
    }
    if (raw && typeof raw === 'object') {
      const direct = String(
        raw.message
        || raw.msg
        || raw.error
        || raw.title
        || raw.status
        || raw.statusText
        || ''
      ).trim();
      if (direct) {
        return direct;
      }
      try {
        return JSON.stringify(raw);
      } catch {
        return String(raw);
      }
    }
    return String(raw || '').trim();
  }

  function resolveConfig(state = {}, deps = {}) {
    const configuredBaseUrl = String(state.smsPoolBaseUrl || '').trim();
    const normalizedConfiguredBaseUrl = normalizeBaseUrl(configuredBaseUrl || DEFAULT_BASE_URL);
    const normalizedConfiguredCompatBaseUrl = normalizeCompatBaseUrl(configuredBaseUrl || DEFAULT_COMPAT_BASE_URL);
    const baseUrlLooksLikeCompat = /\/stubs\/handler_api(?:\.php)?/i.test(normalizedConfiguredBaseUrl);
    return {
      apiKey: String(state.smsPoolApiKey || '').trim(),
      baseUrl: baseUrlLooksLikeCompat ? DEFAULT_BASE_URL : normalizedConfiguredBaseUrl,
      compatBaseUrl: baseUrlLooksLikeCompat ? normalizedConfiguredCompatBaseUrl : DEFAULT_COMPAT_BASE_URL,
      fetchImpl: deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  function normalizeActivationRetryRounds(value, fallback = DEFAULT_ACTIVATION_RETRY_ROUNDS) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return Math.max(ACTIVATION_RETRY_ROUNDS_MIN, Math.min(ACTIVATION_RETRY_ROUNDS_MAX, Math.floor(Number(fallback) || DEFAULT_ACTIVATION_RETRY_ROUNDS)));
    }
    return Math.max(ACTIVATION_RETRY_ROUNDS_MIN, Math.min(ACTIVATION_RETRY_ROUNDS_MAX, parsed));
  }

  function normalizeActivationRetryDelayMs(value, fallback = DEFAULT_ACTIVATION_RETRY_DELAY_MS) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return Math.max(500, Math.min(30000, Math.floor(Number(fallback) || DEFAULT_ACTIVATION_RETRY_DELAY_MS)));
    }
    return Math.max(500, Math.min(30000, parsed));
  }

  async function postForm(config, path, body = {}, actionLabel = 'SMSPool request', requireApiKey = true) {
    if (requireApiKey && !config.apiKey) {
      throw new Error('SMSPool API Key 缺失，请先在侧边栏保存接码 API Key。');
    }
    if (!config.fetchImpl) {
      throw new Error('SMSPool 网络请求实现不可用。');
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), Number(config.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS)
      : null;
    try {
      const formData = new URLSearchParams();
      Object.entries(body || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          return;
        }
        formData.set(key, String(value));
      });
      const response = await config.fetchImpl(`${normalizeBaseUrl(config.baseUrl)}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json, text/plain, */*',
        },
        body: formData.toString(),
        signal: controller?.signal,
      });
      const text = await response.text();
      const payload = parsePayload(text);
      if (!response.ok) {
        const error = new Error(`${actionLabel}失败：${describePayload(payload) || response.status}`);
        error.payload = payload;
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`${actionLabel}超时。`);
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  async function fetchCompatPayload(config, query = {}, actionLabel = 'SMSPool compat request') {
    if (!config.apiKey) {
      throw new Error('SMSPool API Key 缺失，请先在侧边栏保存接码 API Key。');
    }
    if (!config.fetchImpl) {
      throw new Error('SMSPool 网络请求实现不可用。');
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), Number(config.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS)
      : null;
    try {
      const response = await config.fetchImpl(buildCompatUrl(config, {
        api_key: config.apiKey,
        ...query,
      }), {
        method: 'GET',
        signal: controller?.signal,
      });
      const text = await response.text();
      const payload = parsePayload(text);
      if (!response.ok) {
        const error = new Error(`${actionLabel}失败：${describePayload(payload) || response.status}`);
        error.payload = payload;
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`${actionLabel}超时。`);
      }
      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  function normalizeActivation(record, fallback = {}) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return null;
    }
    const activationId = String(
      record.activationId
      ?? record.orderid
      ?? record.order_id
      ?? record.orderCode
      ?? record.id
      ?? ''
    ).trim();
    const phoneNumber = String(
      record.phoneNumber
      ?? record.phonenumber
      ?? record.number
      ?? record.phone
      ?? ''
    ).trim();
    if (!activationId || !phoneNumber) {
      return null;
    }
    return {
      activationId,
      phoneNumber,
      provider: PROVIDER_ID,
      serviceCode: normalizeServiceCode(record.serviceCode || fallback.serviceCode || DEFAULT_SERVICE_CODE),
      countryId: normalizeCountryId(record.countryId ?? fallback.countryId, DEFAULT_COUNTRY_ID),
      countryLabel: normalizeCountryLabel(record.countryLabel || record.country || fallback.countryLabel, DEFAULT_COUNTRY_LABEL),
      successfulUses: Math.max(0, Math.floor(Number(record.successfulUses ?? fallback.successfulUses) || 0)),
      maxUses: Math.max(1, Math.floor(Number(record.maxUses ?? fallback.maxUses) || 3)),
      ...(Number.isFinite(Number(record.smsPoolResendPreparedAt ?? fallback.smsPoolResendPreparedAt))
        ? { smsPoolResendPreparedAt: Math.max(0, Number(record.smsPoolResendPreparedAt ?? fallback.smsPoolResendPreparedAt) || 0) }
        : {}),
      ...(Array.isArray(record.smsPoolIgnoredCodes) || Array.isArray(fallback.smsPoolIgnoredCodes)
        ? {
          smsPoolIgnoredCodes: Array.from(new Set(
            (Array.isArray(record.smsPoolIgnoredCodes) ? record.smsPoolIgnoredCodes : fallback.smsPoolIgnoredCodes)
              .map((entry) => extractVerificationCode(entry))
              .filter(Boolean)
          )),
        }
        : {}),
      ...(record.cost !== undefined ? { price: Number(record.cost) } : {}),
      ...(record.pool !== undefined ? { pool: record.pool } : {}),
    };
  }

  function isSuccessPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return false;
    }
    return Number(payload.success) === 1;
  }

  function extractVerificationCode(rawCodeOrText) {
    const trimmed = String(rawCodeOrText || '').trim();
    if (!trimmed) {
      return '';
    }
    const digitMatch = trimmed.match(/\b(\d{4,8})\b/);
    return digitMatch?.[1] || '';
  }

  function extractCodeFromSmsPoolPayload(payload) {
    if (!payload) {
      return '';
    }
    if (Array.isArray(payload)) {
      for (let index = payload.length - 1; index >= 0; index -= 1) {
        const code = extractCodeFromSmsPoolPayload(payload[index]);
        if (code) {
          return code;
        }
      }
      return '';
    }
    if (typeof payload === 'string') {
      return extractVerificationCode(payload);
    }
    if (typeof payload === 'object') {
      const directFields = [
        payload.code,
        payload.full_code,
        payload.sms_code,
        payload.otp,
        payload.verification_code,
        payload.message,
        payload.text,
      ];
      for (const field of directFields) {
        const code = extractVerificationCode(field);
        if (code) {
          return code;
        }
      }
      const nestedArrays = [
        payload.sms,
        payload.messages,
        payload.history,
      ];
      for (const items of nestedArrays) {
        if (!Array.isArray(items)) {
          continue;
        }
        for (let index = items.length - 1; index >= 0; index -= 1) {
          const code = extractCodeFromSmsPoolPayload(items[index]);
          if (code) {
            return code;
          }
        }
      }
    }
    return '';
  }

  function collectCodesFromSmsPoolPayload(payload, codes = new Set()) {
    if (!payload) {
      return codes;
    }
    if (Array.isArray(payload)) {
      payload.forEach((entry) => collectCodesFromSmsPoolPayload(entry, codes));
      return codes;
    }
    if (typeof payload === 'string') {
      const code = extractVerificationCode(payload);
      if (code) {
        codes.add(code);
      }
      return codes;
    }
    if (typeof payload === 'object') {
      const directFields = [
        payload.code,
        payload.full_code,
        payload.sms_code,
        payload.otp,
        payload.verification_code,
        payload.message,
        payload.text,
      ];
      directFields.forEach((field) => {
        const code = extractVerificationCode(field);
        if (code) {
          codes.add(code);
        }
      });
      [
        payload.sms,
        payload.messages,
        payload.history,
      ].forEach((items) => collectCodesFromSmsPoolPayload(items, codes));
    }
    return codes;
  }

  function resolveIgnoredCodeSet(activation) {
    const codes = Array.isArray(activation?.smsPoolIgnoredCodes) ? activation.smsPoolIgnoredCodes : [];
    return new Set(codes.map((entry) => extractVerificationCode(entry)).filter(Boolean));
  }

  function extractFreshCodeFromSmsPoolPayload(payload, ignoredCodes = null) {
    const code = extractCodeFromSmsPoolPayload(payload);
    if (!code) {
      return '';
    }
    if (ignoredCodes && ignoredCodes.has(code)) {
      return '';
    }
    return code;
  }

  async function captureExistingCodesForActivation(config, activation) {
    const existingCodes = new Set();
    try {
      const checkPayload = await postForm(config, '/sms/check', {
        key: config.apiKey,
        orderid: activation.activationId,
      }, 'SMSPool capture existing sms');
      collectCodesFromSmsPoolPayload(checkPayload, existingCodes);
    } catch {}

    try {
      const activePayload = await postForm(config, '/request/active', {
        key: config.apiKey,
      }, 'SMSPool capture active orders');
      const activeOrders = Array.isArray(activePayload) ? activePayload : [];
      const matchedOrder = activeOrders.find((entry) => {
        const orderCode = String(entry?.order_code || entry?.orderid || entry?.order_id || '').trim();
        const phoneNumber = String(entry?.phonenumber || entry?.phoneNumber || entry?.number || '').trim();
        return orderCode === activation.activationId || phoneNumber === activation.phoneNumber;
      });
      if (matchedOrder) {
        collectCodesFromSmsPoolPayload(matchedOrder, existingCodes);
      }
    } catch {}

    return Array.from(existingCodes);
  }

  function isTerminalStatusPayload(payloadOrMessage) {
    const text = describePayload(payloadOrMessage).toLowerCase();
    return /cancel|expired|timeout|closed|order\s+not\s+found|invalid\s+order|invalid\s+number|does\s+not\s+exist/i.test(text);
  }

  async function requestActivation(state = {}, _options = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const maxRounds = normalizeActivationRetryRounds(state?.heroSmsActivationRetryRounds, DEFAULT_ACTIVATION_RETRY_ROUNDS);
    const retryDelayMs = normalizeActivationRetryDelayMs(state?.heroSmsActivationRetryDelayMs, DEFAULT_ACTIVATION_RETRY_DELAY_MS);
    let lastError = null;

    for (let round = 1; round <= maxRounds; round += 1) {
      try {
        const payload = await postForm(config, '/purchase/sms', {
          key: config.apiKey,
          country: 'US',
          service: normalizeServiceCode(state.smsPoolServiceCode, DEFAULT_SERVICE_CODE),
          quantity: 1,
        }, 'SMSPool purchase sms');
        const activation = normalizeActivation(payload, {
          serviceCode: normalizeServiceCode(state.smsPoolServiceCode, DEFAULT_SERVICE_CODE),
          countryId: normalizeCountryId(state.smsPoolCountryId, DEFAULT_COUNTRY_ID),
          countryLabel: normalizeCountryLabel(state.smsPoolCountryLabel, DEFAULT_COUNTRY_LABEL),
        });
        if (!activation) {
          throw new Error(`SMSPool purchase sms失败：${describePayload(payload) || '空响应'}`);
        }
        return activation;
      } catch (error) {
        lastError = error;
        if (round >= maxRounds) {
          break;
        }
        await deps.addLog?.(
          `步骤 8：SMSPool 取号失败，正在按取号轮数重试（${round}/${maxRounds}）。${error?.message || error}`,
          'warn'
        );
        await deps.sleepWithStop?.(retryDelayMs);
      }
    }

    throw lastError || new Error('SMSPool purchase sms失败：未知错误');
  }

  async function reuseActivation(state = {}, activation, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      throw new Error('缺少可复用的 SMSPool 手机号订单。');
    }
    const config = resolveConfig(state, deps);
    const activatePayload = await postForm(config, '/sms/activate', {
      key: config.apiKey,
      orderid: normalizedActivation.activationId,
    }, 'SMSPool activate sms');
    if (isSuccessPayload(activatePayload)) {
      const existingCodes = await captureExistingCodesForActivation(config, normalizedActivation);
      return {
        ...normalizedActivation,
        smsPoolResendPreparedAt: Date.now(),
        ...(existingCodes.length ? { smsPoolIgnoredCodes: existingCodes } : {}),
      };
    }
    const reactivatePayload = await postForm(config, '/sms/reactivate', {
      key: config.apiKey,
      orderid: normalizedActivation.activationId,
    }, 'SMSPool reactivate sms');
    if (!isSuccessPayload(reactivatePayload)) {
      throw new Error(`SMSPool 复用手机号失败：${describePayload(reactivatePayload) || '未知错误'}`);
    }
    const existingCodes = await captureExistingCodesForActivation(config, normalizedActivation);
    return {
      ...normalizedActivation,
      smsPoolResendPreparedAt: Date.now(),
      ...(existingCodes.length ? { smsPoolIgnoredCodes: existingCodes } : {}),
    };
  }

  async function finishActivation(_state = {}, activation) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      return '';
    }
    return 'SMSPool complete skipped';
  }

  async function cancelActivation(state = {}, activation, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      return '';
    }
    const config = resolveConfig(state, deps);
    const payload = await postForm(config, '/sms/cancel', {
      key: config.apiKey,
      orderid: normalizedActivation.activationId,
    }, 'SMSPool cancel sms');
    if (!isSuccessPayload(payload)) {
      throw new Error(`SMSPool 取消订单失败：${describePayload(payload) || '未知错误'}`);
    }
    return describePayload(payload);
  }

  async function banActivation(state = {}, activation, deps = {}) {
    return cancelActivation(state, activation, deps);
  }

  async function requestAdditionalSms(state = {}, activation, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      return '';
    }
    const config = resolveConfig(state, deps);
    const probePayload = await postForm(config, '/sms/check_resend', {
      key: config.apiKey,
      orderid: normalizedActivation.activationId,
    }, 'SMSPool check resend');
    if (isSuccessPayload(probePayload)) {
      const resendPayload = await postForm(config, '/sms/resend', {
        key: config.apiKey,
        orderid: normalizedActivation.activationId,
      }, 'SMSPool resend sms');
      if (!isSuccessPayload(resendPayload)) {
        throw new Error(`SMSPool 重发请求失败：${describePayload(resendPayload) || '未知错误'}`);
      }
      return {
        message: describePayload(resendPayload),
        activation: {
          ...normalizedActivation,
          smsPoolResendPreparedAt: Date.now(),
          ...(ignoredCodes.length ? { smsPoolIgnoredCodes: ignoredCodes } : {}),
        },
      };
    }
    const activatePayload = await postForm(config, '/sms/activate', {
      key: config.apiKey,
      orderid: normalizedActivation.activationId,
    }, 'SMSPool activate sms');
    if (!isSuccessPayload(activatePayload)) {
      throw new Error(`SMSPool 刷新收码状态失败：${describePayload(activatePayload) || describePayload(probePayload) || '未知错误'}`);
    }
    return {
      message: describePayload(activatePayload),
      activation: {
        ...normalizedActivation,
        smsPoolResendPreparedAt: Date.now(),
        ...(ignoredCodes.length ? { smsPoolIgnoredCodes: ignoredCodes } : {}),
      },
    };
  }

  async function pollActivationCode(state = {}, activation, options = {}, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      throw new Error('缺少 SMSPool 手机号接码订单。');
    }
    const config = resolveConfig(state, deps);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 180000);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || 5000);
    const maxRoundsRaw = Math.floor(Number(options.maxRounds));
    const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? maxRoundsRaw : 0;
    const start = Date.now();
    let pollCount = 0;
    let lastResponse = '';
    const ignoredCodes = resolveIgnoredCodeSet(normalizedActivation);
    const resendPreparedAt = Math.max(0, Number(normalizedActivation.smsPoolResendPreparedAt) || 0);
    const freshnessDelayMs = Math.max(3000, Number(options.smsPoolFreshnessDelayMs) || 8000);
    let ignoredHistoricalCodeLogged = false;

    while (Date.now() - start < timeoutMs) {
      if (maxRounds > 0 && pollCount >= maxRounds) {
        break;
      }
      deps.throwIfStopped?.();
      if (resendPreparedAt > 0 && (Date.now() - resendPreparedAt) < freshnessDelayMs) {
        pollCount += 1;
        lastResponse = 'WAIT_FRESH_SMS';
        if (typeof options.onStatus === 'function') {
          await options.onStatus({
            activation: normalizedActivation,
            elapsedMs: Date.now() - start,
            pollCount,
            statusText: lastResponse,
            timeoutMs,
          });
        }
        if (typeof options.onWaitingForCode === 'function') {
          await options.onWaitingForCode({
            activation: normalizedActivation,
            elapsedMs: Date.now() - start,
            pollCount,
            statusText: lastResponse,
            timeoutMs,
          });
        }
        await deps.sleepWithStop(intervalMs);
        continue;
      }
      let payload = null;
      let checkFailed = null;
      try {
        payload = await postForm(config, '/sms/check', {
          key: config.apiKey,
          orderid: normalizedActivation.activationId,
        }, 'SMSPool check sms');
      } catch (error) {
        checkFailed = error;
      }
      pollCount += 1;
      lastResponse = describePayload(payload || checkFailed?.payload || checkFailed?.message);

      if (typeof options.onStatus === 'function') {
        await options.onStatus({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: lastResponse || 'PENDING',
          timeoutMs,
        });
      }

      const code = extractFreshCodeFromSmsPoolPayload(payload, ignoredCodes);
      if (code) {
        return code;
      }
      if (!code && ignoredCodes.size > 0 && extractCodeFromSmsPoolPayload(payload)) {
        if (!ignoredHistoricalCodeLogged) {
          ignoredHistoricalCodeLogged = true;
          await deps.addLog?.(
            `步骤 8：SMSPool 复用订单 ${normalizedActivation.phoneNumber} 命中历史验证码，继续等待新短信。`,
            'info'
          );
        }
      }

      try {
        const activePayload = await postForm(config, '/request/active', {
          key: config.apiKey,
        }, 'SMSPool active orders');
        const activeOrders = Array.isArray(activePayload) ? activePayload : [];
        const matchedOrder = activeOrders.find((entry) => {
          const orderCode = String(entry?.order_code || entry?.orderid || entry?.order_id || '').trim();
          const phoneNumber = String(entry?.phonenumber || entry?.phoneNumber || entry?.number || '').trim();
          return orderCode === normalizedActivation.activationId || phoneNumber === normalizedActivation.phoneNumber;
        });
        const activeCode = extractFreshCodeFromSmsPoolPayload(matchedOrder, ignoredCodes);
        if (activeCode) {
          return activeCode;
        }
        if (!activeCode && ignoredCodes.size > 0 && extractCodeFromSmsPoolPayload(matchedOrder)) {
          if (!ignoredHistoricalCodeLogged) {
            ignoredHistoricalCodeLogged = true;
            await deps.addLog?.(
              `步骤 8：SMSPool 复用订单 ${normalizedActivation.phoneNumber} 命中历史验证码，继续等待新短信。`,
              'info'
            );
          }
        }
        if (matchedOrder) {
          lastResponse = describePayload(matchedOrder) || lastResponse;
          if (isTerminalStatusPayload(matchedOrder) || String(matchedOrder?.status || '').trim().toLowerCase() === 'completed') {
            throw new Error(`SMSPool 查询验证码失败：${lastResponse || '订单已结束'}`);
          }
        }
      } catch (activeError) {
        if (!checkFailed && isTerminalStatusPayload(activeError?.payload || activeError?.message)) {
          throw activeError;
        }
      }

      if (isTerminalStatusPayload(payload || checkFailed?.payload || checkFailed?.message)) {
        throw new Error(`SMSPool 查询验证码失败：${lastResponse || '订单已结束'}`);
      }

      if (typeof options.onWaitingForCode === 'function') {
        await options.onWaitingForCode({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: lastResponse || 'PENDING',
          timeoutMs,
        });
      }

      await deps.sleepWithStop(intervalMs);
    }

    const suffix = lastResponse ? ` SMSPool 最后状态：${lastResponse}` : '';
    throw new Error(`PHONE_CODE_TIMEOUT::等待手机验证码超时。${suffix}`);
  }

  async function fetchBalance(state = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const payload = await postForm(config, '/request/balance', {
      key: config.apiKey,
    }, 'SMSPool balance');
    const balance = Number(payload?.balance);
    return {
      balance,
      raw: payload,
    };
  }

  async function fetchPrices(state = {}, countryConfig = null, deps = {}) {
    const config = resolveConfig(state, deps);
    return fetchCompatPayload(config, {
      action: 'getPrices',
      service: normalizeServiceCode(state.smsPoolServiceCode, DEFAULT_SERVICE_CODE),
      country: normalizeCountryId(countryConfig?.id ?? state.smsPoolCountryId, DEFAULT_COUNTRY_ID),
    }, 'SMSPool getPrices');
  }

  function collectPriceEntries(payload, entries = []) {
    if (Array.isArray(payload)) {
      payload.forEach((entry) => collectPriceEntries(entry, entries));
      return entries;
    }
    if (!payload || typeof payload !== 'object') {
      return entries;
    }
    const directPrice = Number(payload.price ?? payload.cost);
    const directCount = Number(payload.count ?? payload.qty);
    if (Number.isFinite(directPrice) && directPrice > 0) {
      entries.push({
        cost: Math.round(directPrice * 10000) / 10000,
        count: Number.isFinite(directCount) ? Math.max(0, directCount) : 0,
        inStock: !Number.isFinite(directCount) || directCount > 0,
      });
    }
    Object.entries(payload).forEach(([key, value]) => {
      const keyedPrice = Number(key);
      if (Number.isFinite(keyedPrice) && keyedPrice > 0) {
        const count = Number(value?.count ?? value);
        entries.push({
          cost: Math.round(keyedPrice * 10000) / 10000,
          count: Number.isFinite(count) ? Math.max(0, count) : 0,
          inStock: !Number.isFinite(count) || count > 0,
        });
      }
      collectPriceEntries(value, entries);
    });
    return entries;
  }

  function resolveCountryCandidates(state = {}) {
    const primary = {
      id: normalizeCountryId(state.smsPoolCountryId),
      label: normalizeCountryLabel(state.smsPoolCountryLabel),
    };
    const seen = new Set([primary.id]);
    const candidates = [primary];
    normalizeCountryFallback(state.smsPoolCountryFallback).forEach((entry) => {
      const id = normalizeCountryId(entry.id, 0);
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);
      candidates.push({ id, label: normalizeCountryLabel(entry.label, `Country #${id}`) });
    });
    return candidates;
  }

  function createProvider(deps = {}) {
    const providerDeps = {
      addLog: deps.addLog,
      fetchImpl: deps.fetchImpl,
      sleepWithStop: deps.sleepWithStop,
      throwIfStopped: deps.throwIfStopped,
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
    return {
      id: PROVIDER_ID,
      label: 'SMSPool',
      defaultCountryId: DEFAULT_COUNTRY_ID,
      defaultCountryLabel: DEFAULT_COUNTRY_LABEL,
      defaultProduct: DEFAULT_SERVICE_LABEL,
      defaultServiceCode: DEFAULT_SERVICE_CODE,
      normalizeCountryId,
      normalizeCountryLabel,
      normalizeCountryFallback,
      normalizeMaxPrice,
      normalizeServiceCode,
      resolveCountryCandidates,
      requestActivation: (state, options) => requestActivation(state, options, providerDeps),
      reuseActivation: (state, activation) => reuseActivation(state, activation, providerDeps),
      finishActivation: (state, activation) => finishActivation(state, activation, providerDeps),
      cancelActivation: (state, activation) => cancelActivation(state, activation, providerDeps),
      banActivation: (state, activation) => banActivation(state, activation, providerDeps),
      requestAdditionalSms: (state, activation) => requestAdditionalSms(state, activation, providerDeps),
      pollActivationCode: (state, activation, options) => pollActivationCode(state, activation, options, providerDeps),
      fetchBalance: (state) => fetchBalance(state, providerDeps),
      fetchPrices: (state, countryConfig) => fetchPrices(state, countryConfig, providerDeps),
      collectPriceEntries,
      describePayload,
    };
  }

  return {
    PROVIDER_ID,
    DEFAULT_BASE_URL,
    DEFAULT_COMPAT_BASE_URL,
    DEFAULT_COUNTRY_ID,
    DEFAULT_COUNTRY_LABEL,
    DEFAULT_SERVICE_CODE,
    DEFAULT_SERVICE_LABEL,
    createProvider,
  };
});
