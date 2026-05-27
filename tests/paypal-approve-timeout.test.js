const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/steps/paypal-approve.js');

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

test('paypal approve exits with a timeout instead of waiting forever on a stable PayPal page', async () => {
  await withFakeNow(async ({ advance }) => {
    let completed = false;
    const executor = globalThis.MultiPageBackgroundPayPalApprove.createPayPalApproveExecutor({
      addLog: async () => {},
      chrome: {
        tabs: {
          get: async () => ({ url: 'https://www.paypal.com/checkoutnow' }),
        },
      },
      completeNodeFromBackground: async () => {
        completed = true;
      },
      ensureContentScriptReadyOnTabUntilStopped: async () => {},
      getTabId: async () => 41,
      isTabAlive: async () => true,
      queryTabsInAutomationWindow: async () => [],
      sendTabMessageUntilStopped: async (tabId, source, message) => {
        if (message.type === 'PAYPAL_GET_STATE') {
          return {
            approveReady: false,
            hasPasskeyPrompt: false,
            needsLogin: false,
          };
        }
        if (message.type === 'PAYPAL_DISMISS_PROMPTS') {
          return { clicked: 0 };
        }
        if (message.type === 'PAYPAL_CLICK_APPROVE') {
          return { clicked: false };
        }
        throw new Error(`unexpected message ${message.type}`);
      },
      setState: async () => {},
      sleepWithStop: async (ms) => {
        advance(ms);
      },
      waitForTabCompleteUntilStopped: async () => {},
      waitForTabUrlMatchUntilStopped: async () => {},
    });

    await assert.rejects(
      () => executor.executePayPalApprove({}),
      /PayPal 授权页停留超过 120 秒/
    );

    assert.equal(completed, false);
  });
});
