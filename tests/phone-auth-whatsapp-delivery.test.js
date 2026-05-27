const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPhoneAuthModule(document, locationOverride = null) {
  const filePath = path.join(__dirname, '..', 'content', 'phone-auth.js');
  const source = fs.readFileSync(filePath, 'utf8');
  class FakeEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = Boolean(options.bubbles);
    }
  }
  const sandbox = {
    console,
    document,
    location: locationOverride || {
      href: 'https://auth.openai.com/phone-verification',
      pathname: '/phone-verification',
      assign(nextUrl) {
        this.href = String(nextUrl || '');
        this.pathname = new URL(this.href, 'https://auth.openai.com').pathname;
      },
    },
    Event: FakeEvent,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPagePhoneAuth;
}

function createDeliveryHarness({ describedByText = '', pageText = '' }) {
  const subtitle = {
    innerText: describedByText,
    textContent: describedByText,
  };
  const codeInput = {
    getAttribute(name) {
      if (name === 'aria-describedby') {
        return 'subtitle';
      }
      return '';
    },
  };
  const form = {
    getAttribute() {
      return '';
    },
    querySelector(selector) {
      if (selector.includes('input[name="code"]')) {
        return codeInput;
      }
      return null;
    },
    parentElement: {
      parentElement: {
        querySelectorAll() {
          return [];
        },
      },
    },
  };
  form.contains = () => false;
  const document = {
    body: {
      innerText: pageText,
      textContent: pageText,
    },
    documentElement: {
      lang: 'zh-CN',
      getAttribute(name) {
        return name === 'lang' ? 'zh-CN' : '';
      },
    },
    getElementById(id) {
      return id === 'subtitle' ? subtitle : null;
    },
    querySelector(selector) {
      if (selector === 'form[action*="/phone-verification" i]') {
        return form;
      }
      return null;
    },
  };
  const module = loadPhoneAuthModule(document);
  const helpers = module.createPhoneAuthHelpers({
    fillInput() {},
    getActionText: (element) => String(element?.textContent || ''),
    getPageTextSnapshot: () => pageText,
    getVerificationErrorText: () => '',
    humanPause: async () => {},
    isActionEnabled: () => true,
    isAddPhonePageReady: () => false,
    isConsentReady: () => false,
    isPhoneVerificationPageReady: () => true,
    isVisibleElement: () => true,
    simulateClick() {},
    sleep: async () => {},
    throwIfStopped() {},
    waitForElement: async () => null,
  });
  return helpers.getPhoneVerificationDeliveryInfo();
}

