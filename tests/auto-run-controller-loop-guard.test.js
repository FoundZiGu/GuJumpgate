const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/auto-run-controller.js');

function createRuntime() {
  const state = {
    autoRunActive: false,
    autoRunSessionId: 0,
    autoRunCurrentRun: 0,
    autoRunTotalRuns: 0,
    autoRunAttemptRun: 0,
  };
  return {
    get() {
      return { ...state };
    },
    set(updates = {}) {
      Object.assign(state, updates || {});
    },
  };
}

test('auto run caps same-email retries and continues to next round when skip failures is enabled', async () => {
  const moduleApi = globalThis.MultiPageBackgroundAutoRunController;
  const logs = [];
  const statuses = [];
  const records = [];
  const runtime = createRuntime();
  const baseState = {
    mailProvider: 'custom',
    customMailProviderPool: ['seed@example.com'],
    autoRunFallbackThreadIntervalMinutes: 0,
  };
  let state = { ...baseState };
  let runCalls = 0;

  const controller = moduleApi.createAutoRunController({
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 3,
    AUTO_RUN_RETRY_DELAY_MS: 1,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before_retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between_rounds',
    addLog: async (message, level) => {
      logs.push([level, String(message || '')]);
    },
    appendAccountRunRecord: async (status, recordState, reason) => {
      records.push({ status, reason, recordState });
      return { status, reason };
    },
    broadcastAutoRunStatus: async (status, payload) => {
      statuses.push({ status, payload });
    },
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve(),
      },
    },
    clearStopRequest: () => {},
    createAutoRunSessionId: () => 77,
    ensureHotmailMailboxReadyForAutoRunRound: async () => {},
    getAutoRunStatusPayload: () => ({}),
    getErrorMessage: (error) => String(error?.message || error || ''),
    getFirstUnfinishedNodeId: () => null,
    getPendingAutoRunTimerPlan: () => null,
    getRunningNodeIds: () => [],
    getState: async () => ({ ...state }),
    getStopRequested: () => false,
    hasSavedNodeProgress: () => false,
    isAddPhoneAuthFailure: () => false,
    isCloudCheckoutAlreadyPaidFailure: () => false,
    isGpcTaskEndedFailure: () => false,
    isHostedCheckoutGenericErrorFailure: () => false,
    isHostedCheckoutVerificationResendLimitFailure: () => false,
    isPhoneSmsPlatformRateLimitFailure: () => false,
    isPlusCheckoutNonFreeTrialFailure: () => false,
    isRestartCurrentAttemptError: () => false,
    isSignupUserAlreadyExistsFailure: () => false,
    isStep4Route405RecoveryLimitFailure: () => false,
    isStopError: () => false,
    launchAutoRunTimerPlan: async () => false,
    normalizeAutoRunFallbackThreadIntervalMinutes: (value) => Math.max(0, Number(value) || 0),
    persistAutoRunTimerPlan: async () => {},
    resetState: async () => {
      state = { ...baseState };
    },
    runAutoSequenceFromNode: async () => {
      runCalls += 1;
      throw new Error('generic retryable failure');
    },
    runtime,
    setState: async (updates) => {
      state = { ...state, ...(updates || {}) };
    },
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: () => {},
    waitForRunningNodesToFinish: async () => ({ ...state }),
  });

  await controller.autoRunLoop(2, {
    autoRunSkipFailures: true,
  });

  assert.equal(
    runCalls,
    (controller.__test.AUTO_RUN_MAX_KEEP_SAME_EMAIL_RETRIES_PER_ROUND + 1) * 2
  );
  assert.ok(
    logs.some(([, message]) => message.includes('继续使用当前邮箱重试已达到 10 次上限')),
    'expected same-email retry limit log to be emitted'
  );
  assert.equal(statuses.at(-1)?.status, 'complete');
  assert.equal(records.length, 2);
  records.forEach((record) => {
    assert.match(record.reason, /^KEEP_SAME_EMAIL_RETRY_LIMIT_EXCEEDED::/);
  });
  assert.equal(state.autoRunRoundSummaries.length, 2);
  state.autoRunRoundSummaries.forEach((summary) => {
    assert.equal(summary.status, 'failed');
    assert.match(summary.finalFailureReason, /^KEEP_SAME_EMAIL_RETRY_LIMIT_EXCEEDED::/);
  });
});

