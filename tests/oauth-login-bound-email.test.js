const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadStep7Module() {
  const filePath = path.join(__dirname, '..', 'background', 'steps', 'oauth-login.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundStep7;
}

test('relogin-bound-email forced state overrides stale session identity', async () => {
  const step7Module = loadStep7Module();
  const sentPayloads = [];
  const staleSessionState = {
    nodeId: 'relogin-bound-email',
    oauthUrl: 'https://auth.openai.com/oauth/authorize?client_id=test',
    signupMethod: 'phone',
    resolvedSignupMethod: 'phone',
    accountIdentifierType: 'phone',
    accountIdentifier: '+15550001111',
    signupPhoneNumber: '+15550001111',
    email: 'original@example.com',
    password: 'pw',
    phoneVerificationEnabled: true,
  };

  const executor = step7Module.createStep7Executor({
    addLog: async () => {},
    completeNodeFromBackground: async () => {},
    getErrorMessage: (error) => error?.message || String(error || ''),
    getLoginAuthStateLabel: (state) => state || 'unknown',
    getOAuthFlowStepTimeoutMs: async (fallbackMs) => fallbackMs,
    getState: async () => staleSessionState,
    isStep6RecoverableResult: () => false,
    isStep6SuccessResult: (result) => Boolean(result?.success),
    refreshOAuthUrlBeforeStep6: async () => staleSessionState.oauthUrl,
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async (_source, message) => {
      sentPayloads.push(message.payload);
      return {
        success: true,
        state: 'verification_page',
        loginVerificationRequestedAt: 123,
      };
    },
    STEP6_MAX_ATTEMPTS: 1,
    throwIfStopped: () => {},
  });

  await executor.executeStep7({
    ...staleSessionState,
    forceLoginIdentifierType: 'email',
    forceEmailLogin: true,
    signupMethod: 'email',
    resolvedSignupMethod: 'email',
    accountIdentifierType: 'email',
    accountIdentifier: 'bound@example.com',
    email: 'bound@example.com',
    boundEmail: 'bound@example.com',
    step8VerificationTargetEmail: 'bound@example.com',
  });

  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].loginIdentifierType, 'email');
  assert.equal(sentPayloads[0].accountIdentifier, 'bound@example.com');
  assert.equal(sentPayloads[0].email, 'bound@example.com');
  assert.equal(sentPayloads[0].phoneNumber, '');
});
