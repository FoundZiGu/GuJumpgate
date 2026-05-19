const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/plus-success-session-upload.js', 'utf8');

function createApi() {
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundPlusSuccessSessionUpload;`)(globalScope);
}

test('payments success continuation completes hosted checkout and stores the success url', async () => {
  const api = createApi();
  const logs = [];
  const stateUpdates = [];
  const completions = [];
  const successUrl = 'https://chatgpt.com/payments/success?stripe_session_id=cs_live_demo';
  const manager = api.createPlusSuccessSessionUploadManager({
    addLog: async (message, level = 'info', options = {}) => {
      logs.push({ message, level, options });
    },
    completeNodeFromBackground: async (nodeId, payload) => {
      completions.push({ nodeId, payload });
    },
    getState: async () => ({
      plusCheckoutTabId: 77,
      plusPaymentMethod: 'paypal',
      plusHostedCheckoutOauthDelaySeconds: 0,
      nodeStatuses: {
        'plus-checkout-create': 'running',
      },
    }),
    setState: async (payload) => {
      stateUpdates.push(payload);
    },
  });

  const result = await manager.handleTabUpdated(77, { status: 'complete' }, { url: successUrl });

  assert.deepStrictEqual(result, {
    completed: true,
    plusReturnUrl: successUrl,
    oauthDelaySeconds: 0,
    skipPostPaymentOAuthEnabled: false,
  });
  assert.deepStrictEqual(stateUpdates, [
    { plusReturnUrl: successUrl },
  ]);
  assert.deepStrictEqual(completions, [
    {
      nodeId: 'plus-checkout-create',
      payload: {
        plusReturnUrl: successUrl,
        plusHostedCheckoutCompleted: true,
        plusHostedCheckoutOauthDelaySeconds: 0,
        skipPostPaymentOAuthEnabled: false,
      },
    },
  ]);
  assert.equal(logs.some((entry) => /检测到 ChatGPT 支付成功页，准备继续 OAuth 流程/.test(entry.message)), true);
});

test('payments success continuation waits configured seconds before continuing oauth', async () => {
  const api = createApi();
  const events = [];
  const successUrl = 'https://chatgpt.com/payments/success?stripe_session_id=cs_live_delay';
  const manager = api.createPlusSuccessSessionUploadManager({
    addLog: async (message, level = 'info') => {
      events.push(`log:${level}:${message}`);
    },
    delay: async (ms) => {
      events.push(`delay:${ms}`);
    },
    completeNodeFromBackground: async (_nodeId, payload) => {
      events.push(`complete:${payload.plusHostedCheckoutOauthDelaySeconds}`);
    },
    getState: async () => ({
      plusCheckoutTabId: 77,
      plusPaymentMethod: 'paypal',
      plusHostedCheckoutOauthDelaySeconds: 12,
      nodeStatuses: {
        'plus-checkout-create': 'running',
      },
    }),
    setState: async () => {
      events.push('set-state');
    },
  });

  const result = await manager.handleTabUpdated(77, { status: 'complete' }, { url: successUrl });

  assert.deepStrictEqual(result, {
    completed: true,
    plusReturnUrl: successUrl,
    oauthDelaySeconds: 12,
    skipPostPaymentOAuthEnabled: false,
  });
  assert.equal(events.includes('delay:12000'), true);
  assert.equal(events.some((entry) => /等待 12 秒/.test(entry)), true);
  assert.equal(events.includes('complete:12'), true);
});

test('payments success continuation can finish without oauth when skip toggle is enabled', async () => {
  const api = createApi();
  const events = [];
  const successUrl = 'https://chatgpt.com/payments/success?stripe_session_id=cs_live_skip';
  const manager = api.createPlusSuccessSessionUploadManager({
    addLog: async (message, level = 'info') => {
      events.push(`log:${level}:${message}`);
    },
    delay: async (ms) => {
      events.push(`delay:${ms}`);
    },
    completeNodeFromBackground: async (_nodeId, payload) => {
      events.push(`complete:${payload.plusHostedCheckoutOauthDelaySeconds}:${payload.skipPostPaymentOAuthEnabled}`);
    },
    getState: async () => ({
      plusCheckoutTabId: 77,
      plusPaymentMethod: 'paypal',
      plusHostedCheckoutOauthDelaySeconds: 12,
      skipPostPaymentOAuthEnabled: true,
      nodeStatuses: {
        'plus-checkout-create': 'running',
      },
    }),
    setState: async () => {
      events.push('set-state');
    },
  });

  const result = await manager.handleTabUpdated(77, { status: 'complete' }, { url: successUrl });

  assert.deepStrictEqual(result, {
    completed: true,
    plusReturnUrl: successUrl,
    oauthDelaySeconds: 0,
    skipPostPaymentOAuthEnabled: true,
  });
  assert.equal(events.some((entry) => /跳过后续 OAuth 流程/.test(entry)), true);
  assert.equal(events.some((entry) => entry.startsWith('delay:')), false);
  assert.equal(events.includes('complete:0:true'), true);
});

test('payments success continuation is idempotent when active polling and tab update fire together', async () => {
  const api = createApi();
  const events = [];
  let releaseComplete;
  let resolveCompleteEntered;
  const successUrl = 'https://chatgpt.com/payments/success?stripe_session_id=cs_live_race';
  const completionBlocker = new Promise((resolve) => {
    releaseComplete = resolve;
  });
  const completeEntered = new Promise((resolve) => {
    resolveCompleteEntered = resolve;
  });
  const manager = api.createPlusSuccessSessionUploadManager({
    addLog: async (message, level = 'info') => {
      events.push(`log:${level}:${message}`);
    },
    completeNodeFromBackground: async () => {
      events.push('complete');
      resolveCompleteEntered();
      await completionBlocker;
    },
    getState: async () => ({
      plusCheckoutTabId: 77,
      plusPaymentMethod: 'paypal',
      plusHostedCheckoutOauthDelaySeconds: 0,
      nodeStatuses: {
        'plus-checkout-create': 'running',
      },
    }),
    setState: async () => {
      events.push('set-state');
    },
  });

  const first = manager.processPaymentsSuccessTab(77, successUrl);
  await completeEntered;
  const second = manager.handleTabUpdated(77, { status: 'complete' }, { url: successUrl });
  const secondResult = await second;
  releaseComplete();
  const firstResult = await first;

  assert.equal(secondResult, null);
  assert.equal(firstResult.completed, true);
  assert.deepStrictEqual(events.filter((event) => event === 'complete'), ['complete']);
});

test('payments success continuation ignores unrelated tabs or non-running checkout state', async () => {
  const api = createApi();
  const manager = api.createPlusSuccessSessionUploadManager({
    getState: async () => ({
      plusCheckoutTabId: 88,
      plusPaymentMethod: 'paypal',
      plusHostedCheckoutOauthDelaySeconds: 0,
      nodeStatuses: {
        'plus-checkout-create': 'completed',
      },
    }),
    setState: async () => {
      throw new Error('setState should not be called');
    },
    completeNodeFromBackground: async () => {
      throw new Error('completeNodeFromBackground should not be called');
    },
  });

  const result = await manager.handleTabUpdated(77, { status: 'complete' }, { url: 'https://chatgpt.com/payments/success?stripe_session_id=demo' });
  assert.equal(result, null);
});

test('payments success continuation recognizes backend-api success urls too', async () => {
  const api = createApi();
  const manager = api.createPlusSuccessSessionUploadManager({});

  assert.equal(manager.isPaymentsSuccessUrl('https://chatgpt.com/payments/success?stripe_session_id=demo'), true);
  assert.equal(manager.isPaymentsSuccessUrl('https://chatgpt.com/backend-api/payments/success'), true);
  assert.equal(manager.isPaymentsSuccessUrl('https://chatgpt.com/checkout/openai_ie/cs_demo'), false);
});
