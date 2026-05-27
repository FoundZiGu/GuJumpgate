const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadStep4Module() {
  const filePath = path.join(__dirname, '..', 'background', 'steps', 'fetch-signup-code.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundStep4;
}

test('signup code step treats Outlook Email Plus as API polling mail provider', async () => {
  const step4Module = loadStep4Module();
  const logs = [];
  const verificationCalls = [];
  let openedMailTab = false;

  const executor = step4Module.createStep4Executor({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    completeNodeFromBackground: async () => {},
    getMailConfig: () => ({
      provider: 'outlook-email-plus',
      label: 'Outlook Email Plus',
    }),
    getTabId: async () => 123,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    CLOUD_MAIL_PROVIDER: 'cloudmail',
    OUTLOOK_EMAIL_PLUS_PROVIDER: 'outlook-email-plus',
    resolveVerificationStep: async (_step, state, mail, options = {}) => {
      verificationCalls.push({ state, mail, options });
    },
    reuseOrCreateTab: async () => {
      openedMailTab = true;
    },
    shouldUseCustomRegistrationEmail: () => false,
    sendToContentScript: async () => ({
      alreadyVerified: false,
    }),
    resolveSignupMethod: () => 'email',
    throwIfStopped: () => {},
    waitForTabStableComplete: async () => {},
  });

  await executor.executeStep4({
    nodeId: 'fetch-signup-code',
    email: 'user+PayPal1@example.com',
    registrationEmailState: { current: 'user+PayPal1@example.com' },
    mailProvider: 'outlook-email-plus',
    emailGenerator: 'outlook-email-plus',
  });

  assert.equal(openedMailTab, false);
  assert.equal(verificationCalls.length, 1);
  assert.equal(verificationCalls[0].mail.provider, 'outlook-email-plus');
  assert.ok(logs.some((message) => message.includes('正在通过 Outlook Email Plus 轮询验证码')));
});

test('signup code step treats iCloud API as API polling mail provider', async () => {
  const step4Module = loadStep4Module();
  const logs = [];
  const verificationCalls = [];
  let openedMailTab = false;

  const executor = step4Module.createStep4Executor({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    completeNodeFromBackground: async () => {},
    getMailConfig: () => ({
      provider: 'icloud-api',
      label: 'iCloud API（QQ 转发）',
    }),
    getTabId: async () => 123,
    HOTMAIL_PROVIDER: 'hotmail-api',
    ICLOUD_API_PROVIDER: 'icloud-api',
    isTabAlive: async () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    CLOUD_MAIL_PROVIDER: 'cloudmail',
    OUTLOOK_EMAIL_PLUS_PROVIDER: 'outlook-email-plus',
    resolveVerificationStep: async (_step, state, mail, options = {}) => {
      verificationCalls.push({ state, mail, options });
    },
    reuseOrCreateTab: async () => {
      openedMailTab = true;
    },
    shouldUseCustomRegistrationEmail: () => false,
    sendToContentScript: async () => ({
      alreadyVerified: false,
    }),
    resolveSignupMethod: () => 'email',
    throwIfStopped: () => {},
    waitForTabStableComplete: async () => {},
  });

  await executor.executeStep4({
    nodeId: 'fetch-signup-code',
    email: 'alias@example.com',
    registrationEmailState: { current: 'alias@example.com' },
    mailProvider: 'icloud-api',
  });

  assert.equal(openedMailTab, false);
  assert.equal(verificationCalls.length, 1);
  assert.equal(verificationCalls[0].mail.provider, 'icloud-api');
  assert.equal(verificationCalls[0].options.requestFreshCodeFirst, false);
  assert.equal(verificationCalls[0].options.resendIntervalMs, 0);
  assert.ok(logs.some((message) => message.includes('iCloud API')));
});