test('auto run retries non-free-trial failures and logs the next email attempt', async () => {
  const moduleApi = globalThis.MultiPageBackgroundAutoRunController;
  const logs = [];
  const statuses = [];
  const runtime = createRuntime();
  const baseState = {
    autoRunFallbackThreadIntervalMinutes: 0,
  };
  let state = { ...baseState };
  let runCalls = 0;

  const controller = moduleApi.createAutoRunController({
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 3,
    AUTO_RUN_RETRY_DELAY_MS: 1000,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before_retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between_rounds',
    addLog: async (message, level) => {
      logs.push([level, String(message || '')]);
    },
    appendAccountRunRecord: async () => null,
    broadcastAutoRunStatus: async (status, payload) => {
      statuses.push({ status, payload });
    },
    broadcastStopToContentScripts: async () => {},
    cancelPendingCommands: () => {},
    chrome: {
      runtime: {
        sendMessage: () => Promise.resolve(),
      },
    },
    clearStopRequest: () => {},
    createAutoRunSessionId: () => 88,
    ensureHotmailMailboxReadyForAutoRunRound: async () => {},
    getAutoRunStatusPayload: () => ({}),
    getErrorMessage: (error) => String(error?.message || error || ''),
    getFirstUnfinishedNodeId: () => null,
    getPendingAutoRunTimerPlan: () => null,
    getRunningNodeIds: () => [],
    getState: async () => ({ ...state }),
    getStopRequested: () => false,
    hasSavedNodeProgress: () => false,
    isAddPhoneAuthFailure: () => false,
    isCloudCheckoutAlreadyPaidFailure: () => false,
    isGpcTaskEndedFailure: () => false,
    isHostedCheckoutCardFallbackFailure: () => false,
    isHostedCheckoutGenericErrorFailure: () => false,
    isHostedCheckoutVerificationResendLimitFailure: () => false,
    isPhoneSmsPlatformRateLimitFailure: () => false,
    isPlusCheckoutNonFreeTrialFailure: (error) => /PLUS_CHECKOUT_NON_FREE_TRIAL::/.test(String(error?.message || error || '')),
    isRestartCurrentAttemptError: () => false,
    isSignupUserAlreadyExistsFailure: () => false,
    isStep4Route405RecoveryLimitFailure: () => false,
    isStopError: () => false,
    launchAutoRunTimerPlan: async () => false,
    normalizeAutoRunFallbackThreadIntervalMinutes: (value) => Math.max(0, Number(value) || 0),
    persistAutoRunTimerPlan: async () => {},
    resetState: async () => {
      state = { ...baseState };
    },
    runAutoSequenceFromNode: async () => {
      runCalls += 1;
      if (runCalls === 1) {
        throw new Error('PLUS_CHECKOUT_NON_FREE_TRIAL::步骤 6：检测到今日应付金额不是 0（US$20.00）');
      }
    },
    runtime,
    setState: async (updates) => {
      state = { ...state, ...(updates || {}) };
    },
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: () => {},
    waitForRunningNodesToFinish: async () => ({ ...state }),
  });

  await controller.autoRunLoop(1, {
    autoRunRetryNonFreeTrial: true,
  });

  assert.equal(runCalls, 2);
  assert.equal(
    logs.some(([, message]) => message.includes('第 1/1 轮第 1 次尝试没有 Plus 免费试用资格')),
    true
  );
  assert.equal(
    logs.some(([, message]) => message.includes('无试用套餐自动重试：1 秒后换新邮箱，开始第 1/1 轮第 2 次尝试')),
    true
  );
  assert.equal(statuses.some(({ status }) => status === 'retrying'), true);
  assert.equal(statuses.at(-1)?.status, 'complete');
});
