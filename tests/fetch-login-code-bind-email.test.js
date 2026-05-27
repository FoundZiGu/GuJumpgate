const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadStep8Module() {
  const filePath = path.join(__dirname, '..', 'background', 'steps', 'fetch-login-code.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundStep8;
}

for (const emailGenerator of ['cloudflare-temp-email', 'cloudmail', 'freemail', 'outlook-email-plus']) {
  test(`bind-email auto-generates missing ${emailGenerator} address for phone signup flow`, async () => {
    const step8Module = loadStep8Module();
    const sendCalls = [];
    const completionPayloads = [];
    const persistedEmails = [];
    const logMessages = [];
    let currentState = {
      nodeId: 'bind-email',
      oauthUrl: 'https://auth.openai.com/oauth/authorize?client_id=test',
      accountIdentifierType: 'phone',
      accountIdentifier: '+15550001111',
      signupPhoneNumber: '+15550001111',
      phoneVerificationEnabled: true,
      mailProvider: emailGenerator === 'cloudmail'
        ? 'cloudmail'
        : (emailGenerator === 'freemail'
          ? 'freemail'
          : (emailGenerator === 'outlook-email-plus' ? 'outlook-email-plus' : 'cloudflare-temp-email')),
      emailGenerator,
      email: '',
      registrationEmailState: null,
    };

    const executor = step8Module.createStep8Executor({
      addLog: async (message) => {
        logMessages.push(String(message || ''));
      },
      chrome: {
        tabs: {
          update: async () => {},
        },
      },
      completeNodeFromBackground: async (_nodeId, payload) => {
        completionPayloads.push(payload);
      },
      getOAuthFlowStepTimeoutMs: async (fallbackMs) => fallbackMs,
      getState: async () => currentState,
      getTabId: async () => 123,
      resolveSignupEmailForFlow: async (state, options = {}) => {
        assert.equal(state.accountIdentifierType, 'phone');
        assert.equal(state.email, '');
        assert.equal(options.preserveAccountIdentity, true);
        return `auto-${emailGenerator}@example.com`;
      },
      persistRegistrationEmailState: async (_state, email, options = {}) => {
        persistedEmails.push({ email, options });
        currentState = {
          ...currentState,
          email,
          registrationEmailState: {
            current: email,
          },
        };
      },
      sendToContentScriptResilient: async (_source, message) => {
        sendCalls.push(message);
        if (message.type === 'GET_LOGIN_AUTH_STATE') {
          return {
            state: 'add_email_page',
            url: 'https://auth.openai.com/add-email',
          };
        }
        if (message.type === 'SUBMIT_ADD_EMAIL') {
          return {
            displayedEmail: `auto-${emailGenerator}@example.com`,
            url: 'https://auth.openai.com/u/login/email-verification',
          };
        }
        throw new Error(`unexpected message type: ${message.type}`);
      },
      setState: async (updates) => {
        currentState = {
          ...currentState,
          ...updates,
        };
      },
    });

    await executor.executeBindEmail(currentState);

    assert.equal(sendCalls.length, 2);
    assert.equal(sendCalls[1].type, 'SUBMIT_ADD_EMAIL');
    assert.equal(sendCalls[1].payload.email, `auto-${emailGenerator}@example.com`);

    assert.equal(persistedEmails.length, 1);
    assert.equal(persistedEmails[0].email, `auto-${emailGenerator}@example.com`);
    assert.equal(persistedEmails[0].options.preserveAccountIdentity, true);
    assert.equal(persistedEmails[0].options.source, 'bind_email');

    assert.equal(completionPayloads.length, 1);
    assert.equal(completionPayloads[0].bindEmailSubmitted, true);
    assert.equal(completionPayloads[0].email, `auto-${emailGenerator}@example.com`);
    assert.equal(completionPayloads[0].boundEmail, `auto-${emailGenerator}@example.com`);
    assert.equal(completionPayloads[0].step8VerificationTargetEmail, `auto-${emailGenerator}@example.com`);

    assert.ok(logMessages.some((message) => message.includes(`auto-${emailGenerator}@example.com`)));
  });
}

test('bound-email login code uses stable boundEmail after transient verification target is cleared', async () => {
  const step8Module = loadStep8Module();
  const stateUpdates = [];
  const verificationCalls = [];
  const currentState = {
    nodeId: 'fetch-bound-email-login-code',
    oauthUrl: 'https://auth.openai.com/oauth/authorize?client_id=test',
    email: 'original@example.com',
    boundEmail: 'bound@example.com',
    step8VerificationTargetEmail: '',
    registrationEmailState: {
      current: 'original@example.com',
    },
    mailProvider: 'hotmail-api',
    loginVerificationRequestedAt: 0,
  };

  const executor = step8Module.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    completeNodeFromBackground: async () => {},
    ensureStep8VerificationPageReady: async () => ({
      state: 'verification_page',
      displayedEmail: '',
      url: 'https://auth.openai.com/u/login/email-verification',
    }),
    getMailConfig: () => ({
      provider: 'hotmail-api',
      source: 'hotmail-api',
      label: 'Hotmail',
    }),
    getOAuthFlowStepTimeoutMs: async (fallbackMs) => fallbackMs,
    getState: async () => currentState,
    getTabId: async () => 123,
    HOTMAIL_PROVIDER: 'hotmail-api',
    resolveVerificationStep: async (_step, preparedState, _mail, options = {}) => {
      verificationCalls.push({ preparedState, options });
    },
    setState: async (updates) => {
      stateUpdates.push(updates);
    },
    shouldUseCustomRegistrationEmail: () => false,
    throwIfStopped: () => {},
  });

  await executor.executeBoundEmailLoginCode(currentState);

  assert.equal(verificationCalls.length, 1);
  assert.equal(verificationCalls[0].preparedState.email, 'bound@example.com');
  assert.equal(verificationCalls[0].preparedState.accountIdentifier, 'bound@example.com');
  assert.equal(verificationCalls[0].preparedState.boundEmail, 'bound@example.com');
  assert.equal(verificationCalls[0].options.targetEmail, 'bound@example.com');
  assert.equal(stateUpdates[0].step8VerificationTargetEmail, '');
});

