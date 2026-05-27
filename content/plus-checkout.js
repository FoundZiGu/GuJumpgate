// content/plus-checkout.js — ChatGPT Plus checkout helper.

(function attachPlusCheckoutContentScript() {
console.log('[MultiPage:plus-checkout] Content script loaded on', location.href);
window.__MULTIPAGE_PLUS_CHECKOUT_READY__ = true;

const PLUS_CHECKOUT_LISTENER_SENTINEL = 'data-multipage-plus-checkout-listener';
const PLUS_CHECKOUT_PAYLOAD_BASE = {
  entry_point: 'all_plans_pricing_modal',
  plan_name: 'chatgptplusplan',
  promo_campaign: {
    promo_campaign_id: 'plus-1-month-free',
    is_coupon_from_query_param: false,
  },
};
const PAYPAL_DIAGNOSTIC_LOG_INTERVAL_MS = 5000;
const PLUS_CHECKOUT_DOCUMENT_COMPLETE_TIMEOUT_MS = 30000;
const HOSTED_CHECKOUT_CARD_FALLBACK_ERROR_PREFIX = 'HOSTED_CHECKOUT_CARD_FALLBACK::';
const HOSTED_CHECKOUT_CARD_DECLINED_ERROR_PREFIX = 'HOSTED_CHECKOUT_CARD_DECLINED::';
const PLUS_PAYMENT_METHOD_PAYPAL = 'paypal';
const PLUS_PAYMENT_METHOD_GOPAY = 'gopay';
const DEFAULT_CONVERTED_CHECKOUT_PROCESSOR_ENTITY = 'openai_llc';
const PAYMENT_METHOD_CONFIGS = {
  [PLUS_PAYMENT_METHOD_PAYPAL]: {
    id: PLUS_PAYMENT_METHOD_PAYPAL,
    label: 'PayPal',
    diagnosticLabel: 'PayPal',
    checkoutMerchantPath: 'openai_ie',
    billingDetails: {
      country: 'US',
      currency: 'USD',
    },
    patterns: [/paypal/i],
  },
  [PLUS_PAYMENT_METHOD_GOPAY]: {
    id: PLUS_PAYMENT_METHOD_GOPAY,
    label: 'GoPay',
    diagnosticLabel: 'GoPay',
    checkoutMerchantPath: 'openai_llc',
    billingDetails: {
      country: 'ID',
      currency: 'IDR',
    },
    patterns: [/gopay|go\s*pay/i],
  },
};

async function performOperationWithDelay(metadata, operation) {
  const rootScope = typeof window !== 'undefined' ? window : globalThis;
  const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
  return typeof gate === 'function' ? gate(metadata, operation) : operation();
}

if (document.documentElement.getAttribute(PLUS_CHECKOUT_LISTENER_SENTINEL) !== '1') {
  document.documentElement.setAttribute(PLUS_CHECKOUT_LISTENER_SENTINEL, '1');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      message.type === 'CREATE_PLUS_CHECKOUT'
      || message.type === 'FILL_PLUS_BILLING_AND_SUBMIT'
      || message.type === 'RUN_HOSTED_OPENAI_CHECKOUT_STEP'
      || message.type === 'PLUS_CHECKOUT_SELECT_PAYPAL'
      || message.type === 'PLUS_CHECKOUT_SELECT_GOPAY'
      || message.type === 'PLUS_CHECKOUT_FILL_BILLING_ADDRESS'
      || message.type === 'PLUS_CHECKOUT_FILL_ADDRESS_QUERY'
      || message.type === 'PLUS_CHECKOUT_SELECT_ADDRESS_SUGGESTION'
      || message.type === 'PLUS_CHECKOUT_ENSURE_BILLING_ADDRESS'
      || message.type === 'PLUS_CHECKOUT_CLICK_SUBSCRIBE'
      || message.type === 'PLUS_CHECKOUT_GET_STATE'
    ) {
      resetStopState();
      handlePlusCheckoutCommand(message).then((result) => {
        sendResponse({ ok: true, ...(result || {}) });
      }).catch((err) => {
        if (isStopError(err)) {
          sendResponse({ stopped: true, error: err.message });
          return;
        }
        sendResponse({ error: err.message });
      });
      return true;
    }
  });
} else {
  console.log('[MultiPage:plus-checkout] 消息监听已存在，跳过重复注册');
}

async function handlePlusCheckoutCommand(message) {
  switch (message.type) {
    case 'CREATE_PLUS_CHECKOUT':
      return createPlusCheckoutSession(message.payload || {});
    case 'FILL_PLUS_BILLING_AND_SUBMIT':
      return fillPlusBillingAndSubmit(message.payload || {});
    case 'RUN_HOSTED_OPENAI_CHECKOUT_STEP':
      return runHostedOpenAiCheckoutStep(message.payload || {});
    case 'PLUS_CHECKOUT_SELECT_PAYPAL':
      return selectPlusPayPalPaymentMethod(message.payload || {});
    case 'PLUS_CHECKOUT_SELECT_GOPAY':
      return selectPlusGoPayPaymentMethod(message.payload || {});
    case 'PLUS_CHECKOUT_FILL_BILLING_ADDRESS':
      return fillPlusBillingAddress(message.payload || {});
    case 'PLUS_CHECKOUT_FILL_ADDRESS_QUERY':
      return fillPlusAddressQuery(message.payload || {});
    case 'PLUS_CHECKOUT_SELECT_ADDRESS_SUGGESTION':
      return selectPlusAddressSuggestion(message.payload || {});
    case 'PLUS_CHECKOUT_ENSURE_BILLING_ADDRESS':
      return ensurePlusStructuredBillingAddress(message.payload || {});
    case 'PLUS_CHECKOUT_CLICK_SUBSCRIBE':
      return clickPlusSubscribe(message.payload || {});
    case 'PLUS_CHECKOUT_GET_STATE':
      return inspectPlusCheckoutState(message.payload || {});
    default:
      throw new Error(`plus-checkout.js 不处理消息：${message.type}`);
  }
}

async function waitUntil(predicate, options = {}) {
  const intervalMs = Math.max(50, Math.floor(Number(options.intervalMs) || 250));
  const label = String(options.label || '条件').trim() || '条件';
  const timeoutMs = Math.max(0, Math.floor(Number(options.timeoutMs) || 0));
  const startedAt = Date.now();
  while (true) {
    throwIfStopped();
    const value = await predicate();
    if (value) {
      return value;
    }
    if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
      throw new Error(`${label}等待超时`);
    }
    await sleep(intervalMs);
  }
}

async function waitForDocumentComplete() {
  await waitUntil(() => document.readyState === 'complete', {
    label: '页面加载完成',
    intervalMs: 200,
    timeoutMs: PLUS_CHECKOUT_DOCUMENT_COMPLETE_TIMEOUT_MS,
  });
  await sleep(1000);
}

function isHostedOpenAiCheckoutPage() {
  const host = String(location?.host || '').toLowerCase();
  return host.includes('pay.openai.com') || host.includes('checkout.stripe.com');
}

let hostedOpenAiAutocompleteObserver = null;

function hideHostedOpenAiAutocomplete() {
  const selectors = [
    '.AddressAutocomplete-results',
    '[class*="AddressAutocomplete"]',
    '#billing-address-autocomplete-results',
  ];
  document.querySelectorAll(selectors.join(', ')).forEach((node) => {
    try {
      node.style.setProperty('display', 'none', 'important');
      node.style.setProperty('visibility', 'hidden', 'important');
      node.style.setProperty('pointer-events', 'none', 'important');
      node.style.setProperty('height', '0', 'important');
      node.style.setProperty('overflow', 'hidden', 'important');
    } catch {
      // Ignore readonly style failures.
    }
  });
}

function startHostedOpenAiAutocompleteObserver() {
  if (hostedOpenAiAutocompleteObserver || !isHostedOpenAiCheckoutPage()) {
    return;
  }
  hostedOpenAiAutocompleteObserver = new MutationObserver(() => {
    hideHostedOpenAiAutocomplete();
  });
  hostedOpenAiAutocompleteObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
  });
}

function stopHostedOpenAiAutocompleteObserver() {
  if (!hostedOpenAiAutocompleteObserver) {
    return;
  }
  hostedOpenAiAutocompleteObserver.disconnect();
  hostedOpenAiAutocompleteObserver = null;
}

function hasHostedOpenAiCaptcha() {
  return Boolean(
    document.querySelector('iframe[name="recaptcha"]')
    || document.getElementById('captchaHeading')
    || document.querySelector('#captcha-standalone')
    || document.querySelector('form[action="/auth/validatecaptcha"]')
  );
}

function removeHostedOpenAiCaptcha() {
  let removed = false;
  const selectors = [
    '#captcha-standalone',
    '.captcha-overlay',
    '.captcha-container',
  ];
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      try {
        node.remove();
        removed = true;
      } catch {
        // Ignore readonly nodes.
      }
    });
  });
  return removed;
}

function hasHostedOpenAiVerificationPopup() {
  return Boolean(document.getElementById('ci-ciBasic-0'));
}

function fillHostedOpenAiInputById(id, value) {
  const input = document.getElementById(String(id || '').trim());
  if (!input) {
    return false;
  }
  fillInput(input, String(value || ''));
  return true;
}

function fillHostedOpenAiInputBySelector(selector, value) {
  const input = document.querySelector(String(selector || '').trim());
  if (!input) {
    return false;
  }
  fillInput(input, String(value || ''));
  return true;
}

function fillHostedOpenAiSelectByIdText(id, text) {
  const select = document.getElementById(String(id || '').trim());
  const expected = normalizeText(text);
  if (!select || !expected) {
    return false;
  }
  const match = Array.from(select.options || []).find((option) => {
    const optionText = normalizeText(option?.textContent || option?.label || '');
    const optionValue = normalizeText(option?.value || '');
    return optionText.toLowerCase().includes(expected.toLowerCase())
      || optionValue.toLowerCase().includes(expected.toLowerCase());
  });
  if (!match) {
    return false;
  }
  select.value = match.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function findHostedOpenAiPayPalButton() {
  return document.querySelector('[data-testid="paypal-accordion-item-button"]')
    || document.querySelector('.paypal-accordion-item button');
}

function hasHostedOpenAiPaypalDisabledSignals() {
  const frames = Array.from(document.querySelectorAll('iframe'));
  return frames.some((frame) => {
    const src = String(frame?.getAttribute?.('src') || frame?.src || '');
    return src.includes('paymentMethods][paypal]=never')
      || src.includes('wallets][paypal]=never');
  });
}

function isHostedOpenAiCardAccordionSelected() {
  const selectors = [
    '[data-testid="card-accordion-item"]',
    '.card-accordion-item',
    '[data-testid="card-accordion-item-button"]',
  ];
  return selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some((el) => {
    if (!isVisibleElement(el) && !el.closest?.('[data-testid="card-accordion-item"]')) {
      return false;
    }
    const text = getCombinedSearchText(el);
    const className = String(el.className || el.getAttribute?.('class') || '');
    const current = el.getAttribute?.('aria-current');
    return /card|银行卡|卡号|cvc|expiry|有效期/i.test(text)
      || /\bselected\b/i.test(className)
      || current === 'true'
      || current === 'page'
      || hasPaymentMethodSelectionMarker(el);
  }));
}

