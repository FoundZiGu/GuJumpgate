// content/sub2api-panel.js — 页内脚本：SUB2API 后台（OAuth 生成与回调提交）

console.log('[MultiPage:sub2api-panel] Content script loaded on', location.href);

const SUB2API_PANEL_LISTENER_SENTINEL = 'data-multipage-sub2api-panel-listener';
const SUB2API_DEFAULT_GROUP_NAME = 'codex';
const SUB2API_DEFAULT_PROXY_NAME = '';
const SUB2API_DEFAULT_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SUB2API_DEFAULT_CONCURRENCY = 10;
const SUB2API_DEFAULT_PRIORITY = 1;
const SUB2API_DEFAULT_RATE_MULTIPLIER = 1;

if (document.documentElement.getAttribute(SUB2API_PANEL_LISTENER_SENTINEL) !== '1') {
  document.documentElement.setAttribute(SUB2API_PANEL_LISTENER_SENTINEL, '1');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXECUTE_NODE' || message.type === 'REQUEST_OAUTH_URL') {
      resetStopState();
      const handler = message.type === 'REQUEST_OAUTH_URL'
        ? requestOAuthUrl(message.payload)
        : handleNode(message.nodeId || message.payload?.nodeId, message.payload);
      handler.then((result) => {
        sendResponse({ ok: true, ...(result || {}) });
      }).catch((err) => {
        if (isStopError(err)) {
          if (message.payload?.visibleStep || message.step) {
            log('Đã bị người dùng dừng.', 'warn', { step: message.payload?.visibleStep || message.step });
          }
          sendResponse({ stopped: true, error: err.message });
          return;
        }
        if (message.nodeId || message.payload?.nodeId) {
          reportError(message.nodeId || message.payload?.nodeId, err.message);
        }
        sendResponse({ error: err.message });
      });
      return true;
    }
  });
} else {
  console.log('[MultiPage:sub2api-panel] Trình nghe tin nhắn đã tồn tại, bỏ qua đăng ký lặp lại');
}

function getSub2ApiOrigin(payload = {}) {
  const rawUrl = payload.sub2apiUrl || location.href;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return location.origin;
  }
}

function normalizeRedirectUri() {
  const input = SUB2API_DEFAULT_REDIRECT_URI;
  const withProtocol = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  const parsed = new URL(withProtocol);
  if (!parsed.pathname || parsed.pathname === '/') {
    parsed.pathname = '/auth/callback';
  }
  if (parsed.pathname !== '/auth/callback') {
    throw new Error('Địa chỉ callback SUB2API phải là /auth/callback, ví dụ: http://localhost:1455/auth/callback');
  }
  return parsed.toString();
}

async function handleStep(step, payload = {}) {
  switch (step) {
    case 1:
      return step1_generateOpenAiAuthUrl(payload);
    case 10:
    case 12:
    case 13:
      return step9_submitOpenAiCallback({ ...(payload || {}), visibleStep: step });
    default:
      throw new Error(`sub2api-panel.js không xử lý bước ${step}`);
  }
}

async function handleNode(nodeId, payload = {}) {
  const normalizedNodeId = String(nodeId || '').trim();
  switch (normalizedNodeId) {
    case 'platform-verify':
      return step9_submitOpenAiCallback(payload);
    default:
      throw new Error(`sub2api-panel.js không xử lý node ${normalizedNodeId}`);
  }
}

async function requestOAuthUrl(payload = {}) {
  return step1_generateOpenAiAuthUrl(payload, { report: false });
}

