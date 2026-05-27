const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/smsbower.js');

const smsBowerProvider = globalThis.PhoneSmsBowerProvider;

function createResponse(payload) {
  return {
    ok: true,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  };
}

test('SMSBower reuse ignores historical code and waits for a fresh SMS code', async () => {
  const logMessages = [];
  let getStatusCalls = 0;
  const provider = smsBowerProvider.createProvider({
    addLog: async (message) => {
      logMessages.push(String(message || ''));
    },
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getStatus') {
        getStatusCalls += 1;
        if (getStatusCalls <= 2) {
          return createResponse('STATUS_OK:OpenAI code 503526');
        }
        return createResponse('STATUS_OK:OpenAI code 654321');
      }
      if (action === 'setStatus') {
        return createResponse('ACCESS_READY');
      }
      throw new Error(`unexpected action: ${action}`);
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const reusedActivation = await provider.reuseActivation({
    smsBowerApiKey: 'sms-bower-key',
  }, {
    activationId: 'sb-1',
    phoneNumber: '9127918687',
    serviceCode: 'dr',
  });

  assert.deepEqual(reusedActivation.smsBowerIgnoredCodes, ['503526']);

  const code = await provider.pollActivationCode({
    smsBowerApiKey: 'sms-bower-key',
  }, reusedActivation, {
    timeoutMs: 5000,
    intervalMs: 1,
    maxRounds: 5,
  });

  assert.equal(code, '654321');
  assert.equal(
    logMessages.some((message) => message.includes('命中历史验证码，继续等待新短信')),
    true
  );
});
