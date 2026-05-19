(function attachBackgroundPlusCheckoutCreate(root, factory) {
  root.MultiPageBackgroundPlusCheckoutCreate = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundPlusCheckoutCreateModule() {
  const PLUS_CHECKOUT_SOURCE = 'plus-checkout';
  const PAYPAL_SOURCE = 'paypal-flow';
  const PLUS_CHECKOUT_ENTRY_URL = 'https://chatgpt.com/';
  const PLUS_CHECKOUT_INJECT_FILES = ['content/utils.js', 'content/operation-delay.js', 'content/plus-checkout.js'];
  const PAYPAL_INJECT_FILES = ['content/utils.js', 'content/operation-delay.js', 'content/paypal-flow.js'];
  const PLUS_PAYMENT_METHOD_PAYPAL = 'paypal';
  const PLUS_PAYMENT_METHOD_GOPAY = 'gopay';
  const PLUS_PAYMENT_METHOD_GPC_HELPER = 'gpc-helper';
  const DEFAULT_GPC_HELPER_API_URL = 'https://your-gpc-helper-domain.example';
  const GPC_HELPER_PHONE_MODE_AUTO = 'auto';
  const GPC_HELPER_PHONE_MODE_MANUAL = 'manual';
  const CHECKOUT_READY_URL_PATTERN = /^https:\/\/(?:chatgpt\.com\/checkout|pay\.openai\.com\/c\/pay|checkout\.stripe\.com\/c\/pay)(?:\/|$)/i;
  const CHECKOUT_REDIRECT_WAIT_TIMEOUT_MS = 15000;
  const HOSTED_CHECKOUT_ADDRESS_ENDPOINT = 'https://www.meiguodizhi.com/api/v1/dz';
  const HOSTED_CHECKOUT_VERIFICATION_CODE_ENDPOINT = 'https://mail.test.com/api/text-relay/eca_tr_xxxxxxxxx';
  const HOSTED_CHECKOUT_TRANSITION_TIMEOUT_MS = 120000;
  const HOSTED_CHECKOUT_SUCCESS_WAIT_TIMEOUT_MS = 180000;
  const HOSTED_CHECKOUT_PAYPAL_LOOP_TIMEOUT_MS = 10 * 60 * 1000;
  const HOSTED_CHECKOUT_VERIFICATION_POLL_ATTEMPTS = 12;
  const HOSTED_CHECKOUT_VERIFICATION_POLL_INTERVAL_MS = 5000;
  const HOSTED_CHECKOUT_OPENAI_VERIFICATION_FETCH_DELAY_MS = 3000;
  const HOSTED_CHECKOUT_PAYPAL_VERIFICATION_FETCH_DELAY_MS = 5000;
  const HOSTED_CHECKOUT_PAYPAL_DEFAULT_PHONE = '1234567890';
  const HOSTED_CHECKOUT_SUCCESS_URL_PATTERN = /^https:\/\/(?:chatgpt\.com|www\.chatgpt\.com|chat\.openai\.com)\/(?:backend-api\/)?payments\/success(?:[/?#]|$)/i;
  const HOSTED_CHECKOUT_SMS_POOL_SEPARATOR = '----';

  function createPlusCheckoutCreateExecutor(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      chrome,
      completeNodeFromBackground,
      createAutomationTab = null,
      enableHostedCheckoutAutomation = false,
      ensureContentScriptReadyOnTabUntilStopped,
      failNodeFromBackground = null,
      fetch: fetchImpl = null,
      getState = null,
      processHostedCheckoutSuccess = null,
      registerTab,
      sendTabMessageUntilStopped,
      setState,
      sleepWithStop,
      waitForTabCompleteUntilStopped,
      waitForTabUrlMatchUntilStopped = null,
      throwIfStopped = () => {},
    } = deps;

    function addLog(message, level = 'info', options = {}) {
      return rawAddLog(message, level, {
        step: 6,
        stepKey: 'plus-checkout-create',
        ...(options && typeof options === 'object' ? options : {}),
      });
    }

    function normalizePlusPaymentMethod(value = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.normalizePlusPaymentMethod) {
        return rootScope.GoPayUtils.normalizePlusPaymentMethod(value);
      }
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized === PLUS_PAYMENT_METHOD_GPC_HELPER) {
        return PLUS_PAYMENT_METHOD_GPC_HELPER;
      }
      return normalized === PLUS_PAYMENT_METHOD_GOPAY ? PLUS_PAYMENT_METHOD_GOPAY : PLUS_PAYMENT_METHOD_PAYPAL;
    }

    function getCheckoutModeLabel(state = {}) {
      const paymentMethod = normalizePlusPaymentMethod(state?.plusPaymentMethod);
      if (paymentMethod === PLUS_PAYMENT_METHOD_GPC_HELPER) {
        return 'GPC 订阅页';
      }
      return paymentMethod === PLUS_PAYMENT_METHOD_GOPAY ? 'GoPay 订阅页' : 'Plus Checkout';
    }

    function getPlusPaymentMethodLabel(method = PLUS_PAYMENT_METHOD_PAYPAL) {
      const paymentMethod = normalizePlusPaymentMethod(method);
      if (paymentMethod === PLUS_PAYMENT_METHOD_GPC_HELPER) {
        return 'GPC';
      }
      return paymentMethod === PLUS_PAYMENT_METHOD_GOPAY ? 'GoPay' : 'PayPal';
    }

    function shouldWaitForHostedCheckoutSuccess(state = {}, paymentMethod = PLUS_PAYMENT_METHOD_PAYPAL) {
      return normalizePlusPaymentMethod(paymentMethod) === PLUS_PAYMENT_METHOD_PAYPAL
        && state?.plusHostedCheckoutIsFinalStep !== false;
    }

    function isCheckoutReadyUrl(url = '') {
      return CHECKOUT_READY_URL_PATTERN.test(String(url || ''));
    }

    function isPaymentsSuccessUrl(url = '') {
      return HOSTED_CHECKOUT_SUCCESS_URL_PATTERN.test(String(url || ''));
    }

    function isPayPalUrl(url = '') {
      return /paypal\./i.test(String(url || ''));
    }

    function isPayPalHermesUrl(url = '') {
      return /paypal\.com\/webapps\/hermes/i.test(String(url || ''));
    }

    function normalizeHostedCheckoutSmsPoolText(value = '') {
      return String(value || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
    }

    function normalizeHostedCheckoutPoolPhone(value = '') {
      return String(value || '').trim();
    }

    function formatHostedCheckoutPayPalFormPhone(value = '') {
      const rawValue = String(value || '').trim();
      const digits = rawValue.replace(/\D+/g, '');
      if (rawValue.startsWith('+1') && digits.length === 11 && digits.startsWith('1')) {
        return digits.slice(1);
      }
      return digits;
    }

    function normalizeHostedCheckoutPoolUrl(value = '') {
      const rawValue = String(value || '').trim();
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

    function buildHostedCheckoutSmsPoolEntryKey(phone = '', verificationUrl = '') {
      const normalizedPhone = normalizeHostedCheckoutPoolPhone(phone);
      const normalizedUrl = normalizeHostedCheckoutPoolUrl(verificationUrl);
      return normalizedPhone && normalizedUrl ? `${normalizedPhone}${HOSTED_CHECKOUT_SMS_POOL_SEPARATOR}${normalizedUrl}` : '';
    }

    function parseHostedCheckoutSmsPoolText(value = '') {
      const lines = normalizeHostedCheckoutSmsPoolText(value).split('\n').filter(Boolean);
      const entries = [];
      const seen = new Set();
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const separatorIndex = line.indexOf(HOSTED_CHECKOUT_SMS_POOL_SEPARATOR);
        const hasSeparator = separatorIndex > 0;
        const phone = hasSeparator
          ? normalizeHostedCheckoutPoolPhone(line.slice(0, separatorIndex))
          : normalizeHostedCheckoutPoolPhone(line);
        const verificationUrl = hasSeparator
          ? normalizeHostedCheckoutPoolUrl(line.slice(separatorIndex + HOSTED_CHECKOUT_SMS_POOL_SEPARATOR.length))
          : normalizeHostedCheckoutPoolUrl(lines[index + 1] || '');
        if (!hasSeparator && verificationUrl) {
          index += 1;
        }
        const key = buildHostedCheckoutSmsPoolEntryKey(phone, verificationUrl);
        if (!phone || !verificationUrl || !key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        entries.push({
          index,
          key,
          phone,
          verificationUrl,
        });
      }
      return entries;
    }

    function normalizeHostedCheckoutSmsPoolUsage(value = {}) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
      }
      return Object.fromEntries(Object.entries(value).map(([key, usage]) => {
        const item = usage && typeof usage === 'object' && !Array.isArray(usage) ? usage : {};
        const legacyUsedCount = Number(item.usedAt) > 0 ? 1 : 0;
        const useCount = Math.max(0, Math.floor(Number(item.useCount ?? item.usageCount ?? legacyUsedCount) || 0));
        return [String(key || '').trim(), {
          useCount,
          usedAt: Math.max(0, Number(item.usedAt) || 0),
          lastAttemptAt: Math.max(0, Number(item.lastAttemptAt) || 0),
          lastError: String(item.lastError || '').trim(),
        }];
      }).filter(([key]) => Boolean(key)));
    }

    function normalizeHostedCheckoutCurrentSmsEntry(value = {}) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
      }
      const phone = normalizeHostedCheckoutPoolPhone(value.phone);
      const verificationUrl = normalizeHostedCheckoutPoolUrl(value.verificationUrl);
      const key = String(value.key || buildHostedCheckoutSmsPoolEntryKey(phone, verificationUrl)).trim();
      if (!phone || !verificationUrl || !key) {
        return null;
      }
      return {
        key,
        phone,
        verificationUrl,
        index: Math.max(0, Number(value.index) || 0),
      };
    }

    function redactHostedCheckoutVerificationUrl(value = '') {
      const rawValue = String(value || '').trim();
      if (!rawValue) {
        return '(空)';
      }
      try {
        const parsed = new URL(rawValue);
        for (const key of Array.from(parsed.searchParams.keys())) {
          if (/key|token|auth|secret|pass|api/i.test(key)) {
            parsed.searchParams.set(key, '***');
          }
        }
        return parsed.toString();
      } catch {
        return rawValue.replace(/([?&](?:key|token|auth|secret|pass|api)[^=]*=)[^&]+/gi, '$1***');
      }
    }

    function selectHostedCheckoutSmsPoolEntry(state = {}, stored = {}) {
      const poolText = normalizeHostedCheckoutSmsPoolText(
        stored?.hostedCheckoutSmsPoolText
        || state?.hostedCheckoutSmsPoolText
        || ''
      );
      const poolEntries = parseHostedCheckoutSmsPoolText(poolText);
      if (!poolEntries.length) {
        return {
          poolText,
          poolEntries,
          usage: normalizeHostedCheckoutSmsPoolUsage(stored?.hostedCheckoutSmsPoolUsage || state?.hostedCheckoutSmsPoolUsage || {}),
          entry: null,
        };
      }
      const usage = normalizeHostedCheckoutSmsPoolUsage(stored?.hostedCheckoutSmsPoolUsage || state?.hostedCheckoutSmsPoolUsage || {});
      const current = normalizeHostedCheckoutCurrentSmsEntry(state?.hostedCheckoutCurrentSmsEntry);
      if (current && poolEntries.some((entry) => entry.key === current.key) && !usage[current.key]?.usedAt) {
        return {
          poolText,
          poolEntries,
          usage,
          entry: current,
          reused: true,
        };
      }
      const orderedEntries = poolEntries
        .map((entry) => {
          const itemUsage = usage[entry.key] || {};
          return {
            ...entry,
            useCount: Math.max(0, Math.floor(Number(itemUsage.useCount) || 0)),
            lastError: String(itemUsage.lastError || '').trim(),
            lastAttemptAt: Math.max(0, Number(itemUsage.lastAttemptAt) || 0),
          };
        })
        .sort((left, right) => (
          (left.lastError ? 1 : 0) - (right.lastError ? 1 : 0)
          || left.useCount - right.useCount
          || left.lastAttemptAt - right.lastAttemptAt
          || left.index - right.index
        ));
      const entry = orderedEntries[0] || null;
      return {
        poolText,
        poolEntries,
        usage,
        entry,
        reused: false,
      };
    }

    async function getHostedCheckoutRuntimeConfig() {
      const state = typeof getState === 'function' ? await getState().catch(() => ({})) : {};
      let stored = {};
      if (chrome?.storage?.local?.get) {
        stored = await chrome.storage.local.get([
          'hostedCheckoutVerificationUrl',
          'hostedCheckoutPhoneNumber',
          'hostedCheckoutSmsPoolText',
          'hostedCheckoutSmsPoolUsage',
        ]).catch(() => ({}));
      }
      const poolSelection = selectHostedCheckoutSmsPoolEntry(state, stored);
      if (poolSelection.entry) {
        const nextUsage = {
          ...poolSelection.usage,
          [poolSelection.entry.key]: {
            ...(poolSelection.usage[poolSelection.entry.key] || {}),
            usedAt: Math.max(0, Number(poolSelection.usage[poolSelection.entry.key]?.usedAt) || 0),
            lastAttemptAt: Date.now(),
            lastError: '',
          },
        };
        if (!poolSelection.reused && typeof setState === 'function') {
          await setState({
            hostedCheckoutCurrentSmsEntry: poolSelection.entry,
            hostedCheckoutSmsPoolUsage: nextUsage,
          });
        } else if (typeof setState === 'function') {
          await setState({
            hostedCheckoutSmsPoolUsage: nextUsage,
          });
        }
        return {
          verificationUrl: poolSelection.entry.verificationUrl,
          phone: poolSelection.entry.phone,
          smsPoolEntry: poolSelection.entry,
          smsPoolUsage: nextUsage,
          smsPoolSize: poolSelection.poolEntries.length,
          smsPoolReused: Boolean(poolSelection.reused),
        };
      }
      if (poolSelection.poolEntries.length && !poolSelection.entry) {
        throw new Error('hosted checkout 手机号池没有可用号码，请补充新号码。');
      }
      const verificationUrl = String(
        stored?.hostedCheckoutVerificationUrl
        || state?.hostedCheckoutVerificationUrl
        || HOSTED_CHECKOUT_VERIFICATION_CODE_ENDPOINT
        || ''
      ).trim();
      const phone = String(
        stored?.hostedCheckoutPhoneNumber
        || state?.hostedCheckoutPhoneNumber
        || HOSTED_CHECKOUT_PAYPAL_DEFAULT_PHONE
        || ''
      ).trim();
      return {
        verificationUrl,
        phone,
        smsPoolEntry: null,
        smsPoolUsage: poolSelection.usage,
        smsPoolSize: poolSelection.poolEntries.length,
      };
    }

    async function waitForCheckoutSurface(tabId) {
      if (!chrome?.tabs?.get) {
        return null;
      }
      if (typeof waitForTabUrlMatchUntilStopped === 'function') {
        try {
          return await Promise.race([
            waitForTabUrlMatchUntilStopped(tabId, (url) => isCheckoutReadyUrl(url)),
            new Promise((resolve) => {
              setTimeout(() => resolve(null), CHECKOUT_REDIRECT_WAIT_TIMEOUT_MS);
            }),
          ]);
        } catch {
          return null;
        }
      }

      const startedAt = Date.now();
      while (Date.now() - startedAt < CHECKOUT_REDIRECT_WAIT_TIMEOUT_MS) {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab) {
          return null;
        }
        if (isCheckoutReadyUrl(tab.url || '')) {
          return tab;
        }
        await sleepWithStop(300);
      }
      return null;
    }

    async function waitForUrlMatch(tabId, matcher, timeoutMs = 30000, retryDelayMs = 400) {
      if (typeof waitForTabUrlMatchUntilStopped === 'function') {
        const timeout = Date.now() + Math.max(1000, Number(timeoutMs) || 30000);
        while (Date.now() < timeout) {
          throwIfStopped();
          const remainingMs = Math.max(1000, timeout - Date.now());
          const result = await Promise.race([
            waitForTabUrlMatchUntilStopped(tabId, matcher, { retryDelayMs }),
            new Promise((resolve) => {
              setTimeout(() => resolve(null), Math.min(remainingMs, 1000));
            }),
          ]);
          if (result) {
            return result;
          }
        }
        return null;
      }

      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        throwIfStopped();
        const tab = await chrome?.tabs?.get?.(tabId).catch(() => null);
        if (!tab) {
          return null;
        }
        if (typeof matcher === 'function' && matcher(tab.url || '', tab)) {
          return tab;
        }
        await sleepWithStop(retryDelayMs);
      }
      return null;
    }

    async function openFreshChatGptTabForCheckoutCreate() {
      const tab = typeof createAutomationTab === 'function'
        ? await createAutomationTab({ url: PLUS_CHECKOUT_ENTRY_URL, active: true })
        : await chrome.tabs.create({ url: PLUS_CHECKOUT_ENTRY_URL, active: true });
      const tabId = Number(tab?.id);
      if (!Number.isInteger(tabId)) {
        throw new Error('步骤 6：打开 ChatGPT 页面失败，无法创建订阅页。');
      }
      if (typeof registerTab === 'function') {
        await registerTab(PLUS_CHECKOUT_SOURCE, tabId);
      }
      return tabId;
    }

    function buildHostedCheckoutRandomEmail() {
      const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let localPart = '';
      for (let index = 0; index < 16; index += 1) {
        localPart += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      return `${localPart}@gmail.com`;
    }

    function buildHostedCheckoutRandomPassword() {
      const lowercase = 'abcdefghijklmnopqrstuvwxyz';
      const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const digits = '0123456789';
      const symbols = '!@#$%^';
      const alphabet = `${lowercase}${uppercase}${digits}${symbols}`;
      const values = [
        lowercase[Math.floor(Math.random() * lowercase.length)],
        uppercase[Math.floor(Math.random() * uppercase.length)],
        digits[Math.floor(Math.random() * digits.length)],
        symbols[Math.floor(Math.random() * symbols.length)],
      ];
      while (values.length < 14) {
        values.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
      }
      return values.sort(() => Math.random() - 0.5).join('');
    }

    function buildHostedCheckoutVisaCard() {
      const prefixes = [
        [4, 1, 4, 7],
        [4, 1, 0, 0],
      ];
      const digits = prefixes[Math.floor(Math.random() * prefixes.length)].slice();
      while (digits.length < 15) {
        digits.push(Math.floor(Math.random() * 10));
      }
      const reversed = digits.slice().reverse();
      let sum = 0;
      for (let index = 0; index < reversed.length; index += 1) {
        let digit = reversed[index];
        if (index % 2 === 0) {
          digit *= 2;
          if (digit > 9) {
            digit -= 9;
          }
        }
        sum += digit;
      }
      const checkDigit = (10 - (sum % 10)) % 10;
      digits.push(checkDigit);
      const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
      const currentYear = new Date().getFullYear() % 100;
      const year = currentYear + Math.floor(Math.random() * 4) + 2;
      const cvv = String(Math.floor(100 + Math.random() * 900));
      return {
        number: digits.join(''),
        expiry: `${month} / ${year}`,
        cvv,
      };
    }

    async function fetchHostedCheckoutAddress() {
      const { response, data } = await fetchJsonWithTimeout(HOSTED_CHECKOUT_ADDRESS_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: '/',
          method: 'address',
        }),
      }, 30000);
      if (!response?.ok) {
        throw new Error(`获取 hosted checkout 地址失败（HTTP ${response?.status || 0}）。`);
      }
      const address = data?.address || data || {};
      return {
        street: String(address.Address || address.street || '123 Main St').trim(),
        city: String(address.City || address.city || 'New York').trim(),
        state: String(address.State_Full || address.State || address.state || 'New York').trim(),
        zip: String(address.Zip_Code || address.zip || '10001').trim().slice(0, 5) || '10001',
      };
    }

    function buildHostedCheckoutAddressSeed(address = {}) {
      return {
        countryCode: 'US',
        skipAutocomplete: true,
        autoCheckAgreement: true,
        fallback: {
          address1: String(address.street || '123 Main St').trim(),
          city: String(address.city || 'New York').trim(),
          region: String(address.state || 'New York').trim(),
          postalCode: String(address.zip || '10001').trim(),
        },
      };
    }

    function buildHostedCheckoutGuestProfile(address = {}, config = {}) {
      const card = buildHostedCheckoutVisaCard();
      return {
        email: buildHostedCheckoutRandomEmail(),
        password: buildHostedCheckoutRandomPassword(),
        phone: String(config?.phone || HOSTED_CHECKOUT_PAYPAL_DEFAULT_PHONE || '').trim(),
        firstName: 'James',
        lastName: 'Smith',
        fullName: 'James Smith',
        cardNumber: card.number,
        cardExpiry: card.expiry,
        cardCvv: card.cvv,
        address,
        runtimeConfig: config,
      };
    }

    function extractHostedCheckoutVerificationCode(payload = {}) {
      const candidates = [
        payload?.data,
        payload?.code,
        payload?.text,
        payload?.message,
        payload,
      ];
      for (const candidate of candidates) {
        const text = String(candidate || '').trim();
        if (!text) {
          continue;
        }
        const match = text.match(/\d{6}/);
        if (match) {
          return match[0];
        }
        const digits = text.replace(/\D+/g, '').slice(0, 6);
        if (digits.length === 6) {
          return digits;
        }
      }
      return '';
    }

    async function fetchHostedCheckoutVerificationCode(runtimeConfigOverride = null) {
      const runtimeConfig = runtimeConfigOverride || await getHostedCheckoutRuntimeConfig();
      const verificationUrl = runtimeConfig.verificationUrl;
      await addLog(
        `步骤 6：当前 hosted checkout 验证码接口配置为 ${redactHostedCheckoutVerificationUrl(verificationUrl)}。`,
        'info'
      );
      const fetcher = typeof fetchImpl === 'function'
        ? fetchImpl
        : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
      if (typeof fetcher !== 'function') {
        throw new Error('当前运行环境不支持 fetch，无法获取 hosted checkout 验证码。');
      }
      if (!verificationUrl) {
        throw new Error('当前未配置 hosted checkout 验证码接口地址。');
      }
      const separator = verificationUrl.includes('?') ? '&' : '?';
      const response = await fetcher(`${verificationUrl}${separator}t=${Date.now()}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json,text/plain,*/*',
        },
      });
      const text = await response.text().catch(() => '');
      let payload = text;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = text;
      }
      const code = extractHostedCheckoutVerificationCode(payload);
      if (!code) {
        throw new Error('hosted checkout 验证码接口暂未返回有效验证码。');
      }
      return code;
    }

    async function pollHostedCheckoutVerificationCode(runtimeConfigOverride = null) {
      let lastError = null;
      for (let attempt = 1; attempt <= HOSTED_CHECKOUT_VERIFICATION_POLL_ATTEMPTS; attempt += 1) {
        throwIfStopped();
        try {
          const code = await fetchHostedCheckoutVerificationCode(runtimeConfigOverride);
          await addLog(`步骤 6：已获取 hosted checkout 验证码（${attempt}/${HOSTED_CHECKOUT_VERIFICATION_POLL_ATTEMPTS}）。`, 'info');
          return code;
        } catch (error) {
          lastError = error;
          await addLog(
            `步骤 6：hosted checkout 验证码暂不可用（${attempt}/${HOSTED_CHECKOUT_VERIFICATION_POLL_ATTEMPTS}）：${error?.message || error}`,
            'warn'
          );
          if (attempt < HOSTED_CHECKOUT_VERIFICATION_POLL_ATTEMPTS) {
            await sleepWithStop(HOSTED_CHECKOUT_VERIFICATION_POLL_INTERVAL_MS);
          }
        }
      }
      throw lastError || new Error('hosted checkout 验证码轮询失败。');
    }

    async function markHostedCheckoutSmsEntryFailure(errorLike = '') {
      const state = typeof getState === 'function' ? await getState().catch(() => ({})) : {};
      const entry = normalizeHostedCheckoutCurrentSmsEntry(state?.hostedCheckoutCurrentSmsEntry);
      if (!entry || typeof setState !== 'function') {
        return;
      }
      const usage = normalizeHostedCheckoutSmsPoolUsage(state?.hostedCheckoutSmsPoolUsage || {});
      await setState({
        hostedCheckoutSmsPoolUsage: {
          ...usage,
          [entry.key]: {
            ...(usage[entry.key] || {}),
            usedAt: Math.max(0, Number(usage[entry.key]?.usedAt) || 0),
            lastAttemptAt: Math.max(Date.now(), Number(usage[entry.key]?.lastAttemptAt) || 0),
            lastError: String(errorLike?.message || errorLike || '').trim().slice(0, 300),
          },
        },
      });
    }

    async function markHostedCheckoutSmsEntryUsed() {
      const state = typeof getState === 'function' ? await getState().catch(() => ({})) : {};
      const entry = normalizeHostedCheckoutCurrentSmsEntry(state?.hostedCheckoutCurrentSmsEntry);
      if (!entry || typeof setState !== 'function') {
        return;
      }
      const usage = normalizeHostedCheckoutSmsPoolUsage(state?.hostedCheckoutSmsPoolUsage || {});
      await setState({
            hostedCheckoutSmsPoolUsage: {
          ...usage,
          [entry.key]: {
            ...(usage[entry.key] || {}),
            useCount: Math.max(0, Number(usage[entry.key]?.useCount) || 0) + 1,
            usedAt: Date.now(),
            lastAttemptAt: Math.max(Date.now(), Number(usage[entry.key]?.lastAttemptAt) || 0),
            lastError: '',
          },
        },
        hostedCheckoutCurrentSmsEntry: null,
      });
      await addLog(`步骤 6：hosted checkout 号池号码 ${entry.phone} 已标记为已使用。`, 'ok');
    }

    async function runHostedCheckoutOpenAiFlow(tabId, guestProfile) {
      await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
        inject: PLUS_CHECKOUT_INJECT_FILES,
        injectSource: PLUS_CHECKOUT_SOURCE,
        logMessage: '步骤 6：hosted checkout 页面仍在加载，等待脚本就绪...',
      });
      await addLog('步骤 6：hosted checkout 已打开，正在按油猴脚本顺序自动切换 PayPal、填写地址并提交...', 'info');
      const initialResult = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
        type: 'RUN_HOSTED_OPENAI_CHECKOUT_STEP',
        source: 'background',
        payload: {
          address: guestProfile.address,
        },
      });
      if (initialResult?.error) {
        throw new Error(initialResult.error);
      }

      const startedAt = Date.now();
      let verificationSubmitted = false;
      while (Date.now() - startedAt < HOSTED_CHECKOUT_TRANSITION_TIMEOUT_MS) {
        throwIfStopped();
        const tab = await chrome?.tabs?.get?.(tabId).catch(() => null);
        if (!tab) {
          throw new Error('步骤 6：hosted checkout 标签页已关闭。');
        }
        const currentUrl = String(tab.url || '').trim();
        if (isPayPalUrl(currentUrl) || isPaymentsSuccessUrl(currentUrl)) {
          return {
            transitioned: true,
            url: currentUrl,
          };
        }

        const state = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
          type: 'PLUS_CHECKOUT_GET_STATE',
          source: 'background',
          payload: {},
        });
        if (state?.error) {
          throw new Error(state.error);
        }
        if (state?.hostedVerificationVisible && !verificationSubmitted) {
          await addLog(
            `步骤 6：检测到 hosted checkout OpenAI 验证码弹窗，先等待 ${Math.round(HOSTED_CHECKOUT_OPENAI_VERIFICATION_FETCH_DELAY_MS / 1000)} 秒再获取验证码...`,
            'info'
          );
          await sleepWithStop(HOSTED_CHECKOUT_OPENAI_VERIFICATION_FETCH_DELAY_MS);
          await addLog('步骤 6：正在获取并填写 hosted checkout OpenAI 验证码...', 'info');
          const verificationCode = await pollHostedCheckoutVerificationCode(guestProfile.runtimeConfig);
          const verifyResult = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
            type: 'RUN_HOSTED_OPENAI_CHECKOUT_STEP',
            source: 'background',
            payload: {
              verificationCode,
            },
          });
          if (verifyResult?.error) {
            throw new Error(verifyResult.error);
          }
          const success = await checkCurrentHostedCheckoutSuccess(tabId, 'OpenAI hosted checkout 验证码填写');
          if (success) {
            return {
              transitioned: true,
              url: success.url,
            };
          }
          verificationSubmitted = true;
        }
        await sleepWithStop(500);
      }

      throw new Error('步骤 6：hosted checkout OpenAI/Stripe 页面提交后长时间未跳转到 PayPal 或成功页。');
    }

    async function runHostedCheckoutPayPalStep(tabId, payload = {}) {
      await waitForTabCompleteUntilStopped(tabId);
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(PAYPAL_SOURCE, tabId, {
        inject: PAYPAL_INJECT_FILES,
        injectSource: PAYPAL_SOURCE,
        logMessage: '步骤 6：PayPal hosted checkout 页面仍在加载，等待脚本就绪...',
      });
      const result = await sendTabMessageUntilStopped(tabId, PAYPAL_SOURCE, {
        type: 'PAYPAL_RUN_HOSTED_CHECKOUT_STEP',
        source: 'background',
        payload,
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function getHostedCheckoutPayPalState(tabId) {
      await ensureContentScriptReadyOnTabUntilStopped(PAYPAL_SOURCE, tabId, {
        inject: PAYPAL_INJECT_FILES,
        injectSource: PAYPAL_SOURCE,
        logMessage: '步骤 6：正在等待 PayPal hosted checkout 页面脚本就绪...',
      });
      const result = await sendTabMessageUntilStopped(tabId, PAYPAL_SOURCE, {
        type: 'PAYPAL_HOSTED_GET_STATE',
        source: 'background',
        payload: {},
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function waitForHostedCheckoutPaymentsSuccess(tabId) {
      const successTab = await waitForUrlMatch(
        tabId,
        (url) => isPaymentsSuccessUrl(url),
        HOSTED_CHECKOUT_SUCCESS_WAIT_TIMEOUT_MS,
        500
      );
      if (!successTab?.url || !isPaymentsSuccessUrl(successTab.url)) {
        throw new Error('步骤 6：hosted checkout 已离开 PayPal，但长时间未回到 ChatGPT 支付成功页。');
      }
      await addLog('步骤 6：hosted checkout 已回到 ChatGPT 支付成功页，等待扩展继续后续 OAuth 流程。', 'ok');
      return successTab;
    }

    async function checkCurrentHostedCheckoutSuccess(tabId, label = '') {
      const tab = await chrome?.tabs?.get?.(tabId).catch(() => null);
      const currentUrl = String(tab?.url || '').trim();
      if (!currentUrl || !isPaymentsSuccessUrl(currentUrl)) {
        return null;
      }
      if (label) {
        await addLog(`步骤 6：${label}后检测到 ChatGPT 支付成功页。`, 'ok');
      }
      await completeHostedCheckoutSuccess(tabId, currentUrl);
      return {
        url: currentUrl,
        completed: true,
      };
    }

    async function completeHostedCheckoutSuccess(tabId, successUrl = '') {
      const normalizedSuccessUrl = String(successUrl || '').trim();
      if (!normalizedSuccessUrl || !isPaymentsSuccessUrl(normalizedSuccessUrl)) {
        return null;
      }
      await markHostedCheckoutSmsEntryUsed();
      if (typeof processHostedCheckoutSuccess === 'function') {
        return processHostedCheckoutSuccess(tabId, normalizedSuccessUrl);
      }
      if (typeof completeNodeFromBackground === 'function') {
        await completeNodeFromBackground('plus-checkout-create', {
          plusReturnUrl: normalizedSuccessUrl,
          plusHostedCheckoutCompleted: true,
        });
        return {
          completed: true,
          plusReturnUrl: normalizedSuccessUrl,
          fallback: true,
        };
      }
      return null;
    }

    async function runHostedCheckoutPayPalFlow(tabId, guestProfile) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < HOSTED_CHECKOUT_PAYPAL_LOOP_TIMEOUT_MS) {
        throwIfStopped();
        const tab = await chrome?.tabs?.get?.(tabId).catch(() => null);
        if (!tab) {
          throw new Error('步骤 6：hosted checkout PayPal 标签页已关闭。');
        }
        const currentUrl = String(tab.url || '').trim();
        if (!currentUrl) {
          await sleepWithStop(500);
          continue;
        }
        if (isPaymentsSuccessUrl(currentUrl)) {
          await addLog('步骤 6：hosted checkout 已直接进入 ChatGPT 支付成功页。', 'ok');
          await completeHostedCheckoutSuccess(tabId, currentUrl);
          return { url: currentUrl };
        }
        if (!isPayPalUrl(currentUrl)) {
          await addLog(`步骤 6：hosted checkout 已离开 PayPal（${currentUrl}），继续等待 ChatGPT 支付成功页...`, 'info');
          return waitForHostedCheckoutPaymentsSuccess(tabId);
        }

        if (isPayPalHermesUrl(currentUrl)) {
          await addLog(`步骤 6：检测到 PayPal Hermes 复核页（${currentUrl}），按油猴脚本方式直接等待并点击 Agree and Continue...`, 'info');
          await runHostedCheckoutPayPalStep(tabId, {});
          const success = await checkCurrentHostedCheckoutSuccess(tabId, 'PayPal Hermes 点击');
          if (success) {
            return success;
          }
          await sleepWithStop(1500);
          continue;
        }

        const pageState = await getHostedCheckoutPayPalState(tabId);
        if (pageState.hostedStage === 'verification' && pageState.verificationInputsVisible) {
          await addLog(
            `步骤 6：检测到 PayPal hosted checkout 验证码弹窗，先等待 ${Math.round(HOSTED_CHECKOUT_PAYPAL_VERIFICATION_FETCH_DELAY_MS / 1000)} 秒再获取验证码...`,
            'info'
          );
          await sleepWithStop(HOSTED_CHECKOUT_PAYPAL_VERIFICATION_FETCH_DELAY_MS);
          await addLog('步骤 6：正在获取并填写 PayPal hosted checkout 验证码...', 'info');
          const verificationCode = await pollHostedCheckoutVerificationCode(guestProfile.runtimeConfig);
          await runHostedCheckoutPayPalStep(tabId, {
            verificationCode,
          });
          const success = await checkCurrentHostedCheckoutSuccess(tabId, 'PayPal 验证码填写');
          if (success) {
            return success;
          }
          await sleepWithStop(1500);
          continue;
        }

        if (pageState.hostedStage === 'pay_login') {
          await addLog('步骤 6：检测到 PayPal hosted checkout 登录页，正在填写邮箱并继续...', 'info');
          await runHostedCheckoutPayPalStep(tabId, {
            email: guestProfile.email,
          });
          const success = await checkCurrentHostedCheckoutSuccess(tabId, 'PayPal 邮箱提交');
          if (success) {
            return success;
          }
          await sleepWithStop(1500);
          continue;
        }

        if (pageState.hostedStage === 'guest_checkout') {
          const runtimeConfig = guestProfile.runtimeConfig || await getHostedCheckoutRuntimeConfig();
          const configuredPhone = String(runtimeConfig?.phone || guestProfile.phone || '').trim();
          const payPalFormPhone = formatHostedCheckoutPayPalFormPhone(configuredPhone) || configuredPhone;
          await addLog(
            runtimeConfig?.smsPoolEntry
              ? `步骤 6：当前 hosted checkout 使用号池号码 ${configuredPhone}（${runtimeConfig.smsPoolEntry.index + 1}/${runtimeConfig.smsPoolSize}）。`
              : `步骤 6：当前 hosted checkout 电话配置为 ${configuredPhone || '(空，将回退默认值)'}。`,
            'info'
          );
          await addLog(`步骤 6：发送到 PayPal guest checkout 的 payload：${JSON.stringify({
            phone: payPalFormPhone,
            originalPhone: configuredPhone,
            address: guestProfile.address || {},
          })}`, 'info');
          await addLog('步骤 6：检测到 PayPal hosted checkout 卡支付页，正在填写卡资料并提交...', 'info');
          await runHostedCheckoutPayPalStep(tabId, {
            ...guestProfile,
            phone: payPalFormPhone,
          });
          const success = await checkCurrentHostedCheckoutSuccess(tabId, 'PayPal guest checkout 提交');
          if (success) {
            return success;
          }
          await sleepWithStop(2000);
          continue;
        }

        if (pageState.hostedStage === 'review_consent') {
          await addLog('步骤 6：检测到 PayPal hosted checkout 账单确认页，正在点击继续...', 'info');
          await runHostedCheckoutPayPalStep(tabId, {});
          const success = await checkCurrentHostedCheckoutSuccess(tabId, 'PayPal 账单确认');
          if (success) {
            return success;
          }
          await sleepWithStop(1500);
          continue;
        }

        if (pageState.hostedStage === 'approval') {
          throw new Error('步骤 6：hosted checkout 流程意外进入了普通 PayPal 授权页，当前流程未配置 PayPal 账号授权。');
        }

        await sleepWithStop(1000);
      }
      throw new Error('步骤 6：hosted checkout PayPal 自动化超时，长时间未完成支付链路。');
    }

    async function runHostedCheckoutAutomation(tabId) {
      const runtimeConfig = await getHostedCheckoutRuntimeConfig();
      const address = await fetchHostedCheckoutAddress();
      await addLog(
        runtimeConfig.smsPoolEntry
          ? `步骤 6：hosted checkout 已冻结号池号码 ${runtimeConfig.phone}（${runtimeConfig.smsPoolEntry.index + 1}/${runtimeConfig.smsPoolSize}），验证码接口 ${redactHostedCheckoutVerificationUrl(runtimeConfig.verificationUrl)}。`
          : `步骤 6：hosted checkout 初始电话配置为 ${runtimeConfig.phone || '(空)'}。`,
        'info'
      );
      await addLog(`步骤 6：hosted checkout 地址数据：${JSON.stringify(address)}`, 'info');
      const guestProfile = buildHostedCheckoutGuestProfile(address, runtimeConfig);
      const currentTab = await chrome?.tabs?.get?.(tabId).catch(() => null);
      const currentUrl = String(currentTab?.url || '').trim();
      if (isPaymentsSuccessUrl(currentUrl)) {
        await addLog('步骤 6：hosted checkout 启动时已在 ChatGPT 支付成功页。', 'ok');
        await completeHostedCheckoutSuccess(tabId, currentUrl);
        return;
      }
      if (isPayPalUrl(currentUrl)) {
        await addLog('步骤 6：hosted checkout 启动时已在 PayPal 页面，直接继续 PayPal 自动化。', 'info');
        await runHostedCheckoutPayPalFlow(tabId, guestProfile);
        return;
      }
      await runHostedCheckoutOpenAiFlow(tabId, guestProfile);

      const transitionTab = await waitForUrlMatch(
        tabId,
        (url) => isPayPalUrl(url) || isPaymentsSuccessUrl(url),
        HOSTED_CHECKOUT_TRANSITION_TIMEOUT_MS,
        500
      );
      const transitionUrl = String(transitionTab?.url || '').trim();
      if (!transitionUrl) {
        throw new Error('步骤 6：hosted checkout 提交后长时间未跳转到 PayPal 或 ChatGPT 支付成功页。');
      }
      if (isPaymentsSuccessUrl(transitionUrl)) {
        await addLog('步骤 6：hosted checkout 在提交后已直接进入 ChatGPT 支付成功页。', 'ok');
        await completeHostedCheckoutSuccess(tabId, transitionUrl);
        return;
      }

      await addLog('步骤 6：hosted checkout 已跳转到 PayPal，准备继续 guest/card 流自动化。', 'info');
      const successTab = await runHostedCheckoutPayPalFlow(tabId, guestProfile);
      const successUrl = String(successTab?.url || '').trim();
      if (successUrl) {
        await completeHostedCheckoutSuccess(tabId, successUrl);
      }
    }

    function startHostedCheckoutAutomation(tabId) {
      if (!enableHostedCheckoutAutomation) {
        return;
      }
      void runHostedCheckoutAutomation(tabId).catch(async (error) => {
        const message = error?.message || String(error || 'hosted checkout automation failed');
        await addLog(`步骤 6：hosted checkout 自动化失败：${message}`, 'error');
        await markHostedCheckoutSmsEntryFailure(message);
        if (typeof failNodeFromBackground === 'function') {
          await failNodeFromBackground('plus-checkout-create', message);
        }
      });
    }

    function normalizeHelperCountryCode(countryCode = '86') {
      const digits = String(countryCode || '').replace(/\D/g, '');
      return digits || '86';
    }

    function normalizeHelperPhoneNumber(phone = '', countryCode = '86') {
      const cleaned = String(phone || '').replace(/\D/g, '');
      const countryDigits = normalizeHelperCountryCode(countryCode);
      if (countryDigits && cleaned.startsWith(countryDigits) && cleaned.length > countryDigits.length) {
        return cleaned.slice(countryDigits.length);
      }
      return cleaned;
    }

    function normalizeGpcHelperPhoneMode(value = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.normalizeGpcHelperPhoneMode) {
        return rootScope.GoPayUtils.normalizeGpcHelperPhoneMode(value);
      }
      const normalized = String(value || '').trim().toLowerCase();
      return normalized === GPC_HELPER_PHONE_MODE_AUTO || normalized === 'builtin'
        ? GPC_HELPER_PHONE_MODE_AUTO
        : GPC_HELPER_PHONE_MODE_MANUAL;
    }

    function normalizeGpcOtpChannel(value = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.normalizeGpcOtpChannel) {
        return rootScope.GoPayUtils.normalizeGpcOtpChannel(value);
      }
      return String(value || '').trim().toLowerCase() === 'sms' ? 'sms' : 'whatsapp';
    }

    function resolveGpcHelperApiKey(state = {}) {
      const apiKey = String(
        state?.gopayHelperApiKey
        || state?.gpcApiKey
        || state?.apiKey
        || ''
      ).trim();
      if (!apiKey) {
        throw new Error('创建 GPC 订单失败：缺少 API Key。');
      }
      return apiKey;
    }

    function normalizeGpcHelperBaseUrl(apiUrl = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.normalizeGpcHelperBaseUrl) {
        return rootScope.GoPayUtils.normalizeGpcHelperBaseUrl(apiUrl);
      }
      let normalized = String(apiUrl || DEFAULT_GPC_HELPER_API_URL).trim().replace(/\/+$/g, '');
      normalized = normalized.replace(/\/api\/checkout\/start$/i, '');
      normalized = normalized.replace(/\/api\/gopay\/(?:otp|pin)$/i, '');
      normalized = normalized.replace(/\/api\/gp\/tasks(?:\/[^/?#]+)?(?:\/(?:otp|pin|stop))?(?:\?.*)?$/i, '');
      normalized = normalized.replace(/\/api\/gp\/balance(?:\?.*)?$/i, '');
      normalized = normalized.replace(/\/api\/card\/balance(?:\?.*)?$/i, '');
      normalized = normalized.replace(/\/api\/card\/redeem-api-key(?:\?.*)?$/i, '');
      return normalized || DEFAULT_GPC_HELPER_API_URL;
    }

    function buildGpcHelperApiUrl(apiUrl = '', path = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.buildGpcHelperApiUrl) {
        return rootScope.GoPayUtils.buildGpcHelperApiUrl(apiUrl, path);
      }
      const baseUrl = normalizeGpcHelperBaseUrl(apiUrl);
      if (!baseUrl) {
        return '';
      }
      const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
      return `${baseUrl}${normalizedPath}`;
    }

    function buildGpcTaskCreateUrl(apiUrl = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.buildGpcTaskCreateUrl) {
        return rootScope.GoPayUtils.buildGpcTaskCreateUrl(apiUrl);
      }
      return buildGpcHelperApiUrl(apiUrl, '/api/gp/tasks');
    }

    function buildGpcBalanceUrl(apiUrl = '') {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.buildGpcApiKeyBalanceUrl) {
        return rootScope.GoPayUtils.buildGpcApiKeyBalanceUrl(apiUrl);
      }
      if (rootScope.GoPayUtils?.buildGpcCardBalanceUrl) {
        return rootScope.GoPayUtils.buildGpcCardBalanceUrl(apiUrl);
      }
      return buildGpcHelperApiUrl(apiUrl, '/api/gp/balance');
    }

    function unwrapGpcResponse(payload = {}) {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.unwrapGpcResponse) {
        return rootScope.GoPayUtils.unwrapGpcResponse(payload);
      }
      if (payload && typeof payload === 'object' && !Array.isArray(payload)
        && Object.prototype.hasOwnProperty.call(payload, 'data')
        && (Object.prototype.hasOwnProperty.call(payload, 'code') || Object.prototype.hasOwnProperty.call(payload, 'message'))) {
        return payload.data ?? {};
      }
      return payload;
    }

    function isGpcUnifiedResponseOk(payload = {}) {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.isGpcUnifiedResponseOk) {
        return rootScope.GoPayUtils.isGpcUnifiedResponseOk(payload);
      }
      if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'code')) {
        return true;
      }
      const code = Number(payload.code);
      return Number.isFinite(code) ? code >= 200 && code < 300 : String(payload.code || '').trim() === '200';
    }

    function getGpcResponseErrorDetail(payload = {}, status = 0) {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.extractGpcResponseErrorDetail) {
        return rootScope.GoPayUtils.extractGpcResponseErrorDetail(payload, status);
      }
      return payload?.data?.detail || payload?.detail || payload?.message || payload?.error || `HTTP ${status || 0}`;
    }

    function getGpcRemainingUses(payload = {}) {
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      if (rootScope.GoPayUtils?.getGpcBalanceRemainingUses) {
        return rootScope.GoPayUtils.getGpcBalanceRemainingUses(payload);
      }
      const data = unwrapGpcResponse(payload);
      const numeric = Number(data?.remaining_uses ?? data?.remainingUses ?? data?.balance ?? data?.remaining);
      return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
    }

    function normalizeGpcAutoModePermissionValue(value) {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
      }
      const normalized = String(value ?? '').trim().toLowerCase();
      if (!normalized) {
        return null;
      }
      if (['true', '1', 'yes', 'y', 'on', 'enabled', 'enable'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'n', 'off', 'disabled', 'disable'].includes(normalized)) {
        return false;
      }
      return null;
    }

    function getGpcAutoModePermission(payload = {}) {
      const data = unwrapGpcResponse(payload);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return null;
      }
      return normalizeGpcAutoModePermissionValue(
        data.auto_mode_enabled
        ?? data.autoModeEnabled
        ?? data.auto_enabled
        ?? data.autoEnabled
      );
    }

    function isGpcAutoModePermissionDenied(payload = {}) {
      return getGpcAutoModePermission(payload) === false;
    }

    async function assertGpcApiKeyReadyForCreate(state = {}, phoneMode = GPC_HELPER_PHONE_MODE_MANUAL, apiKey = '') {
      const apiUrl = buildGpcBalanceUrl(state?.gopayHelperApiUrl);
      if (!apiUrl) {
        throw new Error('创建 GPC 订单失败：缺少 API 地址。');
      }
      const { response, data } = await fetchJsonWithTimeout(apiUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-API-Key': apiKey,
        },
      }, 30000);
      if (!response?.ok || !isGpcUnifiedResponseOk(data)) {
        const detail = getGpcResponseErrorDetail(data, response?.status || 0);
        throw new Error(`创建 GPC 订单失败：API Key 校验失败：${detail}`);
      }
      const balanceData = unwrapGpcResponse(data);
      const remainingUses = getGpcRemainingUses(balanceData);
      const status = String(balanceData?.status || balanceData?.card_status || balanceData?.cardStatus || '').trim().toLowerCase();
      if (status && status !== 'active') {
        throw new Error(`创建 GPC 订单失败：API Key 状态不可用（${status}）。`);
      }
      if (remainingUses !== null && remainingUses <= 0) {
        throw new Error('创建 GPC 订单失败：API Key 剩余次数不足。');
      }
      if (phoneMode === GPC_HELPER_PHONE_MODE_AUTO && isGpcAutoModePermissionDenied(balanceData)) {
        throw new Error('创建 GPC 订单失败：当前 GPC API Key 未开通自动模式。');
      }
    }

    async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
      const fetcher = typeof fetchImpl === 'function'
        ? fetchImpl
        : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
      if (typeof fetcher !== 'function') {
        throw new Error('当前运行环境不支持 fetch，无法调用 GPC API。');
      }
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const effectiveTimeoutMs = Math.max(1000, Number(timeoutMs) || 30000);
      let didTimeout = false;
      let timer = null;
      const buildTimeoutError = () => new Error(`GPC API 请求超时（>${Math.round(effectiveTimeoutMs / 1000)} 秒）：${url}`);
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          didTimeout = true;
          reject(buildTimeoutError());
          if (controller) {
            controller.abort();
          }
        }, effectiveTimeoutMs);
      });
      try {
        const response = await Promise.race([
          fetcher(url, { ...options, ...(controller ? { signal: controller.signal } : {}) }),
          timeoutPromise,
        ]);
        const data = await Promise.race([
          response.json().catch(() => ({})),
          timeoutPromise,
        ]);
        return { response, data };
      } catch (error) {
        if (didTimeout || error?.name === 'AbortError') {
          throw buildTimeoutError();
        }
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function readAccessTokenFromChatGptSessionTab(tabId) {
      await waitForTabCompleteUntilStopped(tabId);
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
        inject: PLUS_CHECKOUT_INJECT_FILES,
        injectSource: PLUS_CHECKOUT_SOURCE,
        logMessage: '步骤 6：正在等待 ChatGPT 页面完成加载，再继续获取 accessToken...',
      });

      const sessionResult = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
        type: 'PLUS_CHECKOUT_GET_STATE',
        source: 'background',
        payload: {
          includeSession: true,
          includeAccessToken: true,
        },
      });
      if (sessionResult?.error) {
        throw new Error(sessionResult.error);
      }
      return String(sessionResult?.accessToken || sessionResult?.session?.accessToken || '').trim();
    }

    async function generateGpcCheckoutFromApi(accessToken = '', state = {}) {
      const token = String(accessToken || '').trim();
      if (!token) {
        throw new Error('创建 GPC 订单失败：缺少 accessToken。');
      }
      const apiUrl = buildGpcTaskCreateUrl(state?.gopayHelperApiUrl);
      if (!apiUrl) {
        throw new Error('创建 GPC 订单失败：缺少 API 地址。');
      }
      const phoneMode = normalizeGpcHelperPhoneMode(state?.gopayHelperPhoneMode || state?.phoneMode);
      const isAutoMode = phoneMode === GPC_HELPER_PHONE_MODE_AUTO;
      const phoneNumber = String(state?.gopayHelperPhoneNumber || '').trim();
      const countryCode = normalizeHelperCountryCode(state?.gopayHelperCountryCode || '86');
      const pin = String(state?.gopayHelperPin || '').trim();
      const apiKey = resolveGpcHelperApiKey(state);
      if (!isAutoMode && !phoneNumber) {
        throw new Error('创建 GPC 订单失败：手动模式缺少手机号。');
      }
      if (!isAutoMode && !pin) {
        throw new Error('创建 GPC 订单失败：手动模式缺少 PIN。');
      }

      throwIfStopped();
      await assertGpcApiKeyReadyForCreate(state, phoneMode, apiKey);
      throwIfStopped();
      const payload = {
        access_token: token,
        phone_mode: phoneMode,
      };
      if (!isAutoMode) {
        payload.country_code = countryCode;
        payload.phone_number = normalizeHelperPhoneNumber(phoneNumber, countryCode);
        payload.otp_channel = normalizeGpcOtpChannel(state?.gopayHelperOtpChannel);
      }

      const orderCreatedAt = Date.now();
      const { response, data } = await fetchJsonWithTimeout(apiUrl, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(payload),
      }, 30000);

      const taskData = unwrapGpcResponse(data);
      const taskId = String(taskData?.task_id || taskData?.taskId || '').trim();

      if (!response?.ok || !isGpcUnifiedResponseOk(data) || !taskId) {
        const detail = getGpcResponseErrorDetail(data, response?.status || 0);
        throw new Error(`创建 GPC 订单失败：${detail}`);
      }

      return {
        taskId,
        taskStatus: String(taskData?.status || '').trim(),
        statusText: String(taskData?.status_text || taskData?.statusText || '').trim(),
        remoteStage: String(taskData?.remote_stage || taskData?.remoteStage || '').trim(),
        orderCreatedAt,
        responsePayload: taskData && typeof taskData === 'object' && !Array.isArray(taskData) ? taskData : null,
        phoneMode: normalizeGpcHelperPhoneMode(taskData?.phone_mode || taskData?.phoneMode || phoneMode),
        country: 'ID',
        currency: 'IDR',
        checkoutSource: PLUS_PAYMENT_METHOD_GPC_HELPER,
      };
    }

    async function executeGpcCheckoutCreate(state = {}) {
      let accessToken = String(state?.contributionAccessToken || state?.accessToken || state?.chatgptAccessToken || '').trim();
      if (!accessToken) {
        await addLog('步骤 6：正在获取 accessToken...', 'info');
        const tokenTabId = await openFreshChatGptTabForCheckoutCreate();
        try {
          accessToken = await readAccessTokenFromChatGptSessionTab(tokenTabId);
        } finally {
          if (chrome?.tabs?.remove && Number.isInteger(tokenTabId)) {
            await chrome.tabs.remove(tokenTabId).catch(() => {});
          }
        }
      }
      if (!accessToken) {
        throw new Error('步骤 6：GPC 模式获取 accessToken 失败。');
      }

      await addLog('步骤 6：正在调用 GPC 接口创建订单...', 'info');
      const result = await generateGpcCheckoutFromApi(accessToken, state);
      await setState({
        plusCheckoutTabId: null,
        plusCheckoutUrl: '',
        plusCheckoutCountry: result.country || 'ID',
        plusCheckoutCurrency: result.currency || 'IDR',
        plusCheckoutSource: result.checkoutSource,
        gopayHelperTaskId: result.taskId,
        gopayHelperTaskStatus: result.taskStatus,
        gopayHelperStatusText: result.statusText,
        gopayHelperRemoteStage: result.remoteStage,
        gopayHelperTaskPayload: result.responsePayload,
        gopayHelperTaskProgressSignature: '',
        gopayHelperTaskProgressAt: 0,
        gopayHelperTaskProgressTaskId: result.taskId,
        gopayHelperReferenceId: '',
        gopayHelperGoPayGuid: '',
        gopayHelperRedirectUrl: '',
        gopayHelperNextAction: '',
        gopayHelperFlowId: '',
        gopayHelperChallengeId: '',
        gopayHelperStartPayload: null,
        gopayHelperOrderCreatedAt: result.orderCreatedAt || Date.now(),
      });
      await addLog(`步骤 6：GPC ${result.phoneMode === GPC_HELPER_PHONE_MODE_AUTO ? '自动' : '手动'}模式任务已创建（task_id: ${result.taskId}），准备继续下一步。`, 'info');
      await completeNodeFromBackground('plus-checkout-create', {
        plusCheckoutCountry: result.country || 'ID',
        plusCheckoutCurrency: result.currency || 'IDR',
        plusCheckoutSource: result.checkoutSource,
      });
    }

    async function executePlusCheckoutCreate(state = {}) {
      const paymentMethod = normalizePlusPaymentMethod(state?.plusPaymentMethod);
      if (paymentMethod === PLUS_PAYMENT_METHOD_GPC_HELPER) {
        await executeGpcCheckoutCreate(state);
        return;
      }

      const paymentMethodLabel = getPlusPaymentMethodLabel(paymentMethod);
      const checkoutModeLabel = getCheckoutModeLabel(state);
      await addLog(`步骤 6：正在打开新的 ChatGPT 会话，准备创建${checkoutModeLabel}...`, 'info');
      const tabId = await openFreshChatGptTabForCheckoutCreate();

      await waitForTabCompleteUntilStopped(tabId);
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
        inject: PLUS_CHECKOUT_INJECT_FILES,
        injectSource: PLUS_CHECKOUT_SOURCE,
        logMessage: '步骤 6：正在等待 ChatGPT 页面完成加载，再继续创建订阅页...',
      });

      await addLog(
        paymentMethod === PLUS_PAYMENT_METHOD_PAYPAL
          ? '步骤 6：正在由扩展内部直连生成美国 US Stripe/外部支付链接...'
          : `步骤 6：正在由扩展内部创建${checkoutModeLabel}...`,
        'info'
      );
      const result = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
        type: 'CREATE_PLUS_CHECKOUT',
        source: 'background',
        payload: { paymentMethod },
      });

      if (result?.error) {
        throw new Error(result.error);
      }
      const targetCheckoutUrl = String(
        result?.preferredCheckoutUrl
        || result?.hostedCheckoutUrl
        || result?.hostedCheckoutBaseUrl
        || result?.convertedCheckoutUrl
        || result?.chatgptCheckoutUrl
        || result?.checkoutUrl
        || ''
      ).trim();
      if (!targetCheckoutUrl) {
        throw new Error(`步骤 6：${checkoutModeLabel}未返回可用的订阅链接。`);
      }

      await addLog(`步骤 6：${checkoutModeLabel}已创建，正在打开订阅页面...`, 'ok');
      await chrome.tabs.update(tabId, { url: targetCheckoutUrl, active: true });
      await waitForTabCompleteUntilStopped(tabId);
      const landedTab = await waitForCheckoutSurface(tabId);
      if (landedTab?.url && landedTab.url !== targetCheckoutUrl) {
        await addLog(`步骤 6：订阅页已继续跳转到 ${landedTab.url}，准备进入自动填写。`, 'info');
      }
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
        inject: PLUS_CHECKOUT_INJECT_FILES,
        injectSource: PLUS_CHECKOUT_SOURCE,
        logMessage: '步骤 6：正在等待订阅页面完成加载...',
      });

      const finalCheckoutUrl = String((landedTab?.url || targetCheckoutUrl || '')).trim();
      await setState({
        plusCheckoutTabId: tabId,
        plusCheckoutUrl: finalCheckoutUrl,
        plusCheckoutCountry: result.country || 'DE',
        plusCheckoutCurrency: result.currency || 'EUR',
        plusReturnUrl: '',
        plusCheckoutSource: targetCheckoutUrl === String(result?.convertedCheckoutUrl || '').trim()
          ? 'converted-chatgpt-checkout'
          : '',
      });

      await addLog(`步骤 6：Plus Checkout 页面已就绪（${paymentMethodLabel} / ${result.country || 'DE'} ${result.currency || 'EUR'}），准备继续下一步。`, 'info');

      if (shouldWaitForHostedCheckoutSuccess(state, paymentMethod)) {
        await addLog('步骤 6：当前 hosted checkout 流程将等待支付成功页出现后，再继续 OAuth 流程。', 'info');
        startHostedCheckoutAutomation(tabId);
        return;
      }

      await completeNodeFromBackground('plus-checkout-create', {
        plusCheckoutCountry: result.country || 'DE',
        plusCheckoutCurrency: result.currency || 'EUR',
      });
    }

    return {
      executePlusCheckoutCreate,
    };
  }

  return {
    createPlusCheckoutCreateExecutor,
  };
});
