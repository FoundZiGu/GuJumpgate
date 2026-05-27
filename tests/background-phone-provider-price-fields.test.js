const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/phone-verification-flow.js');
require('../phone-sms/providers/smsbower.js');

function createHelpers(overrides = {}) {
  return globalThis.MultiPageBackgroundPhoneVerification.createPhoneVerificationHelpers({
    addLog: overrides.addLog || (async () => {}),
    fetchImpl: overrides.fetchImpl,
    getState: overrides.getState || (async () => ({})),
    setState: overrides.setState || (async () => {}),
    sleepWithStop: overrides.sleepWithStop || (async () => {}),
    throwIfStopped: overrides.throwIfStopped || (() => {}),
  });
}

test('SMSPool activation uses SMSPool price fields instead of HeroSMS price fields', async () => {
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPrices') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.1': { count: 1 } }),
        };
      }
      if (action === 'getNumber') {
        getNumberUrls.push(parsed);
        return {
          ok: true,
          text: async () => 'ACCESS_NUMBER:sp-1:15551234567',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'smspool',
    heroSmsApiKey: 'hero-key',
    heroSmsMaxPrice: '0.06',
    smsPoolApiKey: 'sms-pool-key',
    smsPoolCountryId: 1,
    smsPoolCountryLabel: 'USA',
    smsPoolMaxPrice: '0.08',
    smsPoolServiceCode: '671',
  });

  assert.equal(activation.provider, 'smspool');
  assert.equal(getNumberUrls.length, 1);
  assert.equal(getNumberUrls[0].searchParams.get('maxPrice'), '0.08');
});

test('Hero-like fallback providers use their own price fields', async () => {
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPrices') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.12': { count: 1 } }),
        };
      }
      if (action === 'getNumber') {
        getNumberUrls.push(parsed);
        return {
          ok: true,
          text: async () => 'ACCESS_NUMBER:grizzly-1:15557654321',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'grizzlysms',
    heroSmsApiKey: 'hero-key',
    heroSmsMaxPrice: '0.05',
    grizzlySmsApiKey: 'grizzly-key',
    grizzlySmsCountryId: 1,
    grizzlySmsCountryLabel: 'USA',
    grizzlySmsMaxPrice: '0.09',
    grizzlySmsServiceCode: 'dr',
  });

  assert.equal(activation.provider, 'grizzlysms');
  assert.equal(getNumberUrls.length, 1);
  assert.equal(getNumberUrls[0].searchParams.get('maxPrice'), '0.09');
});

test('SMSBower activation uses SMSBower price fields instead of HeroSMS price fields', async () => {
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPricesV3') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.07': { count: 1 } }),
        };
      }
      if (action === 'getNumber') {
        getNumberUrls.push(parsed);
        return {
          ok: true,
          text: async () => 'ACCESS_NUMBER:sb-1:15551234567',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'smsbower',
    heroSmsApiKey: 'hero-key',
    heroSmsMaxPrice: '0.06',
    smsBowerApiKey: 'smsbower-key',
    smsBowerCountryId: 52,
    smsBowerCountryLabel: 'Thailand',
    smsBowerMaxPrice: '0.08',
    smsBowerPricesAction: 'getPricesV3',
    smsBowerServiceCode: 'dr',
  });

  assert.equal(activation.provider, 'smsbower');
  assert.equal(getNumberUrls.length, 1);
  assert.equal(getNumberUrls[0].searchParams.get('maxPrice'), '0.07');
});

