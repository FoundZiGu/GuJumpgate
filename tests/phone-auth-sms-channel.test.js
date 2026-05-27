const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPhoneAuthModule() {
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
    setTimeout,
    clearTimeout,
    Event: FakeEvent,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return {
    module: sandbox.MultiPagePhoneAuth,
    sandbox,
  };
}

function createSelect(options = []) {
  const select = {
    options: options.map((option) => ({
      value: option.value,
      label: option.label,
      textContent: option.label,
    })),
    selectedIndex: 0,
    dispatchEvent() {},
  };
  Object.defineProperty(select, 'value', {
    get() {
      return this.options[this.selectedIndex]?.value || '';
    },
    set(nextValue) {
      const index = this.options.findIndex((option) => option.value === nextValue);
      this.selectedIndex = index >= 0 ? index : 0;
    },
  });
  return select;
}

function createChannelDom(config = {}) {
  const { channels = [], includeGroup = true, initialChannel = '' } = config;
  if (!includeGroup) {
    return {
      hiddenChannelInput: null,
      radioInputs: [],
      labels: [],
      group: null,
      getCheckedChannel: () => '',
      setCheckedChannel: () => {},
    };
  }

  const hiddenChannelInput = {
    value: initialChannel,
    dispatchEvent() {},
  };

  const radioInputs = [];
  const labels = [];

  const setCheckedChannel = (channel) => {
    hiddenChannelInput.value = channel;
    radioInputs.forEach((input) => {
      input.checked = input.value === channel;
      if (input.label) {
        input.label.attrs['data-state'] = input.checked ? 'on' : 'off';
      }
    });
  };

  channels.forEach((entry) => {
    const input = {
      value: entry.value,
      checked: false,
      attrs: {},
      dispatchEvent() {},
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      getAttribute(name) {
        return this.attrs[name] || '';
      },
      closest(selector) {
        return selector === 'label' ? this.label : null;
      },
    };
    const label = {
      textContent: entry.text,
      attrs: { 'data-state': 'off' },
      querySelector(selector) {
        return selector === 'input[type="radio"]' ? input : null;
      },
      getAttribute(name) {
        return this.attrs[name] || '';
      },
      closest(selector) {
        return selector === 'label' ? this : null;
      },
      matches(selector) {
        return selector === 'label';
      },
      dispatchEvent() {},
    };
    label.__click = () => setCheckedChannel(entry.value);
    input.label = label;
    radioInputs.push(input);
    labels.push(label);
  });

  setCheckedChannel(initialChannel || radioInputs[0]?.value || '');

  const group = {
    textContent: 'Send code via',
  };

  return {
    hiddenChannelInput,
    radioInputs,
    labels,
    group,
    getCheckedChannel: () => hiddenChannelInput.value,
    setCheckedChannel,
  };
}

