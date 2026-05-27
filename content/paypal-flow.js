// content/paypal-flow.js — PayPal login and approval helper.

console.log('[MultiPage:paypal-flow] Content script loaded on', location.href);

const PAYPAL_FLOW_LISTENER_SENTINEL = 'data-multipage-paypal-flow-listener';
const PAYPAL_HOSTED_STAGE_OUTSIDE = 'outside_paypal';
const PAYPAL_HOSTED_STAGE_LOGIN = 'pay_login';
const PAYPAL_HOSTED_STAGE_ACCOUNT_CREATE_EMAIL = 'account_create_email';
const PAYPAL_HOSTED_STAGE_GUEST_CHECKOUT = 'guest_checkout';
const PAYPAL_HOSTED_STAGE_VERIFICATION = 'verification';
const PAYPAL_HOSTED_STAGE_REVIEW = 'review_consent';
const PAYPAL_HOSTED_STAGE_REDIRECTING = 'redirecting';
const PAYPAL_HOSTED_STAGE_APPROVAL = 'approval';
const PAYPAL_HOSTED_STAGE_BLOCKED = 'blocked';
const PAYPAL_HOSTED_STAGE_GENERIC_ERROR = 'generic_error';
const PAYPAL_HOSTED_STAGE_UNKNOWN = 'unknown';
const PAYPAL_HOSTED_HERMES_AUTORUN_SENTINEL = '__MULTIPAGE_PAYPAL_HOSTED_HERMES_AUTORUN__';
const PAYPAL_HOSTED_GUEST_SUBMIT_SENTINEL = '__MULTIPAGE_PAYPAL_HOSTED_GUEST_SUBMIT__';

if (document.documentElement.getAttribute(PAYPAL_FLOW_LISTENER_SENTINEL) !== '1') {
  document.documentElement.setAttribute(PAYPAL_FLOW_LISTENER_SENTINEL, '1');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      message.type === 'PAYPAL_GET_STATE'
      || message.type === 'PAYPAL_SUBMIT_LOGIN'
      || message.type === 'PAYPAL_DISMISS_PROMPTS'
      || message.type === 'PAYPAL_CLICK_APPROVE'
      || message.type === 'PAYPAL_HOSTED_GET_STATE'
      || message.type === 'PAYPAL_RUN_HOSTED_CHECKOUT_STEP'
    ) {
      resetStopState();
      handlePayPalCommand(message).then((result) => {
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
  console.log('[MultiPage:paypal-flow] 消息监听已存在，跳过重复注册');
}

async function performPayPalOperationWithDelay(metadata, operation) {
  const rootScope = typeof window !== 'undefined' ? window : globalThis;
  const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
  return typeof gate === 'function' ? gate(metadata, operation) : operation();
}

async function handlePayPalCommand(message) {
  switch (message.type) {
    case 'PAYPAL_GET_STATE':
      return inspectPayPalState();
    case 'PAYPAL_SUBMIT_LOGIN':
      return submitPayPalLogin(message.payload || {});
    case 'PAYPAL_DISMISS_PROMPTS':
      return dismissPayPalPrompts();
    case 'PAYPAL_CLICK_APPROVE':
      return clickPayPalApprove();
    case 'PAYPAL_HOSTED_GET_STATE':
      return inspectPayPalState();
    case 'PAYPAL_RUN_HOSTED_CHECKOUT_STEP':
      return runHostedCheckoutStep(message.payload || {});
    default:
      throw new Error(`paypal-flow.js 不处理消息：${message.type}`);
  }
}

async function waitUntil(predicate, options = {}) {
  const intervalMs = Math.max(50, Math.floor(Number(options.intervalMs) || 250));
  const timeoutMs = Math.max(0, Math.floor(Number(options.timeoutMs) || 0));
  const startedAt = Date.now();
  while (true) {
    throwIfStopped();
    const value = await predicate();
    if (value) {
      return value;
    }
    if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
      throw new Error(options.timeoutMessage || 'PayPal page timed out waiting for target state.');
    }
    await sleep(intervalMs);
  }
}

async function waitForDocumentComplete() {
  await waitUntil(() => document.readyState === 'complete', { intervalMs: 200 });
  await sleep(1000);
}

function isVisibleElement(el) {
  if (!el) return false;
  let node = el;
  while (node && node.nodeType === 1) {
    if (node.hidden || node.getAttribute?.('aria-hidden') === 'true' || node.getAttribute?.('inert') !== null) {
      return false;
    }
    const nodeStyle = window.getComputedStyle(node);
    if (
      nodeStyle.display === 'none'
      || nodeStyle.visibility === 'hidden'
      || nodeStyle.visibility === 'collapse'
      || Number(nodeStyle.opacity) === 0
    ) {
      return false;
    }
    node = node.parentElement;
  }
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

function getActionText(el) {
  return normalizeText([
    el?.textContent,
    el?.value,
    el?.getAttribute?.('aria-label'),
    el?.getAttribute?.('title'),
    el?.getAttribute?.('placeholder'),
    el?.getAttribute?.('name'),
    el?.id,
  ].filter(Boolean).join(' '));
}

function getVisibleControls(selector) {
  return Array.from(document.querySelectorAll(selector)).filter(isVisibleElement);
}

function isEnabledControl(el) {
  return Boolean(el)
    && !el.disabled
    && el.getAttribute?.('aria-disabled') !== 'true';
}

function findClickableByText(patterns) {
  const normalizedPatterns = (Array.isArray(patterns) ? patterns : [patterns]).filter(Boolean);
  const candidates = getVisibleControls('button, a, [role="button"], input[type="button"], input[type="submit"]');
  return candidates.find((el) => {
    const text = getActionText(el);
    return normalizedPatterns.some((pattern) => pattern.test(text));
  }) || null;
}

function findEnabledClickableByText(patterns) {
  const normalizedPatterns = (Array.isArray(patterns) ? patterns : [patterns]).filter(Boolean);
  const candidates = getVisibleControls('button, a, [role="button"], input[type="button"], input[type="submit"]');
  return candidates.find((el) => {
    if (!isEnabledControl(el)) {
      return false;
    }
    const text = getActionText(el);
    return normalizedPatterns.some((pattern) => pattern.test(text));
  }) || null;
}

function findInputByPatterns(patterns) {
  const inputs = getVisibleControls('input')
    .filter((input) => {
      const type = String(input.getAttribute('type') || input.type || '').trim().toLowerCase();
      return isEnabledControl(input) && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'file'].includes(type);
    });
  return inputs.find((input) => {
    const text = getActionText(input);
    return patterns.some((pattern) => pattern.test(text));
  }) || null;
}

function findEmailInput() {
  const isPasswordCandidate = (input) => {
    const type = String(input?.getAttribute?.('type') || input?.type || '').trim().toLowerCase();
    const metadataText = normalizeText([
      input?.textContent,
      input?.getAttribute?.('aria-label'),
      input?.getAttribute?.('title'),
      input?.getAttribute?.('placeholder'),
      input?.getAttribute?.('name'),
      input?.id,
    ].filter(Boolean).join(' '));
    return type === 'password' || /password|pass|密码/i.test(metadataText);
  };
  const inputs = getVisibleControls('input')
    .filter((input) => {
      const type = String(input.getAttribute('type') || input.type || '').trim().toLowerCase();
      return isEnabledControl(input)
        && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'file'].includes(type)
        && !isPasswordCandidate(input);
    });
  return inputs.find((input) => [
    /email|login|user|账号|邮箱/i,
  ].some((pattern) => pattern.test(getActionText(input))))
    || getVisibleControls('input[type="email"]').find((input) => isVisibleElement(input) && !isPasswordCandidate(input))
    || null;
}

