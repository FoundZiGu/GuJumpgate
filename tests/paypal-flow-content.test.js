const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/paypal-flow.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (char === '{' && signatureEnded) {
      braceStart = index;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const char = source[end];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

function createElement({
  tag = 'div',
  type = '',
  id = '',
  name = '',
  text = '',
  value = '',
  placeholder = '',
  attrs = {},
  style = {},
  rect = { width: 160, height: 40 },
  parentElement = null,
} = {}) {
  return {
    nodeType: 1,
    tag,
    type,
    id,
    name,
    textContent: text,
    value,
    placeholder,
    disabled: false,
    hidden: Boolean(attrs.hidden),
    style: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      ...style,
    },
    parentElement,
    getAttribute(key) {
      if (key === 'type') return type;
      if (key === 'id') return id;
      if (key === 'name') return name;
      if (key === 'placeholder') return placeholder;
      if (key === 'value') return value;
      return Object.prototype.hasOwnProperty.call(attrs, key) ? attrs[key] : null;
    },
    getBoundingClientRect() {
      return rect;
    },
  };
}

function loadApi(elements) {
  const document = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'input') {
        return elements.filter((el) => el.tag === 'input');
      }
      if (selector === 'input[type="email"]') {
        return elements.filter((el) => el.tag === 'input' && el.type === 'email');
      }
      if (selector === 'input[type="password"]') {
        return elements.filter((el) => el.tag === 'input' && el.type === 'password');
      }
      if (selector.includes('button') || selector.includes('[role="button"]')) {
        return elements.filter((el) => el.tag === 'button' || el.attrs?.role === 'button');
      }
      return [];
    },
  };
  const window = {
    getComputedStyle(el) {
      return el?.style || { display: 'block', visibility: 'visible', opacity: '1' };
    },
  };

  return new Function('document', 'window', `
${extractFunction('isVisibleElement')}
${extractFunction('normalizeText')}
${extractFunction('getActionText')}
${extractFunction('getVisibleControls')}
${extractFunction('isEnabledControl')}
${extractFunction('findClickableByText')}
${extractFunction('findInputByPatterns')}
${extractFunction('findEmailInput')}
${extractFunction('findPasswordInput')}
${extractFunction('findLoginNextButton')}
${extractFunction('findEmailNextButton')}
${extractFunction('findPasswordLoginButton')}
${extractFunction('getPayPalLoginPhase')}
return {
  findEmailInput,
  findPasswordInput,
  findEmailNextButton,
  findPasswordLoginButton,
  getPayPalLoginPhase,
};
`)(document, window);
}

function createSubmitApi(overrides = {}) {
  const bindings = {
    waitForDocumentComplete: async () => {},
    normalizeText: (text = '') => String(text || '').replace(/\s+/g, ' ').trim(),
    findPasswordInput: () => null,
    findEmailInput: () => null,
    findEmailNextButton: () => null,
    isEnabledControl: () => true,
    findPasswordLoginButton: () => null,
    fillInput: () => {},
    simulateClick: () => {},
    waitUntil: async (predicate) => predicate(),
    findLoginNextButton: () => null,
    sleep: async () => {},
    ...overrides,
  };

  return new Function(
    'waitForDocumentComplete',
    'normalizeText',
    'findPasswordInput',
    'findEmailInput',
    'findEmailNextButton',
    'isEnabledControl',
    'findPasswordLoginButton',
    'fillInput',
    'simulateClick',
    'waitUntil',
    'findLoginNextButton',
    'sleep',
    `
${extractFunction('refillPayPalEmailInput')}
${extractFunction('submitPayPalLogin')}
return { refillPayPalEmailInput, submitPayPalLogin };
`
  )(
    bindings.waitForDocumentComplete,
    bindings.normalizeText,
    bindings.findPasswordInput,
    bindings.findEmailInput,
    bindings.findEmailNextButton,
    bindings.isEnabledControl,
    bindings.findPasswordLoginButton,
    bindings.fillInput,
    bindings.simulateClick,
    bindings.waitUntil,
    bindings.findLoginNextButton,
    bindings.sleep
  );
}

