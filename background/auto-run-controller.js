(function attachBackgroundAutoRunController(root, factory) {
  root.MultiPageBackgroundAutoRunController = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundAutoRunControllerModule() {
  const AUTO_RUN_MAX_KEEP_SAME_EMAIL_RETRIES_PER_ROUND = 10;
  const KEEP_SAME_EMAIL_RETRY_LIMIT_EXCEEDED_ERROR_PREFIX = 'KEEP_SAME_EMAIL_RETRY_LIMIT_EXCEEDED::';

  function createAutoRunController(deps = {}) {
    const {
      addLog,
      appendAccountRunRecord,
      AUTO_RUN_MAX_RETRIES_PER_ROUND,
      AUTO_RUN_RETRY_DELAY_MS,
      AUTO_RUN_TIMER_KIND_BEFORE_RETRY,
      AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS,
      broadcastAutoRunStatus,
      broadcastStopToContentScripts,
      cancelPendingCommands,
      clearStopRequest,
      createAutoRunSessionId,
      ensureHotmailMailboxReadyForAutoRunRound,
      getAutoRunStatusPayload,
      getErrorMessage,
      getFirstUnfinishedNodeId,
      getPendingAutoRunTimerPlan,
      getRunningNodeIds,
      getState,
      hasSavedNodeProgress,
      isAddPhoneAuthFailure,
      isCloudCheckoutAlreadyPaidFailure,
      isGpcTaskEndedFailure,
      isHostedCheckoutGenericErrorFailure,
      isHostedCheckoutVerificationResendLimitFailure,
      isPhoneSmsPlatformRateLimitFailure,
      isPlusCheckoutNonFreeTrialFailure,
      isRestartCurrentAttemptError,
      isStep4Route405RecoveryLimitFailure,
      isSignupUserAlreadyExistsFailure,
      isStopError,
      launchAutoRunTimerPlan,
      normalizeAutoRunFallbackThreadIntervalMinutes,
      persistAutoRunTimerPlan,
      resetState,
      runAutoSequenceFromNode,
      runtime,
      setState,
      sleepWithStop,
      throwIfAutoRunSessionStopped,
      waitForRunningNodesToFinish,
    } = deps;

    function getRunningWorkflowNodes(state = {}) {
      if (typeof getRunningNodeIds === 'function') {
        return getRunningNodeIds(state.nodeStatuses || {}, state);
      }
      return [];
    }

    function getFirstUnfinishedWorkflowNode(state = {}) {
      if (typeof getFirstUnfinishedNodeId === 'function') {
        return getFirstUnfinishedNodeId(state.nodeStatuses || {}, state);
      }
      return null;
    }

    function hasSavedWorkflowProgress(state = {}) {
      if (typeof hasSavedNodeProgress === 'function') {
        return hasSavedNodeProgress(state.nodeStatuses || {}, state);
      }
      return false;
    }

    async function waitForRunningWorkflowNodesToFinish(payload = {}) {
      if (typeof waitForRunningNodesToFinish === 'function') {
        return waitForRunningNodesToFinish(payload);
      }
      return getState();
    }

    async function runAutoSequenceFromWorkflowNode(startNodeId, context = {}) {
      if (typeof runAutoSequenceFromNode === 'function') {
        return runAutoSequenceFromNode(startNodeId, context);
      }
      throw new Error('自动运行节点执行器未接入。');
    }

    function createAutoRunRoundSummary(round) {
      return {
        round,
        status: 'pending',
        attempts: 0,
        failureReasons: [],
        finalFailureReason: '',
      };
    }

    function normalizeAutoRunRoundSummary(summary, round) {
      const base = createAutoRunRoundSummary(round);
      if (!summary || typeof summary !== 'object') {
        return base;
      }

      const status = String(summary.status || '').trim().toLowerCase();
      return {
        round,
        status: ['pending', 'success', 'failed'].includes(status) ? status : base.status,
        attempts: Math.max(0, Math.floor(Number(summary.attempts) || 0)),
        failureReasons: Array.isArray(summary.failureReasons)
          ? summary.failureReasons.map((item) => String(item || '').trim()).filter(Boolean)
          : [],
        finalFailureReason: String(summary.finalFailureReason || '').trim(),
      };
    }

    function buildAutoRunRoundSummaries(totalRuns, rawSummaries = []) {
      return Array.from({ length: totalRuns }, (_, index) => normalizeAutoRunRoundSummary(rawSummaries[index], index + 1));
    }

    function serializeAutoRunRoundSummaries(totalRuns, roundSummaries = []) {
      return buildAutoRunRoundSummaries(totalRuns, roundSummaries).map((summary) => ({
        ...summary,
        failureReasons: [...summary.failureReasons],
      }));
    }

    function getAutoRunRoundRetryCount(summary) {
      return Math.max(0, Number(summary?.attempts || 0) - 1);
    }

    function normalizeRecordNode(value = '') {
      return String(value || '').trim();
    }

    function extractNodeFromRecordStatus(status = '') {
      const match = String(status || '').trim().match(/^node:([^:]+):(failed|stopped)$/i);
      return match ? normalizeRecordNode(match[1]) : '';
    }

    function getKnownNodeIdsFromState(state = {}) {
      const ids = new Set();
      for (const key of Object.keys(state?.nodeStatuses || {})) {
        const nodeId = normalizeRecordNode(key);
        if (nodeId) {
          ids.add(nodeId);
        }
      }

      const currentNodeId = normalizeRecordNode(state?.currentNodeId);
      if (currentNodeId) {
        ids.add(currentNodeId);
      }

      return Array.from(ids);
    }

    function inferRecordNodeFromState(state = {}, preferredStatuses = []) {
      const statuses = state?.nodeStatuses || {};
      const preferredStatusSet = new Set(preferredStatuses.map((item) => String(item || '').trim()).filter(Boolean));
      const nodeIds = getKnownNodeIdsFromState(state);
      const currentNodeId = normalizeRecordNode(state?.currentNodeId);

      if (currentNodeId && preferredStatusSet.has(String(statuses[currentNodeId] || '').trim())) {
        return currentNodeId;
      }

      const matchingNodes = nodeIds.filter((nodeId) => preferredStatusSet.has(String(statuses[nodeId] || '').trim()));
      if (matchingNodes.length) {
        return matchingNodes[matchingNodes.length - 1];
      }

      if (currentNodeId) {
        const currentStatus = String(statuses[currentNodeId] || '').trim();
        if (!['', 'pending', 'completed', 'manual_completed', 'skipped'].includes(currentStatus)) {
          return currentNodeId;
        }
      }

      return '';
    }

    function inferRecordNodeFromError(errorLike = null, state = {}) {
      if (!errorLike || typeof errorLike !== 'object') {
        return '';
      }

      return normalizeRecordNode(errorLike.failedNodeId)
        || normalizeRecordNode(errorLike.nodeId)
        || normalizeRecordNode(errorLike.currentNodeId);
    }

    function resolveAutoRunAccountRecordStatus(status, state = {}, errorLike = null) {
      const normalizedStatus = String(status || '').trim().toLowerCase();
      const explicitNode = extractNodeFromRecordStatus(status);
      if (explicitNode) {
        return `node:${explicitNode}:${normalizedStatus.endsWith(':stopped') ? 'stopped' : 'failed'}`;
      }
      if (normalizedStatus === 'failed') {
        const failedNode = inferRecordNodeFromError(errorLike, state)
          || inferRecordNodeFromState(state, ['failed', 'running']);
        return failedNode ? `node:${failedNode}:failed` : status;
      }

      if (normalizedStatus === 'stopped') {
        const stoppedNode = inferRecordNodeFromError(errorLike, state)
          || inferRecordNodeFromState(state, ['stopped', 'running']);
        return stoppedNode ? `node:${stoppedNode}:stopped` : status;
      }

      return status;
    }

    function formatAutoRunFailureReasons(reasons = []) {
      if (!Array.isArray(reasons) || !reasons.length) {
        return '未知错误';
      }

      const counts = new Map();
      for (const reason of reasons) {
        const normalized = String(reason || '').trim() || '未知错误';
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
      }

      return Array.from(counts.entries())
        .map(([reason, count]) => (count > 1 ? `${reason}（${count}次）` : reason))
        .join('；');
    }

    function isPhoneNumberSupplyExhaustedFailure(errorLike) {
      const message = String(
        typeof errorLike === 'string'
          ? errorLike
          : (errorLike?.message || errorLike || '')
      ).trim();
      if (!message) {
        return false;
      }
      const hasGlobalNoSupplySignal = /Step\s*9:\s*all\s+provider\s+candidates\s+failed\s+to\s+acquire\s+number|(?:HeroSMS|5sim|NexSMS)\s+no\s+numbers\s+available\s+across|no\s+numbers\s+within\s+maxPrice|no\s+free\s+phones|numbers?\s+not\s+found/i.test(message);
      if (!hasGlobalNoSupplySignal) {
        return false;
      }
      const hasRecoverableStep9RotationSignal = /phone\s+verification\s+did\s+not\s+succeed\s+after\s+\d+\s+number\s+replacements|sms_timeout_after_|route_405_retry_loop|resend_throttled|activation_not_found|order\s+not\s+found/i.test(message);
      if (hasRecoverableStep9RotationSignal) {
        return false;
      }
      return true;
    }

    function shouldKeepCustomMailProviderPoolEmail(state = {}) {
      return String(state?.mailProvider || '').trim().toLowerCase() === 'custom'
        && Array.isArray(state?.customMailProviderPool)
        && state.customMailProviderPool.length > 0;
    }

    function isPhoneNumberSupplyExhaustedFailure(error) {
      const text = String(
        typeof getErrorMessage === 'function'
          ? getErrorMessage(error)
          : (error?.message || error || '')
      ).trim();
      if (!text) {
        return false;
      }
      return /no\s+numbers\s+available\s+across|all provider candidates failed to acquire number|no\s+free\s+phones|numbers?\s+not\s+found|no\s+numbers\s+within\s+maxprice|countries\s+are\s+empty|均无可用号码|暂无可用号码|无可用号码|接码号池暂无|\bNO_NUMBERS\b/i.test(text);
    }

    async function logAutoRunFinalSummary(totalRuns, roundSummaries = []) {
      const summaries = buildAutoRunRoundSummaries(totalRuns, roundSummaries);
      const successRounds = summaries.filter((item) => item.status === 'success');
      const failedRounds = summaries.filter((item) => item.status === 'failed');
      const pendingRounds = summaries.filter((item) => item.status === 'pending');

      await addLog('=== 自动运行汇总 ===', failedRounds.length ? 'warn' : 'ok');
      await addLog(
        `总轮数：${totalRuns}；成功：${successRounds.length}；失败：${failedRounds.length}；未完成：${pendingRounds.length}`,
        failedRounds.length ? 'warn' : 'ok'
      );

      if (successRounds.length) {
        await addLog(
          `成功轮次：${successRounds
            .map((item) => `第 ${item.round} 轮（重试 ${getAutoRunRoundRetryCount(item)} 次）`)
            .join('；')}`,
          'ok'
        );
      }

      if (failedRounds.length) {
        await addLog(
          `失败轮次：${failedRounds
            .map((item) => {
              const retryCount = getAutoRunRoundRetryCount(item);
              const finalReason = item.finalFailureReason || item.failureReasons[item.failureReasons.length - 1] || '未知错误';
              const reasonSummary = formatAutoRunFailureReasons(item.failureReasons);
              return !reasonSummary || reasonSummary === finalReason
                ? `第 ${item.round} 轮（重试 ${retryCount} 次，最终原因：${finalReason}）`
                : `第 ${item.round} 轮（重试 ${retryCount} 次，最终原因：${finalReason}；失败记录：${reasonSummary}）`;
            })
            .join('；')}`,
          'error'
        );
      }

      if (pendingRounds.length) {
        await addLog(
          `未完成轮次：${pendingRounds.map((item) => `第 ${item.round} 轮`).join('；')}`,
          'warn'
        );
      }
    }

    async function skipAutoRunCountdown() {
      const state = await getState();
      const plan = getPendingAutoRunTimerPlan(state);
      if (!plan || state.autoRunPhase !== 'waiting_interval') {
        return false;
      }

      return launchAutoRunTimerPlan('manual', {
        expectedKinds: [
          AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS,
          AUTO_RUN_TIMER_KIND_BEFORE_RETRY,
        ],
      });
    }

    async function waitBetweenAutoRunRounds(targetRun, totalRuns, roundSummary, options = {}) {
      const {
        autoRunSkipFailures = false,
        autoRunRetryNonFreeTrial = false,
        autoRunRetryPaypalCallback = false,
        roundSummaries = [],
      } = options;
      if (totalRuns <= 1 || targetRun >= totalRuns) {
        return false;
      }

      const fallbackThreadIntervalMinutes = normalizeAutoRunFallbackThreadIntervalMinutes(
        (await getState()).autoRunFallbackThreadIntervalMinutes
      );
      if (fallbackThreadIntervalMinutes <= 0) {
        return false;
      }

      const currentRuntime = runtime.get();
      const statusLabel = roundSummary?.status === 'failed' ? '失败' : '完成';
      await addLog(
        `线程间隔：第 ${targetRun}/${totalRuns} 轮已${statusLabel}，等待 ${fallbackThreadIntervalMinutes} 分钟后开始下一轮。`,
        'info'
      );
      await persistAutoRunTimerPlan({
        kind: AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS,
        fireAt: Date.now() + fallbackThreadIntervalMinutes * 60 * 1000,
        currentRun: targetRun,
        totalRuns,
        attemptRun: currentRuntime.autoRunAttemptRun,
        autoRunSessionId: currentRuntime.autoRunSessionId,
        autoRunSkipFailures,
        autoRunRetryNonFreeTrial,
        autoRunRetryPaypalCallback,
        roundSummaries,
        countdownTitle: '线程间隔中',
        countdownNote: `第 ${Math.min(targetRun + 1, totalRuns)}/${totalRuns} 轮即将开始`,
      }, {
        autoRunSkipFailures,
        autoRunRetryNonFreeTrial,
        autoRunRetryPaypalCallback,
        autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
      });
      runtime.set({ autoRunActive: false });
      return true;
    }

    async function waitBeforeAutoRunRetry(targetRun, totalRuns, nextAttemptRun, options = {}) {
      const {
        autoRunSkipFailures = false,
        autoRunRetryNonFreeTrial = false,
        autoRunRetryPaypalCallback = false,
        roundSummaries = [],
      } = options;
      const fallbackThreadIntervalMinutes = normalizeAutoRunFallbackThreadIntervalMinutes(
        (await getState()).autoRunFallbackThreadIntervalMinutes
      );
      if (fallbackThreadIntervalMinutes <= 0) {
        return false;
      }

      await addLog(
        `线程间隔：等待 ${fallbackThreadIntervalMinutes} 分钟后开始第 ${targetRun}/${totalRuns} 轮第 ${nextAttemptRun} 次尝试。`,
        'info'
      );
      await persistAutoRunTimerPlan({
        kind: AUTO_RUN_TIMER_KIND_BEFORE_RETRY,
        fireAt: Date.now() + fallbackThreadIntervalMinutes * 60 * 1000,
        currentRun: targetRun,
        totalRuns,
        attemptRun: nextAttemptRun,
        autoRunSessionId: runtime.get().autoRunSessionId,
        autoRunSkipFailures,
        autoRunRetryNonFreeTrial,
        autoRunRetryPaypalCallback,
        roundSummaries,
        countdownTitle: '线程间隔中',
        countdownNote: `第 ${targetRun}/${totalRuns} 轮第 ${nextAttemptRun} 次尝试即将开始`,
      }, {
        autoRunSkipFailures,
        autoRunRetryNonFreeTrial,
        autoRunRetryPaypalCallback,
        autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
      });
      runtime.set({ autoRunActive: false });
      return true;
    }

    async function handleAutoRunLoopUnhandledError(error) {
      const currentRuntime = runtime.get();
      console.error('Auto run loop crashed:', error);
      if (!isStopError(error)) {
        await addLog(`自动运行异常终止：${getErrorMessage(error) || '未知错误'}`, 'error');
      }

      runtime.set({ autoRunActive: false, autoRunSessionId: 0 });
      await broadcastAutoRunStatus('stopped', {
        currentRun: currentRuntime.autoRunCurrentRun,
        totalRuns: currentRuntime.autoRunTotalRuns,
        attemptRun: currentRuntime.autoRunAttemptRun,
        sessionId: 0,
      }, {
        autoRunSessionId: 0,
        autoRunTimerPlan: null,
        scheduledAutoRunPlan: null,
      });
      if (!isStopError(error)) {
        clearStopRequest();
      }
    }

    function startAutoRunLoop(totalRuns, options = {}) {
      autoRunLoop(totalRuns, options).catch((error) => {
        handleAutoRunLoopUnhandledError(error).catch(() => {});
      });
    }

    async function autoRunLoop(totalRuns, options = {}) {
      let currentRuntime = runtime.get();
      if (currentRuntime.autoRunActive) {
        await addLog('自动运行已在进行中', 'warn');
        return;
      }

      let sessionId = Number.isInteger(options.autoRunSessionId) && options.autoRunSessionId > 0
        ? options.autoRunSessionId
        : 0;
      if (sessionId) {
        throwIfAutoRunSessionStopped(sessionId);
      } else {
        sessionId = createAutoRunSessionId();
      }

      clearStopRequest();
      runtime.set({
        autoRunActive: true,
        autoRunTotalRuns: totalRuns,
        autoRunCurrentRun: 0,
        autoRunAttemptRun: 0,
        autoRunSessionId: sessionId,
      });
      currentRuntime = runtime.get();

      const autoRunSkipFailures = Boolean(options.autoRunSkipFailures);
      const autoRunRetryNonFreeTrial = Boolean(options.autoRunRetryNonFreeTrial);
      const autoRunRetryPaypalCallback = Boolean(options.autoRunRetryPaypalCallback);
      const initialMode = options.mode === 'continue' ? 'continue' : 'restart';
      const resumeCurrentRun = Number.isInteger(options.resumeCurrentRun) && options.resumeCurrentRun > 0
        ? Math.min(totalRuns, options.resumeCurrentRun)
        : 1;
      const resumeAttemptRun = Number.isInteger(options.resumeAttemptRun) && options.resumeAttemptRun > 0
        ? Math.min(AUTO_RUN_MAX_RETRIES_PER_ROUND + 1, options.resumeAttemptRun)
        : 1;
      let continueCurrentOnFirstAttempt = initialMode === 'continue';
      let forceFreshTabsNextRun = false;
      let stoppedEarly = false;
      let parkedByTimer = false;
      const roundSummaries = buildAutoRunRoundSummaries(totalRuns, options.resumeRoundSummaries);

      if (continueCurrentOnFirstAttempt && resumeCurrentRun > 1) {
        for (let round = 1; round < resumeCurrentRun; round += 1) {
          const summary = roundSummaries[round - 1];
          if (summary.status === 'pending') {
            summary.status = 'success';
            if (!summary.attempts) {
              summary.attempts = 1;
            }
          }
        }
      }

      let successfulRuns = roundSummaries.filter((item) => item.status === 'success').length;
      const initialState = await getState();
      const initialPhase = continueCurrentOnFirstAttempt && getRunningWorkflowNodes(initialState).length
        ? 'waiting_step'
        : 'running';
      const showResumePosition = continueCurrentOnFirstAttempt || resumeCurrentRun > 1 || resumeAttemptRun > 1;

      await setState({
        autoRunSessionId: sessionId,
        autoRunSkipFailures,
        autoRunRetryNonFreeTrial,
        autoRunRetryPaypalCallback,
        autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
        ...getAutoRunStatusPayload(initialPhase, {
          currentRun: showResumePosition ? resumeCurrentRun : 0,
          totalRuns,
          attemptRun: showResumePosition ? resumeAttemptRun : 0,
          sessionId,
        }),
      });

      for (let targetRun = resumeCurrentRun; targetRun <= totalRuns; targetRun += 1) {
        const roundSummary = roundSummaries[targetRun - 1];
        let roundRecordAppended = false;
        const resumingCurrentRound = continueCurrentOnFirstAttempt && targetRun === resumeCurrentRun;
        let attemptRun = resumingCurrentRound ? resumeAttemptRun : 1;
        let reuseExistingProgress = resumingCurrentRound;
        const currentRoundState = await getState();
        const keepSameEmailUntilAddPhone = autoRunSkipFailures && shouldKeepCustomMailProviderPoolEmail(currentRoundState);
        const maxKeepSameEmailAttemptsForRound = AUTO_RUN_MAX_KEEP_SAME_EMAIL_RETRIES_PER_ROUND + 1;
        const maxAttemptsForRound = autoRunSkipFailures || autoRunRetryNonFreeTrial || autoRunRetryPaypalCallback
          ? (keepSameEmailUntilAddPhone ? maxKeepSameEmailAttemptsForRound : AUTO_RUN_MAX_RETRIES_PER_ROUND + 1)
          : Math.max(AUTO_RUN_MAX_RETRIES_PER_ROUND + 1, attemptRun);

        while (attemptRun <= maxAttemptsForRound) {
          runtime.set({
            autoRunCurrentRun: targetRun,
            autoRunAttemptRun: attemptRun,
          });
          roundSummary.attempts = attemptRun;
          const defaultStartNodeId = typeof runAutoSequenceFromNode === 'function' ? 'open-chatgpt' : 1;
          let startNodeId = defaultStartNodeId;
          let useExistingProgress = false;

          if (reuseExistingProgress) {
            let currentState = await getState();
            if (getRunningWorkflowNodes(currentState).length) {
              currentState = await waitForRunningWorkflowNodesToFinish({
                currentRun: targetRun,
                totalRuns,
                attemptRun,
              });
            }
            const resumeNodeId = getFirstUnfinishedWorkflowNode(currentState);
            if (resumeNodeId && hasSavedWorkflowProgress(currentState)) {
              startNodeId = resumeNodeId;
              useExistingProgress = true;
            } else if (hasSavedWorkflowProgress(currentState)) {
              await addLog('检测到当前流程已处理完成，本轮将改为从首个节点重新开始。', 'info');
            }
          }

          if (!useExistingProgress) {
            const prevState = await getState();
            const keepSettings = {
              vpsUrl: prevState.vpsUrl,
              vpsPassword: prevState.vpsPassword,
              customPassword: prevState.customPassword,
              plusModeEnabled: prevState.plusModeEnabled,
              plusPaymentMethod: prevState.plusPaymentMethod,
              plusAccountAccessStrategy: prevState.plusAccountAccessStrategy,
              plusHostedCheckoutOauthDelaySeconds: prevState.plusHostedCheckoutOauthDelaySeconds,
              hostedCheckoutVerificationPopupDelaySeconds: prevState.hostedCheckoutVerificationPopupDelaySeconds,
              hostedCheckoutVerificationUrl: prevState.hostedCheckoutVerificationUrl,
              hostedCheckoutPhoneNumber: prevState.hostedCheckoutPhoneNumber,
              hostedCheckoutSmsPoolText: prevState.hostedCheckoutSmsPoolText,
              hostedCheckoutSmsPoolUsage: prevState.hostedCheckoutSmsPoolUsage,
              hostedCheckoutSmsPoolAutoDisableEnabled: prevState.hostedCheckoutSmsPoolAutoDisableEnabled,
              hostedCheckoutFirstDirectResendEnabled: prevState.hostedCheckoutFirstDirectResendEnabled,
              hostedCheckoutFirstResendWaitSeconds: prevState.hostedCheckoutFirstResendWaitSeconds,
              hostedCheckoutSubsequentResendWaitSeconds: prevState.hostedCheckoutSubsequentResendWaitSeconds,
              hostedCheckoutVerificationResendMaxAttempts: prevState.hostedCheckoutVerificationResendMaxAttempts,
              hostedCheckoutVerificationPollAttempts: prevState.hostedCheckoutVerificationPollAttempts,
              hostedCheckoutVerificationPollIntervalSeconds: prevState.hostedCheckoutVerificationPollIntervalSeconds,
              paypalEmail: prevState.paypalEmail,
              paypalPassword: prevState.paypalPassword,
              paypalAccounts: prevState.paypalAccounts,
              currentPayPalAccountId: prevState.currentPayPalAccountId,
              autoRunSkipFailures: prevState.autoRunSkipFailures,
              autoRunRetryNonFreeTrial: prevState.autoRunRetryNonFreeTrial,
              autoRunRetryPaypalCallback: prevState.autoRunRetryPaypalCallback,
              autoRunFallbackThreadIntervalMinutes: prevState.autoRunFallbackThreadIntervalMinutes,
              autoRunDelayEnabled: prevState.autoRunDelayEnabled,
              autoRunDelayMinutes: prevState.autoRunDelayMinutes,
              autoStepDelaySeconds: prevState.autoStepDelaySeconds,
              signupMethod: prevState.signupMethod,
              mailProvider: prevState.mailProvider,
              emailGenerator: prevState.emailGenerator,
              gmailBaseEmail: prevState.gmailBaseEmail,
              mail2925BaseEmail: prevState.mail2925BaseEmail,
              currentMail2925AccountId: prevState.currentMail2925AccountId,
              emailPrefix: prevState.emailPrefix,
              outlookAliasMaxPerAccount: prevState.outlookAliasMaxPerAccount,
              hotmailAliasUsage: prevState.hotmailAliasUsage,
              inbucketHost: prevState.inbucketHost,
              inbucketMailbox: prevState.inbucketMailbox,
              cloudflareDomain: prevState.cloudflareDomain,
              cloudflareDomains: prevState.cloudflareDomains,
              reusablePhoneActivation: prevState.reusablePhoneActivation,
              autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              autoRunSessionId: sessionId,
              tabRegistry: {},
              sourceLastUrls: {},
              ...getAutoRunStatusPayload('running', { currentRun: targetRun, totalRuns, attemptRun, sessionId }),
            };
            await resetState();
            await setState(keepSettings);
            deps.chrome.runtime.sendMessage({ type: 'AUTO_RUN_RESET' }).catch(() => { });
            await sleepWithStop(500);
          } else {
            await setState({
              autoRunSessionId: sessionId,
              autoRunSkipFailures,
              autoRunRetryNonFreeTrial,
              autoRunRetryPaypalCallback,
              autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              ...getAutoRunStatusPayload('running', { currentRun: targetRun, totalRuns, attemptRun, sessionId }),
            });
          }

          if (forceFreshTabsNextRun) {
            await addLog(`上一轮尝试已放弃，当前开始第 ${targetRun}/${totalRuns} 轮第 ${attemptRun} 次尝试。`, 'warn');
            forceFreshTabsNextRun = false;
          }

          const appendRoundRecordIfNeeded = async (status, reason = '', errorLike = null) => {
            if (roundRecordAppended) {
              return;
            }

            if (typeof appendAccountRunRecord !== 'function') {
              return;
            }

            const recordState = await getState();
            const recordStatus = resolveAutoRunAccountRecordStatus(status, recordState, errorLike);
            const record = await appendAccountRunRecord(recordStatus, recordState, reason);
            if (record) {
              roundRecordAppended = true;
            }
          };

          try {
            throwIfAutoRunSessionStopped(sessionId);
            await broadcastAutoRunStatus('running', {
              currentRun: targetRun,
              totalRuns,
              attemptRun,
              sessionId,
            });

            if (!useExistingProgress && startNodeId === defaultStartNodeId && typeof ensureHotmailMailboxReadyForAutoRunRound === 'function') {
              await ensureHotmailMailboxReadyForAutoRunRound({
                targetRun,
                totalRuns,
                attemptRun,
                sessionId,
              });
            }

            await runAutoSequenceFromWorkflowNode(startNodeId, {
              targetRun,
              totalRuns,
              attemptRuns: attemptRun,
              continued: useExistingProgress,
            });

            roundSummary.status = 'success';
            roundSummary.finalFailureReason = '';
            successfulRuns += 1;
            await setState({
              autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
            });
            await addLog(`=== 第 ${targetRun}/${totalRuns} 轮完成（第 ${attemptRun} 次尝试成功）===`, 'ok');
            break;
          } catch (err) {
            if (isStopError(err)) {
              stoppedEarly = true;
              await appendRoundRecordIfNeeded('stopped', getErrorMessage(err), err);
              await addLog(`第 ${targetRun}/${totalRuns} 轮已被用户停止`, 'warn');
              await broadcastAutoRunStatus('stopped', {
                currentRun: targetRun,
                totalRuns,
                attemptRun,
                sessionId: 0,
              });
              break;
            }

            const reason = getErrorMessage(err);
            roundSummary.failureReasons.push(reason);
            const blockedByPhoneSmsRateLimit = typeof isPhoneSmsPlatformRateLimitFailure === 'function'
              && isPhoneSmsPlatformRateLimitFailure(err);
            const blockedByPhoneNoSupply = !blockedByPhoneSmsRateLimit
              && isPhoneNumberSupplyExhaustedFailure(err);
            const blockedByAddPhone = !blockedByPhoneSmsRateLimit
              && !blockedByPhoneNoSupply
              && typeof isAddPhoneAuthFailure === 'function'
              && isAddPhoneAuthFailure(err);
            const blockedByPlusNonFreeTrial = typeof isPlusCheckoutNonFreeTrialFailure === 'function'
              && isPlusCheckoutNonFreeTrialFailure(err);
            const blockedByGpcTaskEnded = typeof isGpcTaskEndedFailure === 'function'
              ? isGpcTaskEndedFailure(err)
              : /GPC_TASK_ENDED::/i.test(err?.message || String(err || ''));
            const blockedByHostedCheckoutGenericError = typeof isHostedCheckoutGenericErrorFailure === 'function'
              ? isHostedCheckoutGenericErrorFailure(err)
              : /HOSTED_CHECKOUT_GENERIC_ERROR::/i.test(err?.message || String(err || ''));
            const blockedByHostedCheckoutCardFallback = typeof isHostedCheckoutCardFallbackFailure === 'function'
              ? isHostedCheckoutCardFallbackFailure(err)
              : /HOSTED_CHECKOUT_CARD_FALLBACK::/i.test(err?.message || String(err || ''));
            const blockedByHostedCheckoutVerificationResendLimit = typeof isHostedCheckoutVerificationResendLimitFailure === 'function'
              ? isHostedCheckoutVerificationResendLimitFailure(err)
              : /HOSTED_CHECKOUT_VERIFICATION_RESEND_LIMIT::/i.test(err?.message || String(err || ''));
            const blockedByCloudCheckoutAlreadyPaid = typeof isCloudCheckoutAlreadyPaidFailure === 'function'
              ? isCloudCheckoutAlreadyPaidFailure(err)
              : /\buser\s+is\s+already\s+paid\b|already\s+(?:paid|subscribed)/i.test(err?.message || String(err || ''));
            const blockedBySignupUserAlreadyExists = typeof isSignupUserAlreadyExistsFailure === 'function'
              && !keepSameEmailUntilAddPhone
              && isSignupUserAlreadyExistsFailure(err);
            const blockedByStep4Route405 = typeof isStep4Route405RecoveryLimitFailure === 'function'
              && isStep4Route405RecoveryLimitFailure(err);
            const maxPlusNonFreeTrialAttempts = AUTO_RUN_MAX_RETRIES_PER_ROUND + 1;
            const retryablePlusNonFreeTrial = blockedByPlusNonFreeTrial
              && autoRunRetryNonFreeTrial
              && attemptRun < maxPlusNonFreeTrialAttempts;
            const retryableHostedCheckoutGenericError = blockedByHostedCheckoutGenericError
              && autoRunRetryPaypalCallback
              && attemptRun < maxPlusNonFreeTrialAttempts;
            const retryableHostedCheckoutCardFallback = blockedByHostedCheckoutCardFallback
              && attemptRun < maxPlusNonFreeTrialAttempts;
            const canRetry = !blockedByAddPhone
              && !blockedByPhoneNoSupply
              && !blockedByPlusNonFreeTrial
              && !blockedByGpcTaskEnded
              && !blockedByHostedCheckoutGenericError
              && !blockedByHostedCheckoutCardFallback
              && !blockedByHostedCheckoutVerificationResendLimit
              && !blockedByCloudCheckoutAlreadyPaid
              && !blockedBySignupUserAlreadyExists
              && autoRunSkipFailures
              && attemptRun < maxAttemptsForRound;
            const reachedKeepSameEmailRetryLimit = keepSameEmailUntilAddPhone
              && !blockedByAddPhone
              && !blockedByPhoneNoSupply
              && !blockedByPlusNonFreeTrial
              && !blockedByGpcTaskEnded
              && !blockedByHostedCheckoutGenericError
              && !blockedByHostedCheckoutCardFallback
              && !blockedByHostedCheckoutVerificationResendLimit
              && !blockedByCloudCheckoutAlreadyPaid
              && !blockedBySignupUserAlreadyExists
              && !blockedByStep4Route405
              && autoRunSkipFailures
              && attemptRun >= maxAttemptsForRound;

            await setState({
              autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
            });

            if (retryablePlusNonFreeTrial) {
              const retryIndex = attemptRun;
              await addLog(`第 ${targetRun}/${totalRuns} 轮第 ${attemptRun} 次尝试没有 Plus 免费试用资格：${reason}`, 'warn');
              cancelPendingCommands('当前尝试因无免费试用资格已放弃。');
              await broadcastStopToContentScripts();
              await broadcastAutoRunStatus('retrying', {
                currentRun: targetRun,
                totalRuns,
                attemptRun,
                sessionId,
              });
              forceFreshTabsNextRun = true;
              await addLog(
                `无试用套餐自动重试：${Math.round(AUTO_RUN_RETRY_DELAY_MS / 1000)} 秒后换新邮箱，开始第 ${targetRun}/${totalRuns} 轮第 ${attemptRun + 1} 次尝试（第 ${retryIndex}/${AUTO_RUN_MAX_RETRIES_PER_ROUND} 次重试）。`,
                'warn'
              );
              try {
                await sleepWithStop(AUTO_RUN_RETRY_DELAY_MS);
              } catch (sleepError) {
                if (isStopError(sleepError)) {
                  stoppedEarly = true;
                  await appendRoundRecordIfNeeded('stopped', getErrorMessage(sleepError), sleepError);
                  await addLog(`第 ${targetRun}/${totalRuns} 轮已被用户停止`, 'warn');
                  await broadcastAutoRunStatus('stopped', {
                    currentRun: targetRun,
                    totalRuns,
                    attemptRun,
                    sessionId: 0,
                  });
                  break;
                }
                throw sleepError;
              }
              try {
                const parkedForRetry = await waitBeforeAutoRunRetry(targetRun, totalRuns, attemptRun + 1, {
                  autoRunSkipFailures,
                  autoRunRetryNonFreeTrial,
                  autoRunRetryPaypalCallback,
                  roundSummaries,
                });
                if (parkedForRetry) {
                  parkedByTimer = true;
                  break;
                }
              } catch (sleepError) {
                if (isStopError(sleepError)) {
                  stoppedEarly = true;
                  await appendRoundRecordIfNeeded('stopped', getErrorMessage(sleepError), sleepError);
                  await addLog(`第 ${targetRun}/${totalRuns} 轮已被用户停止`, 'warn');
                  await broadcastAutoRunStatus('stopped', {
                    currentRun: targetRun,
                    totalRuns,
                    attemptRun,
                    sessionId: 0,
                  });
                  break;
                }
                throw sleepError;
              }
              attemptRun += 1;
              reuseExistingProgress = false;
              continue;
            }

            if (retryableHostedCheckoutGenericError) {
              const retryIndex = attemptRun;
              await addLog(`第 ${targetRun}/${totalRuns} 轮第 ${attemptRun} 次尝试遇到 PayPal Checkout 异常：${reason}`, 'warn');
              cancelPendingCommands('当前尝试因 PayPal Checkout 异常已放弃。');
              await broadcastStopToContentScripts();
              await broadcastAutoRunStatus('retrying', {
                currentRun: targetRun,
                totalRuns,
                attemptRun,
                sessionId,
              });
              forceFreshTabsNextRun = true;
              await addLog(
                `PayPal Checkout 异常自动重试：${Math.round(AUTO_RUN_RETRY_DELAY_MS / 1000)} 秒后换新邮箱，开始第 ${targetRun}/${totalRuns} 轮第 ${attemptRun + 1} 次尝试（第 ${retryIndex}/${AUTO_RUN_MAX_RETRIES_PER_ROUND} 次重试）。`,
                'warn'
              );
              try {
                await sleepWithStop(AUTO_RUN_RETRY_DELAY_MS);
              } catch (sleepError) {
                if (isStopError(sleepError)) {
                  stoppedEarly = true;
                  await appendRoundRecordIfNeeded('stopped', getErrorMessage(sleepError), sleepError);
                  await addLog(`第 ${targetRun}/${totalRuns} 轮已被用户停止`, 'warn');
                  await broadcastAutoRunStatus('stopped', {
                    currentRun: targetRun,
                    totalRuns,
                    attemptRun,
                    sessionId: 0,
                  });
                  break;
                }
                throw sleepError;
              }
              try {
                const parkedForRetry = await waitBeforeAutoRunRetry(targetRun, totalRuns, attemptRun + 1, {
                  autoRunSkipFailures,
                  autoRunRetryNonFreeTrial,
                  autoRunRetryPaypalCallback,
                  roundSummaries,
                });
                if (parkedForRetry) {
                  parkedByTimer = true;
                  break;
                }
              } catch (sleepError) {
                if (isStopError(sleepError)) {
                  stoppedEarly = true;
                  await appendRoundRecordIfNeeded('stopped', getErrorMessage(sleepError), sleepError);
                  await addLog(`第 ${targetRun}/${totalRuns} 轮已被用户停止`, 'warn');
                  await broadcastAutoRunStatus('stopped', {
                    currentRun: targetRun,
                    totalRuns,
                    attemptRun,
                    sessionId: 0,
                  });
                  break;
                }
                throw sleepError;
              }
              attemptRun += 1;
              reuseExistingProgress = false;
              continue;
            }

            if (retryableHostedCheckoutCardFallback) {
              const retryIndex = attemptRun;
              await addLog(`第 ${targetRun}/${totalRuns} 轮第 ${attemptRun} 次尝试落到银行卡分支：${reason}`, 'warn');
              cancelPendingCommands('当前尝试因 hosted checkout 落到银行卡分支已放弃。');
              await broadcastStopToContentScripts();
              await broadcastAutoRunStatus('retrying', {
                currentRun: targetRun,
                totalRuns,
                attemptRun,
                sessionId,
              });
              forceFreshTabsNextRun = true;
              await addLog(
                `hosted checkout 银行卡分支默认自动重试：${Math.round(AUTO_RUN_RETRY_DELAY_MS / 1000)} 秒后换新邮箱，开始第 ${targetRun}/${totalRuns} 轮第 ${attemptRun + 1} 次尝试（第 ${retryIndex}/${AUTO_RUN_MAX_RETRIES_PER_ROUND} 次重试）。`,
                'warn'
              );
              try {
                await sleepWithStop(AUTO_RUN_RETRY_DELAY_MS);
              } catch (sleepError) {
                if (isStopError(sleepError)) {
                  stoppedEarly = true;
                  await appendRoundRecordIfNeeded('stopped', getErrorMessage(sleepError), sleepError);
                  await addLog(`第 ${targetRun}/${totalRuns} 轮已被用户停止`, 'warn');
                  await broadcastAutoRunStatus('stopped', {
                    currentRun: targetRun,
                    totalRuns,
                    attemptRun,
                    sessionId: 0,
                  });
                  break;
                }
                throw sleepError;
              }
              try {
                const parkedForRetry = await waitBeforeAutoRunRetry(targetRun, totalRuns, attemptRun + 1, {
                  autoRunSkipFailures,
                  autoRunRetryNonFreeTrial,
                  autoRunRetryPaypalCallback,
                  roundSummaries,
                });
                if (parkedForRetry) {
                  parkedByTimer = true;
                  break;
                }
              } catch (sleepError) {
                if (isStopError(sleepError)) {
                  stoppedEarly = true;
                  await appendRoundRecordIfNeeded('stopped', getErrorMessage(sleepError), sleepError);
                  await addLog(`第 ${targetRun}/${totalRuns} 轮已被用户停止`, 'warn');
                  await broadcastAutoRunStatus('stopped', {
                    currentRun: targetRun,
                    totalRuns,
                    attemptRun,
                    sessionId: 0,
                  });
                  break;
                }
                throw sleepError;
              }
              attemptRun += 1;
              reuseExistingProgress = false;
              continue;
            }

            if (blockedByAddPhone) {
              roundSummary.status = 'failed';
              roundSummary.finalFailureReason = reason;
              await setState({
                autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              });
              await appendRoundRecordIfNeeded('failed', reason, err);
              cancelPendingCommands('当前轮因认证流程进入 add-phone 已终止。');
              await broadcastStopToContentScripts();
              if (!autoRunSkipFailures) {
                await addLog(
                  `第 ${targetRun}/${totalRuns} 轮触发 add-phone/手机号页，自动重试未开启，当前自动运行将停止。`,
                  'warn'
                );
                stoppedEarly = true;
                await broadcastAutoRunStatus('stopped', {
                  currentRun: targetRun,
                  totalRuns,
                  attemptRun,
                  sessionId: 0,
                });
                break;
              }

              await addLog(`第 ${targetRun}/${totalRuns} 轮触发 add-phone/手机号页，本轮将直接失败并跳过剩余重试。`, 'warn');
              await addLog(
                targetRun < totalRuns
                  ? `第 ${targetRun}/${totalRuns} 轮因 add-phone/手机号页提前结束，自动流程将继续下一轮。`
                  : `第 ${targetRun}/${totalRuns} 轮因 add-phone/手机号页提前结束，已无后续轮次，本次自动运行结束。`,
                'warn'
              );
              forceFreshTabsNextRun = true;
              break;
            }

            if (blockedByPhoneNoSupply) {
              roundSummary.status = 'failed';
              roundSummary.finalFailureReason = reason;
              await setState({
                autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              });
              await appendRoundRecordIfNeeded('failed', reason, err);
              cancelPendingCommands('当前轮因接码号池暂无可用号码已终止。');
              await broadcastStopToContentScripts();
              await addLog(
                autoRunSkipFailures
                  ? `第 ${targetRun}/${totalRuns} 轮接码号池暂无可用号码。该状态属于全局资源耗尽，已忽略“自动重试/跳过失败继续下一轮”并停止自动运行。`
                  : `第 ${targetRun}/${totalRuns} 轮接码号池暂无可用号码，当前自动运行将停止。`,
                'warn'
              );
              stoppedEarly = true;
              await broadcastAutoRunStatus('stopped', {
                currentRun: targetRun,
                totalRuns,
                attemptRun,
                sessionId: 0,
              });
              break;
            }

            if (blockedByPlusNonFreeTrial) {
              roundSummary.status = 'failed';
              roundSummary.finalFailureReason = reason;
              await setState({
                autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              });
              await appendRoundRecordIfNeeded('failed', reason, err);
              cancelPendingCommands('当前轮因 Plus 免费试用资格不可用已终止。');
              await broadcastStopToContentScripts();
              if (!autoRunSkipFailures) {
                await addLog(
                  autoRunRetryNonFreeTrial
                    ? `第 ${targetRun}/${totalRuns} 轮检测到 Plus 今日应付金额非 0，已达到无试用套餐自动重试上限，当前自动运行将停止。`
                    : `第 ${targetRun}/${totalRuns} 轮检测到 Plus 今日应付金额非 0，自动重试未开启，当前自动运行将停止。`,
                  'warn'
                );
                stoppedEarly = true;
                await broadcastAutoRunStatus('stopped', {
                  currentRun: targetRun,
                  totalRuns,
                  attemptRun,
                  sessionId: 0,
                });
                break;
              }

              await addLog(`第 ${targetRun}/${totalRuns} 轮没有 Plus 免费试用资格，本轮将直接失败并跳过剩余重试。`, 'warn');
              await addLog(
                targetRun < totalRuns
                  ? `第 ${targetRun}/${totalRuns} 轮因 Plus 今日应付金额非 0 提前结束，自动流程将继续下一轮。`
                  : `第 ${targetRun}/${totalRuns} 轮因 Plus 今日应付金额非 0 提前结束，已无后续轮次，本次自动运行结束。`,
                'warn'
              );
              forceFreshTabsNextRun = true;
              break;
            }

            if (blockedByGpcTaskEnded) {
              roundSummary.status = 'failed';
              roundSummary.finalFailureReason = reason;
              await setState({
                autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              });
              await appendRoundRecordIfNeeded('failed', reason, err);
              cancelPendingCommands('当前轮因 GPC 任务已结束。');
              await broadcastStopToContentScripts();
              if (!autoRunSkipFailures) {
                await addLog(
                  `第 ${targetRun}/${totalRuns} 轮 GPC 任务已结束，自动重试未开启，当前自动运行将停止。`,
                  'warn'
                );
                stoppedEarly = true;
                await broadcastAutoRunStatus('stopped', {
                  currentRun: targetRun,
                  totalRuns,
                  attemptRun,
                  sessionId: 0,
                });
                break;
              }

              await addLog(`第 ${targetRun}/${totalRuns} 轮 GPC 任务已结束，本轮将直接失败并跳过剩余重试。`, 'warn');
              await addLog(
                targetRun < totalRuns
                  ? `第 ${targetRun}/${totalRuns} 轮因 GPC 任务结束提前结束，自动流程将继续下一轮。`
                  : `第 ${targetRun}/${totalRuns} 轮因 GPC 任务结束提前结束，已无后续轮次，本次自动运行结束。`,
                'warn'
              );
              forceFreshTabsNextRun = true;
              break;
            }

            if (blockedByHostedCheckoutGenericError) {
              roundSummary.status = 'failed';
              roundSummary.finalFailureReason = reason;
              await setState({
                autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              });
              await appendRoundRecordIfNeeded('failed', reason, err);
              cancelPendingCommands(
                autoRunRetryPaypalCallback
                  ? '当前轮因 PayPal Checkout genericError 已达到自动重试上限。'
                  : '当前轮因 PayPal Checkout genericError 已终止，等待用户选择检查或重试。'
              );
              await broadcastStopToContentScripts();
              await addLog(
                autoRunRetryPaypalCallback
                  ? `第 ${targetRun}/${totalRuns} 轮检测到 PayPal Checkout genericError，已达到 PAYPAL回调自动重试上限，当前自动运行将停止。`
                  : `第 ${targetRun}/${totalRuns} 轮检测到 PayPal Checkout genericError，当前自动运行已停止，请在弹窗中选择“检查”或“重试”。`,
                'warn'
              );
              stoppedEarly = true;
              await broadcastAutoRunStatus('stopped', {
                currentRun: targetRun,
                totalRuns,
                attemptRun,
                sessionId: 0,
              });
              break;
            }

            if (blockedByHostedCheckoutCardFallback) {
              roundSummary.status = 'failed';
              roundSummary.finalFailureReason = reason;
              await setState({
                autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              });
              await appendRoundRecordIfNeeded('failed', reason, err);
              cancelPendingCommands('当前轮因 hosted checkout 连续落到银行卡分支已终止。');
              await broadcastStopToContentScripts();
              await addLog(
                `第 ${targetRun}/${totalRuns} 轮检测到 hosted checkout 连续落到银行卡分支，已达到默认自动重试上限，当前自动运行将停止。`,
                'warn'
              );
              stoppedEarly = true;
              await broadcastAutoRunStatus('stopped', {
                currentRun: targetRun,
                totalRuns,
                attemptRun,
                sessionId: 0,
              });
              break;
            }

            if (blockedByHostedCheckoutVerificationResendLimit) {
              roundSummary.status = 'failed';
              roundSummary.finalFailureReason = reason;
              await setState({
                autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              });
              await appendRoundRecordIfNeeded('failed', reason, err);
              cancelPendingCommands('当前轮因 PayPal 验证码自动 Resend 达到上限已终止。');
              await broadcastStopToContentScripts();
              await addLog(
                `第 ${targetRun}/${totalRuns} 轮 PayPal 验证码自动 Resend 已达到上限，当前自动运行已停止；请尝试在页面手动获取验证码并填入。`,
                'warn'
              );
              stoppedEarly = true;
              await broadcastAutoRunStatus('stopped', {
                currentRun: targetRun,
                totalRuns,
                attemptRun,
                sessionId: 0,
              });
              break;
            }

            if (blockedByCloudCheckoutAlreadyPaid) {
              roundSummary.status = 'failed';
              roundSummary.finalFailureReason = reason;
              await setState({
                autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              });
              await appendRoundRecordIfNeeded('failed', reason, err);
              cancelPendingCommands('当前轮因云端确认账号已开通 Plus，已停止自动重试。');
              await broadcastStopToContentScripts();
              await addLog(
                `第 ${targetRun}/${totalRuns} 轮云端返回 User is already paid，当前自动运行已停止，请检查 PLUS 是否已经开通。`,
                'warn'
              );
              stoppedEarly = true;
              await broadcastAutoRunStatus('stopped', {
                currentRun: targetRun,
                totalRuns,
                attemptRun,
                sessionId: 0,
              });
              break;
            }

            if (blockedBySignupUserAlreadyExists) {
              roundSummary.status = 'failed';
              roundSummary.finalFailureReason = reason;
              await setState({
                autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              });
              await appendRoundRecordIfNeeded('failed', reason, err);
              cancelPendingCommands('当前轮因 user_already_exists 已终止。');
              await broadcastStopToContentScripts();
              if (!autoRunSkipFailures) {
                await addLog(
                  `第 ${targetRun}/${totalRuns} 轮触发 user_already_exists/用户已存在，自动重试未开启，当前自动运行将停止。`,
                  'warn'
                );
                stoppedEarly = true;
                await broadcastAutoRunStatus('stopped', {
                  currentRun: targetRun,
                  totalRuns,
                  attemptRun,
                  sessionId: 0,
                });
                break;
              }

              await addLog(`第 ${targetRun}/${totalRuns} 轮触发 user_already_exists/用户已存在，本轮将直接失败并跳过剩余重试。`, 'warn');
              await addLog(
                targetRun < totalRuns
                  ? `第 ${targetRun}/${totalRuns} 轮因 user_already_exists/用户已存在提前结束，自动流程将继续下一轮。`
                  : `第 ${targetRun}/${totalRuns} 轮因 user_already_exists/用户已存在提前结束，已无后续轮次，本次自动运行结束。`,
                'warn'
              );
              forceFreshTabsNextRun = true;
              break;
            }

            if (blockedByStep4Route405) {
              roundSummary.status = 'failed';
              roundSummary.finalFailureReason = reason;
              await setState({
                autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              });
              await appendRoundRecordIfNeeded('failed', reason, err);
              cancelPendingCommands('当前轮因步骤 4 连续 405 错误已终止。');
              await broadcastStopToContentScripts();
              if (!autoRunSkipFailures) {
                await addLog(
                  `第 ${targetRun}/${totalRuns} 轮步骤 4 连续 405 恢复失败，自动重试未开启，当前自动运行将停止。`,
                  'warn'
                );
                stoppedEarly = true;
                await broadcastAutoRunStatus('stopped', {
                  currentRun: targetRun,
                  totalRuns,
                  attemptRun,
                  sessionId: 0,
                });
                break;
              }

              await addLog(`第 ${targetRun}/${totalRuns} 轮步骤 4 连续 405 恢复失败，本轮将直接失败并跳过剩余重试。`, 'warn');
              await addLog(
                targetRun < totalRuns
                  ? `第 ${targetRun}/${totalRuns} 轮因步骤 4 连续 405 提前结束，自动流程将继续下一轮。`
                  : `第 ${targetRun}/${totalRuns} 轮因步骤 4 连续 405 提前结束，已无后续轮次，本次自动运行结束。`,
                'warn'
              );
              forceFreshTabsNextRun = true;
              break;
            }

            if (canRetry) {
              const retryIndex = attemptRun;
              if (isRestartCurrentAttemptError(err)) {
                await addLog(`第 ${targetRun}/${totalRuns} 轮第 ${attemptRun} 次尝试需要整轮重开：${reason}`, 'warn');
              } else {
                await addLog(`第 ${targetRun}/${totalRuns} 轮第 ${attemptRun} 次尝试失败：${reason}`, 'error');
              }
              cancelPendingCommands('当前尝试已放弃。');
              await broadcastStopToContentScripts();
              await broadcastAutoRunStatus('retrying', {
                currentRun: targetRun,
                totalRuns,
                attemptRun,
                sessionId,
              });
              forceFreshTabsNextRun = true;
              await addLog(
                keepSameEmailUntilAddPhone
                  ? `自动重试：${Math.round(AUTO_RUN_RETRY_DELAY_MS / 1000)} 秒后继续使用当前邮箱，开始第 ${targetRun}/${totalRuns} 轮第 ${attemptRun + 1} 次尝试。`
                  : `自动重试：${Math.round(AUTO_RUN_RETRY_DELAY_MS / 1000)} 秒后开始第 ${targetRun}/${totalRuns} 轮第 ${attemptRun + 1} 次尝试（第 ${retryIndex}/${AUTO_RUN_MAX_RETRIES_PER_ROUND} 次重试）。`,
                'warn'
              );
              try {
                await sleepWithStop(AUTO_RUN_RETRY_DELAY_MS);
              } catch (sleepError) {
                if (isStopError(sleepError)) {
                  stoppedEarly = true;
                  await appendRoundRecordIfNeeded('stopped', getErrorMessage(sleepError), sleepError);
                  await addLog(`第 ${targetRun}/${totalRuns} 轮已被用户停止`, 'warn');
                  await broadcastAutoRunStatus('stopped', {
                    currentRun: targetRun,
                    totalRuns,
                    attemptRun,
                    sessionId: 0,
                  });
                  break;
                }
                throw sleepError;
              }
              try {
                const parkedForRetry = await waitBeforeAutoRunRetry(targetRun, totalRuns, attemptRun + 1, {
                  autoRunSkipFailures,
                  autoRunRetryNonFreeTrial,
                  autoRunRetryPaypalCallback,
                  roundSummaries,
                });
                if (parkedForRetry) {
                  parkedByTimer = true;
                  break;
                }
              } catch (sleepError) {
                if (isStopError(sleepError)) {
                  stoppedEarly = true;
                  await appendRoundRecordIfNeeded('stopped', getErrorMessage(sleepError), sleepError);
                  await addLog(`第 ${targetRun}/${totalRuns} 轮已被用户停止`, 'warn');
                  await broadcastAutoRunStatus('stopped', {
                    currentRun: targetRun,
                    totalRuns,
                    attemptRun,
                    sessionId: 0,
                  });
                  break;
                }
                throw sleepError;
              }
              attemptRun += 1;
              reuseExistingProgress = false;
              continue;
            }

            if (reachedKeepSameEmailRetryLimit) {
              const limitReason = `${KEEP_SAME_EMAIL_RETRY_LIMIT_EXCEEDED_ERROR_PREFIX}第 ${targetRun}/${totalRuns} 轮继续使用当前邮箱已重试 ${AUTO_RUN_MAX_KEEP_SAME_EMAIL_RETRIES_PER_ROUND} 次，停止当前轮次。最后原因：${reason}`;
              roundSummary.status = 'failed';
              roundSummary.finalFailureReason = limitReason;
              roundSummary.failureReasons.push(limitReason);
              await setState({
                autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
              });
              await appendRoundRecordIfNeeded('failed', limitReason, err);
              cancelPendingCommands('当前轮继续使用同一邮箱重试已达到上限。');
              await broadcastStopToContentScripts();
              if (!autoRunSkipFailures) {
                await addLog(
                  `第 ${targetRun}/${totalRuns} 轮继续使用当前邮箱重试已达到 ${AUTO_RUN_MAX_KEEP_SAME_EMAIL_RETRIES_PER_ROUND} 次上限，当前自动运行将停止。`,
                  'warn'
                );
                stoppedEarly = true;
                await broadcastAutoRunStatus('stopped', {
                  currentRun: targetRun,
                  totalRuns,
                  attemptRun,
                  sessionId: 0,
                });
                break;
              }

              await addLog(
                `第 ${targetRun}/${totalRuns} 轮继续使用当前邮箱重试已达到 ${AUTO_RUN_MAX_KEEP_SAME_EMAIL_RETRIES_PER_ROUND} 次上限，本轮将直接失败并跳过剩余重试。`,
                'warn'
              );
              await addLog(
                targetRun < totalRuns
                  ? `第 ${targetRun}/${totalRuns} 轮因同邮箱重试达到上限提前结束，自动流程将继续下一轮。`
                  : `第 ${targetRun}/${totalRuns} 轮因同邮箱重试达到上限提前结束，已无后续轮次，本次自动运行结束。`,
                'warn'
              );
              forceFreshTabsNextRun = true;
              break;
            }

            roundSummary.status = 'failed';
            roundSummary.finalFailureReason = reason;
            await setState({
              autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
            });
            await appendRoundRecordIfNeeded('failed', reason, err);
            if (!autoRunSkipFailures) {
              cancelPendingCommands('当前轮执行失败。');
              await broadcastStopToContentScripts();
              await addLog('自动重试未开启，自动运行将在当前失败后停止。', 'warn');
              stoppedEarly = true;
              await broadcastAutoRunStatus('stopped', {
                currentRun: targetRun,
                totalRuns,
                attemptRun,
                sessionId: 0,
              });
              break;
            }
            await addLog(`第 ${targetRun}/${totalRuns} 轮最终失败：${reason}`, 'error');
            await addLog(
              targetRun < totalRuns
                ? `第 ${targetRun}/${totalRuns} 轮已达到 ${AUTO_RUN_MAX_RETRIES_PER_ROUND} 次重试上限，继续下一轮。`
                : `第 ${targetRun}/${totalRuns} 轮已达到 ${AUTO_RUN_MAX_RETRIES_PER_ROUND} 次重试上限，本次自动运行结束。`,
              'warn'
            );
            cancelPendingCommands('当前轮已达到重试上限。');
            await broadcastStopToContentScripts();
            forceFreshTabsNextRun = true;
            break;
          } finally {
            reuseExistingProgress = false;
            continueCurrentOnFirstAttempt = false;
          }
        }

        if (stoppedEarly || parkedByTimer) {
          break;
        }

        try {
          const parkedForNextRound = await waitBetweenAutoRunRounds(targetRun, totalRuns, roundSummary, {
            autoRunSkipFailures,
            autoRunRetryNonFreeTrial,
            autoRunRetryPaypalCallback,
            roundSummaries,
          });
          if (parkedForNextRound) {
            parkedByTimer = true;
            break;
          }
        } catch (sleepError) {
          if (isStopError(sleepError)) {
            stoppedEarly = true;
            await addLog(`第 ${targetRun}/${totalRuns} 轮已被用户停止`, 'warn');
            await broadcastAutoRunStatus('stopped', {
              currentRun: targetRun,
              totalRuns,
              attemptRun: runtime.get().autoRunAttemptRun,
              sessionId: 0,
            });
            break;
          }
          throw sleepError;
        }
      }

      if (parkedByTimer) {
        runtime.set({ autoRunActive: false });
        clearStopRequest();
        return;
      }

      await setState({
        autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
      });
      await logAutoRunFinalSummary(totalRuns, roundSummaries);

      const finalRuntime = runtime.get();
      if (deps.getStopRequested() || stoppedEarly) {
        await addLog(`=== 已停止，完成 ${successfulRuns}/${finalRuntime.autoRunTotalRuns} 轮 ===`, 'warn');
        await broadcastAutoRunStatus('stopped', {
          currentRun: finalRuntime.autoRunCurrentRun,
          totalRuns: finalRuntime.autoRunTotalRuns,
          attemptRun: finalRuntime.autoRunAttemptRun,
          sessionId: 0,
        });
      } else {
        await addLog(`=== 全部 ${finalRuntime.autoRunTotalRuns} 轮已执行完成，成功 ${successfulRuns} 轮 ===`, 'ok');
        await broadcastAutoRunStatus('complete', {
          currentRun: finalRuntime.autoRunTotalRuns,
          totalRuns: finalRuntime.autoRunTotalRuns,
          attemptRun: finalRuntime.autoRunAttemptRun,
          sessionId: 0,
        });
      }
      runtime.set({ autoRunActive: false, autoRunSessionId: 0 });
      const afterRuntime = runtime.get();
      await setState({
        autoRunSessionId: 0,
        autoRunRoundSummaries: serializeAutoRunRoundSummaries(totalRuns, roundSummaries),
        autoRunTimerPlan: null,
        scheduledAutoRunPlan: null,
        ...getAutoRunStatusPayload(deps.getStopRequested() || stoppedEarly ? 'stopped' : 'complete', {
          currentRun: deps.getStopRequested() || stoppedEarly ? afterRuntime.autoRunCurrentRun : afterRuntime.autoRunTotalRuns,
          totalRuns: afterRuntime.autoRunTotalRuns,
          attemptRun: afterRuntime.autoRunAttemptRun,
          sessionId: 0,
        }),
      });
      if (!(deps.getStopRequested() || stoppedEarly)) {
        clearStopRequest();
      }
    }

    return {
      autoRunLoop,
      buildAutoRunRoundSummaries,
      createAutoRunRoundSummary,
      formatAutoRunFailureReasons,
      getAutoRunRoundRetryCount,
      handleAutoRunLoopUnhandledError,
      logAutoRunFinalSummary,
      normalizeAutoRunRoundSummary,
      resolveAutoRunAccountRecordStatus,
      serializeAutoRunRoundSummaries,
      skipAutoRunCountdown,
      startAutoRunLoop,
      waitBetweenAutoRunRounds,
      waitBeforeAutoRunRetry,
      __test: {
        AUTO_RUN_MAX_KEEP_SAME_EMAIL_RETRIES_PER_ROUND,
        KEEP_SAME_EMAIL_RETRY_LIMIT_EXCEEDED_ERROR_PREFIX,
      },
    };
  }

  return {
    createAutoRunController,
  };
});
