(function attachBackgroundStep9(root, factory) {
  root.MultiPageBackgroundStep9 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep9Module() {
  function createStep9Executor(deps = {}) {
    const {
      addLog,
      chrome,
      cleanupStep8NavigationListeners,
      clickWithDebugger,
      completeNodeFromBackground,
      ensureStep8SignupPageReady,
      getOAuthFlowRemainingMs,
      getOAuthFlowStepTimeoutMs,
      getStep8CallbackUrlFromNavigation,
      getStep8CallbackUrlFromTabUpdate,
      getStep8EffectLabel,
      getTabId,
      isTabAlive,
      prepareStep8DebuggerClick,
      recoverOAuthLocalhostTimeout,
      recoverStep9AuthFallback,
      reloadStep8ConsentPage,
      reuseOrCreateTab,
      sleepWithStop,
      STEP8_CLICK_RETRY_DELAY_MS,
      STEP8_MAX_ROUNDS,
      STEP8_READY_WAIT_TIMEOUT_MS,
      STEP8_STRATEGIES,
      throwIfStep8SettledOrStopped,
      triggerStep8ContentStrategy,
      waitForStep8ClickEffect,
      waitForStep8Ready,
      setWebNavListener,
      setWebNavCommittedListener,
      setStep8PendingReject,
      setStep8TabUpdatedListener,
      shouldDeferStep9CallbackTimeout,
    } = deps;

    const LOCALHOST_CALLBACK_LOCAL_TIMEOUT_MS = 240000;
    const CALLBACK_TIMEOUT_CHECK_INTERVAL_MS = 1000;
    const STEP9_AUTH_FALLBACK_MAX_RECOVERY_ATTEMPTS = 1;

    function getVisibleStep(state, fallback = 9) {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      return visibleStep > 0 ? visibleStep : fallback;
    }

    function getAuthLoginStepForVisibleStep(visibleStep) {
      const normalizedStep = Math.floor(Number(visibleStep) || 0);
      if (normalizedStep >= 13) {
        return 10;
      }
      if (normalizedStep >= 11) {
        return 6;
      }
      return 7;
    }

    function addStepLog(step, message, level = 'info') {
      return addLog(message, level, { step, stepKey: 'confirm-oauth' });
    }

    function getStep9AuthFallbackKind(pageState = {}) {
      if (!pageState || typeof pageState !== 'object') {
        return '';
      }
      if (pageState.verificationPage) return 'verification';
      if (pageState.addEmailPage) return 'add_email';
      if (pageState.retryPage) return 'retry';
      return '';
    }

    function getStep9AuthFallbackLabel(pageState = {}) {
      const fallbackKind = getStep9AuthFallbackKind(pageState);
      switch (fallbackKind) {
        case 'verification':
          return pageState?.displayedEmail
            ? `邮箱验证码页（${pageState.displayedEmail}）`
            : '邮箱验证码页';
        case 'add_email':
          return '添加邮箱页';
        case 'retry':
          return '认证重试页';
        default:
          return '认证异常页';
      }
    }

    async function runStep9(state, authFallbackRecoveryCount = 0) {
      const visibleStep = getVisibleStep(state, 9);
      let activeState = state;

      if (!activeState.oauthUrl) {
        const authLoginStep = getAuthLoginStepForVisibleStep(visibleStep);
        throw new Error(`缺少登录用 OAuth 链接，请先完成步骤 ${authLoginStep}。`);
      }

      await addStepLog(visibleStep, '正在监听 localhost 回调地址...');

      let callbackTimeoutMs = LOCALHOST_CALLBACK_LOCAL_TIMEOUT_MS;
      let timeoutRecoveryAttempted = false;
      while (true) {
        try {
          callbackTimeoutMs = typeof getOAuthFlowStepTimeoutMs === 'function'
            ? await getOAuthFlowStepTimeoutMs(LOCALHOST_CALLBACK_LOCAL_TIMEOUT_MS, {
              step: visibleStep,
              actionLabel: 'OAuth localhost 回调',
              oauthUrl: activeState?.oauthUrl || '',
            })
            : LOCALHOST_CALLBACK_LOCAL_TIMEOUT_MS;
          break;
        } catch (error) {
          if (timeoutRecoveryAttempted || typeof recoverOAuthLocalhostTimeout !== 'function') {
            throw error;
          }
          const recoveredState = await recoverOAuthLocalhostTimeout({
            error,
            state: activeState,
            visibleStep,
          });
          if (!recoveredState) {
            throw error;
          }
          activeState = recoveredState;
          timeoutRecoveryAttempted = true;
        }
      }

      return new Promise((resolve, reject) => {
        let resolved = false;
        let signupTabId = null;
        let callbackWaitStartedAt = Date.now();
        let timeoutCheckTimer = null;
        let timeoutDeferredLogged = false;

        const cleanupListener = () => {
          if (timeoutCheckTimer) {
            clearTimeout(timeoutCheckTimer);
            timeoutCheckTimer = null;
          }
          cleanupStep8NavigationListeners();
          setStep8PendingReject(null);
        };

        const rejectStep9 = (error) => {
          if (resolved) return;
          resolved = true;
          cleanupListener();
          reject(error);
        };

        const finalizeStep9Callback = (callbackUrl) => {
          if (resolved || !callbackUrl) return;

          resolved = true;
          cleanupListener();

          addStepLog(visibleStep, `已捕获 localhost 地址：${callbackUrl}`, 'ok').then(() => {
            return completeNodeFromBackground(state?.nodeId || 'confirm-oauth', { localhostUrl: callbackUrl });
          }).then(() => {
            resolve();
          }).catch((err) => {
            reject(err);
          });
        };

        const resolveWithRecoveredStep9 = async (pageState, reasonLabel) => {
          const fallbackKind = getStep9AuthFallbackKind(pageState);
          if (!fallbackKind) {
            return false;
          }
          if (authFallbackRecoveryCount >= STEP9_AUTH_FALLBACK_MAX_RECOVERY_ATTEMPTS) {
            const authLoginStep = getAuthLoginStepForVisibleStep(visibleStep);
            throw new Error(
              `步骤 ${visibleStep}：${reasonLabel}时认证页再次回流到${getStep9AuthFallbackLabel(pageState)}，已自动恢复 ${STEP9_AUTH_FALLBACK_MAX_RECOVERY_ATTEMPTS} 次仍未成功，请回到步骤 ${authLoginStep} 重新开始。`
            );
          }
          if (typeof recoverStep9AuthFallback !== 'function') {
            const authLoginStep = getAuthLoginStepForVisibleStep(visibleStep);
            throw new Error(
              `步骤 ${visibleStep}：${reasonLabel}时认证页回流到${getStep9AuthFallbackLabel(pageState)}，但当前未接入自动恢复能力，请回到步骤 ${authLoginStep} 重新开始。`
            );
          }

          await addStepLog(
            visibleStep,
            `检测到${reasonLabel}时认证页回流到${getStep9AuthFallbackLabel(pageState)}，正在自动补登后重试当前 OAuth 确认...`,
            'warn'
          );
          const recoveredState = await recoverStep9AuthFallback({
            state: activeState,
            pageState,
            visibleStep,
            recoveryAttempt: authFallbackRecoveryCount + 1,
            maxRecoveryAttempts: STEP9_AUTH_FALLBACK_MAX_RECOVERY_ATTEMPTS,
            reason: reasonLabel,
          });
          const nextState = recoveredState && typeof recoveredState === 'object'
            ? recoveredState
            : activeState;
          if (!String(nextState?.oauthUrl || '').trim()) {
            throw new Error(`步骤 ${visibleStep}：自动恢复后缺少可用的 OAuth 链接，无法继续确认 OAuth。`);
          }

          resolved = true;
          cleanupListener();
          resolve(runStep9(nextState, authFallbackRecoveryCount + 1));
          return true;
        };

        const isCallbackTimeoutDeferred = async (elapsedMs) => {
          if (typeof shouldDeferStep9CallbackTimeout !== 'function') {
            return false;
          }
          try {
            const deferred = await shouldDeferStep9CallbackTimeout({
              tabId: signupTabId,
              visibleStep,
              elapsedMs,
              oauthUrl: activeState?.oauthUrl || '',
            });
            if (deferred && !timeoutDeferredLogged) {
              timeoutDeferredLogged = true;
              await addStepLog(
                visibleStep,
                '检测到认证页仍在安全验证/授权跳转中，暂停本地回调超时判定，继续等待 localhost 回调...',
                'info'
              );
            }
            return Boolean(deferred);
          } catch (error) {
            await addStepLog(
              visibleStep,
              `复核认证页跳转状态失败（${error?.message || error}），继续按原超时规则等待回调。`,
              'warn'
            );
            return false;
          }
        };

        const checkCallbackTimeout = async () => {
          if (resolved) {
            return;
          }
          const elapsedMs = Date.now() - callbackWaitStartedAt;
          if (await isCallbackTimeoutDeferred(elapsedMs)) {
            timeoutCheckTimer = setTimeout(checkCallbackTimeout, CALLBACK_TIMEOUT_CHECK_INTERVAL_MS);
            return;
          }

          if (elapsedMs >= LOCALHOST_CALLBACK_LOCAL_TIMEOUT_MS) {
            rejectStep9(new Error(`${Math.round(LOCALHOST_CALLBACK_LOCAL_TIMEOUT_MS / 1000)} 秒内未捕获到 localhost 回调跳转，步骤 ${visibleStep} 的点击可能被拦截了。`));
            return;
          }

          if (typeof getOAuthFlowRemainingMs === 'function') {
            try {
              await getOAuthFlowRemainingMs({
                step: visibleStep,
                actionLabel: 'OAuth localhost 回调',
                oauthUrl: activeState?.oauthUrl || '',
              });
            } catch (error) {
              rejectStep9(error);
              return;
            }
          } else if (elapsedMs >= callbackTimeoutMs) {
            rejectStep9(new Error(`${Math.round(callbackTimeoutMs / 1000)} 秒内未捕获到 localhost 回调跳转，步骤 ${visibleStep} 的点击可能被拦截了。`));
            return;
          }

          timeoutCheckTimer = setTimeout(checkCallbackTimeout, CALLBACK_TIMEOUT_CHECK_INTERVAL_MS);
        };

        timeoutCheckTimer = setTimeout(
          checkCallbackTimeout,
          Math.min(CALLBACK_TIMEOUT_CHECK_INTERVAL_MS, Math.max(1, callbackTimeoutMs))
        );

        setStep8PendingReject((error) => {
          rejectStep9(error);
        });

        setWebNavListener((details) => {
          const callbackUrl = getStep8CallbackUrlFromNavigation(details, signupTabId);
          finalizeStep9Callback(callbackUrl);
        });

        setWebNavCommittedListener((details) => {
          const callbackUrl = getStep8CallbackUrlFromNavigation(details, signupTabId);
          finalizeStep9Callback(callbackUrl);
        });

        setStep8TabUpdatedListener((tabId, changeInfo, tab) => {
          const callbackUrl = getStep8CallbackUrlFromTabUpdate(tabId, changeInfo, tab, signupTabId);
          finalizeStep9Callback(callbackUrl);
        });

        (async () => {
          try {
            throwIfStep8SettledOrStopped(resolved);
            signupTabId = await getTabId('signup-page');
            throwIfStep8SettledOrStopped(resolved);

            if (signupTabId && await isTabAlive('signup-page')) {
              await chrome.tabs.update(signupTabId, { active: true });
              await addStepLog(visibleStep, '已切回认证页，正在准备调试器点击...');
            } else {
              signupTabId = await reuseOrCreateTab('signup-page', activeState.oauthUrl);
              await addStepLog(visibleStep, '已重新打开认证页，正在准备调试器点击...');
            }

            throwIfStep8SettledOrStopped(resolved);
            chrome.webNavigation.onBeforeNavigate.addListener(deps.getWebNavListener());
            chrome.webNavigation.onCommitted.addListener(deps.getWebNavCommittedListener());
            chrome.tabs.onUpdated.addListener(deps.getStep8TabUpdatedListener());
            await ensureStep8SignupPageReady(signupTabId, {
              timeoutMs: typeof getOAuthFlowStepTimeoutMs === 'function'
                ? await getOAuthFlowStepTimeoutMs(15000, {
                  step: visibleStep,
                  actionLabel: '等待 OAuth 同意页内容脚本就绪',
                })
                : 15000,
              visibleStep,
              logStepKey: 'confirm-oauth',
              logMessage: '认证页内容脚本尚未就绪，正在等待页面恢复...',
            });

            for (let round = 1; round <= STEP8_MAX_ROUNDS && !resolved; round++) {
              throwIfStep8SettledOrStopped(resolved);
              const pageState = await waitForStep8Ready(
                signupTabId,
                typeof getOAuthFlowStepTimeoutMs === 'function'
                  ? await getOAuthFlowStepTimeoutMs(STEP8_READY_WAIT_TIMEOUT_MS, {
                    step: visibleStep,
                    actionLabel: '等待 OAuth 同意页出现',
                  })
                  : STEP8_READY_WAIT_TIMEOUT_MS,
                { visibleStep }
              );
              if (await resolveWithRecoveredStep9(pageState, '等待 OAuth 同意页')) {
                return;
              }
              if (!pageState?.consentReady) {
                await sleepWithStop(STEP8_CLICK_RETRY_DELAY_MS);
                continue;
              }

              const strategy = STEP8_STRATEGIES[Math.min(round - 1, STEP8_STRATEGIES.length - 1)];

              await addStepLog(visibleStep, `第 ${round}/${STEP8_MAX_ROUNDS} 轮尝试点击“继续”（${strategy.label}）...`);

              if (strategy.mode === 'debugger') {
                const clickActionTimeoutMs = typeof getOAuthFlowStepTimeoutMs === 'function'
                  ? await getOAuthFlowStepTimeoutMs(15000, {
                    step: visibleStep,
                    actionLabel: '定位 OAuth 同意页继续按钮',
                  })
                  : 15000;
                const clickTarget = await prepareStep8DebuggerClick(signupTabId, {
                  timeoutMs: clickActionTimeoutMs,
                  responseTimeoutMs: clickActionTimeoutMs,
                  visibleStep,
                });
                if (clickTarget?.pageState && await resolveWithRecoveredStep9(clickTarget.pageState, '准备定位 OAuth 同意页继续按钮')) {
                  return;
                }
                throwIfStep8SettledOrStopped(resolved);
                await clickWithDebugger(signupTabId, clickTarget?.rect, { visibleStep });
              } else {
                const clickActionTimeoutMs = typeof getOAuthFlowStepTimeoutMs === 'function'
                  ? await getOAuthFlowStepTimeoutMs(15000, {
                    step: visibleStep,
                    actionLabel: '点击 OAuth 同意页继续按钮',
                  })
                  : 15000;
                const triggerResult = await triggerStep8ContentStrategy(signupTabId, strategy.strategy, {
                  timeoutMs: clickActionTimeoutMs,
                  responseTimeoutMs: clickActionTimeoutMs,
                  visibleStep,
                });
                if (triggerResult?.pageState && await resolveWithRecoveredStep9(triggerResult.pageState, '触发 OAuth 同意页继续按钮')) {
                  return;
                }
              }

              if (resolved) {
                return;
              }

              const effect = await waitForStep8ClickEffect(
                signupTabId,
                pageState.url,
                typeof getOAuthFlowStepTimeoutMs === 'function'
                  ? await getOAuthFlowStepTimeoutMs(15000, {
                    step: visibleStep,
                    actionLabel: '等待 OAuth 同意页点击生效',
                  })
                  : 15000,
                { visibleStep }
              );
              if (resolved) {
                return;
              }
              if (effect?.pageState && await resolveWithRecoveredStep9(effect.pageState, '点击 OAuth 同意页继续按钮')) {
                return;
              }

              if (effect.progressed) {
                await addStepLog(visibleStep, `检测到本次点击已生效，${getStep8EffectLabel(effect)}，继续等待 localhost 回调...`, 'info');
                break;
              }

              if (round >= STEP8_MAX_ROUNDS) {
                throw new Error(`步骤 ${visibleStep}：连续 ${STEP8_MAX_ROUNDS} 轮点击“继续”后页面仍无反应。`);
              }

              await addStepLog(visibleStep, `${strategy.label} 本轮点击后页面无反应，正在刷新认证页后重试（下一轮 ${round + 1}/${STEP8_MAX_ROUNDS}）...`, 'warn');
              await reloadStep8ConsentPage(
                signupTabId,
                typeof getOAuthFlowStepTimeoutMs === 'function'
                  ? await getOAuthFlowStepTimeoutMs(30000, {
                    step: visibleStep,
                    actionLabel: '刷新 OAuth 同意页',
                  })
                  : 30000,
                { visibleStep }
              );
              await sleepWithStop(STEP8_CLICK_RETRY_DELAY_MS);
            }
          } catch (err) {
            rejectStep9(err);
          }
        })();
      });
    }

    async function executeStep9(state) {
      return runStep9(state, 0);
    }

    return { executeStep9 };
  }

  return { createStep9Executor };
});
