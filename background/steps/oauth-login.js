(function attachBackgroundStep7(root, factory) {
  root.MultiPageBackgroundStep7 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep7Module() {
  function createStep7Executor(deps = {}) {
    const {
      addLog,
      completeNodeFromBackground,
      getErrorMessage,
      getLoginAuthStateLabel,
      getOAuthFlowStepTimeoutMs,
      getState,
      isAddPhoneAuthFailure = (error) => {
        const message = String(typeof error === 'string' ? error : error?.message || '');
        if (/\u624b\u673a\u53f7\u8f93\u5165\u6a21\u5f0f|phone\s+entry/i.test(message)) {
          return false;
        }
        return /https:\/\/auth\.openai\.com\/add-phone(?:[/?#]|$)|\badd-phone\b|\u6dfb\u52a0\u624b\u673a\u53f7|\u624b\u673a\u53f7\u7801|\u8fdb\u5165\u624b\u673a\u53f7\u9875\u9762|\u624b\u673a\u53f7\u9875|\u624b\u673a\u53f7\u9875\u9762|phone\s+number|telephone/i.test(message);
      },
      isStep6RecoverableResult,
      isStep6SuccessResult,
      getTabId,
      refreshOAuthUrlBeforeStep6,
      reuseOrCreateTab,
      sendToContentScriptResilient,
      startOAuthFlowTimeoutWindow,
      STEP6_MAX_ATTEMPTS,
      throwIfStopped,
    } = deps;

    function isManagementSecretConfigError(error) {
      const message = String(typeof error === 'string' ? error : error?.message || '').trim();
      if (!message) {
        return false;
      }

      const mentionsSecret = /管理密钥|Admin Secret|X-Admin-Key|CPA Key/i.test(message);
      if (!mentionsSecret) {
        return false;
      }

      return /缺少|未配置|请输入|无效|错误|失败|401|认证失败|未授权|unauthorized|invalid/i.test(message);
    }

    function normalizeStep7IdentifierType(value = '') {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized === 'phone' || normalized === 'email' ? normalized : '';
    }

    function normalizeStep7SignupMethod(value = '') {
      return String(value || '').trim().toLowerCase() === 'phone' ? 'phone' : 'email';
    }

    function shouldForceStep7EmailLogin(state = {}) {
      return normalizeStep7IdentifierType(state?.forceLoginIdentifierType) === 'email'
        || Boolean(state?.forceEmailLogin);
    }

    function canUseConfiguredPhoneSignup(state = {}) {
      return normalizeStep7SignupMethod(state?.signupMethod) === 'phone'
        && Boolean(state?.phoneVerificationEnabled)
        && !Boolean(state?.plusModeEnabled)
        && !Boolean(state?.contributionMode);
    }

    function hasStep7PhoneSignupIdentity(state = {}) {
      return Boolean(
        String(state?.signupPhoneNumber || '').trim()
        || String(state?.signupPhoneCompletedActivation?.phoneNumber || '').trim()
        || String(state?.signupPhoneActivation?.phoneNumber || '').trim()
        || (
          normalizeStep7IdentifierType(state?.accountIdentifierType) === 'phone'
          && String(state?.accountIdentifier || '').trim()
        )
      );
    }

    function shouldPreferStep7PhoneSignupIdentity(state = {}) {
      return canUseConfiguredPhoneSignup(state)
        && hasStep7PhoneSignupIdentity(state);
    }

    function resolveStep7LoginIdentifierType(state = {}, fallbackType = '') {
      if (shouldForceStep7EmailLogin(state)) {
        return 'email';
      }

      if (shouldPreferStep7PhoneSignupIdentity(state)) {
        return 'phone';
      }

      const explicitIdentifierType = normalizeStep7IdentifierType(state?.accountIdentifierType);
      if (explicitIdentifierType) {
        return explicitIdentifierType;
      }

      const frozenSignupMethod = normalizeStep7IdentifierType(state?.resolvedSignupMethod);
      if (frozenSignupMethod) {
        return frozenSignupMethod;
      }

      if (canUseConfiguredPhoneSignup(state)) {
        return 'phone';
      }

      return normalizeStep7IdentifierType(fallbackType) || 'email';
    }

    function resolveStep7FallbackEmail(state = {}) {
      const registrationEmail = String(state?.registrationEmailState?.current || '').trim();
      if (registrationEmail) {
        return registrationEmail;
      }

      const currentHotmailAccountId = String(state?.currentHotmailAccountId || '').trim();
      if (currentHotmailAccountId && Array.isArray(state?.hotmailAccounts)) {
        const matchedHotmailAccount = state.hotmailAccounts.find((account) => String(account?.id || '').trim() === currentHotmailAccountId);
        const hotmailEmail = String(matchedHotmailAccount?.email || '').trim();
        if (hotmailEmail) {
          return hotmailEmail;
        }
      }

      const currentMail2925AccountId = String(state?.currentMail2925AccountId || '').trim();
      if (currentMail2925AccountId && Array.isArray(state?.mail2925Accounts)) {
        const matchedMail2925Account = state.mail2925Accounts.find((account) => String(account?.id || '').trim() === currentMail2925AccountId);
        const mail2925Email = String(matchedMail2925Account?.email || '').trim();
        if (mail2925Email) {
          return mail2925Email;
        }
      }

      return '';
    }

    function extractAddPhoneUrl(error) {
      const message = String(typeof error === 'string' ? error : error?.message || '');
      const match = message.match(/https:\/\/auth\.openai\.com\/add-phone(?:[^\s]*)?/i);
      return match ? match[0] : 'https://auth.openai.com/add-phone';
    }

    function getStep7ResultState(result = {}) {
      return String(result?.state || '').trim();
    }

    function isStep7OauthConsentResult(result = {}) {
      return Boolean(result?.directOAuthConsentPage)
        || getStep7ResultState(result) === 'oauth_consent_page';
    }

    function isStep7AddEmailResult(result = {}) {
      return Boolean(result?.addEmailPage) || getStep7ResultState(result) === 'add_email_page';
    }

    function isStep7AddPhoneResult(result = {}) {
      return Boolean(result?.addPhonePage) || getStep7ResultState(result) === 'add_phone_page';
    }

    function isStep7PhoneVerificationResult(result = {}) {
      return Boolean(result?.phoneVerificationPage) || getStep7ResultState(result) === 'phone_verification_page';
    }

    function isStep7PlainVerificationResult(result = {}) {
      return getStep7ResultState(result) === 'verification_page' && !isStep7PhoneVerificationResult(result);
    }

    function isStep7SmsOauthFlowState(state = {}) {
      return String(state?.plusAccountAccessStrategy || '').trim().toLowerCase() === 'sms_oauth';
    }

    function buildStep7CompletionPayload(result = {}, currentState = {}, currentIdentifierType = '', currentPhoneNumber = '') {
      const phoneSignupMode = currentIdentifierType === 'phone';
      const smsOauthFlow = isStep7SmsOauthFlowState(currentState);
      const payload = {
        loginVerificationRequestedAt: result.loginVerificationRequestedAt || null,
      };

      if (currentIdentifierType === 'phone') {
        payload.accountIdentifierType = 'phone';
        payload.accountIdentifier = currentPhoneNumber;
        payload.signupPhoneNumber = currentPhoneNumber;
        payload.signupPhoneCompletedActivation = currentState?.signupPhoneCompletedActivation || null;
        payload.signupPhoneActivation = currentState?.signupPhoneActivation || null;
      }

      if (isStep7OauthConsentResult(result)) {
        payload.skipLoginVerificationStep = true;
        payload.directOAuthConsentPage = true;
        return payload;
      }

      if (phoneSignupMode) {
        if (isStep7AddPhoneResult(result)) {
          throw new Error(`步骤 ${completionStepForState(currentState)}：手机号注册模式 OAuth 登录不应进入添加手机号页。URL: ${result?.url || ''}`.trim());
        }
        if (isStep7AddEmailResult(result)) {
          payload.skipLoginVerificationStep = true;
          payload.addEmailPage = true;
          return payload;
        }
        if (isStep7PhoneVerificationResult(result)) {
          return payload;
        }
        if (isStep7PlainVerificationResult(result)) {
          throw new Error(`步骤 ${completionStepForState(currentState)}：手机号注册模式 OAuth 登录进入了普通邮箱登录验证码页，当前流程不会回落到邮箱验证码。URL: ${result?.url || ''}`.trim());
        }
        throw new Error(`步骤 ${completionStepForState(currentState)}：手机号注册模式 OAuth 登录进入了不允许的页面：${getLoginAuthStateLabel(result.state)}。URL: ${result?.url || ''}`.trim());
      }

      if (isStep7AddEmailResult(result) && smsOauthFlow) {
        payload.skipLoginVerificationStep = true;
        payload.addEmailPage = true;
        return payload;
      }

      if (isStep7AddEmailResult(result)) {
        throw new Error(`步骤 ${completionStepForState(currentState)}：邮箱注册模式 OAuth 登录不应进入添加邮箱页。URL: ${result?.url || ''}`.trim());
      }
      if (isStep7AddPhoneResult(result) || isStep7PhoneVerificationResult(result)) {
        payload.skipLoginVerificationStep = true;
        payload.addPhonePage = isStep7AddPhoneResult(result);
        payload.phoneVerificationPage = isStep7PhoneVerificationResult(result);
        return payload;
      }
      if (isStep7PlainVerificationResult(result)) {
        return payload;
      }

      throw new Error(`步骤 ${completionStepForState(currentState)}：邮箱注册模式 OAuth 登录进入了不允许的页面：${getLoginAuthStateLabel(result.state)}。URL: ${result?.url || ''}`.trim());
    }

    function completionStepForState(state = {}) {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      return visibleStep > 0 ? visibleStep : 7;
    }

    async function completeStep7PostLoginPhoneHandoff(state = {}, err, completionStep) {
      if (normalizeStep7SignupMethod(state?.resolvedSignupMethod || state?.signupMethod) === 'phone') {
        throw new Error(
          `步骤 ${completionStep}：手机号注册模式 OAuth 登录进入了添加手机号页，当前流程不允许在手机号注册模式补手机号。URL: ${extractAddPhoneUrl(err)}`
        );
      }
      await completeNodeFromBackground(state?.nodeId || 'oauth-login', {
        loginVerificationRequestedAt: null,
        skipLoginVerificationStep: true,
        addPhonePage: true,
        directOAuthConsentPage: false,
      });
    }

    async function executeStep7(state) {
      const initialState = typeof getState === 'function'
        ? {
          ...(await getState().catch(() => ({}))),
          ...(state || {}),
        }
        : (state || {});
      const visibleStep = Math.floor(Number(initialState?.visibleStep) || 0);
      const completionStep = visibleStep > 0 ? visibleStep : 7;
      const resolvedIdentifierType = resolveStep7LoginIdentifierType(initialState);
      const phoneNumber = resolvedIdentifierType === 'phone'
        ? String(
          initialState?.signupPhoneNumber
          || (normalizeStep7IdentifierType(initialState?.accountIdentifierType) === 'phone' ? initialState?.accountIdentifier : '')
          || initialState?.signupPhoneCompletedActivation?.phoneNumber
          || initialState?.signupPhoneActivation?.phoneNumber
          || ''
        ).trim()
        : '';
      const email = resolvedIdentifierType === 'email'
        ? String(
          initialState?.email
          || (normalizeStep7IdentifierType(initialState?.accountIdentifierType) === 'email' ? initialState?.accountIdentifier : '')
          || resolveStep7FallbackEmail(initialState)
          || ''
        ).trim()
        : '';
      if (
        (resolvedIdentifierType === 'phone' && !phoneNumber)
        || (resolvedIdentifierType !== 'phone' && !email)
      ) {
        const fieldHint = resolvedIdentifierType === 'phone'
          ? '侧栏“接码设置”里的“注册手机号”输入框'
          : '侧栏顶部“注册邮箱”输入框（旁边有“获取”按钮）';
        throw new Error(`缺少登录账号：请先完成步骤 2，或在${fieldHint}中手动填写账号后再执行当前步骤。`);
      }

      let attempt = 0;
      let lastError = null;

      while (attempt < STEP6_MAX_ATTEMPTS) {
        throwIfStopped();
        attempt += 1;
        try {
          const rawCurrentState = attempt === 1 ? initialState : await getState();
          const currentState = shouldForceStep7EmailLogin(state)
            ? {
              ...rawCurrentState,
              forceLoginIdentifierType: 'email',
              forceEmailLogin: true,
              signupMethod: 'email',
              resolvedSignupMethod: 'email',
              accountIdentifierType: 'email',
              accountIdentifier: email,
              email,
            }
            : rawCurrentState;
          const password = currentState.password || currentState.customPassword || '';
          const currentIdentifierType = resolveStep7LoginIdentifierType(currentState, resolvedIdentifierType);
          const currentPhoneNumber = currentIdentifierType === 'phone'
            ? String(
              currentState?.signupPhoneNumber
              || (normalizeStep7IdentifierType(currentState?.accountIdentifierType) === 'phone' ? currentState?.accountIdentifier : '')
              || currentState?.signupPhoneCompletedActivation?.phoneNumber
              || currentState?.signupPhoneActivation?.phoneNumber
              || phoneNumber
            ).trim()
            : '';
          const currentEmail = currentIdentifierType === 'email'
            ? String(
              currentState?.email
              || (normalizeStep7IdentifierType(currentState?.accountIdentifierType) === 'email' ? currentState?.accountIdentifier : '')
              || resolveStep7FallbackEmail(currentState)
              || email
            ).trim()
            : '';
          const accountIdentifier = currentIdentifierType === 'phone'
            ? currentPhoneNumber
            : currentEmail;
          const oauthUrl = await refreshOAuthUrlBeforeStep6(currentState);
          if (typeof startOAuthFlowTimeoutWindow === 'function') {
            await startOAuthFlowTimeoutWindow({ step: completionStep, oauthUrl });
          }
          const loginTimeoutMs = typeof getOAuthFlowStepTimeoutMs === 'function'
            ? await getOAuthFlowStepTimeoutMs(180000, {
              step: completionStep,
              actionLabel: 'OAuth 登录并进入验证码页',
              oauthUrl,
            })
            : 180000;

          if (attempt === 1) {
            await addLog('正在打开最新 OAuth 链接并登录...', 'info', {
              step: completionStep,
              stepKey: 'oauth-login',
            });
          } else {
            await addLog(`上一轮失败后，正在进行第 ${attempt} 次尝试（最多 ${STEP6_MAX_ATTEMPTS} 次）...`, 'warn', {
              step: completionStep,
              stepKey: 'oauth-login',
            });
          }

          await reuseOrCreateTab('signup-page', oauthUrl, { forceNew: true });

          const result = await sendToContentScriptResilient(
            'signup-page',
            {
              type: 'EXECUTE_NODE',
              nodeId: 'oauth-login',
              step: 7,
              source: 'background',
              payload: {
                email: currentEmail,
                phoneNumber: currentPhoneNumber,
                countryId: currentState?.signupPhoneCompletedActivation?.countryId
                  ?? currentState?.signupPhoneActivation?.countryId
                  ?? null,
                countryLabel: String(
                  currentState?.signupPhoneCompletedActivation?.countryLabel
                  || currentState?.signupPhoneActivation?.countryLabel
                  || ''
                ).trim(),
                accountIdentifier,
                loginIdentifierType: currentIdentifierType,
                password,
                visibleStep: completionStep,
              },
            },
            {
              timeoutMs: loginTimeoutMs,
              responseTimeoutMs: loginTimeoutMs,
              retryDelayMs: 700,
              logMessage: '认证页正在切换，等待页面重新就绪后继续登录...',
              logStep: completionStep,
              logStepKey: 'oauth-login',
            }
          );

          if (result?.error) {
            throw new Error(result.error);
          }

          if (isStep6SuccessResult(result)) {
            const completionPayload = buildStep7CompletionPayload(
              result,
              { ...(currentState || {}), visibleStep: completionStep },
              currentIdentifierType,
              currentPhoneNumber
            );

            await completeNodeFromBackground(state?.nodeId || 'oauth-login', completionPayload);
            return;
          }

          if (isStep6RecoverableResult(result)) {
            const reasonMessage = result.message
              || `当前停留在${getLoginAuthStateLabel(result.state)}，准备重新执行步骤 ${completionStep}。`;
            throw new Error(reasonMessage);
          }

          throw new Error(`步骤 ${completionStep}：认证页未返回可识别的登录结果。`);
        } catch (err) {
          throwIfStopped(err);
          if (isAddPhoneAuthFailure(err)) {
            const latestAddPhoneState = typeof getState === 'function'
              ? await getState().catch(() => state)
              : state;
            await completeStep7PostLoginPhoneHandoff(
              { ...(state || {}), ...(latestAddPhoneState || {}) },
              err,
              completionStep
            );
            return;
          }
          if (isManagementSecretConfigError(err)) {
            await addLog(
              `检测到来源后台管理密钥缺失或错误，不再重试，当前流程停止。原因：${getErrorMessage(err)}`,
              'error',
              { step: completionStep, stepKey: 'oauth-login' }
            );
            throw err;
          }
          lastError = err;
          if (attempt >= STEP6_MAX_ATTEMPTS) {
            break;
          }

          await addLog(`第 ${attempt} 次尝试失败，原因：${getErrorMessage(err)}；准备重试...`, 'warn', {
            step: completionStep,
            stepKey: 'oauth-login',
          });
        }
      }

      throw new Error(`步骤 ${completionStep}：判断失败后已重试 ${STEP6_MAX_ATTEMPTS - 1} 次，仍未成功。最后原因：${getErrorMessage(lastError)}`);
    }

    return { executeStep7 };
  }

  return { createStep7Executor };
});
