const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/steps/fill-plus-checkout.js');

function withFakeNow(run) {
  const originalNow = Date.now;
  let fakeNow = 0;
  Date.now = () => fakeNow;
  return Promise.resolve()
    .then(() => run({
      advance(ms) {
        fakeNow += ms;
      },
    }))
    .finally(() => {
      Date.now = originalNow;
    });
}

function createBillingExecutor(onSleep = () => {}) {
  return globalThis.MultiPageBackgroundPlusCheckoutBilling.createPlusCheckoutBillingExecutor({
    addLog: async () => {},
    completeNodeFromBackground: async () => {},
    ensureContentScriptReadyOnTabUntilStopped: async () => {},
    generateRandomName: () => ({ firstName: 'A', lastName: 'B' }),
    getState: async () => ({}),
    getTabId: async () => 0,
    isTabAlive: async () => false,
    markCurrentRegistrationAccountUsed: async () => {},
    setState: async () => {},
    sleepWithStop: async (ms) => {
      onSleep(ms);
    },
    throwIfStopped: () => {},
    waitForTabCompleteUntilStopped: async () => {},
  });
}

test('billing frame wait fails after timeout with an explicit frame summary', async () => {
  await withFakeNow(async ({ advance }) => {
    const executor = createBillingExecutor((ms) => advance(ms));

    await assert.rejects(
      () => executor.__test.waitForFrameMatch(async () => [], () => null, {
        label: '账单地址 iframe',
        timeoutMs: executor.__test.PLUS_CHECKOUT_FRAME_WAIT_TIMEOUT_MS,
      }),
      /等待账单地址 iframe超时（30 秒）。*frame 摘要：none/
    );
  });
});

test('subscribe frame wait fails after timeout and preserves the last frame summary', async () => {
  await withFakeNow(async ({ advance }) => {
    const executor = createBillingExecutor((ms) => advance(ms));

    await assert.rejects(
      () => executor.__test.waitForFrameMatch(async () => ([
        {
          frame: { frameId: 5, url: 'https://checkout.stripe.com/frame' },
          result: { hasPayPal: true },
        },
      ]), () => null, {
        label: '订阅按钮 iframe',
        timeoutMs: executor.__test.PLUS_CHECKOUT_FRAME_WAIT_TIMEOUT_MS,
      }),
      /等待订阅按钮 iframe超时（30 秒）。[\s\S]*5:https:\/\/checkout\.stripe\.com\/frame:paypal/
    );
  });
});
