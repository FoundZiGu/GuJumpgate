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

test('free auto reuse activation is cancelled before replacing the number', async () => {
  const module = loadBackgroundPhoneVerificationModule();
  const fetchActions = [];
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
    heroSmsCountryId: 33,
    heroSmsCountryLabel: 'Colombia',
  };

  const helpers = module.createPhoneVerificationHelpers({
    addLog: async () => {},
    getState: async () => state,
    setState: async (updates) => {
      state = { ...state, ...updates };
    },
    sendToContentScriptResilient: async (_target, message) => {
      if (message?.type === 'SUBMIT_PHONE_NUMBER') {
        return {
          addPhoneRejected: true,
          errorText: 'phone number is already linked',
          url: 'https://auth.openai.com/add-phone',
        };
      }
      if (message?.type === 'RETURN_TO_ADD_PHONE' || message?.type === 'STEP8_GET_STATE') {
        return {
          addPhonePage: true,
          phoneVerificationPage: false,
          url: 'https://auth.openai.com/add-phone',
        };
      }
      throw new Error(`unexpected content-script message: ${message?.type || 'unknown'}`);
    },
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      fetchActions.push(action || parsed.pathname);
      if (action === 'setStatus') {
        assert.equal(parsed.searchParams.get('id'), 'act_free_1');
        assert.equal(parsed.searchParams.get('status'), '8');
        return {
          ok: true,
          text: async () => 'ACCESS_CANCEL',
        };
      }
      throw new Error('acquire sentinel');
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
    /acquire sentinel/
  );

  assert.ok(fetchActions.includes('setStatus'));
  assert.equal(state.freeReusablePhoneActivation, null);
});
