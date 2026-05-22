const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/steps/create-plus-checkout.js');

function createExecutorWithPayload(payload) {
  return globalThis.MultiPageBackgroundPlusCheckoutCreate.createPlusCheckoutCreateExecutor({
    fetch: async () => ({
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    }),
  });
}

test('manual hosted checkout code fetch extracts plain 62-us PayPal response', async () => {
  const executor = createExecutorWithPayload(
    "yes|PayPal: 201412 is your security code. Don't share it.|(PayPal)|到期时间：2026-07-29 00:00:00"
  );

  const result = await executor.fetchHostedCheckoutVerificationCodeManually({
    verificationUrl: 'http://a.62-us.com/api/get_sms?key=test',
  });

  assert.equal(result.code, '201412');
});

test('manual hosted checkout code fetch extracts nested tgflare PayPal response', async () => {
  const executor = createExecutorWithPayload({
    code: 1,
    msg: 'ok',
    data: {
      code: "PayPal: 288652 is your security code. Don't share it.",
      code_time: '2026-05-22 12:25:10',
      expired_date: '2026-07-31 00:00:00',
    },
  });

  const result = await executor.fetchHostedCheckoutVerificationCodeManually({
    verificationUrl: 'https://ithte.tgflare.com/api/record?token=test',
  });

  assert.equal(result.code, '288652');
});

test('manual hosted checkout code fetch extracts separated security code digits', async () => {
  const executor = createExecutorWithPayload(
    "yes|PayPal: 1 2 3 4 5 6 is your security code. Don't share it.|(PayPal)|到期时间：2026-07-29 00:00:00"
  );

  const result = await executor.fetchHostedCheckoutVerificationCodeManually({
    verificationUrl: 'http://a.62-us.com/api/get_sms?key=test',
  });

  assert.equal(result.code, '123456');
});

test('manual hosted checkout code fetch ignores PayPal confirmation text with expiration date', async () => {
  const executor = createExecutorWithPayload(
    'yes|PayPal: Thanks for confirming your phone number. Log in or get the app to get transaction alerts: https://py.pl/24BgEk|(PayPal)|到期时间：2026-07-29 00:00:00'
  );

  await assert.rejects(
    () => executor.fetchHostedCheckoutVerificationCodeManually({
      verificationUrl: 'http://a.62-us.com/api/get_sms?key=test',
    }),
    /暂未返回有效验证码/
  );
});