function createSubmitHarness({ describedByText = '' }) {
  const subtitle = {
    innerText: describedByText,
    textContent: describedByText,
  };
  const codeInput = {
    getAttribute(name) {
      if (name === 'aria-describedby') {
        return 'subtitle';
      }
      return '';
    },
  };
  const phoneVerificationForm = {
    getAttribute() {
      return '';
    },
    querySelector(selector) {
      if (selector.includes('input[name="code"]')) {
        return codeInput;
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
    contains() {
      return false;
    },
    parentElement: {
      parentElement: {
        querySelectorAll() {
          return [];
        },
      },
    },
  };
  const phoneInput = {
    value: '',
    dispatchEvent() {},
    closest() {
      return {
        querySelectorAll(selector) {
          return selector === 'span'
            ? [{ textContent: '57' }]
            : [];
        },
      };
    },
  };
  const hiddenPhoneInput = {
    value: '',
    dispatchEvent() {},
  };
  const hiddenChannelInput = {
    value: 'sms',
    dispatchEvent() {},
  };
  const submitButton = {
    disabled: false,
    textContent: '继续',
  };
  const select = {
    options: [{ value: 'CO', label: 'Colombia (+57)', textContent: 'Colombia (+57)' }],
    selectedIndex: 0,
    dispatchEvent() {},
    get value() {
      return 'CO';
    },
    set value(_) {},
  };
  const addPhoneForm = {
    getAttribute(name) {
      return name === 'aria-labelledby' ? 'add-phone-title' : '';
    },
    querySelector(selector) {
      switch (selector) {
        case 'select':
          return select;
        case 'button[aria-haspopup="listbox"]':
          return null;
        case 'input[type="tel"], input[name="__reservedForPhoneNumberInput_tel"], input[autocomplete="tel"]':
          return phoneInput;
        case 'input[name="phoneNumber"]':
          return hiddenPhoneInput;
        case 'input[name="channel"]':
          return hiddenChannelInput;
        default:
          return null;
      }
    },
    querySelectorAll(selector) {
      if (selector === 'button[type="submit"], input[type="submit"]') {
        return [submitButton];
      }
      return [];
    },
    parentElement: {
      parentElement: {
        innerText: describedByText,
        textContent: describedByText,
      },
    },
  };
  let phase = 'add-phone';
  const locationState = {
    href: 'https://auth.openai.com/add-phone',
    pathname: '/add-phone',
    assign(nextUrl) {
      this.href = String(nextUrl || '');
      this.pathname = new URL(this.href, 'https://auth.openai.com').pathname;
    },
  };
  submitButton.__click = () => {
    phase = 'phone-verification';
    locationState.href = 'https://auth.openai.com/phone-verification';
    locationState.pathname = '/phone-verification';
  };
  const document = {
    body: {
      innerText: describedByText,
      textContent: describedByText,
    },
    documentElement: {
      lang: 'zh-CN',
      getAttribute(name) {
        return name === 'lang' ? 'zh-CN' : '';
      },
    },
    getElementById(id) {
      if (id === 'subtitle') {
        return subtitle;
      }
      if (id === 'add-phone-title') {
        return {
          innerText: '电话号码是必填项',
          textContent: '电话号码是必填项',
        };
      }
      return null;
    },
    querySelector(selector) {
      if (selector === 'form[action*="/add-phone" i]') {
        return phase === 'add-phone' ? addPhoneForm : null;
      }
      if (selector === 'form[action*="/phone-verification" i]') {
        return phase === 'phone-verification' ? phoneVerificationForm : null;
      }
      return null;
    },
  };
  const module = loadPhoneAuthModule(document, locationState);
  const helpers = module.createPhoneAuthHelpers({
    fillInput(element, value) {
      element.value = value;
    },
    getActionText: (element) => String(element?.textContent || ''),
    getPageTextSnapshot: () => describedByText,
    getVerificationErrorText: () => '',
    humanPause: async () => {},
    isActionEnabled: () => true,
    isAddPhonePageReady: () => phase === 'add-phone',
    isConsentReady: () => false,
    isPhoneVerificationPageReady: () => phase === 'phone-verification',
    isVisibleElement: () => true,
    performOperationWithDelay: async (_meta, operation) => operation(),
    simulateClick(element) {
      if (typeof element?.__click === 'function') {
        element.__click();
      }
    },
    sleep: async () => {},
    throwIfStopped() {},
    waitForElement: async () => phoneInput,
  });
  return helpers;
}

test('phone verification delivery detects WhatsApp from Chinese subtitle', () => {
  const delivery = createDeliveryHarness({
    describedByText: '输入我们刚刚通过 WhatsApp 发送到 +57 324 4489253 的验证码。',
  });

  assert.equal(delivery.channel, 'whatsapp');
  assert.match(delivery.text, /WhatsApp/i);
});

test('add-phone delivery detects WhatsApp from subtitle', () => {
  const subtitleText = '要继续，请添加手机号码。我们会通过 WhatsApp 向该号码发送一次性验证码进行验证。';
  const form = {
    getAttribute(name) {
      return name === 'aria-labelledby' ? 'title' : '';
    },
    parentElement: {
      parentElement: {
        innerText: subtitleText,
        textContent: subtitleText,
      },
    },
  };
  const document = {
    body: {
      innerText: subtitleText,
      textContent: subtitleText,
    },
    documentElement: {
      lang: 'zh-CN',
      getAttribute(name) {
        return name === 'lang' ? 'zh-CN' : '';
      },
    },
    getElementById(id) {
      if (id === 'title') {
        return { innerText: '电话号码是必填项', textContent: '电话号码是必填项' };
      }
      return null;
    },
    querySelector(selector) {
      if (selector === 'form[action*="/add-phone" i]') {
        return form;
      }
      return null;
    },
  };
  const module = loadPhoneAuthModule(document, {
    href: 'https://auth.openai.com/add-phone',
    pathname: '/add-phone',
    assign() {},
  });
  const helpers = module.createPhoneAuthHelpers({
    fillInput() {},
    getActionText: () => '',
    getPageTextSnapshot: () => subtitleText,
    getVerificationErrorText: () => '',
    humanPause: async () => {},
    isActionEnabled: () => true,
    isAddPhonePageReady: () => true,
    isConsentReady: () => false,
    isPhoneVerificationPageReady: () => false,
    isVisibleElement: () => true,
    simulateClick() {},
    sleep: async () => {},
    throwIfStopped() {},
    waitForElement: async () => null,
  });

  const delivery = helpers.getAddPhoneDeliveryInfo();
  assert.equal(delivery.channel, 'whatsapp');
  assert.match(delivery.text, /WhatsApp/i);
  assert.doesNotMatch(delivery.text, /阿尔巴尼亚|哥伦比亚 \(\+57\)|隐私政策/i);
});

test('add-phone delivery does not treat send-code-via WhatsApp option as page-level WhatsApp flow', () => {
  const form = {
    getAttribute(name) {
      return name === 'aria-labelledby' ? 'title' : '';
    },
    parentElement: {
      parentElement: {
        innerText: '电话号码是必填项 Send code via WhatsApp SMS',
        textContent: '电话号码是必填项 Send code via WhatsApp SMS',
      },
    },
  };
  const document = {
    body: {
      innerText: 'Send code via WhatsApp SMS',
      textContent: 'Send code via WhatsApp SMS',
    },
    documentElement: {
      lang: 'en',
      getAttribute(name) {
        return name === 'lang' ? 'en' : '';
      },
    },
    getElementById(id) {
      if (id === 'title') {
        return { innerText: 'Phone number required', textContent: 'Phone number required' };
      }
      return null;
    },
    querySelector(selector) {
      if (selector === 'form[action*="/add-phone" i]') {
        return form;
      }
      return null;
    },
  };
  const module = loadPhoneAuthModule(document, {
    href: 'https://auth.openai.com/add-phone',
    pathname: '/add-phone',
    assign() {},
  });
  const helpers = module.createPhoneAuthHelpers({
    fillInput() {},
    getActionText: () => '',
    getPageTextSnapshot: () => 'Send code via WhatsApp SMS',
    getVerificationErrorText: () => '',
    humanPause: async () => {},
    isActionEnabled: () => true,
    isAddPhonePageReady: () => true,
    isConsentReady: () => false,
    isPhoneVerificationPageReady: () => false,
    isVisibleElement: () => true,
    simulateClick() {},
    sleep: async () => {},
    throwIfStopped() {},
    waitForElement: async () => null,
  });

  const delivery = helpers.getAddPhoneDeliveryInfo();
  assert.equal(delivery.channel, '');
});

test('phone verification delivery detects WhatsApp from English subtitle', () => {
  const delivery = createDeliveryHarness({
    describedByText: 'Enter the code we just sent to +1 555 123 4567 via WhatsApp.',
  });

  assert.equal(delivery.channel, 'whatsapp');
  assert.match(delivery.text, /WhatsApp/i);
});

test('phone verification delivery detects SMS subtitle without false positive', () => {
  const delivery = createDeliveryHarness({
    describedByText: 'Enter the code we just sent to +1 555 123 4567 via SMS.',
    pageText: '继续 重新发送 WhatsApp 消息',
  });

  assert.equal(delivery.channel, 'sms');
  assert.doesNotMatch(delivery.text, /重新发送 WhatsApp 消息/i);
});

test('phone verification delivery ignores resend button WhatsApp text when subtitle does not mention it', () => {
  const delivery = createDeliveryHarness({
    describedByText: '输入我们刚刚发送到 +57 324 4489253 的验证码。',
    pageText: '继续 重新发送 WhatsApp 消息',
  });

  assert.equal(delivery.channel, '');
});

test('submitPhoneNumber carries WhatsApp delivery info into the first phone-verification snapshot', async () => {
  const helpers = createSubmitHarness({
    describedByText: '输入我们刚刚发送到 +57 324 4489232 的验证码。',
  });

  const result = await helpers.submitPhoneNumber({
    phoneNumber: '+573244489232',
    countryLabel: 'Colombia',
  });

  assert.equal(result.phoneVerificationPage, true);
  assert.equal(result.phoneVerificationDeliveryChannel, '');
  assert.equal(result.phoneVerificationWhatsApp, false);
});

test('submitPhoneNumber throws WhatsApp restart signal when add-phone subtitle already requires WhatsApp', async () => {
  const helpers = createSubmitHarness({
    describedByText: '要继续，请添加手机号码。我们会通过 WhatsApp 向该号码发送一次性验证码进行验证。',
  });

  await assert.rejects(
    helpers.submitPhoneNumber({
      phoneNumber: '+573244489232',
      countryLabel: 'Colombia',
    }),
    /STEP9_WHATSAPP_PAGE_RESTART::/
  );
});

test('phone verification delivery reads aria-describedby text even when subtitle is not visibly measurable', () => {
  const subtitle = {
    innerText: '输入我们刚刚通过 WhatsApp 发送到 +57 324 4489232 的验证码。',
    textContent: '输入我们刚刚通过 WhatsApp 发送到 +57 324 4489232 的验证码。',
    getBoundingClientRect() {
      return { width: 0, height: 0 };
    },
  };
  const codeInput = {
    getAttribute(name) {
      return name === 'aria-describedby' ? 'subtitle' : '';
    },
    getBoundingClientRect() {
      return { width: 10, height: 10 };
    },
  };
  const form = {
    getAttribute() {
      return '';
    },
    querySelector(selector) {
      if (selector.includes('input[name="code"]')) {
        return codeInput;
      }
      return null;
    },
    contains() {
      return false;
    },
    parentElement: {
      parentElement: {
        querySelectorAll() {
          return [];
        },
      },
    },
  };
  const document = {
    body: {
      innerText: '',
      textContent: '',
    },
    documentElement: {
      lang: 'zh-CN',
      getAttribute(name) {
        return name === 'lang' ? 'zh-CN' : '';
      },
    },
    getElementById(id) {
      return id === 'subtitle' ? subtitle : null;
    },
    querySelector(selector) {
      if (selector === 'form[action*="/phone-verification" i]') {
        return form;
      }
      return null;
    },
  };
  const module = loadPhoneAuthModule(document, {
    href: 'https://auth.openai.com/phone-verification',
    pathname: '/phone-verification',
    assign() {},
  });
  const helpers = module.createPhoneAuthHelpers({
    fillInput() {},
    getActionText: () => '',
    getPageTextSnapshot: () => '',
    getVerificationErrorText: () => '',
    humanPause: async () => {},
    isActionEnabled: () => true,
    isAddPhonePageReady: () => false,
    isConsentReady: () => false,
    isPhoneVerificationPageReady: () => true,
    isVisibleElement: (element) => element === codeInput,
    simulateClick() {},
    sleep: async () => {},
    throwIfStopped() {},
    waitForElement: async () => null,
  });

  const delivery = helpers.getPhoneVerificationDeliveryInfo();
  assert.equal(delivery.channel, 'whatsapp');
});