function getHostedOpenAiCardFallbackState() {
  if (!isHostedOpenAiCheckoutPage()) {
    return {
      fallback: false,
      reason: '',
      reasons: [],
    };
  }

  const hasPayPalButton = Boolean(findHostedOpenAiPayPalButton());
  const hasPayPalTarget = Boolean(findPayPalPaymentMethodTarget());
  const hasGoPayTarget = Boolean(findGoPayPaymentMethodTarget());
  const cardFieldsVisible = hasCreditCardFields();
  const cardAccordionSelected = isHostedOpenAiCardAccordionSelected();
  const paypalDisabledSignals = hasHostedOpenAiPaypalDisabledSignals();
  const paymentTextPreview = getPaymentTextPreview(12);
  const cardPreview = paymentTextPreview.find((text) => /银行卡|card|cardholder|cvc|expiry|有效期|security/i.test(text)) || '';
  const reasons = [];

  if (!hasPayPalButton) reasons.push('未找到 PayPal 按钮');
  if (!hasPayPalTarget) reasons.push('未识别到 PayPal 付款方式');
  if (!hasGoPayTarget) reasons.push('未识别到 GoPay 付款方式');
  if (cardFieldsVisible) reasons.push('银行卡字段可见');
  if (cardAccordionSelected) reasons.push('银行卡卡片已选中');
  if (paypalDisabledSignals) reasons.push('页面信号显示 paypal=never');
  if (cardPreview) reasons.push(`支付文案包含“${cardPreview.slice(0, 40)}”`);

  const fallback = !hasPayPalButton
    && !hasPayPalTarget
    && !hasGoPayTarget
    && cardFieldsVisible
    && (cardAccordionSelected || paypalDisabledSignals || Boolean(cardPreview));

  return {
    fallback,
    reason: reasons.join('；'),
    reasons,
    hasPayPalButton,
    hasPayPalTarget,
    hasGoPayTarget,
    cardFieldsVisible,
    cardAccordionSelected,
    paypalDisabledSignals,
    cardPreview,
  };
}

function findHostedOpenAiSubmitButton() {
  const direct = document.querySelector('button[data-testid="submit-button"]')
    || document.querySelector('button[data-testid="hosted-payment-submit-button"]')
    || document.querySelector('button[data-atomic-wait-intent="Submit_Email"]')
    || document.querySelector('button.SubmitButton--complete');
  if (direct) {
    return direct;
  }
  const buttons = Array.from(document.querySelectorAll('button'));
  return buttons.find((button) => {
    const text = normalizeText(button.textContent || '');
    return text === '下一页'
      || text === 'Next'
      || text === 'Pay'
      || text === 'Continue'
      || text === 'Agree'
      || text.toLowerCase().includes('subscribe');
  }) || null;
}

function getHostedOpenAiAddressErrorState() {
  if (!isHostedOpenAiCheckoutPage() || typeof document?.querySelectorAll !== 'function') {
    return {
      hasError: false,
      message: '',
    };
  }

  const selectors = [
    '[role="alert"]',
    '[aria-live]',
    '.Alert',
    '.Error',
    '.error',
    '.FieldError',
    '[class*="error"]',
    '[class*="Error"]',
    'div',
    'span',
    'p',
  ];
  const pattern = /customer'?s\s+location\s+isn'?t\s+recognized|set\s+a\s+valid\s+customer\s+address|automatically\s+calculate\s+tax|valid\s+customer\s+address|无法识别.*地址|地址.*无法识别|税.*地址/i;
  const seen = new Set();
  for (const element of Array.from(document.querySelectorAll(selectors.join(', ')))) {
    if (!element || seen.has(element) || !isVisibleElement(element)) {
      continue;
    }
    seen.add(element);
    const text = normalizeText(element.innerText || element.textContent || '');
    if (!text || !pattern.test(text)) {
      continue;
    }
    return {
      hasError: true,
      message: text.slice(0, 240),
    };
  }

  return {
    hasError: false,
    message: '',
  };
}

function getHostedOpenAiCardDeclinedState() {
  if (!isHostedOpenAiCheckoutPage() || typeof document?.querySelectorAll !== 'function') {
    return {
      hasError: false,
      message: '',
    };
  }

  const selectors = [
    '[role="alert"]',
    '[aria-live]',
    '.Alert',
    '.Error',
    '.error',
    '.FieldError',
    '[class*="error"]',
    '[class*="Error"]',
    'div',
    'span',
    'p',
  ];
  const pattern = /(?:bank\s*)?card\s+(?:was\s+)?declined|try\s+another\s+card|payment\s+method\s+was\s+declined|银行卡被拒绝|请尝试另一张卡|请尝试另一张银行卡|您的银行卡被拒绝/i;
  const seen = new Set();
  for (const element of Array.from(document.querySelectorAll(selectors.join(', ')))) {
    if (!element || seen.has(element) || !isVisibleElement(element)) {
      continue;
    }
    seen.add(element);
    const text = normalizeText(element.innerText || element.textContent || '');
    if (!text || !pattern.test(text)) {
      continue;
    }
    return {
      hasError: true,
      message: text.slice(0, 240),
    };
  }

  return {
    hasError: false,
    message: '',
  };
}

function dispatchHostedOpenAiClick(button) {
  const rect = button.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const eventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
  };
  button.dispatchEvent(new PointerEvent('pointerdown', eventInit));
  button.dispatchEvent(new MouseEvent('mousedown', eventInit));
  button.dispatchEvent(new PointerEvent('pointerup', eventInit));
  button.dispatchEvent(new MouseEvent('mouseup', eventInit));
  button.dispatchEvent(new MouseEvent('click', eventInit));
}

async function clickHostedOpenAiSubmitButton(retries = 0) {
  if (hasHostedOpenAiCaptcha()) {
    removeHostedOpenAiCaptcha();
  }
  const button = findHostedOpenAiSubmitButton();
  if (!button) {
    if (retries >= 10) {
      throw new Error('hosted checkout 页面未找到可点击的提交按钮。');
    }
    await sleep(1000);
    return clickHostedOpenAiSubmitButton(retries + 1);
  }

  const buttonText = normalizeText(button.textContent || '');
  if (button.disabled) {
    if (retries >= 10) {
      throw new Error('hosted checkout 页面提交按钮长时间处于 disabled 状态。');
    }
    await sleep(1000);
    return clickHostedOpenAiSubmitButton(retries + 1);
  }

  const rect = button.getBoundingClientRect();
  if (rect.height === 0) {
    if (retries >= 10) {
      throw new Error('hosted checkout 页面提交按钮长时间不可见。');
    }
    await sleep(1000);
    return clickHostedOpenAiSubmitButton(retries + 1);
  }

  stopHostedOpenAiAutocompleteObserver();
  hideHostedOpenAiAutocomplete();
  document.activeElement?.blur?.();
  dispatchHostedOpenAiClick(button);
  await sleep(1000);

  startHostedOpenAiAutocompleteObserver();
  hideHostedOpenAiAutocomplete();
  if (hasHostedOpenAiCaptcha()) {
    removeHostedOpenAiCaptcha();
  }
  if (hasHostedOpenAiVerificationPopup()) {
    return {
      clicked: true,
      verificationPopupVisible: true,
      buttonText,
    };
  }

  const currentText = normalizeText(button.textContent || '');
  if (!/processing/i.test(currentText) && currentText === buttonText) {
    if (retries >= 10) {
      return {
        clicked: true,
        verificationPopupVisible: false,
        buttonText,
        retried: true,
      };
    }
    await sleep(2000);
    return clickHostedOpenAiSubmitButton(retries + 1);
  }

  return {
    clicked: true,
    verificationPopupVisible: false,
    buttonText,
  };
}

async function fillHostedOpenAiVerificationCode(verificationCode = '') {
  const code = String(verificationCode || '').replace(/\D+/g, '').slice(0, 6);
  if (code.length !== 6) {
    throw new Error('hosted checkout OpenAI 验证码无效。');
  }
  for (let index = 0; index < 6; index += 1) {
    if (!fillHostedOpenAiInputById(`ci-ciBasic-${index}`, code[index] || '')) {
      throw new Error('hosted checkout OpenAI 页面未找到完整的验证码输入框。');
    }
  }
  return {
    verificationPopupVisible: true,
    verificationCodeFilled: true,
  };
}

async function runHostedOpenAiCheckoutStep(payload = {}) {
  await waitForDocumentComplete();
  if (!isHostedOpenAiCheckoutPage()) {
    throw new Error('当前页面不是 hosted checkout OpenAI/Stripe 页面。');
  }

  startHostedOpenAiAutocompleteObserver();
  hideHostedOpenAiAutocomplete();
  removeHostedOpenAiCaptcha();

  if (payload.verificationCode) {
    return fillHostedOpenAiVerificationCode(payload.verificationCode);
  }

  const amountSummary = getCheckoutAmountSummary();
  if (amountSummary?.hasTodayDue && !amountSummary.isZero) {
    const amountLabel = amountSummary.rawAmount || (
      Number.isFinite(Number(amountSummary.amount)) ? String(amountSummary.amount) : '未知金额'
    );
    throw new Error(`PLUS_CHECKOUT_NON_FREE_TRIAL::步骤 6：检测到今日应付金额不是 0（${amountLabel}），当前账号没有免费试用资格，已自动停止整个流程。`);
  }

  const cardFallbackState = getHostedOpenAiCardFallbackState();
  if (cardFallbackState.fallback) {
    throw new Error(
      `${HOSTED_CHECKOUT_CARD_FALLBACK_ERROR_PREFIX}步骤 6：当前 hosted checkout 落到银行卡分支，未进入 PayPal。${cardFallbackState.reason || '页面仅展示银行卡支付。'}`
    );
  }

  await sleep(2000);
  const payPalButton = findHostedOpenAiPayPalButton();
  if (payPalButton) {
    simulateClick(payPalButton);
    await sleep(500);
    simulateClick(payPalButton);
  }

  await sleep(3000);

  const contactEmail = String(payload.email || payload.registrationEmail || '').trim();
  const emailFillResult = await fillCheckoutContactEmail(contactEmail);
  const address = payload.address && typeof payload.address === 'object' ? payload.address : {};
  await selectCountryDropdown(findCountryDropdown(), 'US');
  fillHostedOpenAiInputBySelector('#billingAddressLine1', address.street || '');
  fillHostedOpenAiInputBySelector('#billingLocality', address.city || '');
  fillHostedOpenAiInputBySelector('#billingPostalCode', address.zip || '');
  fillHostedOpenAiSelectByIdText('billingAdministrativeArea', address.state || '');

  const checkbox = document.getElementById('termsOfServiceConsentCheckbox');
  if (checkbox && !checkbox.checked) {
    simulateClick(checkbox);
  }

  document.activeElement?.blur?.();
  for (let count = 0; count < 10; count += 1) {
    hideHostedOpenAiAutocomplete();
    await sleep(300);
  }

  await sleep(3500);
  const clickResult = await clickHostedOpenAiSubmitButton(0);
  const hostedAddressError = getHostedOpenAiAddressErrorState();
  const hostedCardDeclinedError = getHostedOpenAiCardDeclinedState();
  return {
    ...clickResult,
    contactEmail,
    emailFillResult,
    hostedVerificationVisible: hasHostedOpenAiVerificationPopup(),
    hostedAddressError: hostedAddressError.hasError,
    hostedAddressErrorMessage: hostedAddressError.message,
    hostedCardDeclinedError: hostedCardDeclinedError.hasError,
    hostedCardDeclinedErrorMessage: hostedCardDeclinedError.message,
  };
}

