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

function loadRequestStopHarness(stateOverrides = {}) {
  const filePath = path.join(__dirname, '..', 'background.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const requestStopSource = extractFunctionSource(source, 'requestStop');
  const stateUpdates = [];
  const broadcastPayloads = [];
  const logs = [];
  const rejectedPendingStep8 = [];
  const releasedCurrentActivations = [];
  const releasedSignupActivations = [];
  let state = {
    nodeStatuses: {},
    phoneAutoReleaseOnStopEnabled: false,
    currentPhoneActivation: {
      phoneNumber: '573244489232',
      activationId: '341337093',
      provider: 'smsbower',
    },
    currentPhoneVerificationCode: '123456',
    currentPhoneVerificationCountdownEndsAt: Date.now() + 60_000,
    currentPhoneVerificationCountdownWindowIndex: 1,
    currentPhoneVerificationCountdownWindowTotal: 2,
    plusManualConfirmationPending: false,
    ...stateOverrides,
  };
  const sandbox = {
    STOP_ERROR_MESSAGE: '流程已被用户停止。',
    AUTO_RUN_TIMER_KIND_SCHEDULED_START: 'scheduled-start',
    autoRunActive: false,
    autoRunCurrentRun: 0,
    autoRunTotalRuns: 1,
    autoRunAttemptRun: 0,
    stopRequested: false,
    nodeWaiters: new Map(),
    stepWaiters: new Map(),
    resumeWaiter: null,
    getState: async () => state,
    getRunningNodeIds: () => [],
    inferStoppedRecordNode: () => null,
    getPendingAutoRunTimerPlan: () => null,
    cancelScheduledAutoRun: async () => {},
    clearCurrentAutoRunSessionId: () => {},
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    broadcastAutoRunStatus: async () => {},
    clearAutoRunTimerAlarm: async () => {},
    clearStopRequest: () => {},
    cancelPendingCommands: () => {},
    abortActiveIcloudRequests: () => {},
    cleanupStep8NavigationListeners: () => {},
    rejectPendingStep8: (error) => {
      rejectedPendingStep8.push(error);
    },
    broadcastStopToContentScripts: async () => {},
    setState: async (updates) => {
      stateUpdates.push(updates);
      state = { ...state, ...updates };
    },
    phoneVerificationHelpers: {
      cancelCurrentPhoneActivation: async (_state, activation) => {
        releasedCurrentActivations.push(activation);
      },
      cancelSignupPhoneActivation: async (_state, activation) => {
        releasedSignupActivations.push(activation);
      },
    },
    broadcastDataUpdate: (updates) => {
      broadcastPayloads.push(updates);
    },
    appendAndBroadcastAccountRunRecord: async () => {},
    markRunningNodesStopped: async () => {},
    console,
    Error,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${requestStopSource};\nglobalThis.__requestStop = requestStop;`, sandbox, { filename: filePath });
  return {
    requestStop: sandbox.__requestStop,
    stateUpdates,
    broadcastPayloads,
    logs,
    rejectedPendingStep8,
    releasedCurrentActivations,
    releasedSignupActivations,
    getStateSnapshot: () => ({ ...state }),
  };
}

test('requestStop clears current phone runtime even when stop is configured to preserve the activation order', async () => {
  const harness = loadRequestStopHarness();

  await harness.requestStop();

  assert.equal(harness.logs[0], '已收到停止请求，正在取消当前操作...');
  assert.equal(harness.rejectedPendingStep8.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.stateUpdates[0])), {
    currentPhoneActivation: null,
    currentPhoneVerificationCode: '',
    currentPhoneVerificationCountdownEndsAt: 0,
    currentPhoneVerificationCountdownWindowIndex: 0,
    currentPhoneVerificationCountdownWindowTotal: 0,
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.broadcastPayloads[0])),
    JSON.parse(JSON.stringify(harness.stateUpdates[0]))
  );
  assert.equal(harness.getStateSnapshot().currentPhoneActivation, null);
  assert.equal(harness.releasedCurrentActivations.length, 0);
  assert.equal(harness.releasedSignupActivations.length, 0);
});

test('requestStop releases current phone activation before clearing runtime when auto-release is enabled', async () => {
  const harness = loadRequestStopHarness({
    phoneAutoReleaseOnStopEnabled: true,
    signupPhoneActivation: {
      phoneNumber: '573244489233',
      activationId: '341337094',
      provider: 'hero-sms',
    },
  });

  await harness.requestStop();

  assert.equal(harness.releasedCurrentActivations.length, 1);
  assert.equal(harness.releasedCurrentActivations[0].activationId, '341337093');
  assert.equal(harness.releasedSignupActivations.length, 1);
  assert.equal(harness.releasedSignupActivations[0].activationId, '341337094');
  assert.equal(harness.logs.includes('停止流程：正在自动释放当前接码手机号订单。'), true);
  assert.equal(harness.logs.includes('停止流程：正在自动释放注册手机号接码订单。'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.stateUpdates[harness.stateUpdates.length - 1])), {
    currentPhoneActivation: null,
    currentPhoneVerificationCode: '',
    currentPhoneVerificationCountdownEndsAt: 0,
    currentPhoneVerificationCountdownWindowIndex: 0,
    currentPhoneVerificationCountdownWindowTotal: 0,
  });
});
