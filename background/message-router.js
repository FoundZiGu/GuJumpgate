(function attachBackgroundMessageRouter(root, factory) {
  root.MultiPageBackgroundMessageRouter = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundMessageRouterModule() {
  function createMessageRouter(deps = {}) {
    const {
      addLog,
      appendAccountRunRecord,
      batchUpdateLuckmailPurchases,
      buildLocalhostCleanupPrefix,
      buildLuckmailSessionSettingsPayload,
      buildPersistentSettingsPayload,
      broadcastDataUpdate,
      applyIpProxySettingsFromState,
      cancelScheduledAutoRun,
      checkIcloudSession,
      clearAccountRunHistory,
      deleteAccountRunHistoryRecords,
      clearAutoRunTimerAlarm,
      clearFreeReusablePhoneActivation,
      clearLuckmailRuntimeState,
      clearStopRequest,
      closeLocalhostCallbackTabs,
      closeTabsByUrlPrefix,
      completeNodeFromBackground,
      deleteHotmailAccount,
      deleteHotmailAccounts,
      deleteIcloudAlias,
      deleteUsedIcloudAliases,
      disableUsedLuckmailPurchases,
      doesNodeUseCompletionSignal,
      ensureMail2925MailboxSession,
      ensureManualInteractionAllowed,
      executeNode,
      executeNodeViaCompletionSignal,
      exportCurrentSessionJson,
      exportSettingsBundle,
      ensureContentScriptReadyOnTabUntilStopped = null,
      fetchHostedCheckoutVerificationCodeManually = null,
      testCheckoutConversionProxy = null,
      fetchGeneratedEmail,
      fetchIcloudHideMyEmail,
      refreshGpcCardBalance,
      finalizePhoneActivationAfterSuccessfulFlow,
      finalizeStep3Completion,
      finalizeIcloudAliasAfterSuccessfulFlow,
      findHotmailAccount,
      findPayPalAccount,
      flushCommand,
      getCurrentLuckmailPurchase,
      getCurrentPayPalAccount,
      getCurrentMail2925Account,
      getPendingAutoRunTimerPlan,
      getSourceLabel,
      getState,
      getNodeDefinitionForState,
      getNodeIdsForState,
      getStepIdByNodeIdForState,
      getStepDefinitionForState,
      getStepIdsForState,
      getLastStepIdForState,
      normalizeSignupMethod = (value = '') => String(value || '').trim().toLowerCase() === 'phone' ? 'phone' : 'email',
      canUsePhoneSignup = (state = {}) => {
        const rootScope = typeof self !== 'undefined' ? self : globalThis;
        const capabilityRegistry = rootScope.MultiPageFlowCapabilities?.createFlowCapabilityRegistry?.({
          defaultFlowId: 'openai',
        }) || null;
        if (capabilityRegistry?.canUsePhoneSignup) {
          return capabilityRegistry.canUsePhoneSignup(state);
        }
        return Boolean(state?.phoneVerificationEnabled)
          && !Boolean(state?.plusModeEnabled)
          && !Boolean(state?.contributionMode);
      },
      resolveSignupMethod = (state = {}) => {
        const method = normalizeSignupMethod(state?.signupMethod);
        const rootScope = typeof self !== 'undefined' ? self : globalThis;
        const capabilityRegistry = rootScope.MultiPageFlowCapabilities?.createFlowCapabilityRegistry?.({
          defaultFlowId: 'openai',
        }) || null;
        if (capabilityRegistry?.resolveSignupMethod) {
          return capabilityRegistry.resolveSignupMethod(state, method);
        }
        return method === 'phone' && canUsePhoneSignup(state) ? 'phone' : 'email';
      },
      validateAutoRunStart = (state = {}, options = {}) => {
        const validationState = options?.state || state;
        const rootScope = typeof self !== 'undefined' ? self : globalThis;
        const capabilityRegistry = rootScope.MultiPageFlowCapabilities?.createFlowCapabilityRegistry?.({
          defaultFlowId: 'openai',
        }) || null;
        if (!capabilityRegistry?.validateAutoRunStart) {
          return { ok: true, errors: [] };
        }
        return capabilityRegistry.validateAutoRunStart({
          activeFlowId: options?.activeFlowId ?? validationState?.activeFlowId,
          panelMode: options?.panelMode ?? validationState?.panelMode,
          signupMethod: options?.signupMethod ?? validationState?.signupMethod,
          state: validationState,
        });
      },
      validateModeSwitch = (state = {}, options = {}) => {
        const validationState = options?.state || state;
        const rootScope = typeof self !== 'undefined' ? self : globalThis;
        const capabilityRegistry = rootScope.MultiPageFlowCapabilities?.createFlowCapabilityRegistry?.({
          defaultFlowId: 'openai',
        }) || null;
        if (!capabilityRegistry?.validateModeSwitch) {
          return {
            ok: true,
            changedKeys: Array.isArray(options?.changedKeys) ? options.changedKeys : [],
            errors: [],
            normalizedUpdates: {},
          };
        }
        return capabilityRegistry.validateModeSwitch({
          activeFlowId: options?.activeFlowId ?? validationState?.activeFlowId,
          changedKeys: options?.changedKeys,
          panelMode: options?.panelMode ?? validationState?.panelMode,
          signupMethod: options?.signupMethod ?? validationState?.signupMethod,
          state: validationState,
        });
      },
      getTabId,
      getStopRequested,
      handleAutoRunLoopUnhandledError,
      importSettingsBundle,
      invalidateDownstreamAfterStepRestart,
      isCloudflareSecurityBlockedError,
      isAutoRunLockedState,
      isHotmailProvider,
      isLocalhostOAuthCallbackUrl,
      isLuckmailProvider,
      isStopError,
      isTabAlive,
      launchAutoRunTimerPlan,
      ensureIpProxyAutoSyncAlarm,
      clearIpProxyAutoSyncAlarm,
      runIpProxyAutoSync,
      listIcloudAliases,
      listLuckmailPurchasesForManagement,
      markCurrentCustomEmailPoolEntryUsed,
      markCurrentRegistrationAccountUsed,
      normalizeHotmailAccounts,
      normalizeMail2925Accounts,
      normalizePayPalAccounts,
      normalizeRunCount,
      AUTO_RUN_TIMER_KIND_SCHEDULED_START,
      notifyNodeComplete,
      notifyNodeError,
      patchMail2925Account,
      patchHotmailAccount,
      pollContributionStatus,
      registerTab,
      requestStop,
      probeIpProxyExit,
      handleCloudflareSecurityBlocked,
      resetState,
      resumeAutoRun,
      scheduleAutoRun,
      sendTabMessageUntilStopped = null,
      selectLuckmailPurchase,
      sleepWithStop = async () => {},
      switchIpProxy,
      changeIpProxyExit,
      setCurrentPayPalAccount,
      setCurrentMail2925Account,
      setCurrentHotmailAccount,
      setContributionMode,
      setEmailState,
      setEmailStateSilently,
      persistRegistrationEmailState,
      setFreeReusablePhoneActivation,
      setSignupPhoneState,
      setSignupPhoneStateSilently,
      setIcloudAliasPreservedState,
      setIcloudAliasUsedState,
      setLuckmailPurchaseDisabledState,
      setLuckmailPurchasePreservedState,
      setLuckmailPurchaseUsedState,
      setPersistentSettings,
      setState,
      setNodeStatus,
      skipAutoRunCountdown,
      skipNode,
      startContributionFlow,
      startAutoRunLoop,
      waitForTabCompleteUntilStopped = async () => {},
      deleteMail2925Account,
      deleteMail2925Accounts,
      syncHotmailAccounts,
      syncPayPalAccounts,
      testHotmailAccountMailAccess,
      upsertPayPalAccount,
      upsertMail2925Account,
      upsertHotmailAccount,
      verifyHotmailAccount,
    } = deps;

    function preserveKeyFromState(updates, currentState, key) {
      if (!Object.prototype.hasOwnProperty.call(updates, key)) {
        return;
      }
      if (currentState?.[key] !== undefined) {
        updates[key] = currentState[key];
      } else {
        delete updates[key];
      }
    }

    function preservePhoneReuseSettingsForPhoneSignup(updates, currentState = {}) {
      if (!updates || typeof updates !== 'object') {
        return;
      }

      if (
        Object.prototype.hasOwnProperty.call(updates, 'phoneSmsReuseEnabled')
        || Object.prototype.hasOwnProperty.call(updates, 'heroSmsReuseEnabled')
      ) {
        const currentReuseEnabled = currentState?.phoneSmsReuseEnabled ?? currentState?.heroSmsReuseEnabled;
        if (currentReuseEnabled !== undefined) {
          const normalizedReuseEnabled = Boolean(currentReuseEnabled);
          updates.phoneSmsReuseEnabled = normalizedReuseEnabled;
          updates.heroSmsReuseEnabled = normalizedReuseEnabled;
        } else {
          delete updates.phoneSmsReuseEnabled;
          delete updates.heroSmsReuseEnabled;
        }
      }

      preserveKeyFromState(updates, currentState, 'freePhoneReuseEnabled');
      preserveKeyFromState(updates, currentState, 'freePhoneReuseAutoEnabled');
      preserveKeyFromState(updates, currentState, 'phonePreferredActivation');
    }

    function joinIcloudApiWorkerUrl(baseUrl, path) {
      const parsed = new URL(String(baseUrl || '').trim());
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}${path}`;
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    }

    async function saveIcloudApiCredentials(credentials = []) {
      const currentState = await getState();
      const currentCredentials = currentState?.icloudApiCredentials && typeof currentState.icloudApiCredentials === 'object'
        ? { ...currentState.icloudApiCredentials }
        : {};
      for (const credential of credentials) {
        const raw = String(credential || '').trim();
        const separatorIndex = raw.indexOf('----');
        if (separatorIndex <= 0) continue;
        const email = raw.slice(0, separatorIndex).trim().toLowerCase();
        if (!email) continue;
        currentCredentials[email] = raw;
      }
      await setPersistentSettings({ icloudApiCredentials: currentCredentials });
      await setState({ icloudApiCredentials: currentCredentials });
      return currentCredentials;
    }

    async function syncIcloudApiCredentialsToWorker(credentialsText, apiBaseUrl, apiAdminKey) {
      if (!apiBaseUrl || !apiAdminKey) {
        return { synced: false, syncError: '' };
      }
      try {
        const response = await fetch(joinIcloudApiWorkerUrl(apiBaseUrl, '/api/admin/import'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminKey: apiAdminKey, credentialsText }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
        return { synced: true, syncError: '' };
      } catch (err) {
        return { synced: false, syncError: err?.message || String(err || '同步失败') };
      }
    }

    async function appendManualAccountRunRecordIfNeeded(status, stateOverride = null, reason = '') {
      if (typeof appendAccountRunRecord !== 'function') {
        return null;
      }

      const state = stateOverride || await getState();
      if (isAutoRunLockedState(state)) {
        return null;
      }

      return appendAccountRunRecord(status, state, reason);
    }

    async function ensureManualStepPrerequisites(step) {
      if (step !== 4) {
        return;
      }

      const signupTabId = typeof getTabId === 'function'
        ? await getTabId('signup-page')
        : null;
      const signupTabAlive = signupTabId && typeof isTabAlive === 'function'
        ? await isTabAlive('signup-page')
        : Boolean(signupTabId);

      if (!signupTabId || !signupTabAlive) {
        throw new Error('手动执行步骤 4 前，请先执行步骤 1 或步骤 2，确保认证页仍然打开并停留在验证码页。');
      }
    }

    const DEFAULT_OPENAI_NODE_BY_STEP = Object.freeze({
      1: 'open-chatgpt',
      2: 'submit-signup-email',
      3: 'fill-password',
      4: 'fetch-signup-code',
      5: 'fill-profile',
      6: 'wait-registration-success',
      7: 'oauth-login',
      8: 'fetch-login-code',
      9: 'post-login-phone-verification',
      10: 'confirm-oauth',
      11: 'fetch-login-code',
      12: 'post-login-phone-verification',
      13: 'confirm-oauth',
      14: 'platform-verify',
      15: 'platform-verify',
      16: 'confirm-oauth',
      17: 'platform-verify',
    });

    function getStepKeyForState(step, state = {}) {
      if (typeof getStepDefinitionForState === 'function') {
        return String(getStepDefinitionForState(step, state)?.key || '').trim();
      }
      return DEFAULT_OPENAI_NODE_BY_STEP[Number(step)] || '';
    }

    function findStepByNodeId(nodeId, state = {}) {
      const normalizedNodeId = String(nodeId || '').trim();
      if (normalizedNodeId && typeof getStepIdByNodeIdForState === 'function') {
        const step = getStepIdByNodeIdForState(normalizedNodeId, state);
        if (Number.isInteger(step) && step > 0) {
          return step;
        }
      }
      if (!normalizedNodeId || typeof getStepIdsForState !== 'function') {
        return 0;
      }
      for (const stepId of getStepIdsForState(state)) {
        if (getStepKeyForState(stepId, state) === normalizedNodeId) {
          return Number(stepId) || 0;
        }
      }
      return 0;
    }

    function getNextNodeIdForState(nodeId, state = {}) {
      const normalizedNodeId = String(nodeId || '').trim();
      if (!normalizedNodeId || typeof getNodeIdsForState !== 'function') {
        return '';
      }
      const nodeIds = Array.isArray(getNodeIdsForState(state)) ? getNodeIdsForState(state) : [];
      const currentIndex = nodeIds.indexOf(normalizedNodeId);
      if (currentIndex < 0) {
        return '';
      }
      return String(nodeIds[currentIndex + 1] || '').trim();
    }

    function getLastNodeIdForState(state = {}) {
      if (typeof getNodeIdsForState !== 'function') {
        return '';
      }
      const nodeIds = Array.isArray(getNodeIdsForState(state)) ? getNodeIdsForState(state) : [];
      return String(nodeIds[nodeIds.length - 1] || '').trim();
    }

    const PLUS_CHECKOUT_SOURCE = 'plus-checkout';
    const PAYPAL_SOURCE = 'paypal-flow';
    const GOPAY_SOURCE = 'gopay-flow';
    const PLUS_CHECKOUT_INJECT_FILES = ['content/utils.js', 'content/operation-delay.js', 'content/plus-checkout.js'];
    const PAYPAL_GENERIC_ERROR_CHECK_URL = 'https://chatgpt.com/';
    const PAYPAL_GENERIC_ERROR_SESSION_SETTLE_WAIT_MS = 5000;

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function normalizePlusPaymentMethod(value = '') {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized === 'gpc-helper') {
        return 'gpc-helper';
      }
      return normalized === 'gopay' ? 'gopay' : 'paypal';
    }

    function parseUrlSafely(rawUrl) {
      const normalized = normalizeString(rawUrl);
      if (!normalized) {
        return null;
      }
      try {
        return new URL(normalized);
      } catch {
        return null;
      }
    }

    function isPlusCheckoutPaymentUrl(url = '') {
      const parsed = parseUrlSafely(url);
      if (!parsed) {
        return false;
      }
      const hostname = normalizeString(parsed.hostname).toLowerCase();
      return hostname === 'pay.openai.com' || hostname === 'checkout.stripe.com';
    }

    function isPayPalPaymentUrl(url = '') {
      const parsed = parseUrlSafely(url);
      if (!parsed) {
        return false;
      }
      const hostname = normalizeString(parsed.hostname).toLowerCase();
      return hostname === 'paypal.com' || hostname.endsWith('.paypal.com');
    }

    function isGoPayPaymentUrl(url = '') {
      const parsed = parseUrlSafely(url);
      if (!parsed) {
        return false;
      }
      const hostname = normalizeString(parsed.hostname).toLowerCase();
      return hostname === 'gopay.co.id'
        || hostname.endsWith('.gopay.co.id')
        || hostname === 'gojek.com'
        || hostname.endsWith('.gojek.com')
        || hostname === 'midtrans.com'
        || hostname.endsWith('.midtrans.com')
        || hostname === 'xendit.co'
        || hostname.endsWith('.xendit.co')
        || hostname === 'xendit.co.id'
        || hostname.endsWith('.xendit.co.id');
    }

    function isKnownPaymentFlowUrl(url = '') {
      const parsed = parseUrlSafely(url);
      if (!parsed) {
        return false;
      }
      const href = normalizeString(parsed.href);
      if (
        href.startsWith('https://pay.openai.com/c/pay/')
        || href.startsWith('https://checkout.stripe.com/c/pay/')
        || href.startsWith('https://www.paypal.com/checkoutweb/signup')
        || href.startsWith('https://paypal.com/checkoutweb/signup')
      ) {
        return true;
      }
      return false;
    }

    async function cleanupPaymentTabsAfterSuccessfulFlow() {
      const chromeApi = typeof chrome !== 'undefined' ? chrome : globalThis.chrome;
      const sources = [
        { source: PLUS_CHECKOUT_SOURCE, shouldCloseUrl: isPlusCheckoutPaymentUrl },
        { source: PAYPAL_SOURCE, shouldCloseUrl: isPayPalPaymentUrl },
        { source: GOPAY_SOURCE, shouldCloseUrl: isGoPayPaymentUrl },
      ];
      const closedIds = new Set();
      let closedCount = 0;

      if (chromeApi?.tabs?.get && chromeApi?.tabs?.remove && typeof getTabId === 'function') {
        for (const entry of sources) {
          try {
            const tabId = await getTabId(entry.source);
            if (!Number.isInteger(tabId) || tabId <= 0 || closedIds.has(tabId)) {
              continue;
            }
            const tab = await chromeApi.tabs.get(tabId).catch(() => null);
            const currentUrl = normalizeString(tab?.url);
            if (!entry.shouldCloseUrl(currentUrl)) {
              continue;
            }
            await chromeApi.tabs.remove(tabId).catch(() => {});
            closedIds.add(tabId);
            closedCount += 1;
          } catch (_) {
            // Best effort cleanup only.
          }
        }
      }

      if (chromeApi?.tabs?.query && chromeApi?.tabs?.remove) {
        try {
          const allTabs = await chromeApi.tabs.query({});
          const matchedIds = (Array.isArray(allTabs) ? allTabs : [])
            .filter((tab) => Number.isInteger(tab?.id))
            .filter((tab) => !closedIds.has(tab.id))
            .filter((tab) => isKnownPaymentFlowUrl(tab?.url || ''))
            .map((tab) => tab.id);
          if (matchedIds.length) {
            await chromeApi.tabs.remove(matchedIds).catch(() => {});
            for (const id of matchedIds) {
              closedIds.add(id);
            }
            closedCount += matchedIds.length;
          }
        } catch (_) {
          // Best effort cleanup only.
        }
      }

      const latestState = await getState();
      const nextTabRegistry = {
        ...(latestState?.tabRegistry || {}),
        [PLUS_CHECKOUT_SOURCE]: null,
        [PAYPAL_SOURCE]: null,
        [GOPAY_SOURCE]: null,
      };
      const nextSourceLastUrls = {
        ...(latestState?.sourceLastUrls || {}),
      };
      delete nextSourceLastUrls[PLUS_CHECKOUT_SOURCE];
      delete nextSourceLastUrls[PAYPAL_SOURCE];
      delete nextSourceLastUrls[GOPAY_SOURCE];

      await setState({
        plusCheckoutTabId: null,
        plusCheckoutUrl: null,
        tabRegistry: nextTabRegistry,
        sourceLastUrls: nextSourceLastUrls,
      });

      if (closedCount > 0) {
        await addLog(`流程完成：已关闭 ${closedCount} 个支付相关标签页。`, 'info');
      }
    }

    function firstNonEmpty(...values) {
      for (const value of values) {
        const normalized = normalizeString(value);
        if (normalized) {
          return normalized;
        }
      }
      return '';
    }

    function collectSessionFieldValues(root, targetKeys = []) {
      const normalizedTargets = new Set((Array.isArray(targetKeys) ? targetKeys : []).map((key) => normalizeString(key).toLowerCase()));
      if (!normalizedTargets.size || !root || typeof root !== 'object') {
        return [];
      }

      const results = [];
      const queue = [{ value: root, path: '$' }];
      const visited = new Set();
      while (queue.length && results.length < 32) {
        const current = queue.shift();
        const value = current?.value;
        if (!value || typeof value !== 'object') {
          continue;
        }
        if (visited.has(value)) {
          continue;
        }
        visited.add(value);

        const entries = Array.isArray(value)
          ? value.map((entry, index) => [String(index), entry])
          : Object.entries(value);
        for (const [key, entryValue] of entries) {
          const normalizedKey = normalizeString(key).toLowerCase();
          const path = `${current.path}.${key}`;
          if (normalizedTargets.has(normalizedKey)) {
            results.push({ key: normalizedKey, path, value: entryValue });
          }
          if (entryValue && typeof entryValue === 'object') {
            queue.push({ value: entryValue, path });
          }
        }
      }
      return results;
    }

    function normalizePlanType(value = '') {
      return normalizeString(value)
        .toLowerCase()
        .replace(/\s+/g, '_');
    }

    function isPaidPlanType(value = '') {
      const normalized = normalizePlanType(value);
      if (!normalized) {
        return false;
      }
      return !/(^|[_-])(free|guest|basic|default|none|null|unknown)([_-]|$)/i.test(normalized);
    }

    function inspectPlusActivationFromSession(session = null) {
      const planSignals = collectSessionFieldValues(session, [
        'planType',
        'plan_type',
        'chatgpt_plan_type',
      ]);
      const booleanSignals = collectSessionFieldValues(session, [
        'isPaid',
        'is_paid',
        'hasActiveSubscription',
        'has_active_subscription',
        'subscriptionActive',
        'subscription_active',
        'isSubscribed',
        'is_subscribed',
      ]);
      const planType = firstNonEmpty(
        ...planSignals.map((entry) => typeof entry?.value === 'string' ? entry.value : ''),
        session?.account?.planType,
        session?.account?.plan_type,
        session?.planType,
        session?.plan_type
      );
      const paidSignal = booleanSignals.some((entry) => entry?.value === true);
      return {
        active: paidSignal || isPaidPlanType(planType),
        paidSignal,
        planType,
        planSignalPath: normalizeString(planSignals[0]?.path || ''),
      };
    }

    async function openChatGptTabForPayPalGenericErrorCheck() {
      const chromeApi = typeof chrome !== 'undefined' ? chrome : globalThis.chrome;
      if (!chromeApi?.tabs?.create) {
        throw new Error('当前环境不支持打开 ChatGPT 标签页。');
      }
      const tab = await chromeApi.tabs.create({ url: PAYPAL_GENERIC_ERROR_CHECK_URL, active: true });
      const tabId = Number(tab?.id) || 0;
      if (!tabId) {
        throw new Error('打开 ChatGPT 页面失败，无法检查 PLUS 状态。');
      }
      if (typeof registerTab === 'function') {
        await registerTab(PLUS_CHECKOUT_SOURCE, tabId);
      }
      return tabId;
    }

    async function readChatGptSessionForPayPalGenericErrorCheck(tabId) {
      if (typeof ensureContentScriptReadyOnTabUntilStopped !== 'function' || typeof sendTabMessageUntilStopped !== 'function') {
        throw new Error('缺少 ChatGPT 会话检测依赖，无法检查 PLUS 状态。');
      }
      await waitForTabCompleteUntilStopped(tabId, {
        timeoutMs: 60000,
        retryDelayMs: 300,
      });
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
        inject: PLUS_CHECKOUT_INJECT_FILES,
        injectSource: PLUS_CHECKOUT_SOURCE,
        timeoutMs: 45000,
        retryDelayMs: 700,
        logMessage: '步骤 6：正在等待 ChatGPT 页面完成加载，以检查 PLUS 状态...',
      });
      const sessionResult = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
        type: 'PLUS_CHECKOUT_GET_STATE',
        source: 'background',
        payload: {
          includeSession: true,
          includeAccessToken: true,
        },
      }, {
        timeoutMs: 30000,
        responseTimeoutMs: 15000,
        retryDelayMs: 300,
      });
      if (sessionResult?.error) {
        throw new Error(sessionResult.error);
      }
      return sessionResult || {};
    }

    async function refreshChatGptSessionAndInspectPlusActivation() {
      const chromeApi = typeof chrome !== 'undefined' ? chrome : globalThis.chrome;
      const tabId = await openChatGptTabForPayPalGenericErrorCheck();
      if (typeof setState === 'function') {
        await setState({ plusCheckoutTabId: tabId });
      }
      await waitForTabCompleteUntilStopped(tabId, {
        timeoutMs: 60000,
        retryDelayMs: 300,
      });
      await addLog('步骤 6：已打开 ChatGPT，等待 5 秒后刷新会话并检查 PLUS 状态。', 'info');
      await sleepWithStop(PAYPAL_GENERIC_ERROR_SESSION_SETTLE_WAIT_MS);
      if (chromeApi?.tabs?.reload) {
        await chromeApi.tabs.reload(tabId).catch(() => {});
      }
      const sessionResult = await readChatGptSessionForPayPalGenericErrorCheck(tabId);
      const session = sessionResult?.session && typeof sessionResult.session === 'object' ? sessionResult.session : null;
      return {
        tabId,
        session,
        accessToken: normalizeString(sessionResult?.accessToken || session?.accessToken),
        ...inspectPlusActivationFromSession(session),
      };
    }

    function shouldAutoContinueManualNode(nodeId, state = {}) {
      const normalizedNodeId = String(nodeId || '').trim();
      if (normalizedNodeId !== 'plus-checkout-create') {
        return false;
      }
      return normalizePlusPaymentMethod(state?.plusPaymentMethod) === 'paypal';
    }

    async function executeNodeForManualChain(nodeId) {
      const executionState = await getState();
      if (doesNodeUseCompletionSignal(nodeId, executionState)) {
        await executeNodeViaCompletionSignal(nodeId);
      } else {
        await executeNode(nodeId);
      }
    }

    async function normalizeNodeProtocolMessage(message = {}) {
      const type = String(message?.type || '').trim();
      const nodeProtocolTypes = new Set([
        'EXECUTE_NODE',
        'NODE_COMPLETE',
        'NODE_ERROR',
        'SKIP_NODE',
      ]);
      if (!nodeProtocolTypes.has(type)) {
        return message;
      }

      const nodeId = String(message?.payload?.nodeId || message?.nodeId || '').trim();
      if (!nodeId) {
        throw new Error(`${type} 缺少 nodeId。`);
      }
      const state = await getState();
      const step = findStepByNodeId(nodeId, state);
      if (!step) {
        throw new Error(`当前 flow 中未找到节点：${nodeId}`);
      }

      const payload = {
        ...(message.payload || {}),
        nodeId,
        step,
      };
      return { ...message, nodeId, step, payload };
    }

    function isStaleAutoRunNodeMessage(nodeId, state = {}) {
      const normalizedNodeId = String(nodeId || '').trim();
      if (!normalizedNodeId) {
        return false;
      }
      if (typeof isAutoRunLockedState !== 'function' || !isAutoRunLockedState(state)) {
        return false;
      }
      const currentStatus = String(state?.nodeStatuses?.[normalizedNodeId] || '').trim();
      if (currentStatus === 'running') {
        return false;
      }
      const currentNodeId = String(state?.currentNodeId || '').trim();
      if (currentNodeId && normalizedNodeId !== currentNodeId) {
        return true;
      }
      return ['completed', 'manual_completed', 'skipped', 'failed', 'stopped'].includes(currentStatus);
    }

    function resolveSignupPhonePayload(payload = {}) {
      const directPhone = String(
        payload?.signupPhoneNumber
        || payload?.phoneNumber
        || ''
      ).trim();
      if (directPhone) {
        return directPhone;
      }
      return String(payload?.accountIdentifierType || '').trim().toLowerCase() === 'phone'
        ? String(payload?.accountIdentifier || '').trim()
        : '';
    }

    function resolveEmailIdentityPayload(payload = {}) {
      const directEmail = String(payload?.email || '').trim();
      if (directEmail) {
        return directEmail;
      }
      return String(payload?.accountIdentifierType || '').trim().toLowerCase() === 'email'
        ? String(payload?.accountIdentifier || '').trim()
        : '';
    }

    function hasPhoneSignupIdentity(state = {}) {
      const identifierType = String(state?.accountIdentifierType || '').trim().toLowerCase();
      return Boolean(
        String(state?.signupPhoneNumber || '').trim()
        || (identifierType === 'phone' && String(state?.accountIdentifier || '').trim())
        || state?.signupPhoneActivation
        || state?.signupPhoneCompletedActivation
      );
    }

    function shouldPreservePhoneIdentityForEmailPayload(payload = {}, state = {}) {
      const identifierType = String(payload?.accountIdentifierType || '').trim().toLowerCase();
      if (identifierType === 'email') {
        return false;
      }
      return hasPhoneSignupIdentity(state);
    }

    async function persistEmailIdentityFromStepPayload(email, payload = {}, source = 'step_payload') {
      if (!email) {
        return;
      }
      const state = await getState();
      const preserveAccountIdentity = shouldPreservePhoneIdentityForEmailPayload(payload, state);
      if (preserveAccountIdentity && typeof persistRegistrationEmailState === 'function') {
        await persistRegistrationEmailState(state, email, {
          source,
          preserveAccountIdentity: true,
        });
        return;
      }
      await setEmailState(email, preserveAccountIdentity
        ? { source, preserveAccountIdentity: true }
        : { source });
    }

    function normalizeAutomationWindowId(value) {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const numeric = Number(value);
      return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
    }

    function resolveAutomationWindowIdFromMessage(message = {}, sender = {}) {
      return normalizeAutomationWindowId(
        message?.payload?.automationWindowId
        ?? message?.payload?.windowId
        ?? message?.automationWindowId
        ?? message?.windowId
        ?? sender?.tab?.windowId
        ?? null
      );
    }

    async function lockAutomationWindowFromMessage(message = {}, sender = {}) {
      const windowId = resolveAutomationWindowIdFromMessage(message, sender);
      if (windowId === null) {
        return null;
      }
      await setState({ automationWindowId: windowId });
      return windowId;
    }

    async function syncStepAccountIdentityFromPayload(payload = {}) {
      const identifierType = String(payload?.accountIdentifierType || '').trim().toLowerCase();
      const signupPhoneNumber = resolveSignupPhonePayload(payload);
      if (identifierType === 'phone' || signupPhoneNumber) {
        if (signupPhoneNumber) {
          await setSignupPhoneStateSilently(signupPhoneNumber);
        }
        const updates = {};
        if (Object.prototype.hasOwnProperty.call(payload, 'signupPhoneActivation')) {
          updates.signupPhoneActivation = payload.signupPhoneActivation || null;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'signupPhoneCompletedActivation')) {
          updates.signupPhoneCompletedActivation = payload.signupPhoneCompletedActivation || null;
        }
        if (Object.keys(updates).length) {
          await setState(updates);
          broadcastDataUpdate(updates);
        }
        return;
      }

      const email = resolveEmailIdentityPayload(payload);
      if (identifierType === 'email' || email) {
        if (email) {
          await persistEmailIdentityFromStepPayload(email, payload, 'step_identity');
        }
        if (email) {
          return;
        }
        const updates = {
          phoneNumber: '',
          signupPhoneNumber: '',
          signupPhoneActivation: null,
          signupPhoneCompletedActivation: null,
          signupPhoneVerificationRequestedAt: null,
          signupPhoneVerificationPurpose: '',
          ...(email ? {
            accountIdentifierType: 'email',
            accountIdentifier: email,
          } : {}),
        };
        await setSignupPhoneStateSilently(null);
        await setState(updates);
        broadcastDataUpdate(updates);
      }
    }

    function isStepProtectedFromAutoSkip(status) {
      return status === 'running'
        || status === 'completed'
        || status === 'manual_completed'
        || status === 'skipped';
    }

    function findStepByKeyAfter(currentOrder, targetKey, state = {}) {
      const activeStepIds = typeof getStepIdsForState === 'function'
        ? getStepIdsForState(state)
        : [];
      const candidates = activeStepIds.length ? activeStepIds : [Number(currentOrder) + 1, 8];
      return candidates.find((stepId) => {
        const numericStep = Number(stepId);
        if (!Number.isFinite(numericStep) || numericStep <= Number(currentOrder)) {
          return false;
        }
        const stepKey = getStepKeyForState(numericStep, state);
        if (stepKey) {
          return stepKey === targetKey;
        }
        return targetKey === 'fetch-login-code' && Number(currentOrder) === 7 && numericStep === 8;
      }) || null;
    }

    function getNodeStatusByStep(step, state = {}) {
      const nodeId = getStepKeyForState(step, state);
      return nodeId ? (state.nodeStatuses?.[nodeId] || 'pending') : 'pending';
    }

    async function setNodeStatusByStep(step, status, state = {}) {
      const nodeId = getStepKeyForState(step, state);
      if (!nodeId) {
        throw new Error(`未找到步骤 ${step} 对应节点。`);
      }
      await setNodeStatus(nodeId, status);
      return nodeId;
    }

    function normalizePlusPaymentMethodForDisplay(value = '') {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized === 'gpc-helper') {
        return 'gpc-helper';
      }
      return normalized === 'gopay' ? 'gopay' : 'paypal';
    }

    function getPlusPaymentMethodLabel(value = '') {
      const method = normalizePlusPaymentMethodForDisplay(value);
      if (method === 'gpc-helper') {
        return 'GPC';
      }
      return method === 'gopay' ? 'GoPay' : 'PayPal';
    }

    function shouldDeferHotmailUsedMarkForPhoneSignup(state = {}) {
      return Boolean(isHotmailProvider?.(state)) && resolveSignupMethod(state) === 'phone';
    }

    async function handlePlatformVerifyStepData(payload) {
      if (payload.localhostUrl) {
        await closeLocalhostCallbackTabs(payload.localhostUrl);
      }
      await cleanupPaymentTabsAfterSuccessfulFlow();
      const latestState = await getState();
      if (typeof markCurrentRegistrationAccountUsed === 'function') {
        await markCurrentRegistrationAccountUsed(latestState, {
          logPrefix: '流程完成',
          level: 'ok',
        });
      } else if (latestState.currentHotmailAccountId && isHotmailProvider(latestState)) {
        await patchHotmailAccount(latestState.currentHotmailAccountId, {
          used: true,
          lastUsedAt: Date.now(),
        });
        await addLog('当前 Hotmail 账号已自动标记为已用。', 'ok');
      }
      if (typeof markCurrentRegistrationAccountUsed !== 'function' && String(latestState.mailProvider || '').trim().toLowerCase() === '2925' && latestState.currentMail2925AccountId) {
        await patchMail2925Account(latestState.currentMail2925AccountId, {
          lastUsedAt: Date.now(),
          lastError: '',
        });
        await addLog('当前 2925 账号已记录最近使用时间。', 'ok');
      }
      if (typeof markCurrentRegistrationAccountUsed !== 'function' && isLuckmailProvider(latestState)) {
        const currentPurchase = getCurrentLuckmailPurchase(latestState);
        if (currentPurchase?.id) {
          await setLuckmailPurchaseUsedState(currentPurchase.id, true);
          await addLog(`当前 LuckMail 邮箱 ${currentPurchase.email_address} 已在本地标记为已用。`, 'ok');
        }
        await clearLuckmailRuntimeState({ clearEmail: true });
        await addLog('当前 LuckMail 邮箱运行态已清空，下轮将优先复用未用邮箱或重新购买邮箱。', 'ok');
      }
      const localhostPrefix = buildLocalhostCleanupPrefix(payload.localhostUrl);
      if (localhostPrefix) {
        await closeTabsByUrlPrefix(localhostPrefix, {
          excludeUrls: [payload.localhostUrl],
          excludeLocalhostCallbacks: true,
        });
      }
      if (typeof markCurrentRegistrationAccountUsed !== 'function') {
        await finalizeIcloudAliasAfterSuccessfulFlow(latestState);
      }
      if (typeof finalizePhoneActivationAfterSuccessfulFlow === 'function') {
        await finalizePhoneActivationAfterSuccessfulFlow(latestState);
      }
    }

    async function handleStepData(step, payload) {
      if (step === 1) {
        const updates = {};
        if (payload.oauthUrl) {
          updates.oauthUrl = payload.oauthUrl;
          broadcastDataUpdate({ oauthUrl: payload.oauthUrl });
        }
        if (payload.localCpaJsonOAuthState !== undefined) updates.localCpaJsonOAuthState = payload.localCpaJsonOAuthState || null;
        if (payload.localCpaJsonPkceCodes !== undefined) updates.localCpaJsonPkceCodes = payload.localCpaJsonPkceCodes || null;
        if (payload.sub2apiSessionId !== undefined) updates.sub2apiSessionId = payload.sub2apiSessionId || null;
        if (payload.sub2apiOAuthState !== undefined) updates.sub2apiOAuthState = payload.sub2apiOAuthState || null;
        if (payload.sub2apiGroupId !== undefined) updates.sub2apiGroupId = payload.sub2apiGroupId || null;
        if (payload.sub2apiGroupIds !== undefined) updates.sub2apiGroupIds = Array.isArray(payload.sub2apiGroupIds)
          ? payload.sub2apiGroupIds
          : [];
        if (payload.sub2apiDraftName !== undefined) updates.sub2apiDraftName = payload.sub2apiDraftName || null;
        if (payload.sub2apiProxyId !== undefined) updates.sub2apiProxyId = payload.sub2apiProxyId || null;
        if (payload.cpaOAuthState !== undefined) updates.cpaOAuthState = payload.cpaOAuthState || null;
        if (payload.cpaManagementOrigin !== undefined) updates.cpaManagementOrigin = payload.cpaManagementOrigin || null;
        if (payload.codex2apiSessionId !== undefined) updates.codex2apiSessionId = payload.codex2apiSessionId || null;
        if (payload.codex2apiOAuthState !== undefined) updates.codex2apiOAuthState = payload.codex2apiOAuthState || null;
        if (Object.keys(updates).length) {
          await setState(updates);
        }
        return;
      }

      const stateForStep = await getState();
      const stepKey = getStepKeyForState(step, stateForStep);
      const isLastNode = Boolean(stepKey) && stepKey === getLastNodeIdForState(stateForStep);

      if (stepKey === 'fill-profile') {
        const latestState = await getState();
        if (
          latestState.currentHotmailAccountId
          && isHotmailProvider(latestState)
          && !shouldDeferHotmailUsedMarkForPhoneSignup(latestState)
        ) {
          if (typeof markCurrentRegistrationAccountUsed === 'function') {
            await markCurrentRegistrationAccountUsed(latestState, {
              logPrefix: '步骤 5 完成',
              level: 'ok',
            });
          } else {
            await patchHotmailAccount(latestState.currentHotmailAccountId, {
              used: true,
              lastUsedAt: Date.now(),
            });
            await addLog('步骤 5 完成：当前 Hotmail 账号已标记为已用。', 'ok');
          }
        }
      }

      if (stepKey === 'oauth-login' || stepKey === 'relogin-bound-email') {
        if (stepKey === 'oauth-login') {
          await syncStepAccountIdentityFromPayload(payload);
        }
        if (payload.skipLoginVerificationStep) {
          await setState({ loginVerificationRequestedAt: null });
          const latestState = await getState();
          const loginCodeStep = findStepByKeyAfter(
            step,
            stepKey === 'relogin-bound-email' ? 'fetch-bound-email-login-code' : 'fetch-login-code',
            latestState
          );
          if (loginCodeStep) {
            const currentStatus = getNodeStatusByStep(loginCodeStep, latestState);
            if (!isStepProtectedFromAutoSkip(currentStatus)) {
              await setNodeStatusByStep(loginCodeStep, 'skipped', latestState);
              await addLog(`认证页已直接进入 OAuth 授权页，已自动跳过步骤 ${loginCodeStep} 的登录验证码。`, 'warn', {
                step,
                stepKey: 'oauth-login',
              });
            }
          }
        } else if (payload.loginVerificationRequestedAt) {
          await setState({ loginVerificationRequestedAt: payload.loginVerificationRequestedAt });
        }
        return;
      }

      if (stepKey === 'fetch-login-code' || stepKey === 'fetch-bound-email-login-code') {
        await setState({
          ...(payload.phoneVerification || payload.loginPhoneVerification ? {
            currentPhoneVerificationCode: '',
            signupPhoneVerificationRequestedAt: null,
            signupPhoneVerificationPurpose: '',
          } : {
            lastEmailTimestamp: payload.emailTimestamp || null,
          }),
          loginVerificationRequestedAt: null,
        });
        return;
      }

      if (stepKey === 'post-login-phone-verification' || stepKey === 'post-bound-email-phone-verification') {
        await setState({
          currentPhoneVerificationCode: '',
          signupPhoneVerificationRequestedAt: null,
          signupPhoneVerificationPurpose: '',
        });
        return;
      }

      if (stepKey === 'bind-email') {
        const updates = {};
        if (payload.bindEmailSubmitted !== undefined) {
          updates.bindEmailSubmitted = Boolean(payload.bindEmailSubmitted);
        }
        if (payload.email !== undefined) {
          updates.email = payload.email || null;
        }
        if (payload.step8VerificationTargetEmail !== undefined) {
          updates.step8VerificationTargetEmail = payload.step8VerificationTargetEmail || '';
        }
        if (Object.keys(updates).length) {
          await setState(updates);
        }
        return;
      }

      if (stepKey === 'fetch-bind-email-code') {
        await setState({
          lastEmailTimestamp: payload.emailTimestamp || null,
          loginVerificationRequestedAt: null,
          step8VerificationTargetEmail: '',
          bindEmailSubmitted: false,
        });
        return;
      }

      if (stepKey === 'confirm-oauth') {
        if (payload.localhostUrl) {
          if (!isLocalhostOAuthCallbackUrl(payload.localhostUrl)) {
            throw new Error(`步骤 ${step} 返回了无效的 localhost OAuth 回调地址。`);
          }
          await setState({ localhostUrl: payload.localhostUrl });
          broadcastDataUpdate({ localhostUrl: payload.localhostUrl });
        }
        return;
      }

      if (stepKey === 'platform-verify') {
        await handlePlatformVerifyStepData(payload);
        return;
      }

      if (stepKey === 'plus-checkout-create') {
        const latestState = await getState();
        if (getLastNodeIdForState(latestState) === 'plus-checkout-create') {
          await handlePlatformVerifyStepData(payload);
        }
        return;
      }

      if (isLastNode) {
        await cleanupPaymentTabsAfterSuccessfulFlow();
      }

      switch (step) {
        case 1: {
          const updates = {};
          if (payload.oauthUrl) {
            updates.oauthUrl = payload.oauthUrl;
            broadcastDataUpdate({ oauthUrl: payload.oauthUrl });
          }
          if (payload.localCpaJsonOAuthState !== undefined) updates.localCpaJsonOAuthState = payload.localCpaJsonOAuthState || null;
          if (payload.localCpaJsonPkceCodes !== undefined) updates.localCpaJsonPkceCodes = payload.localCpaJsonPkceCodes || null;
          if (payload.sub2apiSessionId !== undefined) updates.sub2apiSessionId = payload.sub2apiSessionId || null;
          if (payload.sub2apiOAuthState !== undefined) updates.sub2apiOAuthState = payload.sub2apiOAuthState || null;
          if (payload.sub2apiGroupId !== undefined) updates.sub2apiGroupId = payload.sub2apiGroupId || null;
          if (payload.sub2apiGroupIds !== undefined) updates.sub2apiGroupIds = Array.isArray(payload.sub2apiGroupIds)
            ? payload.sub2apiGroupIds
            : [];
          if (payload.sub2apiDraftName !== undefined) updates.sub2apiDraftName = payload.sub2apiDraftName || null;
          if (payload.sub2apiProxyId !== undefined) updates.sub2apiProxyId = payload.sub2apiProxyId || null;
          if (payload.cpaOAuthState !== undefined) updates.cpaOAuthState = payload.cpaOAuthState || null;
          if (payload.cpaManagementOrigin !== undefined) updates.cpaManagementOrigin = payload.cpaManagementOrigin || null;
          if (payload.codex2apiSessionId !== undefined) updates.codex2apiSessionId = payload.codex2apiSessionId || null;
          if (payload.codex2apiOAuthState !== undefined) updates.codex2apiOAuthState = payload.codex2apiOAuthState || null;
          if (Object.keys(updates).length) {
            await setState(updates);
          }
          break;
        }
        case 2:
          await syncStepAccountIdentityFromPayload(payload);
          if (payload.skipRegistrationFlow) {
            const latestState = await getState();
            for (const skippedStep of [3, 4, 5]) {
              const status = getNodeStatusByStep(skippedStep, latestState);
              if (status === 'running' || status === 'completed' || status === 'manual_completed') {
                continue;
              }
              await setNodeStatusByStep(skippedStep, 'skipped', latestState);
            }
            await addLog('步骤 2：检测到当前已登录会话，已自动跳过步骤 3/4/5，流程将直接进入步骤 6。', 'warn');
            break;
          }
          if (payload.skippedPasswordStep) {
            const latestState = await getState();
            const step3Status = getNodeStatusByStep(3, latestState);
            if (step3Status !== 'running' && step3Status !== 'completed' && step3Status !== 'manual_completed') {
              await setNodeStatusByStep(3, 'skipped', latestState);
              const identityLabel = payload.accountIdentifierType === 'phone' ? '手机号' : '邮箱';
              await addLog(`步骤 2：提交${identityLabel}后页面直接进入验证码页，已自动跳过步骤 3。`, 'warn');
            }
          }
          break;
        case 3:
          await syncStepAccountIdentityFromPayload(payload);
          if (payload.signupVerificationRequestedAt) {
            await setState({ signupVerificationRequestedAt: payload.signupVerificationRequestedAt });
          }
          if (payload.skipProfileStep) {
            const latestState = await getState();
            const step5Status = getNodeStatusByStep(5, latestState);
            if (step5Status !== 'running' && step5Status !== 'completed' && step5Status !== 'manual_completed') {
              await setNodeStatusByStep(5, 'skipped', latestState);
              if (
                typeof markCurrentRegistrationAccountUsed === 'function'
                && !shouldDeferHotmailUsedMarkForPhoneSignup(latestState)
              ) {
                await markCurrentRegistrationAccountUsed(latestState, {
                  logPrefix: '步骤 3 跳过步骤 5',
                  level: 'ok',
                });
              }
              await addLog('步骤 3：页面已直接进入已登录态，已自动跳过步骤 5。', 'warn');
            }
          }
          if (payload.loginVerificationRequestedAt) {
            await setState({ loginVerificationRequestedAt: payload.loginVerificationRequestedAt });
          }
          break;
        case 4:
          await setState({
            ...(payload.phoneVerification ? {
              currentPhoneVerificationCode: '',
              signupPhoneVerificationRequestedAt: null,
              signupPhoneVerificationPurpose: '',
            } : {
              lastEmailTimestamp: payload.emailTimestamp || null,
            }),
            signupVerificationRequestedAt: null,
          });
          if (payload.skipProfileStep) {
            const latestState = await getState();
            const step5Status = getNodeStatusByStep(5, latestState);
            if (step5Status !== 'running' && step5Status !== 'completed' && step5Status !== 'manual_completed') {
              await setNodeStatusByStep(5, 'skipped', latestState);
              if (
                typeof markCurrentRegistrationAccountUsed === 'function'
                && !shouldDeferHotmailUsedMarkForPhoneSignup(latestState)
              ) {
                await markCurrentRegistrationAccountUsed(latestState, {
                  logPrefix: '步骤 4 跳过步骤 5',
                  level: 'ok',
                });
              }
              if (payload.skipProfileStepReason === 'combined_verification_profile') {
                await addLog('步骤 4：当前验证码页已内嵌完成注册资料提交，已自动跳过步骤 5。', 'warn');
              } else {
                await addLog('步骤 4：检测到账号已直接进入已登录态，已自动跳过步骤 5。', 'warn');
              }
            }
          }
          break;
        case 7:
          await syncStepAccountIdentityFromPayload(payload);
          if (payload.loginVerificationRequestedAt) {
            await setState({
              loginVerificationRequestedAt: payload.loginVerificationRequestedAt,
              lastLoginCode: null,
            });
            broadcastDataUpdate({ lastLoginCode: null });
          }
          break;
        case 8:
          {
            const step8StateUpdates = {
              ...(payload.phoneVerification || payload.loginPhoneVerification ? {
                currentPhoneVerificationCode: '',
                signupPhoneVerificationRequestedAt: null,
                signupPhoneVerificationPurpose: '',
              } : {
                lastEmailTimestamp: payload.emailTimestamp || null,
                ...(Object.prototype.hasOwnProperty.call(payload, 'code') ? {
                  lastLoginCode: payload.code || null,
                } : {}),
              }),
              loginVerificationRequestedAt: null,
            };
            await setState(step8StateUpdates);
            if (Object.prototype.hasOwnProperty.call(step8StateUpdates, 'lastLoginCode')) {
              broadcastDataUpdate({ lastLoginCode: step8StateUpdates.lastLoginCode });
            }
          }
          break;
        case 9:
          if (payload.localhostUrl) {
            if (!isLocalhostOAuthCallbackUrl(payload.localhostUrl)) {
              throw new Error('步骤 9 返回了无效的 localhost OAuth 回调地址。');
            }
            await setState({ localhostUrl: payload.localhostUrl });
            broadcastDataUpdate({ localhostUrl: payload.localhostUrl });
          }
          break;
        default:
          break;
      }
    }

    async function handleMessage(rawMessage, sender) {
      const message = await normalizeNodeProtocolMessage(rawMessage);
      switch (message.type) {
        case 'CONTENT_SCRIPT_READY': {
          const tabId = sender.tab?.id;
          if (tabId && message.source) {
            await registerTab(message.source, tabId);
            flushCommand(message.source, tabId);
            await addLog(`内容脚本已就绪：${getSourceLabel(message.source)}（标签页 ${tabId}）`);
          }
          return { ok: true };
        }

        case 'LOG': {
          const { message: msg, level, step: payloadStep, stepKey } = message.payload;
          const logStep = Math.floor(Number(message.step || payloadStep) || 0);
          await addLog(
            `[${getSourceLabel(message.source)}] ${msg}`,
            level,
            {
              step: logStep > 0 ? logStep : null,
              stepKey,
            }
          );
          return { ok: true };
        }

        case 'NODE_COMPLETE': {
          const currentStateForNode = await getState();
          const nodeId = String(message.nodeId || message.payload?.nodeId || '').trim();
          const resolvedStep = findStepByNodeId(nodeId, currentStateForNode);
          if (!nodeId || !resolvedStep) {
            throw new Error('NODE_COMPLETE 缺少 nodeId。');
          }
          const currentState = await getState();
          if (isStaleAutoRunNodeMessage(nodeId, currentState)) {
            await addLog(
              `自动运行：忽略过期的节点 ${nodeId} 完成消息，当前流程已在节点 ${currentState.currentNodeId || '未知'}。`,
              'warn',
              { nodeId }
            );
            return { ok: true, ignored: true };
          }
          if (getStopRequested()) {
            await setNodeStatus(nodeId, 'stopped');
            await appendManualAccountRunRecordIfNeeded(`node:${nodeId}:stopped`, null, '流程已被用户停止。');
            notifyNodeError(nodeId, '流程已被用户停止。');
            return { ok: true };
          }
          try {
            if (nodeId === 'fill-password' && typeof finalizeStep3Completion === 'function') {
              await finalizeStep3Completion(message.payload || {});
            }
          } catch (error) {
            if (typeof isCloudflareSecurityBlockedError === 'function' && isCloudflareSecurityBlockedError(error)) {
              const userMessage = typeof handleCloudflareSecurityBlocked === 'function'
                ? await handleCloudflareSecurityBlocked(error)
                : (error?.message || String(error || ''));
              notifyNodeError(nodeId, '流程已被用户停止。');
              return { ok: true, error: userMessage };
            }
            const errorMessage = error?.message || String(error || '步骤 3 提交后确认失败');
            await setNodeStatus(nodeId, 'failed');
            await addLog(`失败：${errorMessage}`, 'error', {
              nodeId,
            });
            await appendManualAccountRunRecordIfNeeded(`node:${nodeId}:failed`, null, errorMessage);
            notifyNodeError(nodeId, errorMessage);
            return { ok: true, error: errorMessage };
          }

          const completionStateCandidate = await getState();
          const nodeIds = typeof getNodeIdsForState === 'function' ? getNodeIdsForState(completionStateCandidate) : [];
          const lastNodeId = nodeIds[nodeIds.length - 1] || '';
          const isFinalNode = nodeId === lastNodeId;
          const completionState = isFinalNode ? completionStateCandidate : null;
          await setNodeStatus(nodeId, 'completed');
          await addLog('已完成', 'ok', { nodeId });
          await handleStepData(resolvedStep, message.payload);
          if (isFinalNode && typeof appendAccountRunRecord === 'function') {
            await appendAccountRunRecord('success', completionState);
          }
          notifyNodeComplete(nodeId, message.payload);
          return { ok: true };
        }

        case 'NODE_ERROR': {
          const stateForNode = await getState();
          const nodeId = String(message.nodeId || message.payload?.nodeId || '').trim();
          const resolvedStep = findStepByNodeId(nodeId, stateForNode);
          if (!nodeId || !resolvedStep) {
            throw new Error('NODE_ERROR 缺少 nodeId。');
          }
          const staleCheckState = await getState();
          if (isStaleAutoRunNodeMessage(nodeId, staleCheckState)) {
            await addLog(
              `自动运行：忽略过期的节点 ${nodeId} 失败消息，当前流程已在节点 ${staleCheckState.currentNodeId || '未知'}。原始错误：${message.error || '未知错误'}`,
              'warn',
              { nodeId }
            );
            return { ok: true, ignored: true };
          }
          if (typeof isCloudflareSecurityBlockedError === 'function' && isCloudflareSecurityBlockedError(message.error)) {
            const userMessage = typeof handleCloudflareSecurityBlocked === 'function'
              ? await handleCloudflareSecurityBlocked(message.error)
              : (typeof message.error === 'string' ? message.error : String(message.error || ''));
            notifyNodeError(nodeId, '流程已被用户停止。');
            return { ok: true, error: userMessage };
          }
          const currentState = await getState();
          const currentNodeStatus = currentState?.nodeStatuses?.[nodeId] || '';
          const isSignupPhonePasswordMismatch = /SIGNUP_PHONE_PASSWORD_MISMATCH::/i.test(String(message.error || ''));
          if (isStopError(message.error)) {
            await setNodeStatus(nodeId, 'stopped');
            await addLog('已被用户停止', 'warn', { nodeId });
            await appendManualAccountRunRecordIfNeeded(`node:${nodeId}:stopped`, null, message.error);
            notifyNodeError(nodeId, message.error);
          } else {
            if (!(isSignupPhonePasswordMismatch && currentNodeStatus === 'failed')) {
              await setNodeStatus(nodeId, 'failed');
              await addLog(`失败：${message.error}`, 'error', {
                nodeId,
              });
              await appendManualAccountRunRecordIfNeeded(`node:${nodeId}:failed`, null, message.error);
            }
            notifyNodeError(nodeId, message.error);
          }
          return { ok: true };
        }

        case 'RESOLVE_PLUS_MANUAL_CONFIRMATION': {
          const currentState = await getState();
          const step = Number(message.payload?.step) || Number(currentState?.plusManualConfirmationStep) || 0;
          const confirmationNodeId = getStepKeyForState(step, currentState) || String(currentState?.currentNodeId || '').trim();
          const confirmed = Boolean(message.payload?.confirmed);
          const requestId = String(message.payload?.requestId || '').trim();
          const currentRequestId = String(currentState?.plusManualConfirmationRequestId || '').trim();
          const method = String(currentState?.plusManualConfirmationMethod || '').trim().toLowerCase();
          const action = String(message.payload?.action || '').trim().toLowerCase();
          const isGpcOtp = method === 'gopay-otp';
          const isPayPalHostedGenericError = method === 'paypal-hosted-generic-error';
          if (!currentState?.plusManualConfirmationPending) {
            return { ok: true, ignored: true };
          }
          if (requestId && currentRequestId && requestId !== currentRequestId) {
            return { ok: true, ignored: true };
          }

          const clearManualConfirmationState = {
            plusManualConfirmationPending: false,
            plusManualConfirmationRequestId: '',
            plusManualConfirmationStep: 0,
            plusManualConfirmationMethod: '',
            plusManualConfirmationTitle: '',
            plusManualConfirmationMessage: '',
          };

          if (isPayPalHostedGenericError) {
            if (action === 'check' && confirmed) {
              let inspection = null;
              try {
                clearStopRequest?.();
                inspection = await refreshChatGptSessionAndInspectPlusActivation();
              } catch (error) {
                const reason = normalizeString(error?.message || error) || '未知错误';
                await addLog(`步骤 6：已按你的选择刷新 ChatGPT 会话，但检查 PLUS 状态失败：${reason}`, 'warn');
                return { ok: true, plusActive: false, checkError: reason };
              }

              if (!inspection?.active) {
                const planSuffix = inspection?.planType ? `（planType=${inspection.planType}）` : '';
                await addLog(`步骤 6：已按你的选择刷新 ChatGPT 会话，但暂未检测到 PLUS 已生效${planSuffix}。`, 'warn');
                return { ok: true, plusActive: false, planType: inspection?.planType || '' };
              }

              await setState(clearManualConfirmationState);
              if (typeof broadcastDataUpdate === 'function') {
                broadcastDataUpdate(clearManualConfirmationState);
              }

              const completedNodeId = confirmationNodeId || 'plus-checkout-create';
              const completedStep = findStepByNodeId(completedNodeId, currentState) || step || 6;
              if (typeof invalidateDownstreamAfterStepRestart === 'function') {
                await invalidateDownstreamAfterStepRestart(completedStep, {
                  logLabel: 'PayPal genericError 后检测到 PLUS 已生效',
                });
              }
              await addLog(`步骤 6：已检测到 PLUS 生效（planType=${inspection.planType || 'unknown'}），准备继续下一步。`, 'ok');
              await completeNodeFromBackground(completedNodeId, {
                plusDetectedPlanType: inspection.planType || '',
                plusCheckoutTabId: inspection.tabId,
              });
              const latestExecutionState = await getState();
              if (shouldAutoContinueManualNode(completedNodeId, latestExecutionState)) {
                const nextNodeId = getNextNodeIdForState(completedNodeId, latestExecutionState);
                if (nextNodeId) {
                  await addLog(`步骤 ${completedStep} 已完成，正在继续执行下一节点 ${nextNodeId}。`, 'info', {
                    step: completedStep,
                    nodeId: completedNodeId,
                  });
                  await executeNodeForManualChain(nextNodeId);
                }
              }
              return { ok: true, plusActive: true, planType: inspection.planType || '' };
            }

            await setState(clearManualConfirmationState);
            if (typeof broadcastDataUpdate === 'function') {
              broadcastDataUpdate(clearManualConfirmationState);
            }

            if (action === 'retry' && confirmed) {
              clearStopRequest?.();
              const retryNodeId = 'plus-checkout-create';
              const retryStep = findStepByNodeId(retryNodeId, currentState) || 6;
              await addLog('步骤 6：已按你的选择重新开始创建 Plus Checkout。', 'info');
              if (typeof invalidateDownstreamAfterStepRestart === 'function') {
                await invalidateDownstreamAfterStepRestart(retryStep, { logLabel: 'PayPal genericError 后重试 Plus Checkout' });
              }
              await executeNodeForManualChain(retryNodeId);
              const latestExecutionState = await getState();
              if (shouldAutoContinueManualNode(retryNodeId, latestExecutionState)) {
                const nextNodeId = getNextNodeIdForState(retryNodeId, latestExecutionState);
                if (nextNodeId) {
                  await addLog(`步骤 ${retryStep} 已完成，正在继续执行下一节点 ${nextNodeId}。`, 'info', {
                    step: retryStep,
                    nodeId: retryNodeId,
                  });
                  await executeNodeForManualChain(nextNodeId);
                }
              }
              return { ok: true };
            }

            const cancelMessage = '已取消 PayPal Checkout 异常处理';
            await addLog(`步骤 ${step || 6}：${cancelMessage}。`, 'warn');
            return { ok: true };
          }

          if (isGpcOtp && confirmed) {
            const otp = String(message.payload?.otp || message.payload?.code || '').trim().replace(/[^\d]/g, '');
            if (!otp) {
              throw new Error('请输入 GPC OTP 验证码。');
            }
            const otpUpdates = {
              ...clearManualConfirmationState,
              gopayHelperResolvedOtp: otp,
            };
            await setState(otpUpdates);
            if (typeof broadcastDataUpdate === 'function') {
              broadcastDataUpdate(otpUpdates);
            }
            await addLog(`步骤 ${step}：已收到 GPC OTP，准备提交验证。`, 'ok');
            return { ok: true };
          }

          await setState(clearManualConfirmationState);
          if (typeof broadcastDataUpdate === 'function') {
            broadcastDataUpdate(clearManualConfirmationState);
          }

          if (confirmed) {
            const methodLabel = method === 'gopay' ? 'GoPay' : '手动';
            await addLog(`步骤 ${step}：已确认${methodLabel}订阅完成，准备继续下一步。`, 'ok');
            await completeNodeFromBackground(confirmationNodeId, {
              plusManualConfirmationMethod: currentState?.plusManualConfirmationMethod || '',
              plusManualConfirmedAt: Date.now(),
            });
            return { ok: true };
          }

          const cancelMessage = method === 'gopay'
            ? '已取消 GoPay 订阅确认'
            : (isGpcOtp ? '已取消 GPC OTP 输入' : '已取消当前手动确认');
          await setNodeStatus(confirmationNodeId, 'failed');
          await addLog(`步骤 ${step}：${cancelMessage}。`, 'warn');
          await appendManualAccountRunRecordIfNeeded(
            confirmationNodeId ? `node:${confirmationNodeId}:failed` : 'failed',
            null,
            cancelMessage
          );
          notifyNodeError(confirmationNodeId, cancelMessage);
          return { ok: true };
        }

        case 'GET_STATE': {
          return await getState();
        }

        case 'EXPORT_CURRENT_SESSION_JSON': {
          if (typeof exportCurrentSessionJson !== 'function') {
            throw new Error('当前 SESSION JSON 导出能力未接入。');
          }
          return await exportCurrentSessionJson(message.payload || {});
        }

        case 'RESET': {
          clearStopRequest();
          await clearAutoRunTimerAlarm();
          await resetState();
          await addLog('流程已重置', 'info');
          return { ok: true };
        }

        case 'CLEAR_FREE_REUSABLE_PHONE': {
          if (typeof clearFreeReusablePhoneActivation !== 'function') {
            throw new Error('白嫖复用手机号清除能力未接入。');
          }
          return await clearFreeReusablePhoneActivation();
        }

        case 'SET_FREE_REUSABLE_PHONE': {
          if (typeof setFreeReusablePhoneActivation !== 'function') {
            throw new Error('白嫖复用手机号记录能力未接入。');
          }
          return await setFreeReusablePhoneActivation(message.payload || {});
        }

        case 'SET_CONTRIBUTION_MODE': {
          const enabled = Boolean(message.payload?.enabled);
          const state = await ensureManualInteractionAllowed(enabled ? '进入贡献模式' : '退出贡献模式');
          if (Object.values(state.nodeStatuses || {}).some((status) => status === 'running')) {
            throw new Error(enabled ? '当前有步骤正在执行，无法进入贡献模式。' : '当前有步骤正在执行，无法退出贡献模式。');
          }
          if (typeof setContributionMode !== 'function') {
            throw new Error('贡献模式切换能力未接入。');
          }
          return {
            ok: true,
            state: await setContributionMode(enabled),
          };
        }

        case 'START_CONTRIBUTION_FLOW': {
          const state = await ensureManualInteractionAllowed('开始贡献');
          if (Object.values(state.nodeStatuses || {}).some((status) => status === 'running')) {
            throw new Error('当前有步骤正在执行，无法开始贡献流程。');
          }
          if (typeof startContributionFlow !== 'function') {
            throw new Error('贡献 OAuth 流程尚未接入。');
          }
          return {
            ok: true,
            state: await startContributionFlow({
              nickname: message.payload?.nickname,
              qq: message.payload?.qq,
            }),
          };
        }

        case 'SET_CONTRIBUTION_PROFILE': {
          const state = await getState();
          if (!state?.contributionMode) {
            throw new Error('请先进入贡献模式。');
          }
          const nickname = String(message.payload?.nickname || '').trim();
          const qq = String(message.payload?.qq || '').trim();
          if (qq && !/^\d{1,20}$/.test(qq)) {
            throw new Error('QQ 只能填写数字，且长度不能超过 20 位。');
          }
          await setState({
            contributionNickname: nickname,
            contributionQq: qq,
          });
          return {
            ok: true,
            state: await getState(),
          };
        }

        case 'POLL_CONTRIBUTION_STATUS': {
          if (typeof pollContributionStatus !== 'function') {
            throw new Error('贡献状态轮询能力尚未接入。');
          }
          return {
            ok: true,
            state: await pollContributionStatus({
              reason: message.payload?.reason || 'sidepanel_poll',
            }),
          };
        }

        case 'CLEAR_ACCOUNT_RUN_HISTORY': {
          const state = await getState();
          if (isAutoRunLockedState(state)) {
            throw new Error('自动流程运行中，当前不能清理邮箱记录。');
          }
          if (typeof clearAccountRunHistory !== 'function') {
            return { ok: true, clearedCount: 0 };
          }
          const result = await clearAccountRunHistory(state);
          return { ok: true, ...result };
        }

        case 'DELETE_ACCOUNT_RUN_HISTORY_RECORDS': {
          const state = await getState();
          if (isAutoRunLockedState(state)) {
            throw new Error('自动流程运行中，当前不能删除邮箱记录。');
          }
          if (typeof deleteAccountRunHistoryRecords !== 'function') {
            return { ok: true, deletedCount: 0, remainingCount: 0 };
          }
          const recordIds = Array.isArray(message.payload?.recordIds) ? message.payload.recordIds : [];
          const result = await deleteAccountRunHistoryRecords(recordIds, state);
          return { ok: true, ...result };
        }

        case 'EXECUTE_NODE': {
          clearStopRequest();
          const requestState = await getState();
          const nodeId = String(message.nodeId || message.payload?.nodeId || '').trim();
          const resolvedStep = findStepByNodeId(nodeId, requestState);
          if (!nodeId || !resolvedStep) {
            throw new Error('EXECUTE_NODE 缺少 nodeId。');
          }
          if (message.source === 'sidepanel') {
            await lockAutomationWindowFromMessage(message, sender);
            await ensureManualInteractionAllowed('手动执行节点');
          }
          if (message.source === 'sidepanel') {
            await ensureManualStepPrerequisites(resolvedStep);
          }
          if (message.source === 'sidepanel') {
            await invalidateDownstreamAfterStepRestart(resolvedStep, { logLabel: `节点 ${nodeId} 重新执行` });
          }
          if (message.payload.email) {
            await setEmailState(message.payload.email);
          }
          if (message.payload.emailPrefix !== undefined) {
            await setPersistentSettings({ emailPrefix: message.payload.emailPrefix });
            await setState({ emailPrefix: message.payload.emailPrefix });
          }
          await executeNodeForManualChain(nodeId);

          const latestExecutionState = await getState();
          if (message.source === 'sidepanel' && shouldAutoContinueManualNode(nodeId, latestExecutionState)) {
            const nextNodeId = getNextNodeIdForState(nodeId, latestExecutionState);
            if (nextNodeId) {
              await addLog(
                `步骤 ${resolvedStep} 已完成，正在继续执行下一节点 ${nextNodeId}。`,
                'info',
                { step: resolvedStep, nodeId }
              );
              await executeNodeForManualChain(nextNodeId);
            }
          }
          return { ok: true };
        }

        case 'AUTO_RUN': {
          clearStopRequest();
          if (message.source === 'sidepanel') {
            await lockAutomationWindowFromMessage(message, sender);
          }
          if (Boolean(message.payload?.contributionMode) && typeof setContributionMode === 'function') {
            await setContributionMode(true);
            if (typeof setState === 'function') {
              const contributionNickname = String(message.payload?.contributionNickname || '').trim();
              const contributionQq = String(message.payload?.contributionQq || '').trim();
              await setState({
                contributionNickname,
                contributionQq,
              });
            }
          }
          const state = await getState();
          const autoRunStartValidation = validateAutoRunStart(state, { state });
          if (autoRunStartValidation?.ok === false) {
            throw new Error(autoRunStartValidation.errors?.[0]?.message || '当前设置不支持启动自动流程。');
          }
          if (getPendingAutoRunTimerPlan(state)) {
            throw new Error('已有自动运行倒计时计划，请先取消或立即开始。');
          }
          const totalRuns = normalizeRunCount(message.payload?.totalRuns || 1);
          const autoRunSkipFailures = Boolean(message.payload?.autoRunSkipFailures);
          const autoRunRetryNonFreeTrial = Boolean(message.payload?.autoRunRetryNonFreeTrial);
          const autoRunRetryPaypalCallback = Boolean(message.payload?.autoRunRetryPaypalCallback);
          const mode = message.payload?.mode === 'continue' ? 'continue' : 'restart';
          await setState({ autoRunSkipFailures, autoRunRetryNonFreeTrial, autoRunRetryPaypalCallback });
          startAutoRunLoop(totalRuns, { autoRunSkipFailures, autoRunRetryNonFreeTrial, autoRunRetryPaypalCallback, mode });
          return { ok: true };
        }

        case 'SCHEDULE_AUTO_RUN': {
          clearStopRequest();
          if (message.source === 'sidepanel') {
            await lockAutomationWindowFromMessage(message, sender);
          }
          if (Boolean(message.payload?.contributionMode) && typeof setContributionMode === 'function') {
            await setContributionMode(true);
            if (typeof setState === 'function') {
              const contributionNickname = String(message.payload?.contributionNickname || '').trim();
              const contributionQq = String(message.payload?.contributionQq || '').trim();
              await setState({
                contributionNickname,
                contributionQq,
              });
            }
          }
          const state = await getState();
          const autoRunStartValidation = validateAutoRunStart(state, { state });
          if (autoRunStartValidation?.ok === false) {
            throw new Error(autoRunStartValidation.errors?.[0]?.message || '当前设置不支持启动自动流程。');
          }
          const totalRuns = normalizeRunCount(message.payload?.totalRuns || 1);
          return await scheduleAutoRun(totalRuns, {
            delayMinutes: message.payload?.delayMinutes,
            autoRunSkipFailures: Boolean(message.payload?.autoRunSkipFailures),
            autoRunRetryNonFreeTrial: Boolean(message.payload?.autoRunRetryNonFreeTrial),
            autoRunRetryPaypalCallback: Boolean(message.payload?.autoRunRetryPaypalCallback),
            mode: message.payload?.mode,
          });
        }

        case 'START_SCHEDULED_AUTO_RUN_NOW': {
          clearStopRequest();
          if (message.source === 'sidepanel') {
            await lockAutomationWindowFromMessage(message, sender);
          }
          const started = await launchAutoRunTimerPlan('manual', {
            expectedKinds: [AUTO_RUN_TIMER_KIND_SCHEDULED_START],
          });
          if (!started) {
            throw new Error('当前没有可立即开始的倒计时计划。');
          }
          return { ok: true };
        }

        case 'CANCEL_SCHEDULED_AUTO_RUN': {
          const cancelled = await cancelScheduledAutoRun();
          if (!cancelled) {
            throw new Error('当前没有可取消的倒计时计划。');
          }
          return { ok: true };
        }

        case 'SKIP_AUTO_RUN_COUNTDOWN': {
          clearStopRequest();
          if (message.source === 'sidepanel') {
            await lockAutomationWindowFromMessage(message, sender);
          }
          const skipped = await skipAutoRunCountdown();
          if (!skipped) {
            throw new Error('当前没有可立即开始的倒计时。');
          }
          return { ok: true };
        }

        case 'RESUME_AUTO_RUN': {
          clearStopRequest();
          if (message.source === 'sidepanel') {
            await lockAutomationWindowFromMessage(message, sender);
          }
          if (message.payload.email) {
            await setEmailState(message.payload.email);
          }
          resumeAutoRun().catch((error) => {
            handleAutoRunLoopUnhandledError(error).catch(() => {});
          });
          return { ok: true };
        }

        case 'TAKEOVER_AUTO_RUN': {
          await requestStop({ logMessage: '已确认手动接管，正在停止自动流程并切换为手动控制...' });
          await addLog('自动流程已切换为手动控制。', 'warn');
          return { ok: true };
        }

        case 'SKIP_NODE': {
          const nodeId = String(message.nodeId || message.payload?.nodeId || '').trim();
          if (!nodeId) {
            throw new Error('SKIP_NODE 缺少 nodeId。');
          }
          return await skipNode(nodeId);
        }

        case 'SAVE_SETTING': {
          const currentState = await getState();
          const updates = buildPersistentSettingsPayload(message.payload || {});
          const sessionUpdates = buildLuckmailSessionSettingsPayload(message.payload || {});
          const modeValidation = validateModeSwitch({
            ...currentState,
            ...updates,
            resolvedSignupMethod: null,
          }, {
            changedKeys: Object.keys(updates),
          });
          if (modeValidation?.normalizedUpdates && Object.keys(modeValidation.normalizedUpdates).length > 0) {
            Object.assign(updates, modeValidation.normalizedUpdates);
          }
          const nextSignupState = {
            ...currentState,
            ...updates,
            resolvedSignupMethod: null,
          };
          if (
            Object.prototype.hasOwnProperty.call(updates, 'phoneVerificationEnabled')
            || Object.prototype.hasOwnProperty.call(updates, 'plusModeEnabled')
            || Object.prototype.hasOwnProperty.call(updates, 'signupMethod')
            || Object.prototype.hasOwnProperty.call(updates, 'panelMode')
            || Object.prototype.hasOwnProperty.call(updates, 'activeFlowId')
            || Object.prototype.hasOwnProperty.call(updates, 'contributionMode')
          ) {
            updates.signupMethod = resolveSignupMethod(nextSignupState);
          }
          const nextPersistedSignupMethod = Object.prototype.hasOwnProperty.call(updates, 'signupMethod')
            ? updates.signupMethod
            : currentState?.signupMethod;
          if (normalizeSignupMethod(nextPersistedSignupMethod) === 'phone') {
            preservePhoneReuseSettingsForPhoneSignup(updates, currentState);
          }
          const modeChanged = Object.prototype.hasOwnProperty.call(updates, 'plusModeEnabled')
            && Boolean(currentState?.plusModeEnabled) !== Boolean(updates.plusModeEnabled);
          const plusPaymentChanged = Object.prototype.hasOwnProperty.call(updates, 'plusPaymentMethod')
            && normalizePlusPaymentMethodForDisplay(currentState?.plusPaymentMethod || 'paypal')
              !== normalizePlusPaymentMethodForDisplay(updates.plusPaymentMethod || 'paypal');
          const phoneSignupReloginAfterBindEmailChanged = Object.prototype.hasOwnProperty.call(updates, 'phoneSignupReloginAfterBindEmailEnabled')
            && Boolean(currentState?.phoneSignupReloginAfterBindEmailEnabled) !== Boolean(updates.phoneSignupReloginAfterBindEmailEnabled);
          const nextPlusModeEnabled = Object.prototype.hasOwnProperty.call(updates, 'plusModeEnabled')
            ? Boolean(updates.plusModeEnabled)
            : Boolean(currentState?.plusModeEnabled);
          const stepModeChanged = modeChanged
            || (nextPlusModeEnabled && plusPaymentChanged)
            || phoneSignupReloginAfterBindEmailChanged;
          const oauthFlowTimeoutDisabled = Object.prototype.hasOwnProperty.call(updates, 'oauthFlowTimeoutEnabled')
            && updates.oauthFlowTimeoutEnabled === false;
          await setPersistentSettings(updates);
          const stateUpdates = {
            ...updates,
            ...sessionUpdates,
            ...(oauthFlowTimeoutDisabled ? {
              oauthFlowDeadlineAt: null,
              oauthFlowDeadlineSourceUrl: null,
            } : {}),
          };
          if (Object.prototype.hasOwnProperty.call(updates, 'icloudHostPreference')) {
            const nextHostPreference = String(updates.icloudHostPreference || '').trim().toLowerCase();
            stateUpdates.preferredIcloudHost = nextHostPreference === 'icloud.com' || nextHostPreference === 'icloud.com.cn'
              ? nextHostPreference
              : '';
          }
          if (stepModeChanged && typeof getStepIdsForState === 'function') {
            const nextStateForSteps = { ...currentState, ...stateUpdates };
            const nextNodeIds = typeof getNodeIdsForState === 'function'
              ? getNodeIdsForState(nextStateForSteps)
              : getStepIdsForState(nextStateForSteps).map((stepId) => getStepKeyForState(stepId, nextStateForSteps)).filter(Boolean);
            stateUpdates.nodeStatuses = Object.fromEntries(nextNodeIds.map((nodeId) => [nodeId, 'pending']));
            stateUpdates.currentNodeId = '';
          }
          await setState(stateUpdates);
          const mergedState = await getState();
          const hasIpProxyAutoSyncSettingChanged = (
            Object.prototype.hasOwnProperty.call(updates, 'ipProxyAutoSyncEnabled')
            || Object.prototype.hasOwnProperty.call(updates, 'ipProxyAutoSyncIntervalMinutes')
          );
          if (hasIpProxyAutoSyncSettingChanged) {
            if (Boolean(mergedState?.ipProxyAutoSyncEnabled)) {
              if (typeof ensureIpProxyAutoSyncAlarm === 'function') {
                await ensureIpProxyAutoSyncAlarm(mergedState);
              }
            } else if (typeof clearIpProxyAutoSyncAlarm === 'function') {
              await clearIpProxyAutoSyncAlarm();
            }
          }
          const hasIpProxyUpdates = Object.keys(updates).some((key) => key.startsWith('ipProxy'));
          const hasIpProxyEnabledUpdate = Object.prototype.hasOwnProperty.call(updates, 'ipProxyEnabled');
          const previousIpProxyEnabled = Boolean(currentState?.ipProxyEnabled);
          const nextIpProxyEnabled = hasIpProxyEnabledUpdate
            ? Boolean(updates.ipProxyEnabled)
            : previousIpProxyEnabled;
          // 仅在“手动开关代理”时自动应用。
          // 其他字段改动（host/账号/地区/session 等）需由“同步/下一条/检测出口/Change”显式触发。
          const shouldApplyIpProxyOnSave = hasIpProxyUpdates
            && hasIpProxyEnabledUpdate
            && previousIpProxyEnabled !== nextIpProxyEnabled;
          let proxyRouting = null;
          if (shouldApplyIpProxyOnSave && typeof applyIpProxySettingsFromState === 'function') {
            const isEnablingProxy = !previousIpProxyEnabled && nextIpProxyEnabled;
            proxyRouting = await applyIpProxySettingsFromState(mergedState, {
              // 手动开启时自动应用一次代理，不做出口探测；
              // 出口探测由“同步/检测出口”按钮显式触发，避免开启即误判为失败。
              skipExitProbe: true,
              resetNetworkState: false,
              forceAuthRebind: false,
              suppressAuthRebind: !isEnablingProxy,
            }).catch((error) => ({
              applied: false,
              reason: 'apply_failed',
              error: error?.message || String(error || '代理应用失败'),
            }));
          }
          if (Boolean(currentState?.contributionMode) && typeof setContributionMode === 'function') {
            await setContributionMode(true);
          }
          if (Object.keys(stateUpdates).length > 0 && typeof broadcastDataUpdate === 'function') {
            broadcastDataUpdate(stateUpdates);
          }
          if (modeChanged) {
            const selectedPlusPaymentMethod = getPlusPaymentMethodLabel(
              stateUpdates.plusPaymentMethod ?? currentState?.plusPaymentMethod ?? 'paypal'
            );
            await addLog(
              Boolean(updates.plusModeEnabled)
                ? `Plus 模式已开启，已切换为 Plus Checkout 步骤，当前支付方式：${selectedPlusPaymentMethod}。`
                : 'Plus 模式已关闭，已恢复普通注册授权步骤。',
              'info'
            );
          } else if (plusPaymentChanged && nextPlusModeEnabled) {
            const selectedPlusPaymentMethod = getPlusPaymentMethodLabel(
              stateUpdates.plusPaymentMethod ?? currentState?.plusPaymentMethod ?? 'paypal'
            );
            await addLog(`Plus 支付方式已切换为 ${selectedPlusPaymentMethod}，已更新对应的 Plus 步骤。`, 'info');
          }
          return {
            ok: true,
            modeValidation,
            proxyRouting,
            state: await getState(),
          };
        }

        case 'RUN_IP_PROXY_AUTO_SYNC_NOW': {
          if (typeof runIpProxyAutoSync !== 'function') {
            throw new Error('IP 代理自动同步能力尚未接入。');
          }
          const result = await runIpProxyAutoSync('manual');
          return { ok: true, ...result };
        }

        case 'REFRESH_IP_PROXY_POOL': {
          if (typeof refreshIpProxyPool !== 'function') {
            throw new Error('IP 代理池能力尚未接入。');
          }
          const result = await refreshIpProxyPool({
            maxItems: message.payload?.maxItems,
            mode: message.payload?.mode,
            skipExitProbe: message.payload?.skipExitProbe,
          });
          return { ok: true, ...result };
        }

        case 'SWITCH_IP_PROXY': {
          if (typeof switchIpProxy !== 'function') {
            throw new Error('IP 代理切换能力尚未接入。');
          }
          const result = await switchIpProxy(message.payload?.direction || 'next', {
            maxItems: message.payload?.maxItems,
            mode: message.payload?.mode,
            forceRefresh: message.payload?.forceRefresh,
            skipExitProbe: message.payload?.skipExitProbe,
          });
          return { ok: true, ...result };
        }

        case 'CHANGE_IP_PROXY_EXIT': {
          if (typeof changeIpProxyExit !== 'function') {
            throw new Error('IP 代理 Change 能力尚未接入。');
          }
          const result = await changeIpProxyExit({
            mode: message.payload?.mode,
            skipExitProbe: message.payload?.skipExitProbe,
          });
          return { ok: true, ...result };
        }

        case 'PROBE_IP_PROXY_EXIT': {
          if (message.source === 'sidepanel') {
            await lockAutomationWindowFromMessage(message, sender);
          }
          if (typeof probeIpProxyExit !== 'function') {
            throw new Error('IP 代理出口检测能力尚未接入。');
          }
          const probeState = await getState();
          const mode = typeof normalizeIpProxyMode === 'function'
            ? normalizeIpProxyMode(probeState?.ipProxyMode)
            : String(probeState?.ipProxyMode || 'account').trim().toLowerCase();
          const provider = typeof normalizeIpProxyProviderValue === 'function'
            ? normalizeIpProxyProviderValue(probeState?.ipProxyService)
            : String(probeState?.ipProxyService || '').trim().toLowerCase();
          const is711AccountMode = mode === 'account' && provider === '711proxy';
          const previousReason = String(probeState?.ipProxyAppliedReason || '').trim().toLowerCase();
          const previousExitError = String(probeState?.ipProxyAppliedExitError || '').trim();
          const hadMissingAuthChallenge = /challenge=0|provided=0|未触发代理鉴权挑战|未收到 407/i.test(previousExitError);
          const shouldPreRebindBeforeProbe = Boolean(
            probeState?.ipProxyEnabled
            && is711AccountMode
            && (hadMissingAuthChallenge || previousReason === 'connectivity_failed')
          );
          const timeoutMs = Number(message.payload?.timeoutMs) > 0
            ? Number(message.payload.timeoutMs)
            : (is711AccountMode ? (shouldPreRebindBeforeProbe ? 15000 : 12000) : undefined);

          // 手动“检测出口”前先轻量应用当前配置，避免读取到旧代理链路状态。
          if (probeState?.ipProxyEnabled && typeof applyIpProxySettingsFromState === 'function') {
            await applyIpProxySettingsFromState(probeState, {
              skipExitProbe: true,
              resetNetworkState: shouldPreRebindBeforeProbe,
              forceAuthRebind: shouldPreRebindBeforeProbe,
              suppressAuthRebind: !shouldPreRebindBeforeProbe,
            }).catch(() => null);
          }

          const result = await probeIpProxyExit({
            timeoutMs,
            authRebindMaxAttempts: is711AccountMode ? 1 : undefined,
          });
          return { ok: true, ...result };
        }

        case 'EXPORT_SETTINGS': {
          return { ok: true, ...(await exportSettingsBundle()) };
        }

        case 'IMPORT_SETTINGS': {
          const state = await importSettingsBundle(message.payload?.config || null);
          return { ok: true, state };
        }

        case 'REFRESH_GPC_CARD_BALANCE': {
          if (typeof refreshGpcCardBalance !== 'function') {
            throw new Error('GPC API Key 余额查询能力尚未接入。');
          }
          const state = await getState();
          const result = await refreshGpcCardBalance({
            ...(state || {}),
            ...(message.payload || {}),
          }, {
            reason: message.payload?.reason,
          });
          return { ok: true, ...result };
        }

        case 'UPSERT_HOTMAIL_ACCOUNT': {
          const account = await upsertHotmailAccount(message.payload || {});
          return { ok: true, account };
        }

        case 'UPSERT_PAYPAL_ACCOUNT': {
          const account = await upsertPayPalAccount(message.payload || {});
          return { ok: true, account };
        }

        case 'SELECT_PAYPAL_ACCOUNT': {
          const account = await setCurrentPayPalAccount(String(message.payload?.accountId || ''));
          return { ok: true, account };
        }

        case 'DELETE_HOTMAIL_ACCOUNT': {
          await deleteHotmailAccount(String(message.payload?.accountId || ''));
          return { ok: true };
        }

        case 'DELETE_HOTMAIL_ACCOUNTS': {
          const result = await deleteHotmailAccounts(String(message.payload?.mode || 'all'));
          return { ok: true, ...result };
        }

        case 'SELECT_HOTMAIL_ACCOUNT': {
          const account = await setCurrentHotmailAccount(String(message.payload?.accountId || ''), {
            markUsed: false,
            syncEmail: true,
          });
          return { ok: true, account };
        }

        case 'PATCH_HOTMAIL_ACCOUNT': {
          const account = await patchHotmailAccount(
            String(message.payload?.accountId || ''),
            message.payload?.updates || {}
          );
          return { ok: true, account };
        }

        case 'VERIFY_HOTMAIL_ACCOUNT':
        case 'AUTHORIZE_HOTMAIL_ACCOUNT': {
          const accountId = String(message.payload?.accountId || '');
          try {
            const result = await verifyHotmailAccount(accountId);
            await setCurrentHotmailAccount(result.account.id, { markUsed: false, syncEmail: true });
            await addLog(`Hotmail 账号 ${result.account.email} 校验通过，可直接用于收信。`, 'ok');
            return { ok: true, account: result.account, messageCount: result.messageCount };
          } catch (err) {
            const state = await getState();
            const accounts = normalizeHotmailAccounts(state.hotmailAccounts);
            const target = findHotmailAccount(accounts, accountId);
            if (target) {
              target.status = 'error';
              target.lastError = err.message;
              await syncHotmailAccounts(accounts.map((item) => (item.id === target.id ? target : item)));
            }
            throw err;
          }
        }

        case 'TEST_HOTMAIL_ACCOUNT': {
          const result = await testHotmailAccountMailAccess(String(message.payload?.accountId || ''));
          return { ok: true, ...result };
        }

        case 'UPSERT_MAIL2925_ACCOUNT': {
          const account = await upsertMail2925Account(message.payload || {});
          return { ok: true, account };
        }

        case 'DELETE_MAIL2925_ACCOUNT': {
          await deleteMail2925Account(String(message.payload?.accountId || ''));
          return { ok: true };
        }

        case 'DELETE_MAIL2925_ACCOUNTS': {
          const result = await deleteMail2925Accounts(String(message.payload?.mode || 'all'));
          return { ok: true, ...result };
        }

        case 'SELECT_MAIL2925_ACCOUNT': {
          const account = await setCurrentMail2925Account(String(message.payload?.accountId || ''), {
            updateLastUsedAt: false,
          });
          return { ok: true, account };
        }

        case 'PATCH_MAIL2925_ACCOUNT': {
          const account = await patchMail2925Account(
            String(message.payload?.accountId || ''),
            message.payload?.updates || {}
          );
          return { ok: true, account };
        }

        case 'LOGIN_MAIL2925_ACCOUNT': {
          const accountId = String(message.payload?.accountId || '');
          const account = await setCurrentMail2925Account(accountId, {
            updateLastUsedAt: false,
          });
          if (typeof deps.ensureMail2925MailboxSession !== 'function') {
            throw new Error('2925 登录能力尚未接入。');
          }
          await deps.ensureMail2925MailboxSession({
            accountId: account.id,
            forceRelogin: Boolean(message.payload?.forceRelogin),
            actionLabel: '侧边栏手动登录 2925 账号',
          });
          return { ok: true, account };
        }

        case 'LIST_LUCKMAIL_PURCHASES': {
          const purchases = await listLuckmailPurchasesForManagement();
          return { ok: true, purchases };
        }

        case 'SELECT_LUCKMAIL_PURCHASE': {
          const purchase = await selectLuckmailPurchase(message.payload?.purchaseId);
          return { ok: true, purchase };
        }

        case 'SET_LUCKMAIL_PURCHASE_USED_STATE': {
          const result = await setLuckmailPurchaseUsedState(message.payload?.purchaseId, Boolean(message.payload?.used));
          return { ok: true, ...result };
        }

        case 'SET_LUCKMAIL_PURCHASE_PRESERVED_STATE': {
          const purchase = await setLuckmailPurchasePreservedState(message.payload?.purchaseId, Boolean(message.payload?.preserved));
          return { ok: true, purchase };
        }

        case 'SET_LUCKMAIL_PURCHASE_DISABLED_STATE': {
          const purchase = await setLuckmailPurchaseDisabledState(message.payload?.purchaseId, Boolean(message.payload?.disabled));
          return { ok: true, purchase };
        }

        case 'BATCH_UPDATE_LUCKMAIL_PURCHASES': {
          const result = await batchUpdateLuckmailPurchases(message.payload || {});
          return { ok: true, ...result };
        }

        case 'DISABLE_USED_LUCKMAIL_PURCHASES': {
          const result = await disableUsedLuckmailPurchases();
          return { ok: true, ...result };
        }

        case 'SET_EMAIL_STATE': {
          const state = await getState();
          if (isAutoRunLockedState(state)) {
            throw new Error('自动流程运行中，当前不能手动修改邮箱。');
          }
          const email = String(message.payload?.email || '').trim() || null;
          await setEmailStateSilently(email, { source: 'manual' });
          return { ok: true, email };
        }

        case 'SAVE_EMAIL': {
          const state = await getState();
          if (isAutoRunLockedState(state)) {
            throw new Error('自动流程运行中，当前不能手动修改邮箱。');
          }
          await setEmailState(message.payload.email, { source: 'manual' });
          await resumeAutoRun();
          return { ok: true, email: message.payload.email };
        }

        case 'SET_SIGNUP_PHONE_STATE': {
          const state = await getState();
          if (isAutoRunLockedState(state)) {
            throw new Error('自动流程运行中，当前不能手动修改注册手机号。');
          }
          const phoneNumber = resolveSignupPhonePayload(message.payload) || null;
          await setSignupPhoneStateSilently(phoneNumber);
          return { ok: true, phoneNumber };
        }

        case 'SAVE_SIGNUP_PHONE': {
          const state = await getState();
          if (isAutoRunLockedState(state)) {
            throw new Error('自动流程运行中，当前不能手动修改注册手机号。');
          }
          const phoneNumber = resolveSignupPhonePayload(message.payload) || null;
          await setSignupPhoneState(phoneNumber);
          return { ok: true, phoneNumber };
        }

        case 'FETCH_GENERATED_EMAIL': {
          clearStopRequest();
          const state = await getState();
          if (isAutoRunLockedState(state)) {
            throw new Error('自动流程运行中，当前不能手动获取邮箱。');
          }
          const email = await fetchGeneratedEmail(state, message.payload || {});
          await resumeAutoRun();
          return { ok: true, email };
        }

        case 'FETCH_HOSTED_CHECKOUT_VERIFICATION_CODE': {
          if (typeof fetchHostedCheckoutVerificationCodeManually !== 'function') {
            throw new Error('Hosted checkout 手动获取验证码能力尚未接入。');
          }
          const result = await fetchHostedCheckoutVerificationCodeManually(message.payload || {});
          return {
            ok: true,
            code: String(result?.code || '').trim(),
            verificationUrl: String(result?.verificationUrl || '').trim(),
          };
        }

        case 'TEST_PLUS_CHECKOUT_CONVERSION_PROXY': {
          const state = await getState();
          if (isAutoRunLockedState(state)) {
            throw new Error('自动流程运行中，当前不能测试支付转换代理。');
          }
          if (typeof testCheckoutConversionProxy !== 'function') {
            throw new Error('支付转换代理测试能力尚未接入。');
          }
          const result = await testCheckoutConversionProxy(message.payload || {});
          return {
            ok: true,
            proxyDisplayName: String(result?.proxyDisplayName || '').trim(),
            exitIp: String(result?.exitIp || '').trim(),
            exitRegion: String(result?.exitRegion || '').trim(),
            exitSource: String(result?.exitSource || '').trim(),
            exitEndpoint: String(result?.exitEndpoint || '').trim(),
            targetEndpoint: String(result?.targetEndpoint || '').trim(),
            diagnostics: String(result?.diagnostics || '').trim(),
          };
        }

        case 'FETCH_DUCK_EMAIL': {
          clearStopRequest();
          const state = await getState();
          if (isAutoRunLockedState(state)) {
            throw new Error('自动流程运行中，当前不能手动获取邮箱。');
          }
          const email = await fetchGeneratedEmail(state, { ...(message.payload || {}), generator: 'duck' });
          await resumeAutoRun();
          return { ok: true, email };
        }

        case 'CHECK_ICLOUD_SESSION': {
          clearStopRequest();
          return await checkIcloudSession();
        }

        case 'LIST_ICLOUD_ALIASES': {
          clearStopRequest();
          const aliases = await listIcloudAliases();
          return { ok: true, aliases };
        }

        case 'BATCH_CREATE_ICLOUD_API_CREDENTIALS': {
          clearStopRequest();
          const count = Math.max(1, Math.min(Number(message.payload?.count) || 1, 50));
          const apiBaseUrl = String(message.payload?.apiBaseUrl || '').trim();
          const apiAdminKey = String(message.payload?.apiAdminKey || '');
          const created = [];
          const credentials = [];
          for (let index = 0; index < count; index += 1) {
            const email = await fetchIcloudHideMyEmail({
              generateNew: true,
              source: 'icloud_api_batch_creator',
            });
            const secretBytes = crypto.getRandomValues(new Uint8Array(24));
            const secret = Array.from(secretBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
            created.push(email);
            credentials.push(`${email}----${secret}`);
          }
          const credentialsText = credentials.join('\n');
          await saveIcloudApiCredentials(credentials);
          const { synced, syncError } = await syncIcloudApiCredentialsToWorker(credentialsText, apiBaseUrl, apiAdminKey);
          return { ok: true, created, credentialsText, synced, syncError };
        }

        case 'SYNC_SELECTED_ICLOUD_API_CREDENTIALS': {
          clearStopRequest();
          const emails = Array.isArray(message.payload?.emails)
            ? message.payload.emails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean)
            : [];
          if (!emails.length) throw new Error('请选择要同步的 iCloud 隐藏邮箱。');
          const apiBaseUrl = String(message.payload?.apiBaseUrl || '').trim();
          const apiAdminKey = String(message.payload?.apiAdminKey || '');
          const credentials = emails.map((email) => {
            const secretBytes = crypto.getRandomValues(new Uint8Array(24));
            const secret = Array.from(secretBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
            return `${email}----${secret}`;
          });
          const credentialsText = credentials.join('\n');
          await saveIcloudApiCredentials(credentials);
          const { synced, syncError } = await syncIcloudApiCredentialsToWorker(credentialsText, apiBaseUrl, apiAdminKey);
          return { ok: true, credentialsText, synced, syncError, count: emails.length };
        }

        case 'SET_ICLOUD_ALIAS_USED_STATE': {
          clearStopRequest();
          const result = await setIcloudAliasUsedState(message.payload || {});
          return { ok: true, ...result };
        }

        case 'SET_ICLOUD_ALIAS_PRESERVED_STATE': {
          clearStopRequest();
          const result = await setIcloudAliasPreservedState(message.payload || {});
          return { ok: true, ...result };
        }

        case 'DELETE_ICLOUD_ALIAS': {
          clearStopRequest();
          const result = await deleteIcloudAlias(message.payload || {});
          return { ok: true, ...result };
        }

        case 'DELETE_USED_ICLOUD_ALIASES': {
          clearStopRequest();
          const result = await deleteUsedIcloudAliases();
          return { ok: true, ...result };
        }

        case 'STOP_FLOW': {
          await requestStop();
          return { ok: true };
        }

        default:
          console.warn('Unknown message type:', message.type);
          return { error: `Unknown message type: ${message.type}` };
      }
    }

    return {
      handleMessage,
      handleStepData,
    };
  }

  return {
    createMessageRouter,
  };
});
