const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadBackgroundPhoneVerificationModule() {
  const filePath = path.join(__dirname, '..', 'background', 'phone-verification-flow.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundPhoneVerification;
}

function createHelpersForWhatsappPage(stateOverrides = {}) {
  const module = loadBackgroundPhoneVerificationModule();
  const logs = [];
  const stateUpdates = [];
  let state = {
    currentPhoneActivation: {
      phoneNumber: '+573244489253',
      activationId: 'act_1',
      provider: 'hero-sms',
      maxUses: 1,
      successfulUses: 0,
    },
    phoneVerificationReplacementLimit: 3,
    verificationResendCount: 0,
    whatsappPhoneVerificationRestartEnabled: true,
    ...stateOverrides,
  };
  const helpers = module.createPhoneVerificationHelpers({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    getState: async () => state,
    setState: async (updates) => {
      stateUpdates.push(updates);
      state = { ...state, ...updates };
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });
  return { helpers, logs, stateUpdates };
}

test('completePhoneVerificationFlow throws WhatsApp restart signal for phone-verification page', async () => {
  const { helpers, logs, stateUpdates } = createHelpersForWhatsappPage();

  await assert.rejects(
    helpers.completePhoneVerificationFlow(
      1,
      {
        state: 'phone_verification_page',
        phoneVerificationPage: true,
        phoneVerificationWhatsApp: true,
        phoneVerificationDeliveryChannel: 'whatsapp',
        phoneVerificationDeliveryText: '输入我们刚刚通过 WhatsApp 发送到 +57 324 4489253 的验证码。',
        displayedPhone: '+57 324 4489253',
        url: 'https://auth.openai.com/phone-verification',
      },
      { step: 9, visibleStep: 9 }
    ),
    /STEP9_WHATSAPP_PAGE_RESTART::/
  );

  assert.equal(stateUpdates.length, 0);
  assert.ok(logs.some((message) => message.includes('WhatsApp')));
});

test('completePhoneVerificationFlow falls back to a normal error when WhatsApp restart toggle is disabled', async () => {
  const { helpers } = createHelpersForWhatsappPage({
    whatsappPhoneVerificationRestartEnabled: false,
  });

  await assert.rejects(
    helpers.completePhoneVerificationFlow(
      1,
      {
        state: 'phone_verification_page',
        phoneVerificationPage: true,
        phoneVerificationWhatsApp: true,
        phoneVerificationDeliveryChannel: 'whatsapp',
        phoneVerificationDeliveryText: 'Enter the code we just sent via WhatsApp.',
        displayedPhone: '+1 555 123 4567',
        url: 'https://auth.openai.com/phone-verification',
      },
      { step: 9, visibleStep: 9 }
    ),
    /WhatsApp.*开关已关闭/
  );
});

test('completePhoneVerificationFlow throws WhatsApp restart signal for add-phone page before submitting number', async () => {
  const { helpers, logs, stateUpdates } = createHelpersForWhatsappPage({
    currentPhoneActivation: null,
  });

  await assert.rejects(
    helpers.completePhoneVerificationFlow(
      1,
      {
        state: 'add_phone_page',
        addPhonePage: true,
        addPhoneWhatsApp: true,
        addPhoneDeliveryChannel: 'whatsapp',
        addPhoneDeliveryText: '要继续，请添加手机号码。我们会通过 WhatsApp 向该号码发送一次性验证码进行验证。',
        url: 'https://auth.openai.com/add-phone',
      },
      { step: 9, visibleStep: 9 }
    ),
    /STEP9_WHATSAPP_PAGE_RESTART::/
  );

  assert.equal(stateUpdates.length, 0);
  assert.ok(logs.some((message) => message.includes('添加手机号页正文命中 WhatsApp')));
});
