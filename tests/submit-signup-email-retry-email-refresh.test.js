const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadStep2Module() {
  const filePath = path.join(__dirname, '..', 'background', 'steps', 'submit-signup-email.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundStep2;
}

test('step 2 manual retry ignores the stale runtime email after invalidation and requests a fresh email', async () => {
  const module = loadStep2Module();
  const resolveCalls = [];
  const completionPayloads = [];

  const executor = module.createStep2Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async () => ({ url: 'https://chatgpt.com/auth/login' }),
        update: async () => {},
      },
    },
    completeNodeFromBackground: async (_nodeId, payload) => {
      completionPayloads.push(payload);
    },
    ensureContentScriptReadyOnTab: async () => {},
    ensureSignupEntryPageReady: async () => ({ tabId: 101 }),
    ensureSignupPostEmailPageReadyInTab: async () => ({
      state: 'password_page',
      url: 'https://chatgpt.com/auth/password',
    }),
    getTabId: async () => 101,
    isTabAlive: async () => true,
    resolveSignupMethod: () => 'email',
    resolveSignupEmailForFlow: async (state, options = {}) => {
      resolveCalls.push({ state, options });
      return 'fresh@example.com';
    },
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type === 'ENSURE_SIGNUP_ENTRY_READY') {
        return { state: 'email_entry' };
      }
      if (message.type === 'EXECUTE_NODE') {
        return { url: 'https://chatgpt.com/auth/password' };
      }
      throw new Error(`Unexpected message type: ${message.type}`);
    },
    SIGNUP_PAGE_INJECT_FILES: [],
    waitForTabStableComplete: async () => {},
  });

  await executor.executeStep2({
    email: 'stale@example.com',
    registrationEmailState: {
      current: '',
      previous: 'stale@example.com',
    },
  });

  assert.equal(resolveCalls.length, 1);
  assert.equal(resolveCalls[0].options.ignoreCurrentEmail, true);
  assert.equal(completionPayloads.length, 1);
  assert.equal(completionPayloads[0].email, 'fresh@example.com');
  assert.equal(completionPayloads[0].accountIdentifierType, 'email');
});
