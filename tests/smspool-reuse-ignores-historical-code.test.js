const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/smspool.js');

const smsPoolProvider = globalThis.PhoneSmsPoolProvider;

function createResponse(payload) {
  return {
    ok: true,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  };
}

test('SMSPool reuse ignores historical code and waits for a fresh SMS code', async () => {
  const logMessages = [];
  const requestCounts = {
    check: 0,
  };
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const provider = smsPoolProvider.createProvider({
      addLog: async (message) => {
        logMessages.push(String(message || ''));
      },
      fetchImpl: async (url, options = {}) => {
        const parsed = new URL(String(url));
        const body = new URLSearchParams(String(options.body || ''));
        const pathname = parsed.pathname;

        if (pathname === '/sms/activate') {
          return createResponse({ success: 1 });
        }
        if (pathname === '/sms/check') {
          requestCounts.check += 1;
          if (requestCounts.check === 1) {
            return createResponse({ sms: [{ message: 'OpenAI code 503526' }] });
          }
          if (requestCounts.check === 2) {
            return createResponse({ sms: [{ message: 'OpenAI code 503526' }] });
          }
          return createResponse({ sms: [{ message: 'OpenAI code 654321' }] });
        }
        if (pathname === '/request/active') {
          const orderId = String(body.get('orderid') || 'sp-1');
          if (requestCounts.check <= 2) {
            return createResponse([{ orderid: orderId, phonenumber: '9127918687', sms: [{ message: 'OpenAI code 503526' }] }]);
          }
          return createResponse([{ orderid: orderId, phonenumber: '9127918687', sms: [{ message: 'OpenAI code 654321' }] }]);
        }
        throw new Error(`unexpected request: ${pathname}`);
      },
      sleepWithStop: async (ms = 0) => {
        now += Math.max(1, Number(ms) || 0);
      },
      throwIfStopped: () => {},
    });

    const reusedActivation = await provider.reuseActivation({
      smsPoolApiKey: 'sms-pool-key',
    }, {
      activationId: 'sp-1',
      phoneNumber: '9127918687',
      serviceCode: '671',
    });

    assert.deepEqual(reusedActivation.smsPoolIgnoredCodes, ['503526']);

    const pollActivation = {
      ...reusedActivation,
      smsPoolResendPreparedAt: 0,
    };

    const code = await provider.pollActivationCode({
      smsPoolApiKey: 'sms-pool-key',
    }, pollActivation, {
      timeoutMs: 5000,
      intervalMs: 1,
      maxRounds: 5,
    });

    assert.equal(code, '654321');
    assert.equal(
      logMessages.some((message) => message.includes('命中历史验证码，继续等待新短信')),
      true
    );
  } finally {
    Date.now = originalNow;
  }
});
