// phone-sms/providers/smsbower.js - SMSBower 接码平台适配层
(function attachSmsBowerProvider(root, factory) {
  root.PhoneSmsBowerProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createSmsBowerProviderModule() {
  const PROVIDER_ID = 'smsbower';
  const DEFAULT_BASE_URL = 'https://smsbower.page/stubs/handler_api.php';
  const DEFAULT_SERVICE_CODE = 'dr';
  const DEFAULT_SERVICE_LABEL = 'OpenAI';
  const DEFAULT_COUNTRY_ID = 52;
  const DEFAULT_COUNTRY_LABEL = 'Thailand';
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
  const DEFAULT_LANG = '';
  const DEFAULT_PRICES_ACTION = 'getPricesV3';

  function normalizeSmsBowerCountryId(value, fallback = DEFAULT_COUNTRY_ID) {
    const parsed = Math.floor(Number(value));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const fallbackParsed = Math.floor(Number(fallback));
    return Number.isFinite(fallbackParsed) && fallbackParsed > 0 ? fallbackParsed : DEFAULT_COUNTRY_ID;
  }

  function normalizeSmsBowerCountryLabel(value = '', fallback = DEFAULT_COUNTRY_LABEL) {
    return String(value || '').trim() || fallback;
  }

  function normalizeSmsBowerCountryFallback(value = []) {
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
        id = normalizeSmsBowerCountryId(entry.id ?? entry.countryId, 0);
        label = String((entry.label ?? entry.countryLabel) || '').trim();
      } else {
        const text = String(entry || '').trim();
        const structured = text.match(/^(\d+)\s*(?:[:|/-]\s*(.+))?$/);
        id = normalizeSmsBowerCountryId(structured?.[1] || text, 0);
        label = String(structured?.[2] || '').trim();
      }
      if (!id || seen.has(id)) continue;
      seen.add(id);
      normalized.push({ id, label: label || `Country #${id}` });
      if (normalized.length >= 20) break;
    }
    return normalized;
  }

  function normalizeSmsBowerPrice(value = '') {
    const rawValue = String(value ?? '').trim();
    if (!rawValue) return '';
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    return String(Math.round(numeric * 10000) / 10000);
  }

  function normalizeSmsBowerServiceCode(value = '', fallback = DEFAULT_SERVICE_CODE) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
    if (normalized) return normalized;
    const fallbackNormalized = String(fallback || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
    return fallbackNormalized || DEFAULT_SERVICE_CODE;
  }

  function normalizeSmsBowerLang(value = '', fallback = DEFAULT_LANG) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'ru' || normalized === 'en') {
      return normalized;
    }
    const fallbackNormalized = String(fallback || '').trim().toLowerCase();
    return fallbackNormalized === 'ru' || fallbackNormalized === 'en' ? fallbackNormalized : DEFAULT_LANG;
  }

  function normalizeSmsBowerPricesAction(value = '', fallback = DEFAULT_PRICES_ACTION) {
    const normalized = String(value || '').trim();
    if (normalized === 'getPrices' || normalized === 'getPricesV3') {
      return normalized;
    }
    const fallbackNormalized = String(fallback || '').trim();
    return fallbackNormalized === 'getPrices' || fallbackNormalized === 'getPricesV3'
      ? fallbackNormalized
      : DEFAULT_PRICES_ACTION;
  }

  function normalizeBaseUrl(value = '') {
    const trimmed = String(value || '').trim() || DEFAULT_BASE_URL;
    try {
      return new URL(trimmed).toString();
    } catch {
      return DEFAULT_BASE_URL;
    }
  }

  function buildUrl(config = {}, query = {}) {
    const url = new URL(normalizeBaseUrl(config.baseUrl));
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  function parsePayload(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.parse(trimmed); } catch { return trimmed; }
    }
    return trimmed;
  }

  function describePayload(raw) {
    if (typeof raw === 'string') return raw.trim();
    if (raw && typeof raw === 'object') {
      const direct = String(raw.message || raw.msg || raw.error || raw.title || raw.status || '').trim();
      if (direct) return direct;
      try { return JSON.stringify(raw); } catch { return String(raw); }
    }
    return String(raw || '').trim();
  }

  function resolveConfig(state = {}, deps = {}) {
    return {
      apiKey: String(state.smsBowerApiKey || '').trim(),
      baseUrl: state.smsBowerBaseUrl || DEFAULT_BASE_URL,
      lang: normalizeSmsBowerLang(state.smsBowerLang, deps.lang),
      pricesAction: normalizeSmsBowerPricesAction(state.smsBowerPricesAction, deps.pricesAction),
      fetchImpl: deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  async function fetchPayload(config, query, actionLabel = 'SMSBower request') {
    if (query.api_key === undefined && config.apiKey) {
      query = { api_key: config.apiKey, ...query };
    }
    if (query.lang === undefined && config.lang) {
      query = { ...query, lang: config.lang };
    }
    if (!config.apiKey) {
      throw new Error('SMSBower API Key 缺失，请先在侧边栏保存接码 API Key。');
    }
    if (!config.fetchImpl) {
      throw new Error('SMSBower 网络请求实现不可用。');
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), Number(config.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS)
      : null;
    try {
      const response = await config.fetchImpl(buildUrl(config, query), {
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
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function resolveCountryConfig(state = {}) {
    return {
      id: normalizeSmsBowerCountryId(state.smsBowerCountryId ?? state.heroSmsCountryId),
      label: normalizeSmsBowerCountryLabel(state.smsBowerCountryLabel || state.heroSmsCountryLabel),
    };
  }

  function resolveCountryCandidates(state = {}) {
    const primary = resolveCountryConfig(state);
    const fallbackSource = state.smsBowerCountryFallback !== undefined
      ? state.smsBowerCountryFallback
      : state.heroSmsCountryFallback;
    const seen = new Set([primary.id]);
    const candidates = [primary];
    normalizeSmsBowerCountryFallback(fallbackSource).forEach((entry) => {
      const id = normalizeSmsBowerCountryId(entry.id, 0);
      if (!id || seen.has(id)) return;
      seen.add(id);
      candidates.push({ id, label: normalizeSmsBowerCountryLabel(entry.label, `Country #${id}`) });
    });
    return candidates;
  }

  function getServiceCode(state = {}) {
    return normalizeSmsBowerServiceCode(state.smsBowerServiceCode || DEFAULT_SERVICE_CODE);
  }

  function getPriceBounds(state = {}) {
    return {
      minPrice: normalizeSmsBowerPrice(state.smsBowerMinPrice || state.heroSmsMinPrice),
      maxPrice: normalizeSmsBowerPrice(state.smsBowerMaxPrice || state.heroSmsMaxPrice),
    };
  }

  function normalizeActivation(record, fallback = {}) {
    let activationId = '';
    let phoneNumber = '';
    let activationCost;
    let canGetAnotherSms;

    if (typeof record === 'string') {
      const match = record.trim().match(/^ACCESS_NUMBER:([^:]+):(.+)$/i);
      if (match) {
        activationId = match[1];
        phoneNumber = match[2];
      }
    } else if (record && typeof record === 'object' && !Array.isArray(record)) {
      activationId = String(record.activationId ?? record.id ?? '').trim();
      phoneNumber = String(record.phoneNumber ?? record.phone ?? '').trim();
      activationCost = record.activationCost ?? record.price ?? record.cost;
      if (record.canGetAnotherSms !== undefined && record.canGetAnotherSms !== null) {
        canGetAnotherSms = record.canGetAnotherSms === true
          || record.canGetAnotherSms === 1
          || String(record.canGetAnotherSms).trim().toLowerCase() === 'true';
      }
    }

    if (!activationId || !phoneNumber) return null;
    return {
      activationId,
      phoneNumber,
      provider: PROVIDER_ID,
      serviceCode: normalizeSmsBowerServiceCode(fallback.serviceCode),
      countryId: normalizeSmsBowerCountryId(fallback.countryId ?? fallback.id, DEFAULT_COUNTRY_ID),
      countryLabel: normalizeSmsBowerCountryLabel(fallback.countryLabel || fallback.label, DEFAULT_COUNTRY_LABEL),
      successfulUses: Math.max(0, Math.floor(Number(record?.successfulUses) || 0)),
      maxUses: 1,
      ...(Array.isArray(record?.smsBowerIgnoredCodes) || Array.isArray(fallback?.smsBowerIgnoredCodes)
        ? {
          smsBowerIgnoredCodes: Array.from(new Set(
            (Array.isArray(record?.smsBowerIgnoredCodes) ? record.smsBowerIgnoredCodes : fallback.smsBowerIgnoredCodes)
              .map((entry) => extractVerificationCode(entry))
              .filter(Boolean)
          )),
        }
        : {}),
      ...(activationCost !== undefined ? { price: Number(activationCost) } : {}),
      ...(canGetAnotherSms !== undefined ? { canGetAnotherSms } : {}),
    };
  }

  function isNoNumbersPayload(payloadOrMessage) {
    const text = describePayload(payloadOrMessage);
    return /NO_NUMBERS|NO_BALANCE|NO_BALANCE_FORWARD|no\s+numbers|not\s+found|empty/i.test(text);
  }

  function isTerminalPayload(payloadOrMessage) {
    const text = describePayload(payloadOrMessage);
    return /BAD_KEY|BAD_SERVICE|BAD_ACTION|BAD_COUNTRY|NO_BALANCE|banned|invalid/i.test(text);
  }

  async function requestActivation(state = {}, options = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const serviceCode = getServiceCode(state);
    const priceBounds = getPriceBounds(state);
    const blockedCountryIds = new Set(
      (Array.isArray(options?.blockedCountryIds) ? options.blockedCountryIds : [])
        .map((value) => normalizeSmsBowerCountryId(value, 0))
        .filter((id) => id > 0)
    );
    let countryCandidates = resolveCountryCandidates(state)
      .filter((entry) => !blockedCountryIds.has(normalizeSmsBowerCountryId(entry.id, 0)));
    if (!countryCandidates.length) {
      countryCandidates = resolveCountryCandidates(state);
    }

    const failures = [];
    let lastError = null;
    for (const countryConfig of countryCandidates) {
      for (const action of ['getNumberV2', 'getNumber']) {
        try {
          const payload = await fetchPayload(config, {
            action,
            service: serviceCode,
            country: normalizeSmsBowerCountryId(countryConfig.id),
            minPrice: priceBounds.minPrice,
            maxPrice: priceBounds.maxPrice,
          }, `SMSBower ${action}`);
          const activation = normalizeActivation(payload, {
            serviceCode,
            countryId: countryConfig.id,
            countryLabel: countryConfig.label,
          });
          if (activation) return activation;
          const text = describePayload(payload);
          if (isTerminalPayload(text)) {
            throw new Error(`SMSBower ${action}失败：${text}`);
          }
          failures.push(`${countryConfig.label}: ${text || '空响应'}`);
        } catch (error) {
          const payloadOrMessage = error?.payload || error?.message;
          const text = describePayload(payloadOrMessage);
          if (isTerminalPayload(payloadOrMessage) && !isNoNumbersPayload(payloadOrMessage)) {
            throw new Error(`SMSBower 获取手机号失败：${text || '未知错误'}`);
          }
          lastError = error;
          failures.push(`${countryConfig.label}: ${text || error?.message || '未知错误'}`);
        }
      }
    }

    if (failures.length) {
      throw new Error(`SMSBower 已尝试 ${countryCandidates.length} 个候选国家，均无可用号码：${Array.from(new Set(failures)).join(' | ')}。`);
    }
    throw lastError || new Error('SMSBower 获取手机号失败。');
  }

  async function setActivationStatus(state = {}, activation, status, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) return '';
    const payload = await fetchPayload(resolveConfig(state, deps), {
      action: 'setStatus',
      id: normalizedActivation.activationId,
      status: Math.floor(Number(status) || 0),
    }, `SMSBower setStatus(${status})`);
    return describePayload(payload);
  }

  function resolveIgnoredCodeSet(activation = null) {
    const ignoredCodes = Array.isArray(activation?.smsBowerIgnoredCodes)
      ? activation.smsBowerIgnoredCodes
      : [];
    return new Set(ignoredCodes.map((entry) => extractVerificationCode(entry)).filter(Boolean));
  }

  function extractCodeFromStatusText(statusText = '') {
    const okMatch = String(statusText || '').match(/^STATUS_OK:(.+)$/i);
    return okMatch ? extractVerificationCode(okMatch[1]) : '';
  }

  async function captureExistingCodesForActivation(state = {}, activation, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      return [];
    }
    try {
      const payload = await fetchPayload(resolveConfig(state, deps), {
        action: 'getStatus',
        id: normalizedActivation.activationId,
      }, 'SMSBower capture existing sms');
      const code = extractCodeFromStatusText(describePayload(payload));
      return code ? [code] : [];
    } catch {
      return [];
    }
  }

  async function reuseActivation(state = {}, activation, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      throw new Error('缺少可复用的 SMSBower 手机号订单。');
    }
    const existingCodes = await captureExistingCodesForActivation(state, normalizedActivation, deps);
    await setActivationStatus(state, normalizedActivation, 3, deps);
    return {
      ...normalizedActivation,
      ...(existingCodes.length ? { smsBowerIgnoredCodes: existingCodes } : {}),
    };
  }

  async function finishActivation(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 6, deps);
  }

  async function cancelActivation(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 8, deps);
  }

  async function requestAdditionalSms(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 3, deps);
  }

  function extractVerificationCode(rawCodeOrText) {
    const trimmed = String(rawCodeOrText || '').trim();
    if (!trimmed) return '';
    const digitMatch = trimmed.match(/\b(\d{4,8})\b/);
    return digitMatch?.[1] || '';
  }

  async function pollActivationCode(state = {}, activation, options = {}, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      throw new Error('缺少 SMSBower 手机号接码订单。');
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
    let ignoredHistoricalCodeLogged = false;

    while (Date.now() - start < timeoutMs) {
      if (maxRounds > 0 && pollCount >= maxRounds) break;
      deps.throwIfStopped?.();
      const payload = await fetchPayload(config, {
        action: 'getStatus',
        id: normalizedActivation.activationId,
      }, 'SMSBower getStatus');
      pollCount += 1;
      lastResponse = describePayload(payload);

      if (typeof options.onStatus === 'function') {
        await options.onStatus({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: lastResponse || 'PENDING',
          timeoutMs,
        });
      }

      const code = extractCodeFromStatusText(lastResponse);
      if (code) {
        if (!ignoredCodes.has(code)) {
          return code;
        }
        if (!ignoredHistoricalCodeLogged) {
          ignoredHistoricalCodeLogged = true;
          await deps.addLog?.(
            `步骤 8：SMSBower 复用订单 ${normalizedActivation.phoneNumber} 命中历史验证码，继续等待新短信。`,
            'info'
          );
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

      if (/^STATUS_(WAIT_CODE|WAIT_RETRY|WAIT_RESEND)(?::.+)?$/i.test(lastResponse)) {
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

      if (/^STATUS_CANCEL$/i.test(lastResponse)) {
        throw new Error('SMSBower 订单在短信到达前已被取消。');
      }
      throw new Error(`SMSBower 查询验证码失败：${lastResponse || '空响应'}`);
    }

    const suffix = lastResponse ? ` SMSBower 最后状态：${lastResponse}` : '';
    throw new Error(`PHONE_CODE_TIMEOUT::等待手机验证码超时。${suffix}`);
  }

  async function fetchBalance(state = {}, deps = {}) {
    const payload = await fetchPayload(resolveConfig(state, deps), { action: 'getBalance' }, 'SMSBower getBalance');
    const balance = Number(String(describePayload(payload)).replace(/^ACCESS_BALANCE:/i, '').trim());
    return { balance, raw: payload };
  }

  async function fetchPrices(state = {}, countryConfig = resolveCountryConfig(state), deps = {}) {
    const config = resolveConfig(state, deps);
    return fetchPayload(config, {
      action: normalizeSmsBowerPricesAction(config.pricesAction),
      service: getServiceCode(state),
      country: normalizeSmsBowerCountryId(countryConfig?.id),
    }, `SMSBower ${normalizeSmsBowerPricesAction(config.pricesAction)}`);
  }

  function collectPriceEntries(payload, entries = []) {
    if (Array.isArray(payload)) {
      payload.forEach((entry) => collectPriceEntries(entry, entries));
      return entries;
    }
    if (!payload || typeof payload !== 'object') return entries;

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
      label: 'SMSBower',
      defaultCountryId: DEFAULT_COUNTRY_ID,
      defaultCountryLabel: DEFAULT_COUNTRY_LABEL,
      defaultProduct: DEFAULT_SERVICE_LABEL,
      defaultServiceCode: DEFAULT_SERVICE_CODE,
      normalizeCountryId: normalizeSmsBowerCountryId,
      normalizeCountryLabel: normalizeSmsBowerCountryLabel,
      normalizeCountryFallback: normalizeSmsBowerCountryFallback,
      normalizeMaxPrice: normalizeSmsBowerPrice,
      normalizeServiceCode: normalizeSmsBowerServiceCode,
      resolveCountryCandidates,
      requestActivation: (state, options) => requestActivation(state, options, providerDeps),
      reuseActivation: (state, activation) => reuseActivation(state, activation, providerDeps),
      finishActivation: (state, activation) => finishActivation(state, activation, providerDeps),
      cancelActivation: (state, activation) => cancelActivation(state, activation, providerDeps),
      banActivation: (state, activation) => cancelActivation(state, activation, providerDeps),
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
    DEFAULT_COUNTRY_ID,
    DEFAULT_COUNTRY_LABEL,
    DEFAULT_SERVICE_CODE,
    DEFAULT_SERVICE_LABEL,
    createProvider,
    describePayload,
    normalizeSmsBowerCountryFallback,
    normalizeSmsBowerCountryId,
    normalizeSmsBowerCountryLabel,
    normalizeSmsBowerPrice,
    normalizeSmsBowerServiceCode,
    normalizeSmsBowerLang,
    normalizeSmsBowerPricesAction,
  };
});