function loadHostedStageApi({ elements = [], locationOverride = {} } = {}) {
  const document = {
    documentElement: {},
    getElementById(id) {
      return elements.find((el) => el.id === id) || null;
    },
    querySelector(selector) {
      if (selector === 'button[data-testid="consentButton"]') {
        return elements.find((el) => el.tag === 'button' && el.attrs?.['data-testid'] === 'consentButton') || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('button') || selector.includes('[role="button"]')) {
        return elements.filter((el) => el.tag === 'button' || el.attrs?.role === 'button');
      }
      return [];
    },
  };
  const window = {
    getComputedStyle(el) {
      return el?.style || { display: 'block', visibility: 'visible', opacity: '1' };
    },
  };
  const location = {
    host: 'www.paypal.com',
    pathname: '/checkoutweb/demo',
    href: 'https://www.paypal.com/checkoutweb/demo',
    ...locationOverride,
  };

  return new Function('document', 'window', 'location', `
const PAYPAL_HOSTED_STAGE_OUTSIDE = 'outside_paypal';
const PAYPAL_HOSTED_STAGE_LOGIN = 'pay_login';
const PAYPAL_HOSTED_STAGE_GUEST_CHECKOUT = 'guest_checkout';
const PAYPAL_HOSTED_STAGE_VERIFICATION = 'verification';
const PAYPAL_HOSTED_STAGE_REVIEW = 'review_consent';
const PAYPAL_HOSTED_STAGE_APPROVAL = 'approval';
const PAYPAL_HOSTED_STAGE_UNKNOWN = 'unknown';
${extractFunction('isVisibleElement')}
${extractFunction('normalizeText')}
${extractFunction('getActionText')}
${extractFunction('getVisibleControls')}
${extractFunction('isEnabledControl')}
${extractFunction('findClickableByText')}
${extractFunction('findApproveButton')}
${extractFunction('getPayPalHostedPathname')}
${extractFunction('isPayPalHostedLoginPage')}
${extractFunction('isPayPalHostedGuestCheckoutPage')}
${extractFunction('isPayPalHostedReviewPage')}
${extractFunction('findHostedVerificationInputs')}
${extractFunction('hasHostedVerificationInputs')}
${extractFunction('findHostedReviewConsentButton')}
${extractFunction('detectPayPalHostedCheckoutStage')}
return {
  detectPayPalHostedCheckoutStage,
};
`)(document, window, location);
}

function createHostedVerificationApi(overrides = {}) {
  const bindings = {
    PAYPAL_HOSTED_STAGE_VERIFICATION: 'verification',
    findHostedVerificationInputs: () => [],
    normalizeHostedVerificationCode: (value = '') => String(value || '').replace(/\\D+/g, '').slice(0, 6),
    waitForDocumentComplete: async () => {},
    performPayPalOperationWithDelay: async (_metadata, operation) => operation(),
    fillInput: () => {},
    sleep: async () => {},
    ...overrides,
  };

  return new Function(
    'PAYPAL_HOSTED_STAGE_VERIFICATION',
    'findHostedVerificationInputs',
    'normalizeHostedVerificationCode',
    'waitForDocumentComplete',
    'performPayPalOperationWithDelay',
    'fillInput',
    'sleep',
    `
const PAYPAL_HOSTED_CODE_DIGIT_DELAY_MS = 300;
const PAYPAL_HOSTED_CODE_SUBMIT_DELAY_MS = 800;
${extractFunction('fillHostedVerificationCode')}
return { fillHostedVerificationCode };
`
  )(
    bindings.PAYPAL_HOSTED_STAGE_VERIFICATION,
    bindings.findHostedVerificationInputs,
    bindings.normalizeHostedVerificationCode,
    bindings.waitForDocumentComplete,
    bindings.performPayPalOperationWithDelay,
    bindings.fillInput,
    bindings.sleep
  );
}

