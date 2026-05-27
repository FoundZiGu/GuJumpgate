// phone-sms/providers/hero-sms.js — HeroSMS 接码平台适配层
(function attachHeroSmsProvider(root, factory) {
  root.PhoneSmsHeroSmsProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createHeroSmsProviderModule() {
  const PROVIDER_ID = 'hero-sms';
  const DEFAULT_BASE_URL = 'https://hero-sms.com/stubs/handler_api.php';
  const DEFAULT_SERVICE_CODE = 'dr';
  const DEFAULT_SERVICE_LABEL = 'OpenAI';
  const DEFAULT_COUNTRY_ID = 33;
  const DEFAULT_COUNTRY_LABEL = 'Colombia';
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
  const DEFAULT_PHONE_POLL_TIMEOUT_MS = 180000;
  const DEFAULT_PHONE_POLL_INTERVAL_MS = 5000;
  const DEFAULT_PHONE_NUMBER_MAX_USES = 3;

  function normalizeHeroSmsCountryId(value, fallback = DEFAULT_COUNTRY_ID) {
    const parsed = Math.floor(Number(value));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const fallbackParsed = Math.floor(Number(fallback));
    return Number.isFinite(fallbackParsed) && fallbackParsed > 0 ? fallbackParsed : DEFAULT_COUNTRY_ID;
  }

  function normalizeHeroSmsCountryLabel(value = '', fallback = DEFAULT_COUNTRY_LABEL) {
    return String(value || '').trim() || fallback;
  }

  function normalizeHeroSmsMaxPrice(value = '') {
    const rawValue = String(value ?? '').trim();
    if (!rawValue) return '';
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    return String(Math.round(numeric * 10000) / 10000);
  }

  function normalizeHeroSmsServiceCode(value = '', fallback = DEFAULT_SERVICE_CODE) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
    if (normalized) return normalized;
    const fallbackNormalized = String(fallback || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
    return fallbackNormalized || DEFAULT_SERVICE_CODE;
  }

  function normalizeHeroSmsCountryFallback(value = []) {
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
        id = normalizeHeroSmsCountryId(entry.id ?? entry.countryId, 0);
        label = String((entry.label ?? entry.countryLabel) || '').trim();
      } else {
        const text = String(entry || '').trim();
        const structured = text.match(/^(\d+)\s*(?:[:|/-]\s*(.+))?$/);
        id = normalizeHeroSmsCountryId(structured?.[1] || text, 0);
        label = String(structured?.[2] || '').trim();
      }
      if (!id || seen.has(id)) continue;
      seen.add(id);
      normalized.push({ id, label: label || `Country #${id}` });
      if (normalized.length >= 20) break;
    }
    return normalized;
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

  function extractVerificationCode(rawCodeOrText) {
    const trimmed = String(rawCodeOrText || '').trim();
    if (!trimmed) {
      return '';
    }
    const digitMatch = trimmed.match(/\b(\d{4,8})\b/);
    return digitMatch?.[1] || '';
  }

  function createActionError(actionLabel, payload, status = 0) {
    const text = describePayload(payload) || 'empty response';
    const error = new Error(`${actionLabel}失败：${text}`);
    if (payload !== undefined) {
      error.payload = payload;
    }
    if (status) {
      error.status = status;
    }
    return error;
  }

  function resolveConfig(state = {}, deps = {}) {
    return {
      apiKey: String(state.heroSmsApiKey || '').trim(),
      baseUrl: state.heroSmsBaseUrl || DEFAULT_BASE_URL,
      fetchImpl: deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  async function fetchPayload(config, query, actionLabel = 'HeroSMS request') {
    if (query.api_key === undefined && config.apiKey) {
      query = { api_key: config.apiKey, ...query };
    }
    if (!config.apiKey) {
      throw new Error('HeroSMS API Key 缺失，请先在侧边栏保存接码 API Key。');
    }
    if (!config.fetchImpl) {
      throw new Error('HeroSMS 网络请求实现不可用。');
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
        throw createActionError(actionLabel, payload, response.status);
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
      id: normalizeHeroSmsCountryId(state.heroSmsCountryId),
      label: normalizeHeroSmsCountryLabel(state.heroSmsCountryLabel),
    };
  }

  function resolveCountryCandidates(state = {}) {
    const primary = resolveCountryConfig(state);
    const seen = new Set([primary.id]);
    const candidates = [primary];
    normalizeHeroSmsCountryFallback(state.heroSmsCountryFallback).forEach((entry) => {
      const id = normalizeHeroSmsCountryId(entry.id, 0);
      if (!id || seen.has(id)) return;
      seen.add(id);
      candidates.push({ id, label: normalizeHeroSmsCountryLabel(entry.label, `Country #${id}`) });
    });
    return candidates;
  }

  function normalizeActivation(record, fallback = {}) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return null;
    }
    const activationId = String(record.activationId ?? record.id ?? record.activation ?? '').trim();
    const phoneNumber = String(record.phoneNumber ?? record.number ?? record.phone ?? '').trim();
    if (!activationId || !phoneNumber) {
      return null;
    }
    const statusAction = String(record.statusAction || fallback.statusAction || '').trim();
    const countryId = normalizeHeroSmsCountryId(
      record.countryId ?? record.country ?? fallback.countryId,
      DEFAULT_COUNTRY_ID
    );
    const countryLabel = normalizeHeroSmsCountryLabel(
      record.countryLabel || fallback.countryLabel,
      DEFAULT_COUNTRY_LABEL
    );
    return {
      activationId,
      phoneNumber,
      provider: PROVIDER_ID,
      serviceCode: normalizeHeroSmsServiceCode(record.serviceCode || fallback.serviceCode, DEFAULT_SERVICE_CODE),
      countryId,
      countryLabel,
      successfulUses: Math.max(0, Math.floor(Number(record.successfulUses ?? fallback.successfulUses) || 0)),
      maxUses: Math.max(1, Math.floor(Number(record.maxUses ?? fallback.maxUses) || DEFAULT_PHONE_NUMBER_MAX_USES)),
      ...(statusAction ? { statusAction } : {}),
      ...(record.source ? { source: String(record.source || '').trim() } : {}),
      ...(record.phoneCodeReceived ? { phoneCodeReceived: true } : {}),
      ...(record.phoneCodeReceivedAt ? { phoneCodeReceivedAt: Math.max(0, Number(record.phoneCodeReceivedAt) || 0) } : {}),
      ...(record.canGetAnotherSms !== undefined ? { canGetAnotherSms: Boolean(record.canGetAnotherSms) } : {}),
    };
  }

  function parseActivationPayload(payload, fallback = null) {
    const normalizedFallback = normalizeActivation(fallback, fallback) || null;
    const directActivation = normalizeActivation(payload, normalizedFallback || fallback || {});
    if (directActivation) {
      return {
        ...directActivation,
        ...(normalizedFallback?.statusAction || directActivation.statusAction
          ? { statusAction: normalizedFallback?.statusAction || directActivation.statusAction }
          : {}),
      };
    }

    const text = describePayload(payload);
    const accessNumberMatch = text.match(/^ACCESS_NUMBER:([^:]+):(.+)$/i);
    if (accessNumberMatch) {
      return {
        activationId: String(accessNumberMatch[1] || '').trim(),
        phoneNumber: String(accessNumberMatch[2] || '').trim(),
        provider: PROVIDER_ID,
        serviceCode: normalizeHeroSmsServiceCode(normalizedFallback?.serviceCode, DEFAULT_SERVICE_CODE),
        countryId: normalizeHeroSmsCountryId(normalizedFallback?.countryId, DEFAULT_COUNTRY_ID),
        countryLabel: normalizeHeroSmsCountryLabel(normalizedFallback?.countryLabel, DEFAULT_COUNTRY_LABEL),
        successfulUses: normalizedFallback?.successfulUses ?? 0,
        maxUses: normalizedFallback?.maxUses ?? DEFAULT_PHONE_NUMBER_MAX_USES,
        ...(normalizedFallback?.statusAction ? { statusAction: normalizedFallback.statusAction } : {}),
      };
    }

    if (/^ACCESS_READY$/i.test(text) && normalizedFallback) {
      return normalizedFallback;
    }

    return null;
  }

  function resolveActivationStatusAction(activation) {
    return activation?.statusAction === 'getStatusV2' ? 'getStatusV2' : 'getStatus';
  }

  function isCancelledStatusText(text) {
    return /^STATUS_CANCEL$/i.test(String(text || '').trim());
  }

  async function fetchBalance(state = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const payload = await fetchPayload(config, { action: 'getBalance' }, 'HeroSMS getBalance');
    const balance = Number(String(describePayload(payload)).replace(/^ACCESS_BALANCE:/i, '').trim());
    return { balance, raw: payload };
  }

  async function fetchPrices(state = {}, countryConfig = resolveCountryConfig(state), deps = {}) {
    const config = resolveConfig(state, deps);
    return fetchPayload(config, {
      action: 'getPrices',
      service: DEFAULT_SERVICE_CODE,
      country: normalizeHeroSmsCountryId(countryConfig?.id),
    }, 'HeroSMS getPrices');
  }

  async function setActivationStatus(state = {}, activation, status, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      return '';
    }
    const config = resolveConfig(state, deps);
    const payload = await fetchPayload(config, {
      action: 'setStatus',
      id: normalizedActivation.activationId,
      status: Math.floor(Number(status) || 0),
    }, `HeroSMS setStatus(${Math.floor(Number(status) || 0)})`);
    return describePayload(payload);
  }

  async function reuseActivation(state = {}, activation, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      throw new Error('缺少可复用的 HeroSMS 手机号订单。');
    }
    const config = resolveConfig(state, deps);
    const payload = await fetchPayload(config, {
      action: 'reactivate',
      id: normalizedActivation.activationId,
    }, 'HeroSMS reactivate');
    const nextActivation = parseActivationPayload(payload, normalizedActivation);
    if (!nextActivation) {
      throw new Error(`HeroSMS 复用手机号失败：${describePayload(payload) || '空响应'}`);
    }
    return nextActivation;
  }

  async function finishActivation(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 6, deps);
  }

  async function cancelActivation(state = {}, activation, deps = {}) {
    return setActivationStatus(state, activation, 8, deps);
  }

  async function banActivation(state = {}, activation, deps = {}) {
    return cancelActivation(state, activation, deps);
  }

  async function requestAdditionalSms(state = {}, activation, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      return {
        message: '',
        activation: null,
      };
    }
    const message = await setActivationStatus(state, normalizedActivation, 3, deps);
    return {
      message,
      activation: normalizedActivation,
    };
  }

  async function pollActivationCode(state = {}, activation, options = {}, deps = {}) {
    const normalizedActivation = normalizeActivation(activation, activation);
    if (!normalizedActivation) {
      throw new Error('缺少 HeroSMS 手机号接码订单。');
    }
    const config = resolveConfig(state, deps);
    const statusAction = resolveActivationStatusAction(normalizedActivation);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_PHONE_POLL_TIMEOUT_MS);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || DEFAULT_PHONE_POLL_INTERVAL_MS);
    const maxRoundsRaw = Math.floor(Number(options.maxRounds));
    const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? maxRoundsRaw : 0;
    const start = Date.now();
    let lastResponse = '';
    let pollCount = 0;

    const emitWaitingForCode = async (statusText) => {
      if (typeof options.onWaitingForCode === 'function') {
        await options.onWaitingForCode({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText,
          timeoutMs,
        });
      }
    };

    while (Date.now() - start < timeoutMs) {
      if (maxRounds > 0 && pollCount >= maxRounds) {
        break;
      }
      deps.throwIfStopped?.();
      const payload = await fetchPayload(config, {
        action: statusAction,
        id: normalizedActivation.activationId,
      }, `HeroSMS ${statusAction}`);
      const text = describePayload(payload);
      lastResponse = text;
      pollCount += 1;

      if (typeof options.onStatus === 'function') {
        await options.onStatus({
          activation: normalizedActivation,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: text,
          timeoutMs,
        });
      }

      const v2Code = (
        payload
        && typeof payload === 'object'
        && !Array.isArray(payload)
        && (
          extractVerificationCode(payload.sms?.code)
          || extractVerificationCode(payload.call?.code)
        )
      );
      if (v2Code) {
        return v2Code;
      }

      const okMatch = text.match(/^STATUS_OK:(.+)$/i);
      if (okMatch) {
        const extractedCode = extractVerificationCode(okMatch[1] || '');
        if (extractedCode) {
          return extractedCode;
        }
        await emitWaitingForCode(text || 'STATUS_OK');
        await deps.sleepWithStop?.(intervalMs);
        continue;
      }

      if (/^STATUS_(WAIT_CODE|WAIT_RETRY|WAIT_RESEND)(?::.+)?$/i.test(text)) {
        await emitWaitingForCode(text);
        await deps.sleepWithStop?.(intervalMs);
        continue;
      }

      if (statusAction === 'getStatusV2' && payload && typeof payload === 'object' && !Array.isArray(payload)) {
        await emitWaitingForCode(text || 'PENDING');
        await deps.sleepWithStop?.(intervalMs);
        continue;
      }

      if (isCancelledStatusText(text)) {
        throw new Error('HeroSMS 订单在短信到达前已被取消。');
      }

      throw createActionError(`HeroSMS ${statusAction}`, payload);
    }

    throw new Error(`等待 HeroSMS 验证码超时。最后状态：${lastResponse || '未知'}。`);
  }

  function createProvider(deps = {}) {
    const providerDeps = {
      fetchImpl: deps.fetchImpl,
      requestTimeoutMs: deps.requestTimeoutMs,
      sleepWithStop: deps.sleepWithStop,
      throwIfStopped: deps.throwIfStopped,
    };
    return {
      id: PROVIDER_ID,
      label: 'HeroSMS',
      defaultCountryId: DEFAULT_COUNTRY_ID,
      defaultCountryLabel: DEFAULT_COUNTRY_LABEL,
      defaultProduct: DEFAULT_SERVICE_LABEL,
      defaultServiceCode: DEFAULT_SERVICE_CODE,
      normalizeCountryId: normalizeHeroSmsCountryId,
      normalizeCountryLabel: normalizeHeroSmsCountryLabel,
      normalizeCountryFallback: normalizeHeroSmsCountryFallback,
      normalizeMaxPrice: normalizeHeroSmsMaxPrice,
      normalizeServiceCode: normalizeHeroSmsServiceCode,
      normalizeActivation,
      resolveCountryCandidates,
      reuseActivation: (state, activation) => reuseActivation(state, activation, providerDeps),
      finishActivation: (state, activation) => finishActivation(state, activation, providerDeps),
      cancelActivation: (state, activation) => cancelActivation(state, activation, providerDeps),
      banActivation: (state, activation) => banActivation(state, activation, providerDeps),
      requestAdditionalSms: (state, activation) => requestAdditionalSms(state, activation, providerDeps),
      pollActivationCode: (state, activation, options) => pollActivationCode(state, activation, options, providerDeps),
      fetchBalance: (state) => fetchBalance(state, providerDeps),
      fetchPrices: (state, countryConfig) => fetchPrices(state, countryConfig, providerDeps),
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
    normalizeActivation,
    normalizeHeroSmsCountryFallback,
    normalizeHeroSmsCountryId,
    normalizeHeroSmsCountryLabel,
    normalizeHeroSmsMaxPrice,
    normalizeHeroSmsServiceCode,
  };
});
