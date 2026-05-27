const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadTabRuntimeModule() {
  const filePath = path.join(__dirname, '..', 'background', 'tab-runtime.js');
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
  return sandbox.MultiPageBackgroundTabRuntime;
}

function createHarness() {
  const module = loadTabRuntimeModule();
  const events = [];
  let nextTabId = 2;
  let state = {
    automationWindowId: 99,
    sourceLastUrls: {},
    tabRegistry: {},
  };
  let tabs = [
    {
      id: 1,
      windowId: 99,
      url: 'https://chatgpt.com/',
      active: true,
      status: 'complete',
    },
  ];

  const runtime = module.createTabRuntime({
    LOG_PREFIX: '[test]',
    addLog: async () => {},
    chrome: {
      tabs: {
        query: async (queryInfo = {}) => tabs.filter((tab) => (
          !Number.isInteger(queryInfo.windowId) || tab.windowId === queryInfo.windowId
        )),
        create: async (createProperties = {}) => {
          events.push({ type: 'create', createProperties });
          const tab = {
            id: nextTabId++,
            windowId: Number(createProperties.windowId) || 99,
            url: String(createProperties.url || ''),
            active: Boolean(createProperties.active),
            status: 'complete',
          };
          tabs.push(tab);
          return tab;
        },
        remove: async (tabIds) => {
          const ids = Array.isArray(tabIds) ? tabIds.slice() : [tabIds];
          events.push({ type: 'remove', tabIds: ids });
          tabs = tabs.filter((tab) => !ids.includes(tab.id));
        },
      },
    },
    getSourceLabel: (source) => source,
    getState: async () => state,
    isLocalhostOAuthCallbackUrl: () => false,
    isRetryableContentScriptTransportError: () => false,
    matchesSourceUrlFamily: (_source, candidateUrl, referenceUrl) => (
      String(candidateUrl || '').startsWith('https://chatgpt.com/')
      && String(referenceUrl || '').startsWith('https://chatgpt.com/')
    ),
    setState: async (updates) => {
      state = { ...state, ...updates };
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  return {
    events,
    getState: () => state,
    getTabs: () => tabs.slice(),
    runtime,
  };
}

test('reuseOrCreateTab creates a replacement before removing the last conflicting tab', async () => {
  const harness = createHarness();

  const tabId = await harness.runtime.reuseOrCreateTab('signup-page', 'https://chatgpt.com/', {});

  assert.equal(tabId, 2);
  assert.deepEqual(
    harness.events.map((entry) => entry.type),
    ['create', 'remove']
  );
  assert.deepEqual(harness.events[1].tabIds, [1]);
  assert.deepEqual(
    harness.getTabs().map((tab) => tab.id),
    [2]
  );
  assert.equal(harness.getState().sourceLastUrls['signup-page'], 'https://chatgpt.com/');
});

test('reuseOrCreateTab forceNew keeps the replacement tab excluded from cleanup', async () => {
  const harness = createHarness();

  const tabId = await harness.runtime.reuseOrCreateTab('signup-page', 'https://chatgpt.com/', {
    forceNew: true,
  });

  assert.equal(tabId, 2);
  assert.deepEqual(
    harness.events.map((entry) => entry.type),
    ['create', 'remove']
  );
  assert.deepEqual(harness.events[1].tabIds, [1]);
  assert.deepEqual(
    harness.getTabs().map((tab) => tab.id),
    [2]
  );
});