function createHostedReviewApi(overrides = {}) {
  const bindings = {
    PAYPAL_HOSTED_STAGE_REVIEW: 'review_consent',
    waitForDocumentComplete: async () => {},
    isPayPalHostedReviewPage: () => true,
    detectPayPalHostedCheckoutStage: () => 'unknown',
    clickHostedReviewConsent: async () => ({ stage: 'review_consent', submitted: true }),
    ...overrides,
  };

  return new Function(
    'PAYPAL_HOSTED_STAGE_REVIEW',
    'waitForDocumentComplete',
    'isPayPalHostedReviewPage',
    'detectPayPalHostedCheckoutStage',
    'clickHostedReviewConsent',
    `
${extractFunction('runHostedCheckoutStep')}
return { runHostedCheckoutStep };
`
  )(
    bindings.PAYPAL_HOSTED_STAGE_REVIEW,
    bindings.waitForDocumentComplete,
    bindings.isPayPalHostedReviewPage,
    bindings.detectPayPalHostedCheckoutStage,
    bindings.clickHostedReviewConsent
  );
}

function createHostedGuestCheckoutApi(overrides = {}) {
  const bindings = {
    PAYPAL_HOSTED_STAGE_GUEST_CHECKOUT: 'guest_checkout',
    PAYPAL_HOSTED_DEFAULT_PHONE: '1234567890',
    PAYPAL_HOSTED_GUEST_SUBMIT_SENTINEL: '__sentinel__',
    waitForDocumentComplete: async () => {},
    startHostedCaptchaCleanupObserver: () => {},
    removeHostedCaptchaArtifacts: () => {},
    log: () => {},
    sleep: async () => {},
    buildHostedVisaCard: () => ({ number: '4111111111111111', expiry: '12/30', cvv: '123' }),
    normalizeText: (value = '') => String(value || '').replace(/\s+/g, ' ').trim(),
    buildHostedRandomEmail: () => 'fallback@example.com',
    buildHostedRandomPassword: () => 'fallback-password',
    fillHostedInputById: () => true,
    selectHostedOptionByIdText: () => true,
    hasHostedVerificationInputs: () => false,
    clickHostedGenericSubmitButton: async () => ({}),
    document: {
      getElementById: () => null,
    },
    window: {},
    Event: function Event(type, init) {
      this.type = type;
      this.init = init;
    },
    ...overrides,
  };

  return new Function(
    'PAYPAL_HOSTED_STAGE_GUEST_CHECKOUT',
    'PAYPAL_HOSTED_DEFAULT_PHONE',
    'PAYPAL_HOSTED_GUEST_SUBMIT_SENTINEL',
    'waitForDocumentComplete',
    'startHostedCaptchaCleanupObserver',
    'removeHostedCaptchaArtifacts',
    'log',
    'sleep',
    'buildHostedVisaCard',
    'normalizeText',
    'buildHostedRandomEmail',
    'buildHostedRandomPassword',
    'fillHostedInputById',
    'selectHostedOptionByIdText',
    'hasHostedVerificationInputs',
    'clickHostedGenericSubmitButton',
    'document',
    'window',
    'Event',
    ` 
${extractFunction('formatHostedPayPalPhoneInput')}
${extractFunction('fillHostedGuestCheckout')}
return { fillHostedGuestCheckout };
`
  )(
    bindings.PAYPAL_HOSTED_STAGE_GUEST_CHECKOUT,
    bindings.PAYPAL_HOSTED_DEFAULT_PHONE,
    bindings.PAYPAL_HOSTED_GUEST_SUBMIT_SENTINEL,
    bindings.waitForDocumentComplete,
    bindings.startHostedCaptchaCleanupObserver,
    bindings.removeHostedCaptchaArtifacts,
    bindings.log,
    bindings.sleep,
    bindings.buildHostedVisaCard,
    bindings.normalizeText,
    bindings.buildHostedRandomEmail,
    bindings.buildHostedRandomPassword,
    bindings.fillHostedInputById,
    bindings.selectHostedOptionByIdText,
    bindings.hasHostedVerificationInputs,
    bindings.clickHostedGenericSubmitButton,
    bindings.document,
    bindings.window,
    bindings.Event
  );
}

