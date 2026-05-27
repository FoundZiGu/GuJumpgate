const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/registry.js');

const registry = globalThis.PhoneSmsProviderRegistry;

test('provider registry exposes activation-reuse support matrix', () => {
  assert.equal(registry.supportsActivationReuse('hero-sms'), true);
  assert.equal(registry.supportsActivationReuse('5sim'), true);
  assert.equal(registry.supportsActivationReuse('smspool'), true);

  assert.equal(registry.supportsActivationReuse('nexsms'), false);
  assert.equal(registry.supportsActivationReuse('smsbower'), false);
  assert.equal(registry.supportsActivationReuse('sms-verification-number'), false);
  assert.equal(registry.supportsActivationReuse('grizzlysms'), false);
  assert.equal(registry.supportsActivationReuse('chatgpt-api'), false);
});

test('provider registry exposes free-phone-reuse support matrix', () => {
  assert.equal(registry.supportsFreePhoneReuse('hero-sms'), true);
  assert.equal(registry.supportsFreePhoneReuse('5sim'), true);
  assert.equal(registry.supportsFreePhoneReuse('smsbower'), true);
  assert.equal(registry.supportsFreePhoneReuse('smspool'), true);

  assert.equal(registry.supportsFreePhoneReuse('nexsms'), false);
  assert.equal(registry.supportsFreePhoneReuse('sms-verification-number'), false);
  assert.equal(registry.supportsFreePhoneReuse('grizzlysms'), false);
  assert.equal(registry.supportsFreePhoneReuse('chatgpt-api'), false);
});
