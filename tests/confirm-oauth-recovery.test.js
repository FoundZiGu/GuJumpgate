const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadStep9Module() {
  const filePath = path.join(__dirname, '..', 'background', 'steps', 'confirm-oauth.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundStep9;
}

function createExecutorHarness(pageStates = []) {
  const step9Module = loadStep9Module();
  const logs = [];
  const completions = [];
  const recoverCalls = [];
  const listeners = {
    beforeNavigate: null,
    committed: null,
    tabUpdated: null,
    pendingReject: null,
  };
  let waitIndex = 0;

  const executor = step9Module.createStep9Executor({
    STEP8_CLICK_RETRY_DELAY_MS: 1,
    STEP8_MAX_ROUNDS: 1,
    STEP8_READY_WAIT_TIMEOUT_MS: 1000,
    STEP8_STRATEGIES: [{ mode: 'debugger', label: 'debugger click' }],
    addLog: async (message, level) => {
      logs.push({ message, level });
    },
    chrome: {
      tabs: {
        update: async () => {},
        onUpdated: {
          addListener(listener) {
            listeners.tabUpdated = listener;
          },
          removeListener(listener) {
            if (listeners.tabUpdated === listener) {
              listeners.tabUpdated = null;
            }
          },
        },
      },
      webNavigation: {
        onBeforeNavigate: {
          addListener(listener) {
            listeners.beforeNavigate = listener;
          },
          removeListener(listener) {
            if (listeners.beforeNavigate === listener) {
              listeners.beforeNavigate = null;
            }
          },
        },
        onCommitted: {
          addListener(listener) {
            listeners.committed = listener;
          },
          removeListener(listener) {
            if (listeners.committed === listener) {
              listeners.committed = null;
            }
          },
        },
      },
    },
    cleanupStep8NavigationListeners: () => {
      listeners.beforeNavigate = null;
      listeners.committed = null;
      listeners.tabUpdated = null;
      listeners.pendingReject = null;
    },
    clickWithDebugger: async () => {
      setTimeout(() => {
        if (typeof listeners.tabUpdated === 'function') {
          listeners.tabUpdated(101, { status: 'complete' }, { url: 'http://127.0.0.1/callback?code=abc' });
        }
      }, 0);
    },
    completeNodeFromBackground: async (_nodeId, payload) => {
      completions.push(payload);
    },
    ensureStep8SignupPageReady: async () => {},
    getOAuthFlowStepTimeoutMs: async (fallbackMs) => fallbackMs,
    getStep8CallbackUrlFromNavigation: () => '',
    getStep8CallbackUrlFromTabUpdate: (_tabId, _changeInfo, tab) => String(tab?.url || '').startsWith('http://127.0.0.1/')
      ? String(tab.url)
      : '',
    getStep8EffectLabel: (effect) => effect?.reason || 'unknown',
    getTabId: async () => 101,
    getWebNavCommittedListener: () => listeners.committed,
    getWebNavListener: () => listeners.beforeNavigate,
    getStep8TabUpdatedListener: () => listeners.tabUpdated,
    isTabAlive: async () => true,
    prepareStep8DebuggerClick: async () => ({ rect: { left: 1, top: 1, width: 10, height: 10 } }),
    recoverOAuthLocalhostTimeout: async () => null,
    recoverStep9AuthFallback: async (details) => {
      recoverCalls.push(details);
      return {
        ...details.state,
        oauthUrl: 'https://auth.openai.com/oauth/recovered',
      };
    },
    reloadStep8ConsentPage: async () => {},
    reuseOrCreateTab: async () => 101,
    setStep8PendingReject: (handler) => {
      listeners.pendingReject = handler;
    },
    setStep8TabUpdatedListener: (listener) => {
      listeners.tabUpdated = listener;
    },
    setWebNavCommittedListener: (listener) => {
      listeners.committed = listener;
    },
    setWebNavListener: (listener) => {
      listeners.beforeNavigate = listener;
    },
    shouldDeferStep9CallbackTimeout: async () => false,
    sleepWithStop: async () => {},
    throwIfStep8SettledOrStopped: () => {},
    triggerStep8ContentStrategy: async () => ({ strategy: 'requestSubmit' }),
    waitForStep8ClickEffect: async () => ({ progressed: true, reason: 'url_changed', url: 'https://auth.openai.com/oauth/consent' }),
    waitForStep8Ready: async () => {
      const next = pageStates[Math.min(waitIndex, pageStates.length - 1)] || null;
      waitIndex += 1;
      return next;
    },
  });

  return {
    completions,
    executor,
    logs,
    recoverCalls,
  };
}

test('confirm-oauth recovers after verification page fallback and completes callback', async () => {
  const harness = createExecutorHarness([
    {
      state: 'verification_page',
      verificationPage: true,
      displayedEmail: 'user@example.com',
      url: 'https://auth.openai.com/u/login/identifier',
    },
    {
      state: 'oauth_consent_page',
      consentPage: true,
      consentReady: true,
      url: 'https://auth.openai.com/oauth/consent',
    },
  ]);

  await harness.executor.executeStep9({
    nodeId: 'confirm-oauth',
    oauthUrl: 'https://auth.openai.com/oauth/original',
    visibleStep: 9,
  });

  assert.equal(harness.recoverCalls.length, 1);
  assert.equal(harness.recoverCalls[0].pageState.displayedEmail, 'user@example.com');
  assert.equal(harness.completions[0].localhostUrl, 'http://127.0.0.1/callback?code=abc');
});

test('confirm-oauth recovers after add-email fallback and completes callback', async () => {
  const harness = createExecutorHarness([
    {
      state: 'add_email_page',
      addEmailPage: true,
      url: 'https://auth.openai.com/u/login/add-email',
    },
    {
      state: 'oauth_consent_page',
      consentPage: true,
      consentReady: true,
      url: 'https://auth.openai.com/oauth/consent',
    },
  ]);

  await harness.executor.executeStep9({
    nodeId: 'confirm-oauth',
    oauthUrl: 'https://auth.openai.com/oauth/original',
    visibleStep: 9,
  });

  assert.equal(harness.recoverCalls.length, 1);
  assert.equal(harness.recoverCalls[0].pageState.addEmailPage, true);
  assert.equal(harness.completions[0].localhostUrl, 'http://127.0.0.1/callback?code=abc');
});

test('confirm-oauth stops after one auth fallback recovery attempt', async () => {
  const harness = createExecutorHarness([
    {
      state: 'verification_page',
      verificationPage: true,
      displayedEmail: 'first@example.com',
      url: 'https://auth.openai.com/u/login/identifier',
    },
    {
      state: 'verification_page',
      verificationPage: true,
      displayedEmail: 'second@example.com',
      url: 'https://auth.openai.com/u/login/identifier',
    },
  ]);

  await assert.rejects(
    () => harness.executor.executeStep9({
      nodeId: 'confirm-oauth',
      oauthUrl: 'https://auth.openai.com/oauth/original',
      visibleStep: 9,
    }),
    /已自动恢复 1 次仍未成功/
  );

  assert.equal(harness.recoverCalls.length, 1);
  assert.equal(harness.completions.length, 0);
});