function isVisibleElement(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(rect.width) > 0
    && Number(rect.height) > 0;
}

function normalizeText(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function parseLocalizedAmount(rawValue = '') {
  const raw = normalizeText(rawValue);
  const match = raw.match(/(?:[$€£¥]\s*)?([+-]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})|[+-]?\d+(?:[.,]\d{1,2})?)(?:\s*[$€£¥])?/);
  if (!match) return null;
  let numericText = String(match[1] || '').trim();
  const lastComma = numericText.lastIndexOf(',');
  const lastDot = numericText.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    numericText = numericText
      .replace(new RegExp(`\\${thousandsSeparator}`, 'g'), '')
      .replace(decimalSeparator, '.');
  } else if (lastComma > -1) {
    numericText = numericText.replace(',', '.');
  }
  const amount = Number(numericText.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(amount)
    ? {
        amount,
        raw: match[0],
      }
    : null;
}

function getTextAfterTodayDueLabel(text = '') {
  const normalized = normalizeText(text);
  const match = normalized.match(/(?:今日应付金额|今日应付|今天应付|amount\s*due\s*today|due\s*today|today'?s\s*total|total\s*due\s*today)/i);
  if (!match) return '';
  return normalized.slice((match.index || 0) + match[0].length).trim();
}

function getHostedCheckoutTotalAmountSummary() {
  if (!isHostedOpenAiCheckoutPage() || typeof document?.querySelector !== 'function') {
    return null;
  }

  const selectors = [
    '#OrderDetails-TotalAmount .CurrencyAmount',
    '#OrderDetails-TotalAmount',
    '#ProductSummary-totalAmount .CurrencyAmount',
    '#ProductSummary-totalAmount',
  ];
  const seenElements = new Set();
  const parsedEntries = [];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element || seenElements.has(element)) {
      continue;
    }
    seenElements.add(element);
    const text = normalizeText(element.innerText || element.textContent || '');
    if (!text) {
      continue;
    }
    const parsed = parseLocalizedAmount(text);
    if (!parsed) {
      continue;
    }
    parsedEntries.push({
      selector,
      amount: parsed.amount,
      rawAmount: text,
    });
  }

  if (!parsedEntries.length) {
    return null;
  }

  const nonZeroEntry = parsedEntries.find((entry) => Math.abs(Number(entry.amount) || 0) >= 0.005) || null;
  const chosenEntry = nonZeroEntry || parsedEntries[0];
  const isZero = parsedEntries.every((entry) => Math.abs(Number(entry.amount) || 0) < 0.005);
  return {
    hasTodayDue: true,
    amount: Number(chosenEntry.amount) || 0,
    isZero,
    rawAmount: chosenEntry.rawAmount || '',
    labelText: 'hosted checkout total amount',
  };
}

function getCheckoutAmountSummary() {
  const hostedSummary = getHostedCheckoutTotalAmountSummary();
  if (hostedSummary) {
    return hostedSummary;
  }

  const elements = getVisibleControls('div, span, p, strong, b');
  const labelPattern = /今日应付金额|今日应付|今天应付|amount\s*due\s*today|due\s*today|today'?s\s*total|total\s*due\s*today/i;
  const amountPattern = /[$€£¥]\s*[+-]?\d|[+-]?\d+(?:[.,]\d{1,2})?\s*[$€£¥]/;

  for (const element of elements) {
    const text = normalizeText(element.innerText || element.textContent || '');
    if (!labelPattern.test(text)) continue;

    const candidates = [];
    const afterLabelText = getTextAfterTodayDueLabel(text);
    if (afterLabelText) candidates.push(afterLabelText);

    const parent = element.parentElement;
    if (parent) {
      for (const child of Array.from(parent.children || [])) {
        if (child === element) continue;
        const childText = normalizeText(child.innerText || child.textContent || '');
        if (amountPattern.test(childText)) {
          candidates.push(childText);
        }
      }
      const parentAfterLabelText = getTextAfterTodayDueLabel(parent.innerText || parent.textContent || '');
      if (parentAfterLabelText) candidates.push(parentAfterLabelText);
    }

    const grandparent = parent?.parentElement;
    if (grandparent) {
      const grandparentAfterLabelText = getTextAfterTodayDueLabel(grandparent.innerText || grandparent.textContent || '');
      if (grandparentAfterLabelText) candidates.push(grandparentAfterLabelText);
    }

    for (const candidate of candidates) {
      const parsed = parseLocalizedAmount(candidate);
      if (!parsed) continue;
      return {
        hasTodayDue: true,
        amount: parsed.amount,
        isZero: Math.abs(parsed.amount) < 0.005,
        rawAmount: parsed.raw,
        labelText: text.slice(0, 160),
      };
    }

    return {
      hasTodayDue: true,
      amount: null,
      isZero: false,
      rawAmount: '',
      labelText: text.slice(0, 160),
    };
  }

  return {
    hasTodayDue: false,
    amount: null,
    isZero: false,
    rawAmount: '',
    labelText: '',
  };
}

function getActionText(el) {
  return normalizeText([
    el?.textContent,
    el?.value,
    el?.getAttribute?.('aria-label'),
    el?.getAttribute?.('aria-labelledby'),
    el?.getAttribute?.('title'),
    el?.getAttribute?.('placeholder'),
    el?.getAttribute?.('name'),
    el?.getAttribute?.('autocomplete'),
    el?.getAttribute?.('data-elements-stable-field-name'),
    el?.getAttribute?.('data-field'),
    el?.getAttribute?.('data-field-name'),
    el?.id,
  ].filter(Boolean).join(' '));
}

function getSearchText(el) {
  const datasetValues = el?.dataset ? Object.values(el.dataset) : [];
  return normalizeText([
    getActionText(el),
    el?.getAttribute?.('alt'),
    el?.getAttribute?.('role'),
    el?.getAttribute?.('data-testid'),
    el?.getAttribute?.('src'),
    el?.getAttribute?.('href'),
    el?.getAttribute?.('xlink:href'),
    typeof el?.className === 'string' ? el.className : el?.getAttribute?.('class'),
    ...datasetValues,
  ].filter(Boolean).join(' '));
}

function getFieldText(el) {
  const id = el?.id || '';
  const labels = [];
  if (id) {
    labels.push(...Array.from(document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)).map((label) => label.textContent));
  }
  const wrappingLabel = el?.closest?.('label');
  if (wrappingLabel) {
    labels.push(wrappingLabel.textContent);
  }
  const container = el?.closest?.('[data-testid], [class], div, section, fieldset');
  if (container) {
    labels.push(container.textContent);
  }
  return normalizeText([
    getActionText(el),
    ...labels,
  ].filter(Boolean).join(' '));
}

function getCombinedSearchText(el) {
  return normalizeText([
    getSearchText(el),
    getFieldText(el),
  ].filter(Boolean).join(' '));
}

function getVisibleControls(selector) {
  return Array.from(document.querySelectorAll(selector)).filter(isVisibleElement);
}

