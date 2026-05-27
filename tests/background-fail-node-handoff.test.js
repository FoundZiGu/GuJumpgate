const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function extractFunctionSource(source, functionName) {
  const signature = `async function ${functionName}`;
  const startIndex = source.indexOf(signature);
  if (startIndex < 0) {
    throw new Error(`Unable to find function ${functionName}`);
  }
  const paramsStart = source.indexOf('(', startIndex);
  if (paramsStart < 0) {
    throw new Error(`Unable to find parameter list for ${functionName}`);
  }
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      paramsDepth += 1;
    } else if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = source.indexOf('{', index);
        break;
      }
    }
  }
  if (bodyStart < 0) {
    throw new Error(`Unable to find body for ${functionName}`);
  }
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract full source for ${functionName}`);
}

function loadFailNodeHarness(overrides = {}) {
  const filePath = path.join(__dirname, '..', 'background.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const failNodeSource = extractFunctionSource(source, 'failNodeFromBackground');
  const notifications = [];
  const warnings = [];
  const sandbox = {
    LOG_PREFIX: '[MultiPage:test]',
    STOP_ERROR_MESSAGE: '流程已被用户停止。',
    stopRequested: false,
    getErrorMessage: (error) => String(error?.message || error || ''),
    isStopError: () => false,
    getState: async () => ({ nodeStatuses: {} }),
    setNodeStatus: async () => {},
    schedulePayPalCookieCleanupBeforeCheckoutCreateIfNeeded: async () => {},
    addLog: async () => {},
    appendManualAccountRunRecordIfNeeded: async () => {},
    notifyNodeError: (nodeId, error) => {
      notifications.push({ nodeId, error });
    },
    console: {
      warn: (...args) => warnings.push(args.map(String).join(' ')),
    },
    Error,
    ...overrides,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${failNodeSource};\nglobalThis.__failNodeFromBackground = failNodeFromBackground;`, sandbox, {
    filename: filePath,
  });
  return {
    failNodeFromBackground: sandbox.__failNodeFromBackground,
    notifications,
    warnings,
  };
}

test('failNodeFromBackground still notifies waiters when setNodeStatus throws', async () => {
  const harness = loadFailNodeHarness({
    setNodeStatus: async () => {
      throw new Error('setNodeStatus exploded');
    },
  });
  const errorMessage = 'PLUS_CHECKOUT_NON_FREE_TRIAL::步骤 6：检测到今日应付金额不是 0（US$20.00）';

  await assert.doesNotReject(
    harness.failNodeFromBackground('plus-checkout-create', errorMessage)
  );

  assert.deepEqual(harness.notifications, [{
    nodeId: 'plus-checkout-create',
    error: errorMessage,
  }]);
  assert.equal(
    harness.warnings.some((entry) => entry.includes('set failed status failed')),
    true
  );
});

test('failNodeFromBackground still notifies waiters when addLog throws', async () => {
  const harness = loadFailNodeHarness({
    addLog: async () => {
      throw new Error('addLog exploded');
    },
  });
  const errorMessage = 'PLUS_CHECKOUT_NON_FREE_TRIAL::步骤 6：检测到今日应付金额不是 0（US$20.00）';

  await assert.doesNotReject(
    harness.failNodeFromBackground('plus-checkout-create', errorMessage)
  );

  assert.deepEqual(harness.notifications, [{
    nodeId: 'plus-checkout-create',
    error: errorMessage,
  }]);
  assert.equal(
    harness.warnings.some((entry) => entry.includes('write failure log failed')),
    true
  );
});