function findPasswordInput() {
  const inputs = getVisibleControls('input')
    .filter((input) => {
      const type = String(input.getAttribute('type') || input.type || '').trim().toLowerCase();
      return isEnabledControl(input) && !['hidden', 'checkbox', 'radio', 'submit', 'button', 'file'].includes(type);
    });
  return inputs.find((input) => {
    const type = String(input.getAttribute('type') || input.type || '').trim().toLowerCase();
    const metadataText = normalizeText([
      input?.textContent,
      input?.getAttribute?.('aria-label'),
      input?.getAttribute?.('title'),
      input?.getAttribute?.('placeholder'),
      input?.getAttribute?.('name'),
      input?.id,
    ].filter(Boolean).join(' '));
    return type === 'password' || /password|pass|密码/i.test(metadataText);
  }) || getVisibleControls('input[type="password"]').find(isVisibleElement) || null;
}

function findLoginNextButton() {
  return findClickableByText([
    /next|continue|login|log\s*in|sign\s*in/i,
    /下一步|继续|登录|登入/i,
  ]);
}

function findEmailNextButton() {
  return findClickableByText([
    /next|btn\s*next|btnnext/i,
    /下一页|下一步/i,
  ]);
}

function findPasswordLoginButton() {
  const button = findClickableByText([
    /login|log\s*in|sign\s*in/i,
    /登录|登入/i,
  ]);
  return button && button !== findEmailNextButton() ? button : null;
}

function findApproveButton() {
  return findEnabledClickableByText([
    /同意并继续|同意|授权|确认并继续/i,
    /agree\s*(?:and)?\s*continue|accept|authorize|agree|pay\s*now/i,
  ]);
}

function getPayPalHostedPathname() {
  return String(location?.pathname || '').trim();
}

function isPayPalHostedLoginPage() {
  const pathname = getPayPalHostedPathname();
  return pathname === '/pay'
    || Boolean(document.getElementById('email'));
}

function findHostedAccountCreateEmailContinueButton() {
  return findClickableByText([
    /continue\s+(?:to\s+)?pay(?:ment)?/i,
    /继续付款|继续支付/i,
  ]);
}

function isPayPalHostedAccountCreateEmailPage() {
  const bodyText = normalizeText(document.body?.innerText || '');
  const emailInput = document.getElementById('email') || findEmailInput();
  const hasCardOrAddressForm = Boolean(
    document.getElementById('cardNumber')
    || document.getElementById('billingLine1')
    || document.getElementById('cardExpiry')
    || document.getElementById('cardCvv')
  );
  return Boolean(emailInput)
    && !findPasswordInput()
    && !hasCardOrAddressForm
    && Boolean(findHostedAccountCreateEmailContinueButton())
    && (
      /创建\s*PayPal\s*账户|create\s+(?:a\s+)?paypal\s+account/i.test(bodyText)
      || /您已有账号了吗|already\s+have\s+an?\s+account/i.test(bodyText)
    );
}

