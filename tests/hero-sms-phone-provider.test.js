const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/hero-sms.js');

function createProvider(overrides = {}) {
  return globalThis.PhoneSmsHeroSmsProvider.createProvider({
    fetchImpl: overrides.fetchImpl,
    sleepWithStop: overrides.sleepWithStop || (async () => {}),
    throwIfStopped: overrides.throwIfStopped || (() => {}),
    addLog: overrides.addLog || (async () => {}),
  });
}

test('HeroSMS provider finish/cancel/ban lifecycle methods map to setStatus actions', async () => {
  const requests = [];
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      requests.push(parsed);
      return {
        ok: true,
        text: async () => 'ACCESS_READY',
      };
    },
  });

  const state = {
    heroSmsApiKey: 'hero-key',
  };
  const activation = {
    activationId: 'hero-1',
    phoneNumber: '573244489253',
    provider: 'hero-sms',
  };

  await provider.finishActivation(state, activation);
  await provider.cancelActivation(state, activation);
  await provider.banActivation(state, activation);

  assert.equal(requests.length, 3);
  assert.equal(requests[0].searchParams.get('action'), 'setStatus');
  assert.equal(requests[0].searchParams.get('id'), 'hero-1');
  assert.equal(requests[0].searchParams.get('status'), '6');
  assert.equal(requests[1].searchParams.get('status'), '8');
  assert.equal(requests[2].searchParams.get('status'), '8');
});

test('HeroSMS provider reuses activation through reactivate action', async () => {
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.searchParams.get('action'), 'reactivate');
      assert.equal(parsed.searchParams.get('id'), 'hero-2');
      return {
        ok: true,
        text: async () => 'ACCESS_NUMBER:hero-2:573244489254',
      };
    },
  });

  const activation = await provider.reuseActivation({
    heroSmsApiKey: 'hero-key',
    heroSmsCountryId: 33,
    heroSmsCountryLabel: 'Colombia',
  }, {
    activationId: 'hero-2',
    phoneNumber: '573244489254',
    provider: 'hero-sms',
    statusAction: 'getStatusV2',
  });

  assert.equal(activation.activationId, 'hero-2');
  assert.equal(activation.phoneNumber, '573244489254');
  assert.equal(activation.provider, 'hero-sms');
  assert.equal(activation.statusAction, 'getStatusV2');
});

test('HeroSMS provider preserves payload reason on lifecycle failures', async () => {
  const provider = createProvider({
    fetchImpl: async () => ({
      ok: true,
      text: async () => 'BAD_STATUS',
    }),
  });

  await assert.rejects(
    provider.reuseActivation({
      heroSmsApiKey: 'hero-key',
    }, {
      activationId: 'hero-3',
      phoneNumber: '573244489255',
      provider: 'hero-sms',
    }),
    /HeroSMS 复用手机号失败：BAD_STATUS/
  );
});