test('PayPal email page ignores hidden pre-rendered password input', () => {
  const hiddenPanel = createElement({ attrs: { 'aria-hidden': 'true' } });
  const emailInput = createElement({
    tag: 'input',
    type: 'text',
    id: 'login_email',
    name: 'login_email',
    value: 'user@example.com',
    placeholder: 'Email',
  });
  const hiddenPasswordInput = createElement({
    tag: 'input',
    type: 'password',
    id: 'login_password',
    name: 'login_password',
    parentElement: hiddenPanel,
  });
  const nextButton = createElement({
    tag: 'button',
    id: 'btnNext',
    text: 'Next',
  });

  const api = loadApi([emailInput, hiddenPasswordInput, nextButton]);

  assert.equal(api.findEmailInput(), emailInput);
  assert.equal(api.findPasswordInput(), null);
  assert.equal(api.findEmailNextButton(), nextButton);
  assert.equal(api.findPasswordLoginButton(), null);
  assert.equal(api.getPayPalLoginPhase(emailInput, api.findPasswordInput()), 'email');
});

test('PayPal combined login page still sees visible password input', () => {
  const emailInput = createElement({
    tag: 'input',
    type: 'text',
    id: 'login_email',
    name: 'login_email',
  });
  const passwordInput = createElement({
    tag: 'input',
    type: 'password',
    id: 'login_password',
    name: 'login_password',
  });
  const loginButton = createElement({
    tag: 'button',
    id: 'btnLogin',
    text: 'Log In',
  });

  const api = loadApi([emailInput, passwordInput, loginButton]);

  assert.equal(api.findEmailInput(), emailInput);
  assert.equal(api.findPasswordInput(), passwordInput);
  assert.equal(api.findPasswordLoginButton(), loginButton);
  assert.equal(api.getPayPalLoginPhase(emailInput, passwordInput), 'login_combined');
});

test('PayPal email submit refills a prefilled email before clicking next', async () => {
  const emailInput = createElement({
    tag: 'input',
    type: 'text',
    id: 'login_email',
    name: 'login_email',
    value: 'user@example.com',
    placeholder: 'Email',
  });
  const nextButton = createElement({
    tag: 'button',
    id: 'btnNext',
    text: 'Next',
  });
  const fillValues = [];
  const clicked = [];
  let focusCount = 0;
  let blurCount = 0;

  emailInput.focus = () => {
    focusCount += 1;
  };
  emailInput.blur = () => {
    blurCount += 1;
  };

  const api = createSubmitApi({
    findEmailInput: () => emailInput,
    findEmailNextButton: () => nextButton,
    fillInput: (element, value) => {
      fillValues.push(value);
      element.value = value;
    },
    simulateClick: (element) => {
      clicked.push(element);
    },
  });

  const result = await api.submitPayPalLogin({
    email: 'user@example.com',
    password: 'secret',
  });

  assert.deepEqual(fillValues, ['', 'user@example.com']);
  assert.equal(focusCount, 1);
  assert.equal(blurCount, 1);
  assert.deepEqual(clicked, [nextButton]);
  assert.deepEqual(result, {
    submitted: false,
    phase: 'email_submitted',
    awaiting: 'password_page',
  });
});

