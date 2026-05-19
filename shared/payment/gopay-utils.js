(function attachGoPayUtils(root, factory) {
  root.GoPayUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createGoPayUtils() {
  const PLUS_PAYMENT_METHOD_PAYPAL = 'paypal';
  const PLUS_PAYMENT_METHOD_GOPAY = 'gopay';
  const PLUS_PAYMENT_METHOD_GPC_HELPER = 'gpc-helper';
  const DEFAULT_GPC_HELPER_API_URL = 'https://your-gpc-helper-domain.example';
  const GPC_HELPER_PHONE_MODE_AUTO = 'auto';
  const GPC_HELPER_PHONE_MODE_MANUAL = 'manual';

  function normalizePlusPaymentMethod(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === PLUS_PAYMENT_METHOD_GPC_HELPER) {
      return PLUS_PAYMENT_METHOD_GPC_HELPER;
    }
    return normalized === PLUS_PAYMENT_METHOD_GOPAY ? PLUS_PAYMENT_METHOD_GOPAY : PLUS_PAYMENT_METHOD_PAYPAL;
  }

  const DEFAULT_GOPAY_COUNTRY_CODE = '+86';

  function normalizeGoPayCountryCode(value = '') {
    const normalized = String(value || '').trim().replace(/[^\d+]/g, '');
    const digits = normalized.replace(/\D/g, '');
    return digits ? `+${digits}` : DEFAULT_GOPAY_COUNTRY_CODE;
  }

  function normalizeGoPayPhone(value = '') {
    return String(value || '').trim().replace(/[^\d+]/g, '');
  }

  function normalizeGoPayPhoneForCountry(value = '', countryCode = DEFAULT_GOPAY_COUNTRY_CODE) {
    const normalizedPhone = normalizeGoPayPhone(value);
    const normalizedCountryCode = normalizeGoPayCountryCode(countryCode);
    const countryDigits = normalizedCountryCode.replace(/\D/g, '');
    let nationalNumber = normalizedPhone.replace(/\D/g, '');

    if (countryDigits && nationalNumber.startsWith(countryDigits)) {
      nationalNumber = nationalNumber.slice(countryDigits.length);
    }
    return nationalNumber;
  }

  function normalizeGoPayPin(value = '') {
    return String(value || '').trim().replace(/[^\d]/g, '');
  }

  function normalizeGoPayOtp(value = '') {
    return String(value || '').trim().replace(/[^\d]/g, '');
  }

  function normalizeGpcHelperPhoneMode(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === GPC_HELPER_PHONE_MODE_AUTO || normalized === 'builtin'
      ? GPC_HELPER_PHONE_MODE_AUTO
      : GPC_HELPER_PHONE_MODE_MANUAL;
  }

  function normalizeGpcRemainingUses(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
  }

  function unwrapGpcBalancePayload(payload = {}) {
    const data = unwrapGpcResponse(payload);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return data;
    }
    const hasBalanceFields = [
      'remaining_uses',
      'remainingUses',
      'balance',
      'remaining',
      'uses',
      'available_uses',
      'availableUses',
      'auto_mode_enabled',
      'autoModeEnabled',
      'auto_enabled',
      'autoEnabled',
      'status',
      'card_status',
      'cardStatus',
    ].some((key) => Object.prototype.hasOwnProperty.call(data, key));
    if (!hasBalanceFields && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
      return data.data;
    }
    return data;
  }

  function getGpcBalanceRemainingUses(payload = {}) {
    const data = unwrapGpcBalancePayload(payload);
    if (!data || typeof data !== 'object') {
      return null;
    }
    return normalizeGpcRemainingUses(
      data.remaining_uses
      ?? data.remainingUses
      ?? data.balance
      ?? data.remaining
      ?? data.uses
      ?? data.available_uses
      ?? data.availableUses
    );
  }

  function isGpcAutoModeEnabled(payload = {}) {
    const data = unwrapGpcBalancePayload(payload);
    if (!data || typeof data !== 'object') {
      return false;
    }
    const raw = data.auto_mode_enabled ?? data.autoModeEnabled ?? data.auto_enabled ?? data.autoEnabled;
    if (typeof raw === 'boolean') {
      return raw;
    }
    const normalized = String(raw ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'enabled';
  }

  function getGpcApiKeyStatus(payload = {}) {
    const data = unwrapGpcBalancePayload(payload);
    if (!data || typeof data !== 'object') {
      return '';
    }
    return String(data.status || data.card_status || data.cardStatus || '').trim();
  }

  function normalizeGpcOtpChannel(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'sms') {
      return 'sms';
    }
    return 'whatsapp';
  }

  function normalizeGpcHelperBaseUrl(apiUrl = '') {
    let normalized = String(apiUrl || DEFAULT_GPC_HELPER_API_URL).trim();
    if (!normalized) {
      return DEFAULT_GPC_HELPER_API_URL;
    }
    normalized = normalized.replace(/\/+$/g, '');
    normalized = normalized.replace(/\/api\/checkout\/start$/i, '');
    normalized = normalized.replace(/\/api\/gopay\/(?:otp|pin)$/i, '');
    normalized = normalized.replace(/\/api\/gp\/tasks(?:\/[^/?#]+)?(?:\/(?:otp|pin|stop))?(?:\?.*)?$/i, '');
    normalized = normalized.replace(/\/api\/gp\/balance(?:\?.*)?$/i, '');
    normalized = normalized.replace(/\/api\/card\/balance(?:\?.*)?$/i, '');
    normalized = normalized.replace(/\/api\/card\/redeem-api-key(?:\?.*)?$/i, '');

    try {
      const parsed = new URL(normalized);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return DEFAULT_GPC_HELPER_API_URL;
      }
      return normalized || DEFAULT_GPC_HELPER_API_URL;
    } catch {
      return DEFAULT_GPC_HELPER_API_URL;
    }
  }

  function buildGpcHelperApiUrl(apiUrl = '', path = '') {
    const baseUrl = normalizeGpcHelperBaseUrl(apiUrl);
    if (!baseUrl) {
      return '';
    }
    const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
    return `${baseUrl}${normalizedPath}`;
  }

  function buildGpcApiKeyBalanceUrl(apiUrl = '') {
    return buildGpcHelperApiUrl(apiUrl, '/api/gp/balance');
  }

  function buildGpcCardBalanceUrl(apiUrl = '') {
    return buildGpcApiKeyBalanceUrl(apiUrl);
  }

  function buildGpcApiKeyHeaders(apiKey = '', extraHeaders = {}) {
    const headers = {
      ...(extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : {}),
    };
    const normalizedApiKey = String(apiKey || '').trim();
    if (normalizedApiKey) {
      headers['X-API-Key'] = normalizedApiKey;
    }
    return headers;
  }

  function buildGpcTaskCreateUrl(apiUrl = '') {
    return buildGpcHelperApiUrl(apiUrl, '/api/gp/tasks');
  }

  function normalizeGpcTaskId(value = '') {
    return String(value || '').trim();
  }

  function buildGpcTaskQueryUrl(apiUrl = '', taskId = '') {
    const normalizedTaskId = normalizeGpcTaskId(taskId);
    return buildGpcHelperApiUrl(apiUrl, `/api/gp/tasks/${encodeURIComponent(normalizedTaskId)}`);
  }

  function buildGpcTaskActionUrl(apiUrl = '', taskId = '', action = '') {
    const normalizedTaskId = normalizeGpcTaskId(taskId);
    const normalizedAction = String(action || '').trim().replace(/^\/+|\/+$/g, '');
    return buildGpcHelperApiUrl(apiUrl, `/api/gp/tasks/${encodeURIComponent(normalizedTaskId)}/${normalizedAction}`);
  }

  function unwrapGpcResponse(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload;
    }
    const hasUnifiedShape = Object.prototype.hasOwnProperty.call(payload, 'data')
      && (
        Object.prototype.hasOwnProperty.call(payload, 'code')
        || Object.prototype.hasOwnProperty.call(payload, 'message')
      );
    return hasUnifiedShape ? (payload.data ?? {}) : payload;
  }

  function isGpcUnifiedResponseOk(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return true;
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'code')) {
      return payload.ok !== false;
    }
    const code = Number(payload.code);
    if (Number.isFinite(code)) {
      return code >= 200 && code < 300;
    }
    return String(payload.code || '').trim() === '200';
  }

  function formatGpcErrorField(field) {
    if (field === undefined || field === null) {
      return '';
    }
    if (typeof field === 'string') {
      return field.trim();
    }
    if (typeof field !== 'object') {
      return String(field).trim();
    }
    const key = Array.isArray(field.loc)
      ? field.loc.join('.')
      : String(field.field || field.path || field.name || field.param || '').trim();
    const message = String(field.msg || field.message || field.error || field.detail || field.reason || '').trim();
    return [key, message].filter(Boolean).join(': ') || JSON.stringify(field);
  }

  function extractGpcResponseErrorDetail(payload = {}, status = 0) {
    if (!payload || typeof payload !== 'object') {
      return status ? `HTTP ${status}` : '未知错误';
    }

    const payloadText = JSON.stringify(payload).toLowerCase();
    if (/account\s+already\s+linked/i.test(payloadText)) {
      return 'GOPAY已经绑了订阅，需要手动解绑';
    }

    const data = payload.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const nestedDetail = data.detail ?? data.error ?? data.reason;
      if (nestedDetail !== undefined && nestedDetail !== null && String(nestedDetail).trim()) {
        const nestedText = String(nestedDetail).trim();
        return /account\s+already\s+linked/i.test(nestedText)
          ? 'GOPAY已经绑了订阅，需要手动解绑'
          : nestedText;
      }
      const fields = data.fields ?? data.errors;
      if (Array.isArray(fields) && fields.length > 0) {
        const formatted = fields
          .map(formatGpcErrorField)
          .filter(Boolean)
          .join('; ');
        if (formatted) {
          return formatted;
        }
      }
    }

    const direct = payload.detail
      ?? payload.message
      ?? payload.error
      ?? payload.error_description
      ?? payload.reason;
    if (direct !== undefined && direct !== null && String(direct).trim()) {
      const directText = String(direct).trim();
      return /account\s+already\s+linked/i.test(directText)
        ? 'GOPAY已经绑了订阅，需要手动解绑'
        : directText;
    }

    const errorMessages = payload.error_messages ?? payload.errorMessages;
    if (Array.isArray(errorMessages) && errorMessages.length > 0) {
      const firstMessage = String(errorMessages[0] || '').trim();
      if (/account\s+already\s+linked/i.test(firstMessage)) {
        return 'GOPAY已经绑了订阅，需要手动解绑';
      }
      if (firstMessage) {
        return firstMessage;
      }
    }

    const errors = payload.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      if (typeof first === 'string') {
        return first.trim() || (status ? `HTTP ${status}` : '未知错误');
      }
      if (first && typeof first === 'object') {
        const field = Array.isArray(first.loc) ? first.loc.join('.') : String(first.field || first.path || '').trim();
        const message = String(first.msg || first.message || first.error || '').trim();
        return [field, message].filter(Boolean).join(': ') || JSON.stringify(first);
      }
    }

    return status ? `HTTP ${status}` : '未知错误';
  }

  function buildGpcOtpPayload(input = {}) {
    const payload = {
      reference_id: String(input.reference_id ?? input.referenceId ?? '').trim(),
      otp: normalizeGoPayOtp(input.otp ?? input.code ?? ''),
    };
    const flowId = String(input.flow_id ?? input.flowId ?? '').trim();
    const gopayGuid = String(input.gopay_guid ?? input.gopayGuid ?? '').trim();
    const redirectUrl = String(input.redirect_url ?? input.redirectUrl ?? '').trim();
    if (flowId) payload.flow_id = flowId;
    if (gopayGuid) payload.gopay_guid = gopayGuid;
    if (redirectUrl) payload.redirect_url = redirectUrl;
    return payload;
  }

  function buildGpcOtpRetryPayload(input = {}) {
    const payload = buildGpcOtpPayload(input);
    return { ...payload, code: payload.otp };
  }

  function buildGpcPinPayload(input = {}) {
    const payload = {
      reference_id: String(input.reference_id ?? input.referenceId ?? '').trim(),
      challenge_id: String(input.challenge_id ?? input.challengeId ?? '').trim(),
      gopay_guid: String(input.gopay_guid ?? input.gopayGuid ?? '').trim(),
      pin: normalizeGoPayPin(input.pin ?? ''),
    };
    const flowId = String(input.flow_id ?? input.flowId ?? '').trim();
    const redirectUrl = String(input.redirect_url ?? input.redirectUrl ?? '').trim();
    if (flowId) payload.flow_id = flowId;
    if (redirectUrl) payload.redirect_url = redirectUrl;
    return payload;
  }

  function buildGpcPinRetryPayload(input = {}) {
    const payload = buildGpcPinPayload(input);
    return { ...payload, challengeId: payload.challenge_id };
  }

  function buildGpcTaskOtpPayload(input = {}) {
    return {
      otp: normalizeGoPayOtp(input.otp ?? input.code ?? ''),
    };
  }

  function buildGpcTaskPinPayload(input = {}) {
    return {
      pin: normalizeGoPayPin(input.pin ?? ''),
    };
  }

  function formatGpcBalancePayload(payload = {}) {
    const data = unwrapGpcBalancePayload(payload);
    if (!data || typeof data !== 'object') {
      return '';
    }
    const candidates = [
      data.remaining_uses,
      data.remainingUses,
      data.balance,
      data.remaining,
      data.uses,
      data.available_uses,
      data.availableUses,
    ];
    const firstValue = candidates.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
    const totalUses = data.total_uses ?? data.totalUses;
    const usedUses = data.used_uses ?? data.usedUses;
    const status = String(data.status || data.card_status || data.cardStatus || '').trim();
    const flowId = String(data.flow_id || data.flowId || '').trim();
    const parts = [];
    if (firstValue !== undefined) {
      parts.push(totalUses !== undefined && totalUses !== null && String(totalUses).trim() !== ''
        ? `余额 ${firstValue}/${totalUses}`
        : `余额 ${firstValue}`);
    }
    if (usedUses !== undefined && usedUses !== null && String(usedUses).trim() !== '') {
      parts.push(`已用 ${usedUses}`);
    }
    if (status) {
      parts.push(`状态 ${status}`);
    }
    if (flowId) {
      parts.push(`flow_id ${flowId}`);
    }
    return parts.join('，');
  }

  return {
    DEFAULT_GOPAY_COUNTRY_CODE,
    DEFAULT_GPC_HELPER_API_URL,
    GPC_HELPER_PHONE_MODE_AUTO,
    GPC_HELPER_PHONE_MODE_MANUAL,
    PLUS_PAYMENT_METHOD_GPC_HELPER,
    PLUS_PAYMENT_METHOD_GOPAY,
    PLUS_PAYMENT_METHOD_PAYPAL,
    buildGpcCardBalanceUrl,
    buildGpcApiKeyBalanceUrl,
    buildGpcApiKeyHeaders,
    buildGpcHelperApiUrl,
    buildGpcOtpPayload,
    buildGpcOtpRetryPayload,
    buildGpcPinPayload,
    buildGpcPinRetryPayload,
    buildGpcTaskActionUrl,
    buildGpcTaskCreateUrl,
    buildGpcTaskOtpPayload,
    buildGpcTaskPinPayload,
    buildGpcTaskQueryUrl,
    extractGpcResponseErrorDetail,
    formatGpcBalancePayload,
    getGpcApiKeyStatus,
    getGpcBalanceRemainingUses,
    isGpcUnifiedResponseOk,
    isGpcAutoModeEnabled,
    normalizeGpcHelperBaseUrl,
    normalizeGpcHelperPhoneMode,
    normalizeGpcRemainingUses,
    normalizeGpcTaskId,
    normalizeGoPayCountryCode,
    normalizeGoPayPhone,
    normalizeGoPayPhoneForCountry,
    normalizeGoPayOtp,
    normalizeGoPayPin,
    normalizeGpcOtpChannel,
    normalizePlusPaymentMethod,
    unwrapGpcBalancePayload,
    unwrapGpcResponse,
  };
});