function isPayPalHostedGuestCheckoutPage() {
  const pathname = getPayPalHostedPathname();
  return /\/checkoutweb\//i.test(pathname)
    || Boolean(document.getElementById('cardNumber'))
    || Boolean(document.getElementById('billingLine1'));
}

function getPayPalHostedGenericErrorMessage() {
  const bodyText = normalizeText(document.body?.innerText || '');
  const match = bodyText.match(
    /Things\s+don[’']?t\s+appear\s+to\s+be\s+working\s+at\s+the\s+moment\.?|Sorry,\s*something\s+went\s+wrong\.?\s*Please\s+try\s+again\.?|Something\s+went\s+wrong(?:\.?\s*Please\s+go\s+back\s+to\s+[^.]+?\s+and\s+choose\s+another\s+way\s+to\s+pay\.?\s*PayPal\s+isn[’']?t\s+available\s+at\s+this\s+time\.?)?/i
  );
  return match ? match[0] : '';
}

function isPayPalHostedGenericErrorPage() {
  const pathname = getPayPalHostedPathname();
  const bodyText = normalizeText(document.body?.innerText || '');
  return /\/checkoutweb\/genericError/i.test(pathname)
    || Boolean(getPayPalHostedGenericErrorMessage())
    || (
      /(?:sorry,\s*)?something\s+went\s+wrong/i.test(bodyText)
      && /return\s+to\s+merchant/i.test(bodyText)
    )
    || (
      /paypal\s+isn[’']?t\s+available\s+at\s+this\s+time/i.test(bodyText)
      && /choose\s+another\s+way\s+to\s+pay/i.test(bodyText)
    );
}

function getPayPalHostedGuestCardErrorMessage() {
  const bodyText = normalizeText(document.body?.innerText || '');
  const match = bodyText.match(
    /We\s+weren[’']?t\s+able\s+to\s+add\s+this\s+card\.?\s*Check\s+all\s+the\s+details\s+are\s+correct\s+and\s+try\s+again\s+or\s+try\s+a\s+different\s+card\.?|无法添加此卡|无法新增此卡|请检查所有详细信息是否正确.*(?:其他|不同).*卡/i
  );
  return match ? match[0] : '';
}

function hasPayPalHostedGuestCardError() {
  return Boolean(getPayPalHostedGuestCardErrorMessage());
}

function getPayPalHostedGuestPhoneErrorMessage() {
  const bodyText = normalizeText(document.body?.innerText || '');
  const match = bodyText.match(
    /We[’']?re\s+unable\s+to\s+complete\s+your\s+request\.?\s*Try\s+a\s+different\s+phone\s+number\.?|Try\s+a\s+different\s+phone\s+number\.?|请尝试其他手机号|请更换手机号/i
  );
  return match ? match[0] : '';
}

function hasPayPalHostedGuestPhoneError() {
  return Boolean(getPayPalHostedGuestPhoneErrorMessage());
}

function getPayPalHostedBlockedMessage() {
  const bodyText = normalizeText(document.body?.innerText || '');
  const match = bodyText.match(
    /You\s+have\s+been\s+blocked\.?|We\s+couldn[’']?t\s+load\s+the\s+security\s+challenge\.?/i
  );
  return match ? match[0] : '';
}

function isPayPalHostedBlockedPage() {
  const bodyText = normalizeText(document.body?.innerText || '');
  return Boolean(getPayPalHostedBlockedMessage())
    || (
      /you\s+have\s+been\s+blocked/i.test(bodyText)
      && /security\s+challenge/i.test(bodyText)
    );
}

function getPayPalHostedRedirectingMessage() {
  const bodyText = normalizeText(document.body?.innerText || '');
  const match = bodyText.match(
    /saving\s+your\s+info.*sending\s+you\s+back\s+to\s+the\s+merchant\.?/i
  );
  return match ? match[0] : '';
}

function isPayPalHostedRedirectingState() {
  return Boolean(getPayPalHostedRedirectingMessage());
}

function isPayPalHostedReviewPage() {
  return /\/webapps\/hermes/i.test(getPayPalHostedPathname());
}

function findHostedVerificationInputs() {
  return Array.from({ length: 6 }, (_, index) => document.getElementById(`ci-ciBasic-${index}`))
    .filter((input) => isVisibleElement(input));
}

function hasHostedVerificationInputs() {
  return findHostedVerificationInputs().length >= 6;
}

function getHostedVerificationErrorText() {
  const errorPattern = /check\s+the\s+code\s+and\s+try\s+again|(?:sorry,\s*)?something\s+went\s+wrong\.?\s*get\s+a\s+new\s+code|get\s+a\s+new\s+code/i;
  const alert = document.getElementById('message_ciBasic')
    || getVisibleControls('[role="alert"]').find((node) => errorPattern.test(normalizeText(node.textContent || '')));
  return alert && isVisibleElement(alert) ? normalizeText(alert.textContent || '') : '';
}

function hasHostedInvalidVerificationCodeError() {
  return /check\s+the\s+code\s+and\s+try\s+again|(?:sorry,\s*)?something\s+went\s+wrong\.?\s*get\s+a\s+new\s+code|get\s+a\s+new\s+code/i.test(getHostedVerificationErrorText());
}

function findHostedVerificationResendButton() {
  const direct = document.querySelector('button[data-testid="resend-link"]');
  if (direct && isVisibleElement(direct) && isEnabledControl(direct)) {
    return direct;
  }
  return findClickableByText([
    /resend/i,
    /重新发送|重发/i,
  ]);
}

function findHostedReviewConsentButton() {
  const direct = document.getElementById('consentButton')
    || document.querySelector('button[data-testid="consentButton"]');
  if (direct && isVisibleElement(direct) && isEnabledControl(direct)) {
    return direct;
  }
  return findEnabledClickableByText([
    /agree\s*(?:and)?\s*continue|accept|continue/i,
    /同意并继续|同意|继续/i,
  ]);
}

function detectPayPalHostedCheckoutStage() {
  if (!/paypal\./i.test(String(location?.host || ''))) {
    return PAYPAL_HOSTED_STAGE_OUTSIDE;
  }
  if (hasHostedVerificationInputs()) {
    return PAYPAL_HOSTED_STAGE_VERIFICATION;
  }
  if (isPayPalHostedBlockedPage()) {
    return PAYPAL_HOSTED_STAGE_BLOCKED;
  }
  if (isPayPalHostedGenericErrorPage()) {
    return PAYPAL_HOSTED_STAGE_GENERIC_ERROR;
  }
  if (isPayPalHostedAccountCreateEmailPage()) {
    return PAYPAL_HOSTED_STAGE_ACCOUNT_CREATE_EMAIL;
  }
  if (isPayPalHostedGuestCheckoutPage()) {
    return PAYPAL_HOSTED_STAGE_GUEST_CHECKOUT;
  }
  if (isPayPalHostedRedirectingState()) {
    return PAYPAL_HOSTED_STAGE_REDIRECTING;
  }
  if (isPayPalHostedReviewPage() && findHostedReviewConsentButton()) {
    return PAYPAL_HOSTED_STAGE_REVIEW;
  }
  if (isPayPalHostedLoginPage()) {
    return PAYPAL_HOSTED_STAGE_LOGIN;
  }
  if (Boolean(findApproveButton())) {
    return PAYPAL_HOSTED_STAGE_APPROVAL;
  }
  return PAYPAL_HOSTED_STAGE_UNKNOWN;
}

function fillHostedInputById(id, value) {
  const input = document.getElementById(String(id || '').trim());
  if (!input || !isVisibleElement(input) || !isEnabledControl(input)) {
    return false;
  }
  fillInput(input, String(value || ''));
  return true;
}

function selectHostedOptionByIdText(id, text) {
  const select = document.getElementById(String(id || '').trim());
  const expectedText = normalizeText(text);
  if (!select || !expectedText || !Array.isArray(Array.from(select.options || []))) {
    return false;
  }
  const match = Array.from(select.options || []).find((option) => {
    const label = normalizeText(option?.textContent || option?.label || '');
    const value = normalizeText(option?.value || '');
    return label.toLowerCase().includes(expectedText.toLowerCase())
      || value.toLowerCase().includes(expectedText.toLowerCase());
  });
  if (!match) {
    return false;
  }
  select.value = match.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function removeHostedCaptchaArtifacts() {
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
        // Ignore non-removable overlays.
      }
    });
  });
  return removed;
}

