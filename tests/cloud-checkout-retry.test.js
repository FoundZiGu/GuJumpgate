const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/steps/create-plus-checkout.js');

function createExecutor(deps = {}) {
  const logs = [];
  const sleeps = [];
  const reloads = [];
  const executor = globalThis.MultiPageBackgroundPlusCheckoutCreate.createPlusCheckoutCreateExecutor({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    chrome: {
      tabs: {
        reload: async (tabId) => {
          reloads.push(tabId);
        },
      },
    },
    completeNodeFromBackground: async () => {},
    ensureContentScriptReadyOnTabUntilStopped: async () => {},
    registerTab: () => {},
    sendTabMessageUntilStopped: async () => ({ accessToken: '' }),
    setState: async () => {},
    sleepWithStop: async (ms) => {
      sleeps.push(ms);
    },
    waitForTabCompleteUntilStopped: async () => {},
    ...deps,
  });

  return {
    executor,
    logs,
    reloads,
    sleeps,
  };
}

test('cloud checkout access token retry refreshes session tab once before succeeding', async () => {
  let attempt = 0;
  const harness = createExecutor({
    sendTabMessageUntilStopped: async (_tabId, _source, message) => {
      assert.equal(message.type, 'PLUS_CHECKOUT_GET_STATE');
      attempt += 1;
      return attempt === 1
        ? { accessToken: '' }
        : { accessToken: 'tok-123' };
    },
  });

  const token = await harness.executor.__test.readCloudCheckoutAccessTokenWithRetry(321);

  assert.equal(token, 'tok-123');
  assert.deepEqual(harness.reloads, [321]);
  assert.match(harness.logs.find((entry) => /读取 accessToken 失败/.test(entry)) || '', /读取 accessToken 失败/);
});

test('cloud checkout API retries transient 5xx failure and then succeeds', async () => {
  let fetchCount = 0;
  const harness = createExecutor({
    fetch: async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return {
          ok: false,
          status: 502,
          json: async () => ({ message: 'bad gateway' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          checkoutUrl: 'https://pay.openai.com/c/pay/cs_test_success',
          country: 'US',
          currency: 'USD',
        }),
      };
    },
  });

  const result = await harness.executor.__test.generateCloudCheckoutFromApiWithRetry('tok-123', 'paypal', {});

  assert.equal(fetchCount, 2);
  assert.equal(result.preferredCheckoutUrl, 'https://pay.openai.com/c/pay/cs_test_success');
  assert.deepEqual(harness.sleeps, [1000]);
});

test('cloud checkout already-paid response does not retry', async () => {
  let fetchCount = 0;
  const harness = createExecutor({
    fetch: async () => {
      fetchCount += 1;
      return {
        ok: false,
        status: 400,
        json: async () => ({ message: 'User is already paid' }),
      };
    },
  });

  const result = await harness.executor.__test.generateCloudCheckoutFromApiWithRetry('tok-123', 'paypal', {});

  assert.equal(fetchCount, 1);
  assert.equal(result.alreadyPaid, true);
});

test('cloud checkout explicit 4xx business error does not retry', async () => {
  let fetchCount = 0;
  const harness = createExecutor({
    fetch: async () => {
      fetchCount += 1;
      return {
        ok: false,
        status: 400,
        json: async () => ({ message: 'invalid api key' }),
      };
    },
  });

  await assert.rejects(
    () => harness.executor.__test.generateCloudCheckoutFromApiWithRetry('tok-123', 'paypal', {}),
    /invalid api key/
  );

  assert.equal(fetchCount, 1);
});