async function requestJson(origin, path, options = {}) {
  throwIfStopped();
  const {
    method = 'GET',
    token = '',
    body = undefined,
  } = options;

  const response = await fetch(`${origin}${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (json && typeof json === 'object' && 'code' in json) {
    if (json.code === 0) {
      return json.data;
    }
    throw new Error(json.message || json.detail || `Yêu cầu thất bại (${path})`);
  }

  if (!response.ok) {
    throw new Error((json && (json.message || json.detail)) || `Yêu cầu thất bại (HTTP ${response.status}): ${path}`);
  }

  return json;
}

function storeAuthSession(loginData) {
  if (!loginData?.access_token) {
    throw new Error('Đăng nhập SUB2API không trả về access_token.');
  }

  localStorage.setItem('auth_token', loginData.access_token);
  if (loginData.refresh_token) {
    localStorage.setItem('refresh_token', loginData.refresh_token);
  } else {
    localStorage.removeItem('refresh_token');
  }
  if (loginData.expires_in) {
    localStorage.setItem('token_expires_at', String(Date.now() + Number(loginData.expires_in) * 1000));
  }
  if (loginData.user) {
    localStorage.setItem('auth_user', JSON.stringify(loginData.user));
  }
  sessionStorage.removeItem('auth_expired');
}

async function loginSub2Api(payload = {}) {
  const email = (payload.sub2apiEmail || '').trim();
  const password = payload.sub2apiPassword || '';
  const origin = getSub2ApiOrigin(payload);

  if (!email) {
    throw new Error('Thiếu email đăng nhập SUB2API, vui lòng điền trước trong thanh bên.');
  }
  if (!password) {
    throw new Error('Thiếu mật khẩu đăng nhập SUB2API, vui lòng điền trước trong thanh bên.');
  }

  log('Đang đăng nhập vào bảng quản trị SUB2API...');
  const loginData = await requestJson(origin, '/api/v1/auth/login', {
    method: 'POST',
    body: {
      email,
      password,
    },
  });
  storeAuthSession(loginData);

  return {
    origin,
    token: loginData.access_token,
    user: loginData.user || null,
  };
}

async function getGroupByName(origin, token, groupName) {
  const targetName = (groupName || SUB2API_DEFAULT_GROUP_NAME).trim() || SUB2API_DEFAULT_GROUP_NAME;
  const groups = await requestJson(origin, '/api/v1/admin/groups/all', {
    method: 'GET',
    token,
  });

  const normalized = targetName.toLowerCase();
  const group = (groups || []).find((item) => {
    const itemName = String(item?.name || '').trim().toLowerCase();
    if (!itemName) return false;
    if (itemName !== normalized) return false;
    return !item.platform || item.platform === 'openai';
  });

  if (!group) {
    throw new Error(`Không tìm thấy nhóm openai tên “${targetName}” trong SUB2API.`);
  }

  return group;
}

function normalizeSub2ApiGroupNames(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/[\r\n,，;；]+/);
  const seen = new Set();
  const names = [];
  for (const item of source) {
    const name = String(item || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names.length ? names : [SUB2API_DEFAULT_GROUP_NAME];
}

async function getGroupsByNames(origin, token, groupNames) {
  const targetNames = normalizeSub2ApiGroupNames(groupNames);
  const groups = await requestJson(origin, '/api/v1/admin/groups/all', {
    method: 'GET',
    token,
  });
  const matched = [];
  const missing = [];

  for (const targetName of targetNames) {
    const normalized = targetName.toLowerCase();
    const group = (groups || []).find((item) => {
      const itemName = String(item?.name || '').trim().toLowerCase();
      if (!itemName) return false;
      if (itemName !== normalized) return false;
      return !item.platform || item.platform === 'openai';
    });
    if (group) {
      matched.push(group);
    } else {
      missing.push(targetName);
    }
  }

  if (missing.length) {
    throw new Error(`Không tìm thấy các nhóm openai sau trong SUB2API: ${missing.join(', ')}.`);
  }

  return matched;
}

function normalizeSub2ApiProxyPreference(value) {
  return String(value || '').trim();
}

function resolveSub2ApiProxyPreference(payload = {}, backgroundState = {}) {
  if (payload.sub2apiDefaultProxyName !== undefined) {
    return normalizeSub2ApiProxyPreference(payload.sub2apiDefaultProxyName);
  }
  if (backgroundState.sub2apiDefaultProxyName !== undefined) {
    return normalizeSub2ApiProxyPreference(backgroundState.sub2apiDefaultProxyName);
  }
  return SUB2API_DEFAULT_PROXY_NAME;
}

function resolveSub2ApiAccountPriority(payload = {}, backgroundState = {}) {
  const candidate = payload.sub2apiAccountPriority !== undefined
    ? payload.sub2apiAccountPriority
    : backgroundState.sub2apiAccountPriority;
  const rawValue = String(candidate ?? '').trim();
  if (!rawValue) {
    return SUB2API_DEFAULT_PRIORITY;
  }
  const numeric = Number(rawValue);
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    throw new Error('Độ ưu tiên tài khoản SUB2API phải là số nguyên lớn hơn hoặc bằng 1.');
  }
  return numeric;
}

function normalizeProxyId(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function buildProxyDisplayName(proxy = {}) {
  const id = normalizeProxyId(proxy.id);
  const name = String(proxy.name || '').trim();
  const protocol = String(proxy.protocol || '').trim();
  const host = String(proxy.host || '').trim();
  const port = proxy.port === undefined || proxy.port === null ? '' : String(proxy.port).trim();
  const address = protocol && host && port ? `${protocol}://${host}:${port}` : '';
  const parts = [
    name || '(未命名代理)',
    id ? `#${id}` : '',
    address,
  ].filter(Boolean);
  return parts.join(' ');
}

function buildProxySearchText(proxy = {}) {
  return [
    proxy.id,
    proxy.name,
    proxy.protocol,
    proxy.host,
    proxy.port,
    buildProxyDisplayName(proxy),
  ]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function isActiveProxy(proxy = {}) {
  const status = String(proxy.status || '').trim().toLowerCase();
  return !status || status === 'active';
}

function findSub2ApiProxy(proxies = [], preference = '') {
  const activeProxies = (Array.isArray(proxies) ? proxies : [])
    .filter(isActiveProxy)
    .filter((proxy) => normalizeProxyId(proxy.id));
  const normalizedPreference = normalizeSub2ApiProxyPreference(preference).toLowerCase();
  const preferredId = normalizeProxyId(normalizedPreference);

  if (preferredId) {
    const matchedById = activeProxies.find((proxy) => normalizeProxyId(proxy.id) === preferredId);
    return {
      proxy: matchedById || null,
      reason: matchedById ? 'id' : 'missing-id',
      candidates: activeProxies,
    };
  }

  if (normalizedPreference) {
    const exactMatches = activeProxies.filter((proxy) => {
      const name = String(proxy.name || '').trim().toLowerCase();
      return name === normalizedPreference;
    });
    if (exactMatches.length === 1) {
      return { proxy: exactMatches[0], reason: 'name', candidates: activeProxies };
    }
    if (exactMatches.length > 1) {
      return { proxy: null, reason: 'ambiguous-name', candidates: exactMatches };
    }

    const fuzzyMatches = activeProxies.filter((proxy) => buildProxySearchText(proxy).includes(normalizedPreference));
    if (fuzzyMatches.length === 1) {
      return { proxy: fuzzyMatches[0], reason: 'fuzzy', candidates: activeProxies };
    }
    if (fuzzyMatches.length > 1) {
      return { proxy: null, reason: 'ambiguous-fuzzy', candidates: fuzzyMatches };
    }

    return { proxy: null, reason: 'missing-name', candidates: activeProxies };
  }

  if (activeProxies.length === 1) {
    return { proxy: activeProxies[0], reason: 'single-active', candidates: activeProxies };
  }
  return {
    proxy: null,
    reason: activeProxies.length ? 'no-preference' : 'none-active',
    candidates: activeProxies,
  };
}

async function resolveSub2ApiProxy(origin, token, preference = '') {
  const proxies = await requestJson(origin, '/api/v1/admin/proxies/all?with_count=true', {
    method: 'GET',
    token,
  });
  if (!Array.isArray(proxies)) {
    throw new Error('Danh sách proxy SUB2API trả về định dạng bất thường, không thể tự chọn proxy.');
  }

  const { proxy, reason, candidates } = findSub2ApiProxy(proxies, preference);
  if (proxy) {
    return proxy;
  }

  const configured = normalizeSub2ApiProxyPreference(preference) || '(未配置)';
  const available = (candidates || [])
    .slice(0, 8)
    .map(buildProxyDisplayName)
    .join('，') || '无可用代理';
  if (reason === 'ambiguous-name' || reason === 'ambiguous-fuzzy') {
    throw new Error(`SUB2API 默认代理“${configured}”匹配到多个代理，请改填代理 ID。候选：${available}`);
  }
  if (reason === 'missing-id') {
    throw new Error(`SUB2API 默认代理 ID “${configured}”不存在或未启用。可用代理：${available}`);
  }
  if (reason === 'missing-name') {
    throw new Error(`SUB2API 默认代理“${configured}”不存在或未启用。可用代理：${available}`);
  }
  if (reason === 'no-preference') {
    throw new Error(`SUB2API 存在多个可用代理，请在侧边栏填写默认代理名称或 ID；留空则不使用代理。可用代理：${available}`);
  }
  throw new Error('SUB2API không có proxy khả dụng; hãy kiểm tra cấu hình proxy mặc định hoặc để trống để tắt proxy.');
}

function buildDraftAccountName(groupName) {
  const prefix = (groupName || SUB2API_DEFAULT_GROUP_NAME)
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '') || SUB2API_DEFAULT_GROUP_NAME;
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 14);
  const random = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${stamp}-${random}`;
}

function extractStateFromAuthUrl(authUrl) {
  try {
    return new URL(authUrl).searchParams.get('state') || '';
  } catch {
    return '';
  }
}

function parseLocalhostCallback(rawUrl, visibleStep = 10) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL callback được cung cấp không hợp lệ.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Giao thức URL callback không đúng.');
  }
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error(`步骤 ${visibleStep} 只接受 localhost / 127.0.0.1 回调地址。`);
  }
  if (parsed.pathname !== '/auth/callback') {
    throw new Error('Đường dẫn URL callback phải là /auth/callback.');
  }

  const code = (parsed.searchParams.get('code') || '').trim();
  const state = (parsed.searchParams.get('state') || '').trim();
  if (!code || !state) {
    throw new Error('URL callback thiếu code hoặc state.');
  }

  return {
    url: parsed.toString(),
    code,
    state,
  };
}

function buildOpenAiCredentials(exchangeData) {
  const credentials = {};
  const allowedKeys = [
    'access_token',
    'refresh_token',
    'id_token',
    'expires_at',
    'email',
    'chatgpt_account_id',
    'chatgpt_user_id',
    'organization_id',
    'plan_type',
    'client_id',
  ];

  for (const key of allowedKeys) {
    if (exchangeData?.[key] !== undefined && exchangeData?.[key] !== null && exchangeData?.[key] !== '') {
      credentials[key] = exchangeData[key];
    }
  }

  if (!credentials.access_token) {
    throw new Error('SUB2API 交换授权码后未返回 access_token。');
  }

  return credentials;
}

function buildOpenAiExtra(exchangeData) {
  const extra = {};
  const allowedKeys = ['email', 'name', 'privacy_mode'];

  for (const key of allowedKeys) {
    if (exchangeData?.[key] !== undefined && exchangeData?.[key] !== null && exchangeData?.[key] !== '') {
      extra[key] = exchangeData[key];
    }
  }

  return Object.keys(extra).length ? extra : undefined;
}

async function getBackgroundState() {
  try {
    return await chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'sub2api-panel' });
  } catch {
    return {};
  }
}

function openAccountsPageSoon(origin) {
  const accountsUrl = `${origin}/admin/accounts`;
  if (location.href === accountsUrl || location.pathname.startsWith('/admin/accounts')) {
    return;
  }
  setTimeout(() => {
    try {
      location.replace(accountsUrl);
    } catch { }
  }, 500);
}

async function step1_generateOpenAiAuthUrl(payload = {}, options = {}) {
  const { report = true } = options;
  const logStep = Number.isInteger(payload?.logStep) ? payload.logStep : 1;
  const redirectUri = normalizeRedirectUri();
  const groupNames = normalizeSub2ApiGroupNames(payload.sub2apiGroupName || SUB2API_DEFAULT_GROUP_NAME);
  const groupName = groupNames[0] || SUB2API_DEFAULT_GROUP_NAME;

  const { origin, token } = await loginSub2Api(payload);
  const groups = await getGroupsByNames(origin, token, groupNames);
  const group = groups[0];
  const proxyPreference = resolveSub2ApiProxyPreference(payload);
  const proxy = proxyPreference ? await resolveSub2ApiProxy(origin, token, proxyPreference) : null;
  const proxyId = normalizeProxyId(proxy?.id);
  const draftName = buildDraftAccountName(group.name || groupName);
  const groupLabel = groups.map((item) => `${item.name}（#${item.id}）`).join('、');

  log(`步骤 ${logStep}：已登录 SUB2API，使用分组 ${groupLabel}。`);
  if (proxy) {
    log(`步骤 ${logStep}：已选择 SUB2API 默认代理 ${buildProxyDisplayName(proxy)}。`);
  } else {
    log(`步骤 ${logStep}：未配置 SUB2API 默认代理，本次将不使用代理。`);
  }
  log(`步骤 ${logStep}：正在向 SUB2API 生成 OpenAI Auth 链接，回调地址为 ${redirectUri}。`);

  const authRequestBody = {
    redirect_uri: redirectUri,
  };
  if (proxyId) {
    authRequestBody.proxy_id = proxyId;
  }

  const authData = await requestJson(origin, '/api/v1/admin/openai/generate-auth-url', {
    method: 'POST',
    token,
    body: authRequestBody,
  });

  const oauthUrl = String(authData?.auth_url || '').trim();
  const sessionId = String(authData?.session_id || '').trim();
  const oauthState = String(authData?.state || extractStateFromAuthUrl(oauthUrl)).trim();

  if (!oauthUrl || !sessionId) {
    throw new Error('SUB2API 未返回完整的 auth_url / session_id。');
  }

  log(`步骤 ${logStep}：已获取 SUB2API OAuth 链接：${oauthUrl.slice(0, 96)}...`, 'ok');
  const result = {
    oauthUrl,
    sub2apiSessionId: sessionId,
    sub2apiOAuthState: oauthState,
    sub2apiGroupId: group.id,
    sub2apiGroupIds: groups.map((item) => item.id),
    sub2apiDraftName: draftName,
    sub2apiProxyId: proxyId,
  };
  if (report) {
    reportComplete(1, result);
  }
  openAccountsPageSoon(origin);
  return result;
}

