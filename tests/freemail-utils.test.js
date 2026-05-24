const assert = require('node:assert/strict');
const test = require('node:test');

const freemailUtils = require('../freemail-utils.js');
const hotmailUtils = require('../hotmail-utils.js');
require('../background/freemail-provider.js');

test('freemail normalizes generated address and API domains', () => {
  assert.equal(
    freemailUtils.getFreemailAddressFromResponse({ email: 'User@Mail.Example.com' }),
    'User@Mail.Example.com'
  );
  assert.deepEqual(
    freemailUtils.normalizeFreemailDomains([
      '@mail.example.com',
      'https://bad/path',
      'mail.example.com',
    ]),
    ['mail.example.com']
  );
});

test('freemail normalizes email rows for verification code matching', () => {
  const messages = freemailUtils.normalizeFreemailMessages([
    {
      id: 7,
      sender: 'OpenAI <noreply@tm.openai.com>',
      to_addrs: 'abc@mail.example.com',
      subject: 'Your ChatGPT code',
      verification_code: '246810',
      preview: 'Use this code to continue.',
      received_at: '2026-05-24 10:20:30',
    },
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].address, 'abc@mail.example.com');
  assert.equal(messages[0].bodyPreview.includes('246810'), true);
  assert.equal(hotmailUtils.extractVerificationCodeFromMessage(messages[0]), '246810');
});

test('freemail provider auto fetches domains before generating mailbox', async () => {
  const calls = [];
  const provider = globalThis.MultiPageBackgroundFreemailProvider.createFreemailProvider({
    ...freemailUtils,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (url.endsWith('/api/login')) {
        return Response.json({ success: true });
      }
      if (url.endsWith('/api/domains')) {
        return Response.json(['mail.example.com']);
      }
      if (url.includes('/api/generate?domainIndex=0')) {
        return Response.json({ email: 'abc123@mail.example.com' });
      }
      throw new Error(`unexpected request ${url}`);
    },
    getState: async () => ({
      freemailBaseUrl: 'https://freemail.example.com',
      freemailAdminUsername: 'admin',
      freemailAdminPassword: 'password',
      freemailDomains: [],
      freemailDomain: '',
    }),
    persistRegistrationEmailState: async () => {},
    setPersistentSettings: async () => {},
    throwIfStopped: () => {},
  });

  const address = await provider.fetchFreemailAddress();

  assert.equal(address, 'abc123@mail.example.com');
  assert.deepEqual(calls.map((call) => call.url), [
    'https://freemail.example.com/api/login',
    'https://freemail.example.com/api/domains',
    'https://freemail.example.com/api/generate?domainIndex=0',
  ]);
});