function createPhoneAuthHarness(config = {}) {
  const phoneAuthRuntime = loadPhoneAuthModule();
  const channelDom = createChannelDom({
    includeGroup: config.includeChannelGroup !== false,
    channels: config.channels || [],
    initialChannel: config.initialChannel || '',
  });

  const phoneInput = {
    value: '',
    dispatchEvent() {},
    closest() {
      return fieldRoot;
    },
  };
  const hiddenPhoneInput = {
    value: '',
    dispatchEvent() {},
  };
  const submitButton = {
    disabled: false,
    textContent: 'Continue',
  };
  submitButton.__click = () => {
    state.phase = 'phone-verification';
  };

  const select = createSelect(config.countries || [
    { value: 'US', label: 'United States (+1)' },
  ]);

  const dialCodeSpan = {
    textContent: '1',
  };
  const fieldRoot = {
    querySelectorAll(selector) {
      return selector === 'span' ? [dialCodeSpan] : [];
    },
  };

  const form = {
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
          return channelDom.hiddenChannelInput;
        default:
          return null;
      }
    },
    querySelectorAll(selector) {
      switch (selector) {
        case 'button[type="submit"], input[type="submit"]':
          return [submitButton];
        case 'input[type="radio"]':
          return channelDom.radioInputs;
        case 'span':
          return [dialCodeSpan];
        default:
          return [];
      }
    },
  };

  const state = {
    phase: 'add-phone',
  };

  const document = {
    querySelector(selector) {
      if (selector === 'form[action*="/add-phone" i]') {
        return form;
      }
      if (selector === 'form[action*="/phone-verification" i]') {
        return state.phase === 'phone-verification' ? { querySelector() { return null; }, querySelectorAll() { return []; } } : null;
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
    title: 'Add phone',
  };

  Object.defineProperty(phoneAuthRuntime.sandbox, 'document', {
    value: document,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(phoneAuthRuntime.sandbox, 'location', {
    value: {
      get pathname() {
        return state.phase === 'phone-verification' ? '/phone-verification' : '/add-phone';
      },
      get href() {
        return `https://auth.openai.com${this.pathname}`;
      },
    },
    configurable: true,
    writable: true,
  });

  const helpers = phoneAuthRuntime.module.createPhoneAuthHelpers({
    document,
    fillInput(element, value) {
      element.value = value;
      if (typeof config.afterFill === 'function') {
        config.afterFill({ channelDom, state, phoneInput, hiddenPhoneInput });
      }
    },
    getActionText(element) {
      return String(element?.textContent || '').trim();
    },
    getPageTextSnapshot() {
      return config.pageText || '';
    },
    getVerificationErrorText() {
      return '';
    },
    humanPause: async () => {},
    isActionEnabled(element) {
      return !element?.disabled;
    },
    isAddPhonePageReady() {
      return state.phase === 'add-phone';
    },
    isConsentReady() {
      return false;
    },
    isPhoneVerificationPageReady() {
      return state.phase === 'phone-verification';
    },
    isVisibleElement() {
      return true;
    },
    performOperationWithDelay: async (_metadata, operation) => operation(),
    simulateClick(element) {
      if (typeof element?.__click === 'function') {
        element.__click();
      }
    },
    sleep: async () => {},
    throwIfStopped() {},
    waitForElement: async () => null,
  });

  return {
    channelDom,
    helpers,
    hiddenPhoneInput,
    phoneInput,
    select,
    state,
  };
}

test('submitPhoneNumber forces Text Message when WhatsApp is initially selected', async () => {
  const harness = createPhoneAuthHarness({
    channels: [
      { value: 'whatsapp', text: 'WhatsApp' },
      { value: 'sms', text: 'Text Message' },
    ],
    initialChannel: 'whatsapp',
  });

  await harness.helpers.submitPhoneNumber({
    phoneNumber: '+15551234567',
    countryLabel: 'United States',
  });

  assert.equal(harness.channelDom.getCheckedChannel(), 'sms');
  assert.equal(harness.phoneInput.value, '5551234567');
  assert.equal(harness.hiddenPhoneInput.value, '+15551234567');
  assert.equal(harness.state.phase, 'phone-verification');
});

test('submitPhoneNumber selects Text Message regardless of option order', async () => {
  const harness = createPhoneAuthHarness({
    channels: [
      { value: 'sms', text: 'Text Message' },
      { value: 'whatsapp', text: 'WhatsApp' },
    ],
    initialChannel: 'whatsapp',
  });

  await harness.helpers.submitPhoneNumber({
    phoneNumber: '+15551234567',
    countryLabel: 'United States',
  });

  assert.equal(harness.channelDom.getCheckedChannel(), 'sms');
});

test('submitPhoneNumber re-applies Text Message after fill-time channel reset', async () => {
  const harness = createPhoneAuthHarness({
    channels: [
      { value: 'whatsapp', text: 'WhatsApp' },
      { value: 'sms', text: 'Text Message' },
    ],
    initialChannel: 'whatsapp',
    afterFill({ channelDom }) {
      channelDom.setCheckedChannel('whatsapp');
    },
  });

  await harness.helpers.submitPhoneNumber({
    phoneNumber: '+15551234567',
    countryLabel: 'United States',
  });

  assert.equal(harness.channelDom.getCheckedChannel(), 'sms');
});

test('submitPhoneNumber fails when Send code via exists without Text Message', async () => {
  const harness = createPhoneAuthHarness({
    channels: [
      { value: 'whatsapp', text: 'WhatsApp' },
    ],
    initialChannel: 'whatsapp',
  });

  await assert.rejects(
    harness.helpers.submitPhoneNumber({
      phoneNumber: '+15551234567',
      countryLabel: 'United States',
    }),
    /Text Message \/ SMS option/i
  );
});

test('submitPhoneNumber remains compatible when no send-channel group is present', async () => {
  const harness = createPhoneAuthHarness({
    includeChannelGroup: false,
  });

  await harness.helpers.submitPhoneNumber({
    phoneNumber: '+15551234567',
    countryLabel: 'United States',
  });

  assert.equal(harness.phoneInput.value, '5551234567');
  assert.equal(harness.hiddenPhoneInput.value, '+15551234567');
  assert.equal(harness.state.phase, 'phone-verification');
});
