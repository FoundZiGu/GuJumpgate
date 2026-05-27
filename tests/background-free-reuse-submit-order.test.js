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

test('completePhoneVerificationFlow submits the reused phone before preparing Hero auto-reuse', async () => {
  const module = loadBackgroundPhoneVerificationModule();
  const events = [];
  const stopRequests = [];
  let state = {
    currentPhoneActivation: null,
    freePhoneReuseEnabled: true,
    freePhoneReuseAutoEnabled: true,
    freeReusablePhoneActivation: {
      phoneNumber: '+57 324 4489253',
      activationId: 'act_free_1',
      provider: 'hero-sms',
      maxUses: 3,
      successfulUses: 1,
      phoneCodeReceived: true,
      source: 'free-manual-reuse',
    },
    phoneVerificationReplacementLimit: 3,
    verificationResendCount: 0,
    heroSmsApiKey: 'hero_test_key',
  };

  const helpers = module.createPhoneVerificationHelpers({
    addLog: async () => {},
    getState: async () => state,
    setState: async (updates) => {
      state = { ...state, ...updates };
    },
    requestStop: async (payload = {}) => {
      stopRequests.push(payload);
    },
    sendToContentScriptResilient: async (_target, message) => {
      if (message?.type === 'SUBMIT_PHONE_NUMBER') {
        events.push('submit');
        return {
          url: 'https://auth.openai.com/phone-verification',
        };
      }
      throw new Error(`unexpected content-script message: ${message?.type || 'unknown'}`);
    },
    fetchImpl: async () => {
      events.push('fetch');
      throw new Error('prepare sentinel');
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  await assert.rejects(
    helpers.completePhoneVerificationFlow(
      1,
      {
        state: 'add_phone_page',
        addPhonePage: true,
        url: 'https://auth.openai.com/add-phone',
      },
      { step: 9, visibleStep: 9 }
    ),
    /PHONE_AUTO_FREE_REUSE_PREPARE::/
  );

  assert.deepEqual(events, ['submit', 'fetch']);
  assert.equal(stopRequests.length, 1);
});