function startHostedCaptchaCleanupObserver(timeoutMs = 15000) {
  const observer = new MutationObserver(() => {
    removeHostedCaptchaArtifacts();
  });
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
  });
  setTimeout(() => observer.disconnect(), Math.max(1000, Number(timeoutMs) || 15000));
  return observer;
}

function findHostedGuestSubmitButton() {
  return document.querySelector('button[data-testid="submit-button"]')
    || document.querySelector('button[data-testid="hosted-payment-submit-button"]')
    || document.querySelector('button[data-atomic-wait-intent="Submit_Email"]')
    || document.querySelector('button.SubmitButton--complete')
    || findClickableByText([
      /pay|continue|next|agree|subscribe/i,
      /支付|继续|下一步|同意|订阅/i,
    ]);
}

function buildHostedRandomEmail() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 16; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${value}@gmail.com`;
}

function buildHostedRandomPassword() {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const symbols = '!@#$%^';
  const alphabet = `${lowercase}${uppercase}${digits}${symbols}`;
  const value = [
    lowercase[Math.floor(Math.random() * lowercase.length)],
    uppercase[Math.floor(Math.random() * uppercase.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];
  while (value.length < 14) {
    value.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
  }
  return value.sort(() => Math.random() - 0.5).join('');
}

function buildHostedVisaCard() {
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

function dispatchHostedGenericClick(button) {
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

async function clickHostedGenericSubmitButton(retries = 0) {
  removeHostedCaptchaArtifacts();
  const button = findHostedGuestSubmitButton() || findEmailNextButton() || findLoginNextButton();
  if (!button) {
    if (retries >= 10) {
      throw new Error('PayPal hosted checkout 未找到可点击的继续/提交按钮。');
    }
    await sleep(1000);
    return clickHostedGenericSubmitButton(retries + 1);
  }

  const buttonText = normalizeText(button.textContent || '');
  if (button.disabled) {
    if (retries >= 10) {
      throw new Error('PayPal hosted checkout 按钮长时间处于 disabled 状态。');
    }
    await sleep(1000);
    return clickHostedGenericSubmitButton(retries + 1);
  }

  const rect = button.getBoundingClientRect();
  if (rect.height === 0) {
    if (retries >= 10) {
      throw new Error('PayPal hosted checkout 按钮长时间不可见。');
    }
    await sleep(1000);
    return clickHostedGenericSubmitButton(retries + 1);
  }

  dispatchHostedGenericClick(button);
  await sleep(1000);
  removeHostedCaptchaArtifacts();

  if (hasHostedVerificationInputs()) {
    return {
      clicked: true,
      verificationRequired: true,
      buttonText,
    };
  }

  const currentText = normalizeText(button.textContent || '');
  if (!/processing/i.test(currentText) && currentText === buttonText) {
    if (retries >= 10) {
      return {
        clicked: true,
        verificationRequired: false,
        buttonText,
        retried: true,
      };
    }
    await sleep(2000);
    return clickHostedGenericSubmitButton(retries + 1);
  }

  return {
    clicked: true,
    verificationRequired: false,
    buttonText,
  };
}

function normalizeHostedVerificationCode(value = '') {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits.slice(0, 6);
}

async function submitHostedPayLogin(payload = {}) {
  await waitForDocumentComplete();
  removeHostedCaptchaArtifacts();
  const email = normalizeText(payload.email || buildHostedRandomEmail());
  if (!email) {
    throw new Error('PayPal hosted checkout 缺少邮箱。');
  }
  const emailInput = document.getElementById('email') || findEmailInput();
  if (!emailInput) {
    throw new Error('PayPal hosted checkout 未找到邮箱输入框。');
  }
  await sleep(2000);
  refillPayPalEmailInput(emailInput, email);
  await sleep(1000);
  const clickResult = await clickHostedGenericSubmitButton(0);
  return {
    stage: PAYPAL_HOSTED_STAGE_LOGIN,
    submitted: true,
    generatedEmail: email,
    verificationRequired: Boolean(clickResult?.verificationRequired),
    nextExpected: 'guest_checkout_or_verification',
  };
}

async function submitHostedAccountCreateEmail(payload = {}) {
  await waitForDocumentComplete();
  removeHostedCaptchaArtifacts();
  const email = normalizeText(payload.email || buildHostedRandomEmail());
  if (!email) {
    throw new Error('PayPal 创建账户页缺少邮箱。');
  }
  const emailInput = document.getElementById('email') || findEmailInput();
  if (!emailInput) {
    throw new Error('PayPal 创建账户页未找到邮箱输入框。');
  }
  await sleep(1000);
  refillPayPalEmailInput(emailInput, email);
  await sleep(500);
  const button = findHostedAccountCreateEmailContinueButton();
  if (button && isVisibleElement(button) && isEnabledControl(button)) {
    dispatchHostedGenericClick(button);
    await sleep(1000);
    removeHostedCaptchaArtifacts();
  } else {
    await clickHostedGenericSubmitButton(0);
  }
  return {
    stage: PAYPAL_HOSTED_STAGE_ACCOUNT_CREATE_EMAIL,
    submitted: true,
    generatedEmail: email,
    nextExpected: 'guest_checkout_or_verification',
  };
}

async function fillHostedVerificationCode(payload = {}) {
  const delayOperation = typeof performPayPalOperationWithDelay === 'function'
    ? performPayPalOperationWithDelay
    : async (_metadata, operation) => operation();
  await waitForDocumentComplete();
  const code = normalizeHostedVerificationCode(payload.verificationCode || payload.code || '');
  if (code.length !== 6) {
    throw new Error('PayPal hosted checkout 验证码无效。');
  }
  const inputs = findHostedVerificationInputs();
  if (inputs.length < 6) {
    throw new Error('PayPal hosted checkout 当前页面未显示验证码输入框。');
  }
  await delayOperation({ stepKey: 'plus-checkout-create', kind: 'fill', label: 'hosted-paypal-verification-code' }, async () => {
    inputs.forEach((input, index) => {
      fillInput(input, code[index] || '');
    });
  });
  return {
    stage: PAYPAL_HOSTED_STAGE_VERIFICATION,
    codeSubmitted: true,
  };
}

async function clickHostedVerificationResend() {
  const delayOperation = typeof performPayPalOperationWithDelay === 'function'
    ? performPayPalOperationWithDelay
    : async (_metadata, operation) => operation();
  await waitForDocumentComplete();
  const button = await waitUntil(() => findHostedVerificationResendButton(), {
    intervalMs: 250,
    timeoutMs: 10000,
    timeoutMessage: 'PayPal hosted checkout 当前验证码页未找到可用的 Resend 按钮。',
  });
  await delayOperation({ stepKey: 'plus-checkout-create', kind: 'click', label: 'hosted-paypal-verification-resend' }, async () => {
    simulateClick(button);
  });
  return {
    stage: PAYPAL_HOSTED_STAGE_VERIFICATION,
    resendClicked: true,
    invalidCodeVisibleAfterClick: hasHostedInvalidVerificationCodeError(),
  };
}

async function fillHostedGuestCheckout(payload = {}) {
  await waitForDocumentComplete();
  startHostedCaptchaCleanupObserver();
  removeHostedCaptchaArtifacts();
  log(`PayPal guest checkout：收到 payload.phone=${String(payload?.phone || '').trim() || '(空)'}，payload.address=${JSON.stringify(payload?.address || {})}`, 'info');

  await sleep(2000);
  const countrySelect = document.getElementById('country');
  if (countrySelect && String(countrySelect.value || '').trim().toUpperCase() !== 'US') {
    countrySelect.value = 'US';
    countrySelect.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(3000);
  }

  const card = buildHostedVisaCard();
  const email = normalizeText(payload.email || buildHostedRandomEmail());
  const phone = normalizeText(payload.phone || '');
  const password = String(payload.password || buildHostedRandomPassword());
  const firstName = normalizeText(payload.firstName || 'James');
  const lastName = normalizeText(payload.lastName || 'Smith');
  const cardNumber = String(payload.cardNumber || card.number).replace(/\s+/g, '');
  const cardExpiry = normalizeText(payload.cardExpiry || card.expiry);
  const cardCvv = normalizeText(payload.cardCvv || card.cvv);
  const address = payload.address && typeof payload.address === 'object' ? payload.address : {};

  if (!email || !phone || !password || !cardNumber || !cardExpiry || !cardCvv) {
    throw new Error('PayPal hosted checkout 缺少卡支付所需资料（请先填写 PayPal 电话(不带+1) 或导入 PayPal 接码池）。');
  }

  fillHostedInputById('email', email);
  fillHostedInputById('phone', phone);
  fillHostedInputById('cardNumber', cardNumber);
  fillHostedInputById('cardExpiry', cardExpiry);
  fillHostedInputById('cardCvv', cardCvv);
  fillHostedInputById('password', password);
  fillHostedInputById('firstName', firstName);
  fillHostedInputById('lastName', lastName);
  fillHostedInputById('billingLine1', address.street || '');
  fillHostedInputById('billingCity', address.city || '');
  fillHostedInputById('billingPostalCode', address.zip || '');
  fillHostedInputById('billingLine1', address.street || '');
  selectHostedOptionByIdText('billingState', address.state || '');

  const rootScope = typeof window !== 'undefined' ? window : globalThis;
  if (!rootScope[PAYPAL_HOSTED_GUEST_SUBMIT_SENTINEL]) {
    rootScope[PAYPAL_HOSTED_GUEST_SUBMIT_SENTINEL] = true;
    setTimeout(() => {
      try {
        throwIfStopped();
      } catch (error) {
        rootScope[PAYPAL_HOSTED_GUEST_SUBMIT_SENTINEL] = false;
        return;
      }
      clickHostedGenericSubmitButton(0).catch((error) => {
        log(`PayPal hosted checkout guest submit 失败：${error?.message || error}`, 'warn');
      }).finally(() => {
        rootScope[PAYPAL_HOSTED_GUEST_SUBMIT_SENTINEL] = false;
      });
    }, 500);
  }

  return {
    stage: PAYPAL_HOSTED_STAGE_GUEST_CHECKOUT,
    submitted: true,
    verificationRequired: Boolean(hasHostedVerificationInputs()),
    submitScheduled: true,
  };
}

async function clickHostedReviewConsent() {
  await waitForDocumentComplete();
  log(`PayPal Hermes：开始等待账单确认文案。当前 URL：${location.href}`, 'info');
  let waited = 0;
  while (waited < 30) {
    waited += 1;
    const pageText = document.body ? document.body.innerText : '';
    if (String(pageText || '').includes('Set up once. Pay faster next time')) {
      log(`PayPal Hermes：第 ${waited}/30 秒命中目标文案，开始寻找 consentButton。`, 'info');
      let button = findHostedReviewConsentButton();
      if (button && isEnabledControl(button)) {
        log('PayPal Hermes：已找到 consentButton，准备点击 Agree and Continue。', 'info');
        button.click();
        return {
          stage: PAYPAL_HOSTED_STAGE_REVIEW,
          submitted: true,
        };
      }
      log('PayPal Hermes：首次未找到 consentButton，2 秒后重试一次。', 'warn');
      await sleep(2000);
      button = findHostedReviewConsentButton();
      if (button && isEnabledControl(button)) {
        log('PayPal Hermes：重试后找到 consentButton，准备点击 Agree and Continue。', 'info');
        button.click();
        return {
          stage: PAYPAL_HOSTED_STAGE_REVIEW,
          submitted: true,
        };
      }
      log('PayPal Hermes：重试后仍未找到 consentButton。', 'warn');
      throw new Error('PayPal hosted checkout 未找到 consentButton。');
    }
    if (waited === 1 || waited % 5 === 0) {
      log(`PayPal Hermes：尚未命中目标文案，继续等待（${waited}/30）。`, 'info');
    }
    await sleep(1000);
  }
  log('PayPal Hermes：等待 30 秒后仍未命中目标文案。', 'warn');
  throw new Error('PayPal hosted checkout 账单确认页超时，未检测到目标文案。');
}

async function runHostedCheckoutStep(payload = {}) {
  const stage = detectPayPalHostedCheckoutStage();
  if (payload.resendVerificationCode && stage !== PAYPAL_HOSTED_STAGE_VERIFICATION) {
    return {
      stage,
      submitted: false,
      resendSkipped: true,
    };
  }
  if (stage === PAYPAL_HOSTED_STAGE_VERIFICATION) {
    if (payload.resendVerificationCode) {
      return clickHostedVerificationResend();
    }
    if (!payload.verificationCode && !payload.code) {
      return {
        stage,
        requiresVerificationCode: true,
      };
    }
    return fillHostedVerificationCode(payload);
  }
  if (stage === PAYPAL_HOSTED_STAGE_LOGIN) {
    return submitHostedPayLogin(payload);
  }
  if (stage === PAYPAL_HOSTED_STAGE_ACCOUNT_CREATE_EMAIL) {
    return submitHostedAccountCreateEmail(payload);
  }
  if (stage === PAYPAL_HOSTED_STAGE_GUEST_CHECKOUT) {
    return fillHostedGuestCheckout(payload);
  }
  if (stage === PAYPAL_HOSTED_STAGE_REVIEW) {
    return clickHostedReviewConsent();
  }
  return {
    stage,
    submitted: false,
    approveReady: Boolean(findApproveButton()),
  };
}

function shouldAutoRunHostedHermesReview() {
  const rootScope = typeof window !== 'undefined' ? window : globalThis;
  if (!isPayPalHostedReviewPage()) {
    return false;
  }
  if (rootScope[PAYPAL_HOSTED_HERMES_AUTORUN_SENTINEL]) {
    return false;
  }
  rootScope[PAYPAL_HOSTED_HERMES_AUTORUN_SENTINEL] = true;
  return true;
}

function scheduleHostedHermesAutoRun() {
  if (!shouldAutoRunHostedHermesReview()) {
    return;
  }
  log(`PayPal Hermes 页面已命中，按油猴脚本方式自动等待并点击 Agree and Continue。当前 URL：${location.href}`, 'info');
  setTimeout(() => {
    clickHostedReviewConsent().then(() => {
      log('PayPal Hermes：已按油猴脚本方式执行 Agree and Continue。', 'ok');
    }).catch((error) => {
      log(`PayPal Hermes：自动点击 Agree and Continue 失败：${error?.message || error}`, 'warn');
    });
  }, 0);
}

function findPasskeyPromptButtons() {
  const promptPatterns = [
    /passkey|通行密钥|安全密钥|下次登录|faster|save/i,
  ];
  const bodyText = normalizeText(document.body?.innerText || '');
  const likelyPrompt = promptPatterns.some((pattern) => pattern.test(bodyText));
  if (!likelyPrompt) {
    return [];
  }

  const cancelOrClose = getVisibleControls('button, a, [role="button"]')
    .filter((el) => {
      const text = getActionText(el);
      return /取消|稍后|不保存|不用|关闭|cancel|not now|maybe later|skip|close|x/i.test(text)
        || el.getAttribute?.('aria-label')?.match(/close|关闭/i);
    });

  const iconCloseButtons = getVisibleControls('button, [role="button"]')
    .filter((el) => {
      const text = getActionText(el);
      const rect = el.getBoundingClientRect();
      return (/^×$|^x$/i.test(text) || /close|关闭/i.test(text))
        && rect.width <= 64
        && rect.height <= 64;
    });

  return [...cancelOrClose, ...iconCloseButtons];
}

function hasPasskeyPrompt() {
  return findPasskeyPromptButtons().length > 0;
}

function getPayPalLoginPhase(emailInput, passwordInput) {
  const emailNextButton = findEmailNextButton();
  const passwordLoginButton = findPasswordLoginButton();
  if (emailInput && emailNextButton && isEnabledControl(emailNextButton) && (!passwordInput || !passwordLoginButton)) {
    return 'email';
  }
  if (emailInput && passwordInput) return 'login_combined';
  if (passwordInput) return 'password';
  if (emailInput) return 'email';
  return '';
}

function refillPayPalEmailInput(emailInput, email) {
  if (!emailInput) return;
  if (typeof emailInput.focus === 'function') {
    emailInput.focus();
  }
  fillInput(emailInput, '');
  fillInput(emailInput, email);
  if (typeof emailInput.blur === 'function') {
    emailInput.blur();
  }
}

async function submitPayPalLogin(payload = {}) {
  const delayOperation = typeof performPayPalOperationWithDelay === 'function'
    ? performPayPalOperationWithDelay
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  await waitForDocumentComplete();

  const email = normalizeText(payload.email || '');
  const password = String(payload.password || '');
  if (!password) {
    throw new Error('PayPal 密码为空，请先在侧边栏配置。');
  }

  let passwordInput = findPasswordInput();
  const emailInput = findEmailInput();
  const emailNextButton = findEmailNextButton();

  if (emailInput && emailNextButton && isEnabledControl(emailNextButton) && (!passwordInput || !findPasswordLoginButton())) {
    await delayOperation({ stepKey: 'paypal-approve', kind: 'submit', label: 'paypal-email' }, async () => {
      refillPayPalEmailInput(emailInput, email);
      simulateClick(emailNextButton);
    });
    return {
      submitted: false,
      phase: 'email_submitted',
      awaiting: 'password_page',
    };
  }

  if (!passwordInput && emailInput && email) {
    await delayOperation({ stepKey: 'paypal-approve', kind: 'submit', label: 'paypal-email' }, async () => {
      refillPayPalEmailInput(emailInput, email);
      const nextButton = await waitUntil(() => {
        const button = findEmailNextButton() || findLoginNextButton();
        return button && isEnabledControl(button) ? button : null;
      }, {
        intervalMs: 250,
        timeoutMs: 8000,
        timeoutMessage: 'PayPal email page did not expose a clickable next/continue button.',
      });
      simulateClick(nextButton);
    });
    return {
      submitted: false,
      phase: 'email_submitted',
      awaiting: 'password_page',
    };
  } else if (!passwordInput && emailInput && !email) {
    throw new Error('PayPal 账号为空，请先在侧边栏配置。');
  } else if (emailInput && email) {
    await delayOperation({ stepKey: 'paypal-approve', kind: 'fill', label: 'paypal-email' }, async () => {
      refillPayPalEmailInput(emailInput, email);
    });
  }

  passwordInput = passwordInput || await waitUntil(() => findPasswordInput(), {
    intervalMs: 250,
    timeoutMs: 8000,
    timeoutMessage: 'PayPal password page did not expose a password input.',
  });
  await delayOperation({ stepKey: 'paypal-approve', kind: 'submit', label: 'paypal-password' }, async () => {
    fillInput(passwordInput, password);
    await sleep(1000);

    const loginButton = await waitUntil(() => {
      const button = findClickableByText([
        /login|log\s*in|sign\s*in|continue/i,
        /登录|登入|继续/i,
      ]);
      return button && isEnabledControl(button) ? button : null;
    }, {
      intervalMs: 250,
      timeoutMs: 8000,
      timeoutMessage: 'PayPal password page did not expose a clickable login/continue button.',
    });

    simulateClick(loginButton);
  });
  return {
    submitted: true,
    phase: 'password_submitted',
    awaiting: 'redirect_or_approval',
  };
}

async function dismissPayPalPrompts() {
  const delayOperation = typeof performPayPalOperationWithDelay === 'function'
    ? performPayPalOperationWithDelay
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  await waitForDocumentComplete();
  const buttons = findPasskeyPromptButtons();
  let clicked = 0;
  for (const button of buttons) {
    if (!isVisibleElement(button) || !isEnabledControl(button)) {
      continue;
    }
    await delayOperation({ stepKey: 'paypal-approve', kind: 'click', label: 'paypal-dismiss-prompt' }, async () => {
      simulateClick(button);
    });
    clicked += 1;
    await sleep(500);
  }
  return {
    clicked,
    hasPromptAfterClick: hasPasskeyPrompt(),
  };
}

async function clickPayPalApprove() {
  const delayOperation = typeof performPayPalOperationWithDelay === 'function'
    ? performPayPalOperationWithDelay
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  await waitForDocumentComplete();
  await dismissPayPalPrompts().catch(() => ({ clicked: 0 }));

  const button = findApproveButton();
  if (!button || !isEnabledControl(button)) {
    return {
      clicked: false,
      state: inspectPayPalState(),
    };
  }

  await delayOperation({ stepKey: 'paypal-approve', kind: 'click', label: 'paypal-approve' }, async () => {
    simulateClick(button);
  });
  return {
    clicked: true,
    buttonText: getActionText(button),
  };
}

function inspectPayPalState() {
  const emailInput = findEmailInput();
  const passwordInput = findPasswordInput();
  const approveButton = findApproveButton();
  const loginPhase = getPayPalLoginPhase(emailInput, passwordInput);
  const hostedStage = detectPayPalHostedCheckoutStage();
  return {
    url: location.href,
    readyState: document.readyState,
    hostedStage,
    needsLogin: Boolean(loginPhase),
    loginPhase,
    hasEmailInput: Boolean(emailInput),
    hasPasswordInput: Boolean(passwordInput),
    hostedAccountCreateEmail: hostedStage === PAYPAL_HOSTED_STAGE_ACCOUNT_CREATE_EMAIL,
    hostedAccountCreateEmailContinueReady: Boolean(findHostedAccountCreateEmailContinueButton()),
    hasHostedGuestCheckout: hostedStage === PAYPAL_HOSTED_STAGE_GUEST_CHECKOUT,
    hostedBlocked: hostedStage === PAYPAL_HOSTED_STAGE_BLOCKED,
    hostedBlockedMessage: getPayPalHostedBlockedMessage(),
    hostedGenericError: hostedStage === PAYPAL_HOSTED_STAGE_GENERIC_ERROR,
    hostedGenericErrorMessage: getPayPalHostedGenericErrorMessage(),
    hostedRedirecting: hostedStage === PAYPAL_HOSTED_STAGE_REDIRECTING,
    hostedRedirectingMessage: getPayPalHostedRedirectingMessage(),
    hostedGuestCardError: hasPayPalHostedGuestCardError(),
    hostedGuestCardErrorMessage: getPayPalHostedGuestCardErrorMessage(),
    hostedGuestPhoneError: hasPayPalHostedGuestPhoneError(),
    hostedGuestPhoneErrorMessage: getPayPalHostedGuestPhoneErrorMessage(),
    verificationInputsVisible: hasHostedVerificationInputs(),
    hostedVerificationInvalidCode: hasHostedInvalidVerificationCodeError(),
    hostedVerificationErrorText: getHostedVerificationErrorText(),
    hostedVerificationResendReady: Boolean(findHostedVerificationResendButton()),
    reviewConsentReady: Boolean(findHostedReviewConsentButton()),
    approveReady: Boolean(approveButton && isEnabledControl(approveButton)),
    approveButtonText: approveButton ? getActionText(approveButton) : '',
    hasPasskeyPrompt: hasPasskeyPrompt(),
    bodyTextPreview: normalizeText(document.body?.innerText || '').slice(0, 240),
  };
}

scheduleHostedHermesAutoRun();