async function step9_submitOpenAiCallback(payload = {}) {
  const visibleStep = Number(payload?.visibleStep) || 10;
  const callback = parseLocalhostCallback(payload.localhostUrl || '', visibleStep);
  const backgroundState = await getBackgroundState();
  const flowEmail = String(backgroundState.email || '').trim();

  const sessionId = String(payload.sub2apiSessionId || backgroundState.sub2apiSessionId || '').trim();
  const expectedState = String(payload.sub2apiOAuthState || backgroundState.sub2apiOAuthState || '').trim();

  const { origin, token } = await loginSub2Api(payload);
  const proxyPreference = resolveSub2ApiProxyPreference(payload, backgroundState);
  const preferredProxyId = normalizeProxyId(payload.sub2apiProxyId || backgroundState.sub2apiProxyId);
  const proxySelector = preferredProxyId || proxyPreference;
  const proxy = proxySelector ? await resolveSub2ApiProxy(origin, token, proxySelector) : null;
  const proxyId = normalizeProxyId(proxy?.id);
  const accountPriority = resolveSub2ApiAccountPriority(payload, backgroundState);
  const storedGroupIds = Array.isArray(payload.sub2apiGroupIds)
    ? payload.sub2apiGroupIds
    : (Array.isArray(backgroundState.sub2apiGroupIds) ? backgroundState.sub2apiGroupIds : []);
  const groupIdsFromState = storedGroupIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const groups = groupIdsFromState.length
    ? groupIdsFromState.map((id) => ({ id }))
    : (payload.sub2apiGroupId
      ? [{ id: payload.sub2apiGroupId, name: payload.sub2apiGroupName || backgroundState.sub2apiGroupName || SUB2API_DEFAULT_GROUP_NAME }]
      : await getGroupsByNames(origin, token, payload.sub2apiGroupName || backgroundState.sub2apiGroupName || SUB2API_DEFAULT_GROUP_NAME));

  if (!sessionId) {
    throw new Error('缺少 SUB2API session_id，请重新执行步骤 1。');
  }
  if (expectedState && expectedState !== callback.state) {
    throw new Error('本次 localhost 回调中的 state 与步骤 1 生成的 state 不一致，请重新执行步骤 1。');
  }

  log('正在向 SUB2API 交换 OpenAI 授权码...', 'info', { step: visibleStep, stepKey: 'platform-verify' });
  if (proxy) {
    log(`使用 SUB2API 默认代理 ${buildProxyDisplayName(proxy)}。`, 'info', { step: visibleStep, stepKey: 'platform-verify' });
  } else {
    log('未配置 SUB2API 默认代理，本次将不使用代理。', 'info', { step: visibleStep, stepKey: 'platform-verify' });
  }
  const exchangeRequestBody = {
    session_id: sessionId,
    code: callback.code,
    state: callback.state,
  };
  if (proxyId) {
    exchangeRequestBody.proxy_id = proxyId;
  }
  const exchangeData = await requestJson(origin, '/api/v1/admin/openai/exchange-code', {
    method: 'POST',
    token,
    body: exchangeRequestBody,
  });

  const credentials = buildOpenAiCredentials(exchangeData);
  const extra = buildOpenAiExtra(exchangeData);
  const resolvedEmail = String(exchangeData?.email || credentials?.email || '').trim();
  const groupIds = groups
    .map((group) => Number(group.id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!groupIds.length) {
    throw new Error('SUB2API 返回的目标分组 ID 无效。');
  }
  const accountName = resolvedEmail
    || flowEmail
    || String(payload.sub2apiDraftName || backgroundState.sub2apiDraftName || '').trim()
    || buildDraftAccountName(payload.sub2apiGroupName || backgroundState.sub2apiGroupName || SUB2API_DEFAULT_GROUP_NAME);
  const createPayload = {
    name: accountName,
    notes: '',
    platform: 'openai',
    type: 'oauth',
    credentials,
    concurrency: SUB2API_DEFAULT_CONCURRENCY,
    priority: accountPriority,
    rate_multiplier: SUB2API_DEFAULT_RATE_MULTIPLIER,
    group_ids: groupIds,
    auto_pause_on_expired: true,
  };
  if (proxyId) {
    createPayload.proxy_id = proxyId;
  }

  if (extra) {
    createPayload.extra = extra;
  }

  log(`授权码交换成功，正在创建 SUB2API 账号（名称：${accountName}）...`, 'info', { step: visibleStep, stepKey: 'platform-verify' });
  const createdAccount = await requestJson(origin, '/api/v1/admin/accounts', {
    method: 'POST',
    token,
    body: createPayload,
  });

  const verifiedStatus = `SUB2API 已创建账号 #${createdAccount?.id || 'unknown'}`;
  log(verifiedStatus, 'ok', { step: visibleStep, stepKey: 'platform-verify' });
  reportComplete('platform-verify', {
    localhostUrl: callback.url,
    verifiedStatus,
    visibleStep,
  });
  openAccountsPageSoon(origin);
}

reportReady();
