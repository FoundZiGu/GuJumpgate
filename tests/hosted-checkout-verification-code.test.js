const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/steps/create-plus-checkout.js');

function createExecutorWithPayload(payload, deps = {}) {
  const { onFetch, ...executorDeps } = deps;
  return globalThis.MultiPageBackgroundPlusCheckoutCreate.createPlusCheckoutCreateExecutor({
    ...executorDeps,
    fetch: async () => ({
      text: async () => {
        if (typeof onFetch === 'function') {
          onFetch();
        }
        return typeof payload === 'string' ? payload : JSON.stringify(payload);
      },
    }),
  });
}

async function fetchManualCode(payload) {
  const executor = createExecutorWithPayload(payload);
  const result = await executor.fetchHostedCheckoutVerificationCodeManually({
    verificationUrl: 'http://example.test/api/get_sms?key=test',
  });
  return result.code;
}

test('manual hosted checkout code fetch extracts plain 62-us PayPal response', async () => {
  const code = await fetchManualCode(
    "yes|PayPal: 201412 is your security code. Don't share it.|(PayPal)|到期时间：2026-07-29 00:00:00"
  );

  assert.equal(code, '201412');
});

test('manual hosted checkout code fetch extracts nested tgflare PayPal response', async () => {
  const code = await fetchManualCode({
    code: 1,
    msg: 'ok',
    data: {
      code: "PayPal: 288652 is your security code. Don't share it.",
      code_time: '2026-05-22 12:25:10',
      expired_date: '2026-07-31 00:00:00',
    },
  });

  assert.equal(code, '288652');
});

test('manual hosted checkout code fetch extracts issue 29 nested data.code response', async () => {
  const code = await fetchManualCode({
    code: 1,
    msg: 'ok',
    data: {
      code: 'PayPal: 011119 is your security code. Don`t share it.',
      code_time: '2026-05-21 10:37:02',
      expired_date: '2026-06-14 00:00:00',
    },
  });

  assert.equal(code, '011119');
});

test('manual hosted checkout code fetch extracts separated security code digits', async () => {
  const code = await fetchManualCode(
    "yes|PayPal: 1 2 3 4 5 6 is your security code. Don't share it.|(PayPal)|到期时间：2026-07-29 00:00:00"
  );

  assert.equal(code, '123456');
});

test('manual hosted checkout code fetch ignores metadata phone before sms text', async () => {
  const code = await fetchManualCode({
    data: {
      phone: '+14155552671',
      sms: "PayPal: 288652 is your security code. Don't share it.",
    },
  });

  assert.equal(code, '288652');
});

test('manual hosted checkout code fetch ignores metadata order id before message text', async () => {
  const code = await fetchManualCode({
    data: {
      order_id: '123456',
      message: "PayPal: 288652 is your security code. Don't share it.",
    },
  });

  assert.equal(code, '288652');
});

test('manual hosted checkout code fetch ignores PayPal confirmation text with expiration date', async () => {
  const executor = createExecutorWithPayload(
    'yes|PayPal: Thanks for confirming your phone number. Log in or get the app to get transaction alerts: https://py.pl/24BgEk|(PayPal)|到期时间：2026-07-29 00:00:00'
  );

  await assert.rejects(
    () => executor.fetchHostedCheckoutVerificationCodeManually({
      verificationUrl: 'http://example.test/api/get_sms?key=test',
    }),
    /(?:暂未返回有效验证码|非验证码内容)/
  );
});

test('hosted checkout wait seconds are applied before polling verification endpoint', async () => {
  const events = [];
  const executor = createExecutorWithPayload(
    "yes|PayPal: 201412 is your security code. Don't share it.|(PayPal)|到期时间：2026-07-29 00:00:00",
    {
      addLog: async (message) => events.push(['log', message]),
      getState: async () => ({
        hostedCheckoutVerificationUrl: 'http://example.test/api/get_sms?key=test',
      }),
      onFetch: () => events.push(['fetch']),
      sleepWithStop: async (ms) => events.push(['sleep', ms]),
    }
  );

  const code = await executor.__test.waitForHostedCheckoutVerificationCodeWindow(2, {
    label: 'PayPal 首次验证码',
    pollAttempts: 1,
    pollIntervalSeconds: 1,
  });

  assert.equal(code, '201412');
  assert.deepEqual(events.find((event) => event[0] === 'sleep'), ['sleep', 2000]);
  assert.ok(
    events.findIndex((event) => event[0] === 'sleep') < events.findIndex((event) => event[0] === 'fetch'),
    'expected configured wait to happen before fetching the verification code'
  );
});

test('hosted checkout success refreshes OAuth localhost callback window', async () => {
  const calls = [];
  const executor = createExecutorWithPayload({}, {
    addLog: async (message) => calls.push(['log', message]),
    getState: async () => ({
      oauthUrl: 'https://auth.openai.com/oauth/authorize?client_id=test',
    }),
    getStepIdByKeyForState: (stepKey) => (stepKey === 'confirm-oauth' ? 10 : null),
    startOAuthFlowTimeoutWindow: async (options) => {
      calls.push(['timeout', options]);
      return 12345;
    },
  });

  await executor.__test.refreshOAuthTimeoutWindowAfterHostedCheckoutSuccess();

  const timeoutCall = calls.find((entry) => entry[0] === 'timeout')?.[1];
  assert.equal(timeoutCall.step, 10);
  assert.equal(timeoutCall.oauthUrl, 'https://auth.openai.com/oauth/authorize?client_id=test');
  assert.match(timeoutCall.logMessage, /hosted checkout 支付链路已完成/);
});

test('hosted checkout pending return detects unexpected ChatGPT non-success URLs', () => {
  const executor = createExecutorWithPayload({});

  assert.equal(
    executor.__test.isHostedCheckoutPendingReturnUrl('https://pay.openai.com/c/pay/cs_test?redirect_status=pending'),
    true
  );
  assert.equal(
    executor.__test.isHostedCheckoutPendingUnexpectedChatGptReturnUrl('https://chatgpt.com/'),
    true
  );
  assert.equal(
    executor.__test.isHostedCheckoutPendingUnexpectedChatGptReturnUrl('https://chatgpt.com/?model=gpt-4o'),
    true
  );
  assert.equal(
    executor.__test.isHostedCheckoutPendingUnexpectedChatGptReturnUrl('https://chatgpt.com/checkout/openai_llc/cs_test'),
    true
  );
  assert.equal(
    executor.__test.isHostedCheckoutPendingUnexpectedChatGptReturnUrl('https://chatgpt.com/backend-api/payments/success?session_id=cs_test'),
    false
  );
});
