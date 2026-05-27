const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/smsbower.js');

function createProvider(overrides = {}) {
  return globalThis.PhoneSmsBowerProvider.createProvider({
    fetchImpl: overrides.fetchImpl,
    sleepWithStop: overrides.sleepWithStop || (async () => {}),
    throwIfStopped: overrides.throwIfStopped || (() => {}),
  });
}

test('SMSBower provider preserves canGetAnotherSms from getNumberV2 payload', async () => {
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getNumberV2') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            activationId: 'sb-1',
            phoneNumber: '15551234567',
            activationCost: 0.12,
            canGetAnotherSms: false,
          }),
        };
      }
      return {
        ok: true,
        text: async () => 'NO_NUMBERS',
      };
    },
  });

  const activation = await provider.requestActivation({
    smsBowerApiKey: 'demo-key',
    smsBowerCountryId: 52,
    smsBowerCountryLabel: 'Thailand',
    smsBowerServiceCode: 'dr',
  });

  assert.equal(activation.provider, 'smsbower');
  assert.equal(activation.activationId, 'sb-1');
  assert.equal(activation.phoneNumber, '15551234567');
  assert.equal(activation.canGetAnotherSms, false);
});