test('SMSBower probes configured range and preserves provider-specific price query settings', async () => {
  const priceUrls = [];
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPricesV3') {
        priceUrls.push(parsed);
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.025': { count: 1 } }),
        };
      }
      if (action === 'getNumber') {
        getNumberUrls.push(parsed);
        return {
          ok: true,
          text: async () => 'ACCESS_NUMBER:sb-2:15559876543',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'smsbower',
    heroSmsApiKey: 'hero-key',
    heroSmsMaxPrice: '0.06',
    smsBowerApiKey: 'smsbower-key',
    smsBowerCountryId: 52,
    smsBowerCountryLabel: 'Thailand',
    smsBowerMinPrice: '0.05',
    smsBowerMaxPrice: '0.07',
    smsBowerPricesAction: 'getPricesV3',
    smsBowerLang: 'en',
    smsBowerServiceCode: 'dr',
  });

  assert.equal(activation.provider, 'smsbower');
  assert.equal(priceUrls.length, 1);
  assert.equal(priceUrls[0].searchParams.get('action'), 'getPricesV3');
  assert.equal(priceUrls[0].searchParams.get('lang'), 'en');
  assert.equal(getNumberUrls.length, 1);
  assert.equal(getNumberUrls[0].searchParams.get('minPrice'), '0.05');
  assert.equal(getNumberUrls[0].searchParams.get('maxPrice'), '0.05');
  assert.equal(getNumberUrls[0].searchParams.get('fixedPrice'), null);
  assert.equal(getNumberUrls[0].searchParams.get('lang'), 'en');
});

test('SMSBower acquisition uses range semantics instead of fixed-price semantics', async () => {
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPricesV3') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.064': { count: 1 } }),
        };
      }
      if (action === 'getNumber') {
        getNumberUrls.push(parsed);
        return {
          ok: true,
          text: async () => 'ACCESS_NUMBER:sb-3:237612345678',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'smsbower',
    smsBowerApiKey: 'smsbower-key',
    smsBowerCountryId: 223,
    smsBowerCountryLabel: 'Cameroon',
    smsBowerMinPrice: '0.054',
    smsBowerMaxPrice: '0.06',
    smsBowerPricesAction: 'getPricesV3',
    smsBowerLang: 'en',
    smsBowerServiceCode: 'dr',
  });

  assert.equal(activation.provider, 'smsbower');
  assert.equal(getNumberUrls.length, 1);
  assert.equal(getNumberUrls[0].searchParams.get('minPrice'), '0.054');
  assert.equal(getNumberUrls[0].searchParams.get('maxPrice'), '0.06');
  assert.equal(getNumberUrls[0].searchParams.get('fixedPrice'), null);
  assert.equal(getNumberUrls[0].searchParams.get('lang'), 'en');
});

test('SMSBower uses provider-specific country selection instead of HeroSMS country state', async () => {
  const priceUrls = [];
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPricesV3') {
        priceUrls.push(parsed);
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.054': { count: 1 } }),
        };
      }
      if (action === 'getNumber') {
        getNumberUrls.push(parsed);
        return {
          ok: true,
          text: async () => 'ACCESS_NUMBER:sb-4:966501234567',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'smsbower',
    heroSmsApiKey: 'hero-key',
    heroSmsCountryId: 223,
    heroSmsCountryLabel: 'Cameroon',
    smsBowerApiKey: 'smsbower-key',
    smsBowerCountryId: 53,
    smsBowerCountryLabel: 'Saudi Arabia',
    smsBowerMinPrice: '0.054',
    smsBowerMaxPrice: '0.06',
    smsBowerPricesAction: 'getPricesV3',
    smsBowerLang: 'en',
    smsBowerServiceCode: 'dr',
  });

  assert.equal(activation.provider, 'smsbower');
  assert.equal(priceUrls.length, 1);
  assert.equal(priceUrls[0].searchParams.get('country'), '53');
  assert.equal(getNumberUrls.length, 1);
  assert.equal(getNumberUrls[0].searchParams.get('country'), '53');
});

test('HeroSMS probes configured range when catalog tiers are all below minimum price', async () => {
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPrices') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.025': { count: 1 } }),
        };
      }
      if (action === 'getNumber') {
        getNumberUrls.push(parsed);
        return {
          ok: true,
          text: async () => 'ACCESS_NUMBER:hero-1:56912345678',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'hero-sms',
    heroSmsApiKey: 'hero-key',
    heroSmsCountryId: 151,
    heroSmsCountryLabel: 'Chile',
    heroSmsMinPrice: '0.05',
    heroSmsMaxPrice: '0.07',
  });

  assert.equal(activation.provider, 'hero-sms');
  assert.equal(getNumberUrls.length, 1);
  assert.equal(getNumberUrls[0].searchParams.get('maxPrice'), '0.05');
  assert.equal(getNumberUrls[0].searchParams.get('fixedPrice'), 'true');
});