test('PayPal hosted checkout stage detection prioritizes verification popup over checkout path', () => {
  const verificationInputs = Array.from({ length: 6 }, (_, index) => createElement({
    tag: 'input',
    type: 'text',
    id: `ci-ciBasic-${index}`,
  }));
  const api = loadHostedStageApi({
    elements: verificationInputs,
    locationOverride: {
      pathname: '/checkoutweb/demo',
      href: 'https://www.paypal.com/checkoutweb/demo',
    },
  });

  assert.equal(api.detectPayPalHostedCheckoutStage(), 'verification');
});

test('PayPal checkoutweb signup stays in guest checkout stage even when consent text is visible', () => {
  const consentButton = createElement({
    tag: 'button',
    text: '同意并继续',
    attrs: { 'data-testid': 'consentButton' },
  });
  const cardNumberInput = createElement({
    tag: 'input',
    type: 'text',
    id: 'cardNumber',
  });
  const api = loadHostedStageApi({
    elements: [consentButton, cardNumberInput],
    locationOverride: {
      pathname: '/checkoutweb/signup',
      href: 'https://www.paypal.com/checkoutweb/signup?token=demo',
    },
  });

  assert.equal(api.detectPayPalHostedCheckoutStage(), 'guest_checkout');
});

test('PayPal hosted checkout verification filler writes six digits into split inputs', async () => {
  const inputs = Array.from({ length: 6 }, (_, index) => createElement({
    tag: 'input',
    type: 'text',
    id: `ci-ciBasic-${index}`,
    value: '',
  }));
  const writes = [];
  const sleeps = [];
  const api = createHostedVerificationApi({
    findHostedVerificationInputs: () => inputs,
    fillInput: (element, value) => {
      writes.push({ id: element.id, value });
      element.value = value;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  const result = await api.fillHostedVerificationCode({
    verificationCode: '123456',
  });

  assert.deepEqual(writes, [
    { id: 'ci-ciBasic-0', value: '1' },
    { id: 'ci-ciBasic-1', value: '2' },
    { id: 'ci-ciBasic-2', value: '3' },
    { id: 'ci-ciBasic-3', value: '4' },
    { id: 'ci-ciBasic-4', value: '5' },
    { id: 'ci-ciBasic-5', value: '6' },
  ]);
  assert.deepEqual(sleeps, [300, 300, 300, 300, 300, 300, 800]);
  assert.deepEqual(result, {
    stage: 'verification',
    codeSubmitted: true,
  });
});

test('PayPal hosted guest checkout uses the supplied random PayPal email', async () => {
  const writes = [];
  const api = createHostedGuestCheckoutApi({
    fillHostedInputById: (id, value) => {
      writes.push({ id, value });
      return true;
    },
  });

  const result = await api.fillHostedGuestCheckout({
    email: 'paypal-random@example.com',
    password: 'paypal-password',
    phone: '+15551234567',
    firstName: 'Ada',
    lastName: 'Lovelace',
    cardNumber: '4111111111111111',
    cardExpiry: '12/30',
    cardCvv: '123',
    address: {
      street: '1 Main St',
      city: 'New York',
      zip: '10001',
      state: 'NY',
    },
  });

  assert.equal(writes.find((entry) => entry.id === 'email')?.value, 'paypal-random@example.com');
  assert.equal(writes.find((entry) => entry.id === 'phone')?.value, '5551234567');
  assert.equal(result.generatedEmail, 'paypal-random@example.com');
});

test('PayPal hosted review path bypasses generic stage detection and directly runs review handler', async () => {
  const calls = [];
  const api = createHostedReviewApi({
    isPayPalHostedReviewPage: () => true,
    detectPayPalHostedCheckoutStage: () => {
      calls.push('detect');
      return 'guest_checkout';
    },
    clickHostedReviewConsent: async () => {
      calls.push('review');
      return { stage: 'review_consent', submitted: true };
    },
  });

  const result = await api.runHostedCheckoutStep({});

  assert.deepEqual(calls, ['review']);
  assert.deepEqual(result, { stage: 'review_consent', submitted: true });
});