test('login code step treats Outlook Email Plus as API polling mail provider', async () => {
  const step8Module = loadStep8Module();
  const logs = [];
  const verificationCalls = [];
  let openedMailTab = false;
  const currentState = {
    nodeId: 'fetch-login-code',
    oauthUrl: 'https://auth.openai.com/oauth/authorize?client_id=test',
    email: 'user+PayPal1@example.com',
    registrationEmailState: { current: 'user+PayPal1@example.com' },
    mailProvider: 'outlook-email-plus',
    emailGenerator: 'outlook-email-plus',
    loginVerificationRequestedAt: 0,
  };

  const executor = step8Module.createStep8Executor({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    ensureStep8VerificationPageReady: async () => ({
      state: 'verification_page',
      displayedEmail: 'user+PayPal1@example.com',
      url: 'https://auth.openai.com/u/login/email-verification',
    }),
    getMailConfig: () => ({
      provider: 'outlook-email-plus',
      label: 'Outlook Email Plus',
    }),
    getOAuthFlowStepTimeoutMs: async (fallbackMs) => fallbackMs,
    getState: async () => currentState,
    getTabId: async () => 321,
    resolveVerificationStep: async (_step, preparedState, mail, options = {}) => {
      verificationCalls.push({ preparedState, mail, options });
    },
    reuseOrCreateTab: async () => {
      openedMailTab = true;
    },
    sendToContentScriptResilient: async () => ({}),
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    throwIfStopped: () => {},
  });

  await executor.executeStep8(currentState);

  assert.equal(openedMailTab, false);
  assert.equal(verificationCalls.length, 1);
  assert.equal(verificationCalls[0].mail.provider, 'outlook-email-plus');
  assert.equal(verificationCalls[0].options.targetEmail, 'user+paypal1@example.com');
  assert.ok(logs.some((message) => message.includes('正在通过 Outlook Email Plus 轮询验证码')));
});

test('login code step treats iCloud API as API polling mail provider', async () => {
  const step8Module = loadStep8Module();
  const logs = [];
  const verificationCalls = [];
  let openedMailTab = false;
  const currentState = {
    nodeId: 'fetch-login-code',
    oauthUrl: 'https://auth.openai.com/oauth/authorize?client_id=test',
    email: 'alias@example.com',
    registrationEmailState: { current: 'alias@example.com' },
    mailProvider: 'icloud-api',
    loginVerificationRequestedAt: 0,
  };

  const executor = step8Module.createStep8Executor({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    ensureStep8VerificationPageReady: async () => ({
      state: 'verification_page',
      displayedEmail: 'alias@example.com',
      url: 'https://auth.openai.com/u/login/email-verification',
    }),
    getMailConfig: () => ({
      provider: 'icloud-api',
      label: 'iCloud API（QQ 转发）',
    }),
    getOAuthFlowStepTimeoutMs: async (fallbackMs) => fallbackMs,
    getState: async () => currentState,
    getTabId: async () => 321,
    HOTMAIL_PROVIDER: 'hotmail-api',
    ICLOUD_API_PROVIDER: 'icloud-api',
    resolveVerificationStep: async (_step, preparedState, mail, options = {}) => {
      verificationCalls.push({ preparedState, mail, options });
    },
    reuseOrCreateTab: async () => {
      openedMailTab = true;
    },
    sendToContentScriptResilient: async () => ({}),
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    throwIfStopped: () => {},
  });

  await executor.executeStep8(currentState);

  assert.equal(openedMailTab, false);
  assert.equal(verificationCalls.length, 1);
  assert.equal(verificationCalls[0].mail.provider, 'icloud-api');
  assert.equal(verificationCalls[0].options.targetEmail, 'alias@example.com');
  assert.equal(verificationCalls[0].options.resendIntervalMs, 0);
  assert.ok(logs.some((message) => message.includes('iCloud API')));
});