function getVisibleCheckboxCandidates() {
  const seen = new Set();
  const candidates = [];
  for (const el of getVisibleControls('input[type="checkbox"], [role="checkbox"], label')) {
    const key = `${String(el.tagName || '').toLowerCase()}:${el.id || ''}:${getCombinedSearchText(el)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(el);
  }
  return candidates;
}

function findClickableByText(patterns) {
  const normalizedPatterns = (Array.isArray(patterns) ? patterns : [patterns])
    .filter(Boolean);
  const candidates = getVisibleControls('button, a, [role="button"], [role="tab"], input[type="button"], input[type="submit"], [tabindex]');
  return candidates.find((el) => {
    const text = getCombinedSearchText(el);
    return normalizedPatterns.some((pattern) => pattern.test(text));
  }) || null;
}

function isEnabledControl(el) {
  return Boolean(el)
    && !el.disabled
    && el.getAttribute?.('aria-disabled') !== 'true';
}

function getVisibleTextInputs() {
  return getVisibleControls('input, textarea')
    .filter((el) => {
      const type = String(el.getAttribute('type') || el.type || '').trim().toLowerCase();
      return !['hidden', 'checkbox', 'radio', 'submit', 'button', 'file'].includes(type);
    });
}

function findInputByFieldText(patterns, options = {}) {
  const inputs = getVisibleTextInputs();
  const excluded = options.exclude || (() => false);
  return inputs.find((input) => {
    if (excluded(input)) return false;
    const text = getFieldText(input);
    return patterns.some((pattern) => pattern.test(text));
  }) || null;
}

function getDirectFieldHintText(el) {
  const id = el?.id || '';
  const labels = [];
  if (id) {
    labels.push(...Array.from(document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)).map((label) => label.textContent));
  }
  const wrappingLabel = el?.closest?.('label');
  if (wrappingLabel) {
    labels.push(wrappingLabel.textContent);
  }
  return normalizeText([
    getActionText(el),
    ...labels,
  ].filter(Boolean).join(' '));
}

function isNonAddressSearchInput(input) {
  const directText = getDirectFieldHintText(input);
  const type = String(input?.getAttribute?.('type') || input?.type || '').trim().toLowerCase();
  return /name|email|e-mail|phone|tel|password|coupon|promo|country|region|postal|zip|city|state|province|card|card\s*number|expiry|expiration|security|cvc|cvv|cc-/i.test(directText)
    || ['email', 'tel', 'password'].includes(type);
}

function isDocumentLevelContainer(el) {
  return !el
    || el === document.documentElement
    || el === document.body
    || ['HTML', 'BODY', 'MAIN'].includes(el.tagName);
}

function isPaymentCardSized(el) {
  if (!isVisibleElement(el) || isDocumentLevelContainer(el)) return false;
  const rect = el.getBoundingClientRect();
  const maxWidth = Math.max(320, Math.min(window.innerWidth * 0.95, 900));
  const maxHeight = Math.max(140, Math.min(window.innerHeight * 0.45, 320));
  return rect.width >= 64
    && rect.height >= 28
    && rect.width <= maxWidth
    && rect.height <= maxHeight;
}

function findInteractiveAncestor(el) {
  let current = el;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    if (!isVisibleElement(current) || isDocumentLevelContainer(current)) continue;
    if (current.matches?.('button, a, label, [role="button"], [role="radio"], [role="tab"], input[type="radio"], [tabindex]')) {
      return current;
    }
  }
  return null;
}

function findPaymentCardAncestor(el, pattern) {
  let current = el;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    if (!isVisibleElement(current)) continue;
    if (isDocumentLevelContainer(current)) break;
    const text = getSearchText(current);
    if (pattern.test(text) && isPaymentCardSized(current)) {
      return current;
    }
  }
  return null;
}

function normalizePlusPaymentMethod(value = '') {
  return String(value || '').trim().toLowerCase() === PLUS_PAYMENT_METHOD_GOPAY
    ? PLUS_PAYMENT_METHOD_GOPAY
    : PLUS_PAYMENT_METHOD_PAYPAL;
}

function getPaymentMethodConfig(method = PLUS_PAYMENT_METHOD_PAYPAL) {
  return PAYMENT_METHOD_CONFIGS[normalizePlusPaymentMethod(method)] || PAYMENT_METHOD_CONFIGS[PLUS_PAYMENT_METHOD_PAYPAL];
}

function getAncestorChainSummary(el, limit = 6) {
  const chain = [];
  let current = el;
  for (let depth = 0; current && depth < limit; depth += 1, current = current.parentElement) {
    if (isDocumentLevelContainer(current)) break;
    const rect = current.getBoundingClientRect();
    chain.push({
      tag: String(current.tagName || '').toLowerCase(),
      role: current.getAttribute?.('role') || '',
      id: current.id || '',
      className: typeof current.className === 'string' ? current.className.slice(0, 120) : '',
      testId: current.getAttribute?.('data-testid') || '',
      ariaLabel: current.getAttribute?.('aria-label') || '',
      ariaChecked: current.getAttribute?.('aria-checked') || '',
      ariaSelected: current.getAttribute?.('aria-selected') || '',
      rect: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      text: getCombinedSearchText(current).slice(0, 180),
    });
  }
  return chain;
}

function getPaymentMethodSearchCandidates(method = PLUS_PAYMENT_METHOD_PAYPAL) {
  const config = getPaymentMethodConfig(method);
  const selector = [
    'button',
    'a',
    'label',
    '[role="button"]',
    '[role="radio"]',
    '[role="tab"]',
    'input[type="radio"]',
    '[tabindex]',
    '[data-testid]',
    '[aria-label]',
    '[title]',
    'img',
    'svg',
    'span',
    'div',
  ].join(', ');

  return getVisibleControls(selector)
    .filter((el) => {
      const text = getCombinedSearchText(el);
      return config.patterns.some((pattern) => pattern.test(text));
    })
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
    });
}

function getPayPalSearchCandidates() {
  return getPaymentMethodSearchCandidates(PLUS_PAYMENT_METHOD_PAYPAL);
}

function getGoPaySearchCandidates() {
  return getPaymentMethodSearchCandidates(PLUS_PAYMENT_METHOD_GOPAY);
}

function findPaymentMethodTarget(method = PLUS_PAYMENT_METHOD_PAYPAL) {
  const config = getPaymentMethodConfig(method);
  const directClickable = findClickableByText(config.patterns);
  if (directClickable) {
    return directClickable;
  }

  const radios = getVisibleControls('input[type="radio"], [role="radio"]');
  const matchedRadio = radios.find((el) => config.patterns.some((pattern) => pattern.test(getCombinedSearchText(el))));
  if (matchedRadio) {
    return matchedRadio;
  }

  const candidates = getPaymentMethodSearchCandidates(method);
  for (const candidate of candidates) {
    const interactive = findInteractiveAncestor(candidate);
    if (interactive && config.patterns.some((pattern) => pattern.test(getCombinedSearchText(interactive)))) {
      return interactive;
    }
    const card = config.patterns
      .map((pattern) => findPaymentCardAncestor(candidate, pattern))
      .find(Boolean);
    if (card) {
      return card;
    }
  }

  return null;
}

function findPayPalPaymentMethodTarget() {
  return findPaymentMethodTarget(PLUS_PAYMENT_METHOD_PAYPAL);
}

function findGoPayPaymentMethodTarget() {
  return findPaymentMethodTarget(PLUS_PAYMENT_METHOD_GOPAY);
}

function summarizeElementForDebug(el) {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    tag: String(el.tagName || '').toLowerCase(),
    role: el.getAttribute?.('role') || '',
    text: getSearchText(el).slice(0, 160),
    rect: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
    chain: getAncestorChainSummary(el, 3),
  };
}

function getPaymentMethodCandidateSummaries(method = PLUS_PAYMENT_METHOD_PAYPAL, limit = 6) {
  return getPaymentMethodSearchCandidates(method)
    .map(summarizeElementForDebug)
    .filter(Boolean)
    .slice(0, limit);
}

function getPayPalCandidateSummaries(limit = 6) {
  return getPaymentMethodCandidateSummaries(PLUS_PAYMENT_METHOD_PAYPAL, limit);
}

function getGoPayCandidateSummaries(limit = 6) {
  return getPaymentMethodCandidateSummaries(PLUS_PAYMENT_METHOD_GOPAY, limit);
}

function getPaymentTextPreview(limit = 10) {
  const seen = new Set();
  const pattern = /gopay|go\s*pay|paypal|card|payment|billing|subscribe|pay|银行卡|付款|支付|账单|订阅/i;
  return getVisibleControls('button, a, label, [role="button"], [role="radio"], input[type="radio"], input[type="button"], input[type="submit"], [data-testid]')
    .map((el) => getCombinedSearchText(el))
    .filter((text) => text && pattern.test(text))
    .map((text) => text.slice(0, 180))
    .filter((text) => {
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .slice(0, limit);
}

function getPayPalDiagnostics(reason = '') {
  return getPaymentMethodDiagnostics(PLUS_PAYMENT_METHOD_PAYPAL, reason);
}

function getGoPayDiagnostics(reason = '') {
  return getPaymentMethodDiagnostics(PLUS_PAYMENT_METHOD_GOPAY, reason);
}

function getPaymentMethodDiagnostics(method = PLUS_PAYMENT_METHOD_PAYPAL, reason = '') {
  const config = getPaymentMethodConfig(method);
  return {
    reason,
    url: location.href,
    readyState: document.readyState,
    paymentMethod: config.id,
    paymentMethodLabel: config.label,
    paymentCandidates: getPaymentMethodCandidateSummaries(config.id),
    paypalCandidates: getPayPalCandidateSummaries(),
    gopayCandidates: getGoPayCandidateSummaries(),
    paymentTextPreview: getPaymentTextPreview(),
    cardFieldsVisible: hasCreditCardFields(),
    billingFieldsVisible: hasBillingAddressFields(),
  };
}

function writePaymentMethodDiagnostics(method = PLUS_PAYMENT_METHOD_PAYPAL, reason = '', level = 'info') {
  const config = getPaymentMethodConfig(method);
  const diagnostics = getPaymentMethodDiagnostics(config.id, reason);
  const writer = typeof console[level] === 'function' ? console[level] : console.info;
  writer.call(console, `[MultiPage:plus-checkout] ${config.diagnosticLabel} diagnostics`, diagnostics);
  log(`Plus Checkout：${reason}。${config.label} 候选 ${diagnostics.paymentCandidates.length} 个，银行卡字段${diagnostics.cardFieldsVisible ? '仍可见' : '不可见'}。`, level === 'error' ? 'error' : 'warn');
  return diagnostics;
}

function writePayPalDiagnostics(reason, level = 'info') {
  return writePaymentMethodDiagnostics(PLUS_PAYMENT_METHOD_PAYPAL, reason, level);
}

function writeGoPayDiagnostics(reason, level = 'info') {
  return writePaymentMethodDiagnostics(PLUS_PAYMENT_METHOD_GOPAY, reason, level);
}

function buildPlusCheckoutPayload(paymentMethod = PLUS_PAYMENT_METHOD_PAYPAL) {
  const config = getPaymentMethodConfig(paymentMethod);
  return {
    ...JSON.parse(JSON.stringify(PLUS_CHECKOUT_PAYLOAD_BASE)),
    checkout_ui_mode: paymentMethod === PLUS_PAYMENT_METHOD_PAYPAL ? 'hosted' : 'custom',
    billing_details: {
      ...config.billingDetails,
    },
  };
}

function buildPlusCheckoutUrl(checkoutSessionId, paymentMethod = PLUS_PAYMENT_METHOD_PAYPAL) {
  const sessionId = String(checkoutSessionId || '').trim();
  if (!sessionId) {
    throw new Error('创建 Plus Checkout 失败：未返回 checkout_session_id。');
  }
  const config = getPaymentMethodConfig(paymentMethod);
  return `https://chatgpt.com/checkout/${config.checkoutMerchantPath}/${sessionId}`;
}

function buildConvertedChatGptCheckoutUrl(checkoutSessionId, processorEntity = DEFAULT_CONVERTED_CHECKOUT_PROCESSOR_ENTITY) {
  const sessionId = String(checkoutSessionId || '').trim();
  const entity = String(processorEntity || '').trim() || DEFAULT_CONVERTED_CHECKOUT_PROCESSOR_ENTITY;
  if (!sessionId) {
    throw new Error('创建 Plus Checkout 失败：未返回 checkout_session_id。');
  }
  return `https://chatgpt.com/checkout/${entity}/${sessionId}`;
}

function findHostedCheckoutUrl(payload = {}) {
  const stack = [payload];
  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const value of Object.values(current)) {
      if (typeof value === 'string' && /^https:\/\/(?:pay\.openai\.com|checkout\.stripe\.com)\/c\/pay\//i.test(value.trim())) {
        return value.trim();
      }
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
  return '';
}

async function createPlusCheckoutSession(options = {}) {
  await waitForDocumentComplete();
  log('Plus：正在读取 ChatGPT 登录会话...');

  const sessionResponse = await fetch('/api/auth/session', {
    credentials: 'include',
  });
  const session = await sessionResponse.json().catch(() => ({}));
  const accessToken = session?.accessToken;
  if (!accessToken) {
    throw new Error('请先登录 ChatGPT，当前页面未返回可用 accessToken。');
  }

  log('Plus：正在创建 checkout 会话...');
  const paymentMethod = normalizePlusPaymentMethod(options.paymentMethod);
  const checkoutPayload = buildPlusCheckoutPayload(paymentMethod);
  const response = await fetch('https://chatgpt.com/backend-api/payments/checkout', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(checkoutPayload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.checkout_session_id) {
    const detail = data?.detail || data?.message || `HTTP ${response.status}`;
    throw new Error(`创建 Plus Checkout 失败：${detail}`);
  }
  const config = getPaymentMethodConfig(paymentMethod);
  // Follow the local extractor script's default conversion target explicitly:
  // we only rely on checkout_session_id here and default processor_entity to
  // openai_llc instead of reusing any provider-specific short checkout path.
  const processorEntity = DEFAULT_CONVERTED_CHECKOUT_PROCESSOR_ENTITY;
  const hostedCheckoutUrl = findHostedCheckoutUrl(data);
  const chatgptCheckoutUrl = buildConvertedChatGptCheckoutUrl(data.checkout_session_id, processorEntity);
  const preferredCheckoutUrl = paymentMethod === PLUS_PAYMENT_METHOD_PAYPAL
    ? (hostedCheckoutUrl || chatgptCheckoutUrl)
    : chatgptCheckoutUrl;

  return {
    checkoutUrl: buildPlusCheckoutUrl(data.checkout_session_id, paymentMethod),
    chatgptCheckoutUrl,
    checkoutSessionId: data.checkout_session_id,
    processorEntity,
    hostedCheckoutUrl,
    convertedCheckoutUrl: chatgptCheckoutUrl,
    preferredCheckoutUrl,
    country: checkoutPayload.billing_details.country,
    currency: checkoutPayload.billing_details.currency,
  };
}

async function selectPaymentMethod(method = PLUS_PAYMENT_METHOD_PAYPAL, options = {}) {
  const config = getPaymentMethodConfig(method);
  const relaxedActivation = Boolean(options.relaxedActivation);
  const clickRepeats = relaxedActivation && config.id === PLUS_PAYMENT_METHOD_PAYPAL ? 2 : 1;
  let lastDiagnosticsAt = 0;
  const target = await waitUntil(() => {
    const currentTarget = findPaymentMethodTarget(config.id);
    if (currentTarget) {
      return currentTarget;
    }

    const now = Date.now();
    if (!lastDiagnosticsAt || now - lastDiagnosticsAt >= PAYPAL_DIAGNOSTIC_LOG_INTERVAL_MS) {
      lastDiagnosticsAt = now;
      writePaymentMethodDiagnostics(config.id, `正在等待可点击的 ${config.label} 付款方式`, 'warn');
    }
    return null;
  }, {
    label: `${config.label} 付款方式`,
    intervalMs: 250,
  });
  console.info(`[MultiPage:plus-checkout] ${config.label} target selected`, summarizeElementForDebug(target));
  await performOperationWithDelay({ stepKey: 'plus-checkout-billing', kind: 'select', label: 'select-payment-method' }, async () => {
    for (let attempt = 1; attempt <= clickRepeats; attempt += 1) {
      simulateClick(target);
      if (attempt < clickRepeats) {
        await sleep(500);
      }
    }
  });
  log(`Plus Checkout：已点击 ${config.label} 付款方式，正在确认选中状态。${relaxedActivation ? '（hosted checkout 宽松模式）' : ''}`);

  if (!await waitForPaymentMethodActive(config.id)) {
    if (relaxedActivation) {
      writePaymentMethodDiagnostics(config.id, `点击 ${config.label} 后未观察到标准选中标记，hosted checkout 宽松模式继续执行`, 'warn');
      log(`Plus Checkout：点击 ${config.label} 后未观察到标准选中标记，但当前为 hosted checkout 宽松模式，继续执行后续账单填写。`, 'warn');
      return false;
    }
    const diagnostics = writePaymentMethodDiagnostics(config.id, `点击 ${config.label} 后页面仍未进入 ${config.label} 账单表单`, 'error');
    throw new Error(`Plus Checkout：已尝试点击 ${config.label}，但页面未切换到 ${config.label} 表单。请提供控制台 ${config.label} diagnostics 结构。候选数量：${diagnostics.paymentCandidates.length}，银行卡字段仍可见：${diagnostics.cardFieldsVisible ? '是' : '否'}。`);
  }

  log(`Plus Checkout：已确认 ${config.label} 付款方式生效。`);
  return true;
}

async function selectPayPalPaymentMethod() {
  return selectPaymentMethod(PLUS_PAYMENT_METHOD_PAYPAL);
}

async function selectGoPayPaymentMethod() {
  return selectPaymentMethod(PLUS_PAYMENT_METHOD_GOPAY);
}

async function selectPlusPayPalPaymentMethod() {
  await waitForDocumentComplete();
  await selectPaymentMethod(PLUS_PAYMENT_METHOD_PAYPAL);
  return {
    paymentSelected: true,
    paymentMethod: PLUS_PAYMENT_METHOD_PAYPAL,
  };
}

async function selectPlusGoPayPaymentMethod() {
  await waitForDocumentComplete();
  await selectPaymentMethod(PLUS_PAYMENT_METHOD_GOPAY);
  return {
    paymentSelected: true,
    paymentMethod: PLUS_PAYMENT_METHOD_GOPAY,
  };
}

async function fillFullName(fullName) {
  const value = normalizeText(fullName);
  if (!value) return false;
  const input = findInputByFieldText([
    /full\s*name|name\s*on|cardholder|billing\s*name/i,
    /姓名|全名|持卡人/i,
  ]);
  if (!input) {
    return false;
  }
  fillInput(input, value);
  await sleep(300);
  return true;
}

function readCountryText() {
  const countryInput = findInputByFieldText([
    /country|region/i,
    /国家|地区/i,
  ]);
  if (countryInput?.value) {
    return countryInput.value;
  }
  const countrySelect = getVisibleControls('select').find((select) => /country|region|国家|地区/i.test(getFieldText(select)));
  if (countrySelect) {
    const option = countrySelect.selectedOptions?.[0];
    return option?.textContent || countrySelect.value || '';
  }
  const countryDropdown = findCountryDropdown();
  if (countryDropdown) {
    return getCountryDropdownValue(countryDropdown);
  }
  return '';
}

function isLikelyAddressSearchInput(input) {
  const text = getFieldText(input);
  if (isNonAddressSearchInput(input)) {
    return false;
  }
  if (/name|email|e-mail|phone|tel|password|coupon|promo|country|region|postal|zip|city|state|province|card|card\s*number|expiry|expiration|security|cvc|cvv|cc-|全名|姓名|邮箱|电话|密码|国家|地区|邮编|城市|省|州|银行卡|卡号|有效期|安全码/i.test(text)) {
    return false;
  }
  if (/address|street|billing|search|line\s*1|地址|街道|账单/i.test(text)) {
    return true;
  }
  return false;
}

function hasCreditCardFields() {
  return getVisibleTextInputs().some((input) => {
    const text = getFieldText(input);
    return /card\s*number|card|expiry|expiration|security\s*code|cvc|cvv|银行卡|卡号|有效期|安全码/i.test(text);
  });
}

function hasBillingAddressFields() {
  return getVisibleTextInputs().some((input) => {
    const text = getFieldText(input);
    return /address|street|billing|line\s*1|地址|街道|账单/i.test(text)
      && !/card\s*number|card|expiry|expiration|security|cvc|cvv|银行卡|卡号|有效期|安全码/i.test(text);
  });
}

function hasPaymentMethodSelectionMarker(el) {
  if (!el) return false;
  const className = typeof el.className === 'string' ? el.className : el.getAttribute?.('class') || '';
  return el.checked === true
    || el.getAttribute?.('aria-checked') === 'true'
    || el.getAttribute?.('aria-selected') === 'true'
    || el.getAttribute?.('data-state') === 'checked'
    || el.getAttribute?.('data-selected') === 'true'
    || /\b(selected|checked|active)\b/i.test(className);
}

function hasSelectedPaymentMethodControl(method = PLUS_PAYMENT_METHOD_PAYPAL) {
  const config = getPaymentMethodConfig(method);
  const candidates = getPaymentMethodSearchCandidates(config.id);
  return candidates.some((candidate) => {
    let current = candidate;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      if (isDocumentLevelContainer(current)) break;
      const currentMatchesPayment = config.patterns.some((pattern) => pattern.test(getCombinedSearchText(current)));
      if (currentMatchesPayment && hasPaymentMethodSelectionMarker(current)) {
        return true;
      }

      const radio = current.querySelector?.('input[type="radio"], [role="radio"]');
      if (
        radio
        && config.patterns.some((pattern) => pattern.test(getCombinedSearchText(current) || getCombinedSearchText(radio)))
        && hasPaymentMethodSelectionMarker(radio)
      ) {
        return true;
      }
    }
    return false;
  });
}

function hasSelectedPayPalControl() {
  return hasSelectedPaymentMethodControl(PLUS_PAYMENT_METHOD_PAYPAL);
}

function hasSelectedGoPayControl() {
  return hasSelectedPaymentMethodControl(PLUS_PAYMENT_METHOD_GOPAY);
}

function isPaymentMethodActive(method = PLUS_PAYMENT_METHOD_PAYPAL) {
  return hasSelectedPaymentMethodControl(method);
}

function isPayPalPaymentMethodActive() {
  return isPaymentMethodActive(PLUS_PAYMENT_METHOD_PAYPAL);
}

function isGoPayPaymentMethodActive() {
  return isPaymentMethodActive(PLUS_PAYMENT_METHOD_GOPAY);
}

async function waitForPaymentMethodActive(method = PLUS_PAYMENT_METHOD_PAYPAL, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    throwIfStopped();
    if (isPaymentMethodActive(method)) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

async function waitForPayPalPaymentMethodActive(timeoutMs = 5000) {
  return waitForPaymentMethodActive(PLUS_PAYMENT_METHOD_PAYPAL, timeoutMs);
}

async function findAddressSearchInput() {
  return waitUntil(() => {
    const direct = findInputByFieldText([
      /address|street|billing|search|line\s*1/i,
      /地址|街道|账单/i,
    ], {
      exclude: (input) => /city|state|province|postal|zip|country|城市|省|州|邮编|国家|地区/i.test(getFieldText(input)),
    });
    if (direct && !isNonAddressSearchInput(direct)) return direct;
    const candidates = getVisibleTextInputs().filter(isLikelyAddressSearchInput);
    return candidates[0] || null;
  }, {
    label: '地址搜索输入框',
    intervalMs: 250,
  });
}

function getAddressSuggestions() {
  const selectors = [
    '[role="listbox"] [role="option"]',
    '[role="option"]',
    '.pac-container .pac-item',
    '[data-testid*="address" i] [role="option"]',
    'li',
  ];
  const seen = new Set();
  const results = [];
  for (const selector of selectors) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (!isVisibleElement(el)) continue;
      const text = normalizeText(el.textContent || el.getAttribute?.('aria-label') || '');
      if (!text || text.length < 3) continue;
      const key = `${selector}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(el);
    }
  }
  return results;
}

function generateNumericAddressQuery(length = 4) {
  const digits = Math.max(1, Math.min(8, Math.floor(Number(length) || 4)));
  const min = 10 ** Math.max(0, digits - 1);
  const max = (10 ** digits) - 1;
  return String(Math.floor((Math.random() * ((max - min) + 1)) + min));
}

function resolveAddressQueryValue(seed = {}) {
  const explicitQuery = normalizeText(seed.query || seed.autocompleteQuery || '');
  if (explicitQuery) {
    return explicitQuery;
  }
  const numericDigits = Math.max(0, Math.min(8, Math.floor(Number(seed.numericQueryDigits) || 0)));
  if (numericDigits > 0) {
    return generateNumericAddressQuery(numericDigits);
  }
  return 'Berlin Mitte';
}

async function selectAddressSuggestion(seed) {
  await fillAddressQuery(seed);
  return clickAddressSuggestion(seed);
}

async function clickAddressSuggestion(seed = {}) {
  const suggestions = await waitUntil(() => {
    const options = getAddressSuggestions();
    return options.length ? options : null;
  }, {
    label: '地址推荐列表',
    intervalMs: 250,
    timeoutMs: 6000,
  });

  const suggestionIndex = Math.max(0, Math.min(
    suggestions.length - 1,
    Boolean(seed.randomSuggestion)
      ? Math.floor(Math.random() * suggestions.length)
      : Math.floor(Number(seed.suggestionIndex) || 0)
  ));
  const target = suggestions[suggestionIndex] || suggestions[0];
  simulateClick(target);
  await sleep(1200);
  return {
    selectedText: normalizeText(target.textContent || ''),
    suggestionIndex,
  };
}

async function fillAddressQuery(seed = {}) {
  const addressInput = await findAddressSearchInput();
  fillInput(addressInput, resolveAddressQueryValue(seed));
  await sleep(800);
  return {
    filled: true,
  };
}

function getRegionCandidates(value) {
  const raw = normalizeText(value);
  if (!raw) return [];
  const aliases = {
    act: 'Australian Capital Territory',
    nsw: 'New South Wales',
    nt: 'Northern Territory',
    qld: 'Queensland',
    sa: 'South Australia',
    tas: 'Tasmania',
    vic: 'Victoria',
    wa: 'Western Australia',
    tokyo: '東京都',
    osaka: '大阪府',
  };
  const compact = raw.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const candidates = [raw];
  if (aliases[compact]) {
    candidates.push(aliases[compact]);
  }
  for (const [abbr, name] of Object.entries(aliases)) {
    const compactName = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
    if (compact === compactName) {
      candidates.push(abbr.toUpperCase());
    }
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

function getCountryCandidates(value = '') {
  const raw = normalizeText(value);
  const compact = raw.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const aliases = {
    AR: ['Argentina', '阿根廷'],
    AU: ['Australia', '澳大利亚'],
    CA: ['Canada', '加拿大'],
    CN: ['China', '中国'],
    DE: ['Germany', 'Deutschland', '德国'],
    ES: ['Spain', '西班牙'],
    FR: ['France', '法国'],
    GB: ['United Kingdom', 'UK', 'Britain', 'England', '英国'],
    HK: ['Hong Kong', '香港'],
    ID: ['Indonesia', '印度尼西亚', '印尼'],
    IT: ['Italy', '意大利'],
    JP: ['Japan', '日本', '日本国'],
    KR: ['Korea', 'South Korea', '韩国'],
    MY: ['Malaysia', '马来西亚'],
    NL: ['Netherlands', 'Holland', '荷兰'],
    PH: ['Philippines', '菲律宾'],
    RU: ['Russia', '俄罗斯'],
    SG: ['Singapore', '新加坡'],
    TH: ['Thailand', '泰国'],
    TR: ['Turkey', 'Turkiye', '土耳其'],
    TW: ['Taiwan', '台湾'],
    US: ['United States', 'United States of America', 'USA', '美国'],
    VN: ['Vietnam', '越南'],
  };
  const indonesiaCandidates = aliases.ID || [];
  if (compact === 'id' || compact === 'indonesia' || compact === '印度尼西亚' || compact === '印尼') {
    return Array.from(new Set([raw, 'ID', ...indonesiaCandidates].filter(Boolean)));
  }
  const direct = aliases[String(raw || '').trim().toUpperCase()] || [];
  const matched = Object.entries(aliases).find(([code, names]) => {
    if (String(code).toLowerCase() === compact) return true;
    return names.some((name) => {
      const normalizedName = normalizeText(name).toLowerCase();
      const compactName = normalizedName.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
      return compact === compactName || normalizedName === raw.toLowerCase();
    });
  });
  return Array.from(new Set([raw, ...direct, ...(matched ? matched[1] : [])].filter(Boolean)));
}

function matchesCountryOption(text, desiredValue) {
  const normalizedText = normalizeText(text).toLowerCase();
  const compactText = normalizedText.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  if (!compactText) return false;
  return getCountryCandidates(desiredValue).some((candidate) => {
    const normalizedCandidate = normalizeText(candidate).toLowerCase();
    const compactCandidate = normalizedCandidate.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
    if (!compactCandidate) return false;
    return normalizedText === normalizedCandidate
      || compactText === compactCandidate
      || (compactCandidate.length > 3 && compactText.includes(compactCandidate));
  });
}

function findCountryDropdown() {
  const direct = document.getElementById('billingCountry');
  if (direct && isVisibleElement(direct) && isEnabledControl(direct)) {
    return direct;
  }
  const controls = getVisibleControls('select, button, [role="button"], [role="combobox"], [aria-haspopup="listbox"]');
  return controls.find((control) => {
    if (!isEnabledControl(control) || isDocumentLevelContainer(control)) return false;
    const text = getFieldText(control);
    return /country/i.test(text) || /\u56fd\u5bb6|\u56fd\u5bb6\u6216\u5730\u533a/.test(text);
  }) || null;
}

function getCountryDropdownValue(control) {
  if (!control) return '';
  if (String(control.tagName || '').toUpperCase() === 'SELECT') {
    const selected = control.selectedOptions?.[0];
    return normalizeText(selected?.textContent || control.value || '');
  }
  return normalizeText(
    control.getAttribute?.('aria-valuetext')
    || control.getAttribute?.('aria-label')
    || control.getAttribute?.('data-value')
    || control.textContent
    || ''
  );
}

function matchesRegionOption(text, desiredValue) {
  const normalizedText = normalizeText(text).toLowerCase();
  const compactText = normalizedText.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  if (!compactText) return false;
  return getRegionCandidates(desiredValue).some((candidate) => {
    const normalizedCandidate = normalizeText(candidate).toLowerCase();
    const compactCandidate = normalizedCandidate.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
    if (!compactCandidate) return false;
    return normalizedText === normalizedCandidate
      || compactText === compactCandidate
      || (compactCandidate.length > 3 && compactText.includes(compactCandidate));
  });
}

function findRegionDropdown() {
  const direct = document.getElementById('billingAdministrativeArea');
  if (direct && isVisibleElement(direct) && isEnabledControl(direct)) {
    return direct;
  }
  const controls = getVisibleControls('select, button, [role="button"], [role="combobox"], [aria-haspopup="listbox"]');
  return controls.find((control) => {
    if (!isEnabledControl(control) || isDocumentLevelContainer(control)) return false;
    const text = getFieldText(control);
    if (/country/i.test(text) || /\u56fd\u5bb6|\u5730\u533a/.test(text)) return false;
    return /state|province|county|prefecture|administrative|administrative[_-]?area/i.test(text)
      || /(?:^|\s)region(?:\s|$)/i.test(text)
      || /\u5dde|\u7701|\u8f96\u533a|\u90fd\u9053\u5e9c\u53bf/.test(text);
  }) || null;
}

function getRegionDropdownValue(control) {
  if (!control) return '';
  if (String(control.tagName || '').toUpperCase() === 'SELECT') {
    const selected = control.selectedOptions?.[0];
    return normalizeText(selected?.textContent || control.value || '');
  }
  return normalizeText(
    control.getAttribute?.('aria-valuetext')
    || control.getAttribute?.('aria-label')
    || control.getAttribute?.('data-value')
    || control.textContent
    || ''
  );
}

function getVisibleRegionOptions() {
  const selectors = [
    '[role="listbox"] [role="option"]',
    '[role="option"]',
    'li',
  ];
  const seen = new Set();
  const options = [];
  for (const selector of selectors) {
    for (const option of Array.from(document.querySelectorAll(selector))) {
      if (!isVisibleElement(option)) continue;
      const text = normalizeText(getActionText(option) || option.textContent || '');
      if (!text || seen.has(text)) continue;
      seen.add(text);
      options.push(option);
    }
  }
  return options;
}

async function selectRegionDropdown(regionDropdown, value) {
  if (!regionDropdown || !value) return false;
  if (matchesRegionOption(getRegionDropdownValue(regionDropdown), value)) {
    return false;
  }

  if (String(regionDropdown.tagName || '').toUpperCase() === 'SELECT') {
    const option = Array.from(regionDropdown.options || []).find((item) => (
      matchesRegionOption(item.textContent || '', value)
      || matchesRegionOption(item.value || '', value)
    ));
    if (!option) {
      throw new Error(`Plus Checkout: state dropdown option "${value}" was not found.`);
    }
    regionDropdown.value = option.value;
    option.selected = true;
    regionDropdown.dispatchEvent(new Event('input', { bubbles: true }));
    regionDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  simulateClick(regionDropdown);
  await sleep(250);
  const startedAt = Date.now();
  let option = null;
  while (Date.now() - startedAt < 2500) {
    throwIfStopped();
    option = getVisibleRegionOptions().find((item) => (
      matchesRegionOption(getActionText(item) || item.textContent || '', value)
    ));
    if (option) break;
    await sleep(100);
  }
  if (!option) {
    const visibleOptions = getVisibleRegionOptions()
      .map((item) => normalizeText(getActionText(item) || item.textContent || ''))
      .filter(Boolean)
      .slice(0, 12)
      .join(' | ');
    throw new Error(`Plus Checkout: state dropdown option "${value}" was not found. Visible options: ${visibleOptions || 'none'}.`);
  }
  simulateClick(option);
  await sleep(500);
  return true;
}

async function selectCountryDropdown(countryDropdown, value) {
  if (!countryDropdown || !value) return false;
  if (matchesCountryOption(getCountryDropdownValue(countryDropdown), value)) {
    return false;
  }

  if (String(countryDropdown.tagName || '').toUpperCase() === 'SELECT') {
    const option = Array.from(countryDropdown.options || []).find((item) => (
      matchesCountryOption(item.textContent || '', value)
      || matchesCountryOption(item.value || '', value)
    ));
    if (!option) {
      throw new Error(`Plus Checkout: country dropdown option "${value}" was not found.`);
    }
    countryDropdown.value = option.value;
    option.selected = true;
    countryDropdown.dispatchEvent(new Event('input', { bubbles: true }));
    countryDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(500);
    return true;
  }

  simulateClick(countryDropdown);
  await sleep(250);
  const startedAt = Date.now();
  let option = null;
  while (Date.now() - startedAt < 2500) {
    throwIfStopped();
    option = getVisibleRegionOptions().find((item) => (
      matchesCountryOption(getActionText(item) || item.textContent || '', value)
    ));
    if (option) break;
    await sleep(100);
  }
  if (!option) {
    const visibleOptions = getVisibleRegionOptions()
      .map((item) => normalizeText(getActionText(item) || item.textContent || ''))
      .filter(Boolean)
      .slice(0, 12)
      .join(' | ');
    throw new Error(`Plus Checkout: country dropdown option "${value}" was not found. Visible options: ${visibleOptions || 'none'}.`);
  }
  simulateClick(option);
  await sleep(700);
  return true;
}

async function ensureCountrySelectionBeforeAutocomplete(seed = {}) {
  if (!seed?.forceCountrySelectionBeforeAutocomplete || !seed?.countryCode) {
    return false;
  }
  const countryDropdown = findCountryDropdown();
  if (!countryDropdown) {
    return false;
  }
  return selectCountryDropdown(countryDropdown, seed.countryCode);
}

function getStructuredAddressFields() {
  const directAddress1 = document.getElementById('billingAddressLine1');
  const directCity = document.getElementById('billingLocality');
  const directPostalCode = document.getElementById('billingPostalCode');
  const directAddress2 = document.getElementById('billingAddressLine2');
  const address1 = (directAddress1 && isVisibleElement(directAddress1) ? directAddress1 : null) || findInputByFieldText([
    /address\s*(?:line)?\s*1|address[_-]?line[_-]?1|address\[(?:address_)?line1\]|line\s*1|street|street[_-]?address/i,
    /地址\s*1|街道|详细地址|住所/i,
  ]);
  const address2 = (directAddress2 && isVisibleElement(directAddress2) ? directAddress2 : null) || findInputByFieldText([
    /address\s*(?:line)?\s*2|address[_-]?line[_-]?2|address\[(?:address_)?line2\]|line\s*2|apt|suite|unit/i,
    /地址\s*2|公寓|单元|门牌/i,
  ]);
  const city = (directCity && isVisibleElement(directCity) ? directCity : null) || findInputByFieldText([
    /city|town|suburb|locality|address[_-]?level[_-]?2|address\[city\]/i,
    /城市|市区|区市町村|市区町村|市町村/i,
  ]);
  const region = findInputByFieldText([
    /state|province|region|county|prefecture|administrative|administrative[_-]?area|address[_-]?level[_-]?1|address\[state\]/i,
    /省|州|地区|辖区|都道府县|都道府県/i,
  ]);
  const postalCode = (directPostalCode && isVisibleElement(directPostalCode) ? directPostalCode : null) || findInputByFieldText([
    /postal|zip|postcode|postal[_-]?code|zip[_-]?code|address\[postal_code\]/i,
    /邮编|邮政|郵便番号/i,
  ]);
  return { address1, address2, city, region, postalCode };
}

function fillIfEmpty(input, value, options = {}) {
  if (!input || !value) return false;
  if (!options.overwrite && String(input.value || '').trim()) return false;
  if (options.overwrite && String(input.value || '').trim() === String(value || '').trim()) return false;
  fillInput(input, value);
  return true;
}

function findCheckoutEmailInput() {
  const direct = document.getElementById('email');
  if (direct && isVisibleElement(direct)) {
    return direct;
  }
  const emailByType = getVisibleTextInputs().find((input) => {
    const type = String(input?.getAttribute?.('type') || input?.type || '').trim().toLowerCase();
    const autoComplete = String(input?.getAttribute?.('autocomplete') || '').trim().toLowerCase();
    return type === 'email' || autoComplete.includes('email');
  });
  if (emailByType) {
    return emailByType;
  }
  return findInputByFieldText([
    /email|e-mail/i,
    /邮箱/i,
  ]);
}

async function fillCheckoutContactEmail(email = '', options = {}) {
  const normalizedEmail = normalizeText(String(email || '').trim());
  if (!normalizedEmail) {
    log('Checkout 联系邮箱为空，跳过自动填写。', 'warn');
    return { found: false, filled: false, skipped: true, reason: 'empty_email' };
  }
  const input = await waitUntil(() => {
    const candidate = findCheckoutEmailInput();
    return candidate && isVisibleElement(candidate) ? candidate : null;
  }, {
    label: 'Checkout 邮箱输入框',
    intervalMs: 200,
    timeoutMs: Math.max(800, Math.floor(Number(options.timeoutMs) || 2500)),
  }).catch(() => null);
  if (!input) {
    log('未找到 Checkout 联系邮箱输入框，跳过自动填写。', 'warn');
    return { found: false, filled: false, skipped: true, reason: 'input_not_found' };
  }

  const currentValue = String(input.value || '').trim();
  if (currentValue.toLowerCase() === normalizedEmail.toLowerCase()) {
    log(`Checkout 联系邮箱已存在且一致：${currentValue}`, 'info');
    return { found: true, filled: true, alreadyFilled: true, value: currentValue };
  }
  if (currentValue && !options.overwrite) {
    log(`Checkout 联系邮箱已有其他值，按非覆盖策略跳过：${currentValue}`, 'warn');
    return { found: true, filled: false, skipped: true, reason: 'existing_value', value: currentValue };
  }

  fillInput(input, normalizedEmail);
  await sleep(250);
  log(`Checkout 联系邮箱已尝试填写为 ${normalizedEmail}`, 'info');
  return {
    found: true,
    filled: String(input.value || '').trim().toLowerCase() === normalizedEmail.toLowerCase(),
    alreadyFilled: false,
    value: String(input.value || '').trim(),
  };
}

function isDropdownStructuredAddressForm(fields = getStructuredAddressFields()) {
  return Boolean(
    findCountryDropdown()
    && findRegionDropdown()
    && fields.address1
    && fields.city
    && fields.postalCode
  );
}

async function ensureStructuredAddress(seed, options = {}) {
  const fallback = seed?.fallback || {};
  const overwrite = Boolean(options.overwrite);
  const timeoutMs = Math.max(1000, Math.floor(Number(options.timeoutMs) || 6000));
  const countryDropdown = findCountryDropdown();
  if (countryDropdown && seed?.countryCode) {
    await selectCountryDropdown(countryDropdown, seed.countryCode);
  }
  const fields = await waitUntil(() => {
    const currentFields = getStructuredAddressFields();
    if (currentFields.address1 || currentFields.city || currentFields.postalCode) {
      return currentFields;
    }
    return null;
  }, {
    label: '结构化账单地址字段',
    intervalMs: 250,
    timeoutMs,
  });

  fillIfEmpty(fields.address1, fallback.address1, { overwrite });
  fillIfEmpty(fields.city, fallback.city, { overwrite });
  await selectRegionDropdown(findRegionDropdown(), fallback.region);
  fillIfEmpty(fields.postalCode, fallback.postalCode, { overwrite });
  await sleep(500);

  const latest = getStructuredAddressFields();
  const missing = [];
  if (!String(latest.address1?.value || '').trim()) missing.push('地址1');
  if (!String(latest.city?.value || '').trim()) missing.push('城市');
  if (!String(latest.postalCode?.value || '').trim()) missing.push('邮编');
  if (missing.length) {
    throw new Error(`Plus Checkout：账单地址字段未填写完整：${missing.join('、')}。`);
  }

  return {
    address1: latest.address1?.value || '',
    city: latest.city?.value || '',
    region: getRegionDropdownValue(findRegionDropdown()) || latest.region?.value || '',
    postalCode: latest.postalCode?.value || '',
  };
}

function resolveCheckboxControl(el) {
  if (!el) return null;
  if (
    String(el.tagName || '').toUpperCase() === 'INPUT'
    && String(el.getAttribute?.('type') || el.type || '').trim().toLowerCase() === 'checkbox'
  ) {
    return el;
  }
  if (el.getAttribute?.('role') === 'checkbox') {
    return el;
  }
  return el.querySelector?.('input[type="checkbox"], [role="checkbox"]') || el;
}

function isCheckboxChecked(el) {
  const control = resolveCheckboxControl(el);
  if (!control) return false;
  if (String(control.tagName || '').toUpperCase() === 'INPUT') {
    return control.checked === true;
  }
  const dataState = String(control.getAttribute?.('data-state') || '').trim().toLowerCase();
  return control.getAttribute?.('aria-checked') === 'true'
    || control.getAttribute?.('data-selected') === 'true'
    || dataState === 'checked';
}

function findAgreementCheckbox(options = {}) {
  const includePattern = /agree|agreement|authorize|authorization|consent|policy|terms|automatic\s*payments|billing\s*agreement|autopay|同意|协议|条款|授权|政策|自动续费/i;
  const excludePattern = /newsletter|marketing|promo|offer|remember|save\s+my\s+information|save\s+information|stored\s+payment|保存信息|记住|营销/i;
  const candidates = getVisibleCheckboxCandidates()
    .map((candidate) => ({
      candidate,
      control: resolveCheckboxControl(candidate),
      text: getCombinedSearchText(candidate),
    }))
    .filter((item) => item.control && !excludePattern.test(item.text));

  const matched = candidates.find((item) => includePattern.test(item.text));
  if (matched) {
    return matched.candidate;
  }
  if (options.allowSingleVisibleCheckbox && candidates.length === 1) {
    return candidates[0].candidate;
  }
  return null;
}

async function ensureAgreementCheckbox(payload = {}) {
  if (!payload.autoCheckAgreement) {
    return { found: false, checked: false, alreadyChecked: false };
  }
  const timeoutMs = Math.max(0, Math.floor(Number(payload.agreementCheckboxTimeoutMs) || 1800));
  const startedAt = Date.now();
  let checkbox = null;
  while (Date.now() - startedAt <= timeoutMs) {
    throwIfStopped();
    checkbox = findAgreementCheckbox({
      allowSingleVisibleCheckbox: payload.allowSingleVisibleAgreementCheckbox !== false,
    });
    if (checkbox) {
      break;
    }
    await sleep(120);
  }
  if (!checkbox) {
    return { found: false, checked: false, alreadyChecked: false };
  }
  if (isCheckboxChecked(checkbox)) {
    return { found: true, checked: true, alreadyChecked: true };
  }
  await humanLikeClick(checkbox);
  await sleep(400);
  return {
    found: true,
    checked: isCheckboxChecked(checkbox),
    alreadyChecked: false,
  };
}

function findSubscribeButton() {
  const submitButtons = getVisibleControls('button[type="submit"], input[type="submit"]');
  const exactSubmit = submitButtons.find((button) => (
    isEnabledControl(button)
    && /订阅|subscribe|购买\s*ChatGPT\s*Plus|start\s*subscription|place\s*order/i.test(getCombinedSearchText(button))
  ));
  if (exactSubmit) {
    return exactSubmit;
  }

  return findClickableByText([
    /订阅|继续|确认|支付/i,
    /subscribe|continue|confirm|pay|start\s*subscription|place\s*order/i,
  ]);
}

function isBusySubscribeButton(button) {
  if (!button) return true;
  const text = getActionText(button);
  return button.disabled
    || button.getAttribute?.('aria-disabled') === 'true'
    || button.getAttribute?.('aria-busy') === 'true'
    || button.closest?.('[aria-busy="true"], [data-loading="true"], [data-state="loading"]')
    || /loading|processing|submitting|请稍候|处理中|加载中/i.test(text);
}

function getAssociatedForm(button) {
  if (!button) return null;
  if (button.form) return button.form;
  const formId = String(button.getAttribute?.('form') || '').trim();
  if (formId) {
    return document.getElementById(formId) || null;
  }
  return button.closest?.('form') || null;
}

async function humanLikeClick(el) {
  throwIfStopped();
  if (!el) {
    throw new Error('无法点击空元素。');
  }

  el.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'instant' });
  await sleep(300);
  if (typeof el.focus === 'function') {
    el.focus({ preventScroll: true });
    await sleep(150);
  }

  const rect = el.getBoundingClientRect();
  const clientX = Math.floor(rect.left + rect.width / 2);
  const clientY = Math.floor(rect.top + rect.height / 2);
  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX,
    clientY,
    button: 0,
    buttons: 1,
  };
  const pointerCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  const events = [
    ['pointerover', pointerCtor],
    ['pointerenter', pointerCtor],
    ['mouseover', MouseEvent],
    ['mouseenter', MouseEvent],
    ['pointermove', pointerCtor],
    ['mousemove', MouseEvent],
    ['pointerdown', pointerCtor],
    ['mousedown', MouseEvent],
    ['pointerup', pointerCtor],
    ['mouseup', MouseEvent],
    ['click', MouseEvent],
  ];

  for (const [type, EventCtor] of events) {
    throwIfStopped();
    el.dispatchEvent(new EventCtor(type, eventInit));
    await sleep(type === 'mousedown' || type === 'pointerdown' ? 120 : 30);
  }

  if (typeof el.click === 'function') {
    await sleep(120);
    el.click();
  }

  const type = String(el.getAttribute?.('type') || el.type || '').trim().toLowerCase();
  const form = getAssociatedForm(el);
  if (
    form
    && typeof form.requestSubmit === 'function'
    && (
      (String(el.tagName || '').toUpperCase() === 'BUTTON' && (!type || type === 'submit'))
      || (String(el.tagName || '').toUpperCase() === 'INPUT' && type === 'submit')
    )
  ) {
    await sleep(250);
    form.requestSubmit(el);
  }

  console.log('[MultiPage:plus-checkout] 已执行拟人工点击', summarizeElementForDebug(el));
  log(`已拟人工点击 [${el.tagName}] "${el.textContent?.trim().slice(0, 30) || ''}"`);
}

async function fillPlusBillingAndSubmit(payload = {}) {
  await waitForDocumentComplete();
  const paymentMethod = normalizePlusPaymentMethod(payload.paymentMethod);
  await selectPaymentMethod(paymentMethod, {
    relaxedActivation: Boolean(payload.hostedCheckoutMode),
  });
  const billingResult = await fillPlusBillingAddress(payload);

  if (payload.skipSubmit) {
    return {
      ...billingResult,
      submitted: false,
    };
  }

  await clickPlusSubscribe({
    ...payload,
    autoCheckAgreement: payload.autoCheckAgreement ?? payload.addressSeed?.autoCheckAgreement,
  });
  return {
    ...billingResult,
    submitted: true,
  };
}

async function fillPlusBillingAddress(payload = {}) {
  await waitForDocumentComplete();
  const countryText = readCountryText();
  const contactEmail = String(payload.email || payload.registrationEmail || '').trim();
  const seed = payload.addressSeed || {
    query: 'Berlin Mitte',
    suggestionIndex: 1,
    fallback: {
      address1: 'Unter den Linden',
      city: 'Berlin',
      region: 'Berlin',
      postalCode: '10117',
    },
  };
  let emailResult = { found: false, filled: false, skipped: true, reason: 'not_attempted', value: '' };
  await performOperationWithDelay({ stepKey: 'plus-checkout-billing', kind: 'fill', label: 'fill-contact-email' }, async () => {
    emailResult = await fillCheckoutContactEmail(contactEmail);
  });
  let selected = { selectedText: '' };
  const fields = getStructuredAddressFields();
  const useDirectStructuredBranch = Boolean(seed.skipAutocomplete || isDropdownStructuredAddressForm(fields));
  if (!useDirectStructuredBranch) {
    await performOperationWithDelay({ stepKey: 'plus-checkout-billing', kind: 'fill', label: 'fill-address-query' }, async () => {
      await ensureCountrySelectionBeforeAutocomplete(seed);
      await fillFullName(payload.fullName || '');
      await fillAddressQuery(seed);
    });
    selected = await performOperationWithDelay({ stepKey: 'plus-checkout-billing', kind: 'select', label: 'select-address-suggestion' }, async () => (
      clickAddressSuggestion(seed)
    ));
  }
  const structuredAddress = await performOperationWithDelay({ stepKey: 'plus-checkout-billing', kind: 'fill', label: 'fill-billing-address' }, async () => {
    if (useDirectStructuredBranch) {
      await fillFullName(payload.fullName || '');
    }
    return ensureStructuredAddress(seed, {
      overwrite: useDirectStructuredBranch,
      timeoutMs: payload.structuredAddressTimeoutMs,
    });
  });
  const agreementResult = await ensureAgreementCheckbox({
    autoCheckAgreement: payload.autoCheckAgreement ?? seed.autoCheckAgreement,
  });

  return {
    countryText,
    contactEmail,
    emailFillResult: emailResult,
    selectedAddressText: selected.selectedText,
    structuredAddress,
    agreementChecked: agreementResult.checked,
  };
}

async function fillPlusAddressQuery(payload = {}) {
  await waitForDocumentComplete();
  const seed = payload.addressSeed || {};
  const contactEmail = String(payload.email || payload.registrationEmail || '').trim();
  await performOperationWithDelay({ stepKey: 'plus-checkout-billing', kind: 'fill', label: 'fill-contact-email' }, async () => {
    await fillCheckoutContactEmail(contactEmail);
  });
  await performOperationWithDelay({ stepKey: 'plus-checkout-billing', kind: 'fill', label: 'fill-address-query' }, async () => {
    await ensureCountrySelectionBeforeAutocomplete(seed);
    await fillFullName(payload.fullName || '');
    await fillAddressQuery(seed);
  });
  return {
    countryText: readCountryText(),
    queryFilled: true,
  };
}

async function selectPlusAddressSuggestion(payload = {}) {
  await waitForDocumentComplete();
  const selected = await performOperationWithDelay({ stepKey: 'plus-checkout-billing', kind: 'select', label: 'select-address-suggestion' }, async () => (
    clickAddressSuggestion(payload.addressSeed || {})
  ));
  return {
    selectedAddressText: selected.selectedText,
    suggestionIndex: selected.suggestionIndex,
  };
}

async function ensurePlusStructuredBillingAddress(payload = {}) {
  await waitForDocumentComplete();
  const contactEmail = String(payload.email || payload.registrationEmail || '').trim();
  await performOperationWithDelay({ stepKey: 'plus-checkout-billing', kind: 'fill', label: 'fill-contact-email' }, async () => {
    await fillCheckoutContactEmail(contactEmail);
  });
  const structuredAddress = await performOperationWithDelay({ stepKey: 'plus-checkout-billing', kind: 'fill', label: 'fill-billing-address' }, async () => (
    ensureStructuredAddress(payload.addressSeed || {}, {
      overwrite: Boolean(payload.overwriteStructuredAddress),
      timeoutMs: payload.structuredAddressTimeoutMs,
    })
  ));
  const agreementResult = await ensureAgreementCheckbox({
    autoCheckAgreement: payload.autoCheckAgreement ?? payload.addressSeed?.autoCheckAgreement,
  });
  return {
    countryText: readCountryText(),
    structuredAddress,
    agreementChecked: agreementResult.checked,
  };
}

async function clickPlusSubscribe(payload = {}) {
  const paymentMethod = normalizePlusPaymentMethod(payload.paymentMethod);
  if ((payload.ensurePayPalActive || payload.ensurePaymentActive) && !isPaymentMethodActive(paymentMethod)) {
    await selectPaymentMethod(paymentMethod);
  }
  await ensureAgreementCheckbox(payload);

  const subscribeButton = await waitUntil(() => {
    const button = findSubscribeButton();
    return button && isEnabledControl(button) && !isBusySubscribeButton(button) ? button : null;
  }, {
    label: '订阅按钮',
    intervalMs: 250,
    timeoutMs: 10000,
  });

  await sleep(Math.max(0, Math.floor(Number(payload.beforeClickDelayMs) || 0)));
  await performOperationWithDelay({ stepKey: 'plus-checkout-billing', kind: 'submit', label: 'click-subscribe' }, async () => {
    await humanLikeClick(subscribeButton);
  });
  return {
    clicked: true,
  };
}

async function readChatGptSessionAccessToken() {
  const sessionResponse = await fetch('/api/auth/session', {
    credentials: 'include',
  });
  const session = await sessionResponse.json().catch(() => ({}));
  return {
    session,
    accessToken: String(session?.accessToken || '').trim(),
  };
}

async function inspectPlusCheckoutState(options = {}) {
  const structuredAddress = getStructuredAddressFields();
  const hostedAddressError = getHostedOpenAiAddressErrorState();
  const hostedCardDeclinedError = getHostedOpenAiCardDeclinedState();
  const hostedCardFallback = getHostedOpenAiCardFallbackState();
  const state = {
    url: location.href,
    readyState: document.readyState,
    hostedOpenAiPage: isHostedOpenAiCheckoutPage(),
    hostedVerificationVisible: hasHostedOpenAiVerificationPopup(),
    hostedPayPalButtonFound: Boolean(findHostedOpenAiPayPalButton()),
    countryText: readCountryText(),
    hasPayPal: Boolean(findPayPalPaymentMethodTarget()),
    hasGoPay: Boolean(findGoPayPaymentMethodTarget()),
    paypalCandidates: getPayPalCandidateSummaries(),
    gopayCandidates: getGoPayCandidateSummaries(),
    paymentTextPreview: getPaymentTextPreview(),
    cardFieldsVisible: hasCreditCardFields(),
    billingFieldsVisible: hasBillingAddressFields(),
    hasSubscribeButton: Boolean(findSubscribeButton()),
    checkoutAmountSummary: getCheckoutAmountSummary(),
    hostedAddressError: hostedAddressError.hasError,
    hostedAddressErrorMessage: hostedAddressError.message,
    hostedCardDeclinedError: hostedCardDeclinedError.hasError,
    hostedCardDeclinedErrorMessage: hostedCardDeclinedError.message,
    hostedCardFallback: hostedCardFallback.fallback,
    hostedCardFallbackReason: hostedCardFallback.reason,
    hostedCardFallbackReasons: hostedCardFallback.reasons,
    hostedPaypalDisabledSignals: hostedCardFallback.paypalDisabledSignals,
    hostedCardAccordionSelected: hostedCardFallback.cardAccordionSelected,
    addressFieldValues: {
      address1: structuredAddress.address1?.value || '',
      city: structuredAddress.city?.value || '',
      region: getRegionDropdownValue(findRegionDropdown()) || structuredAddress.region?.value || '',
      postalCode: structuredAddress.postalCode?.value || '',
    },
  };
  if (options.includeSession || options.includeAccessToken) {
    const sessionState = await readChatGptSessionAccessToken();
    state.session = sessionState.session;
    state.accessToken = sessionState.accessToken;
  }
  return state;
}
})();
