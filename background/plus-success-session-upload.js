(function attachBackgroundPlusSuccessSessionUpload(root, factory) {
  root.MultiPageBackgroundPlusSuccessSessionUpload = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundPlusSuccessSessionUploadModule() {
  const PAYMENTS_SUCCESS_URL_PATTERN = /^https:\/\/(?:chatgpt\.com|www\.chatgpt\.com|chat\.openai\.com)\/(?:backend-api\/)?payments\/success(?:[/?#]|$)/i;

  function createPlusSuccessSessionUploadManager(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      completeNodeFromBackground = null,
      failNodeFromBackground = null,
      getState = async () => ({}),
      setState = async () => {},
      delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0))),
    } = deps;

    const activeTabIds = new Set();

    function addLog(message, level = 'info', options = {}) {
      return rawAddLog(message, level, {
        step: 6,
        stepKey: 'plus-checkout-create',
        ...(options && typeof options === 'object' ? options : {}),
      });
    }

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function isPaymentsSuccessUrl(url = '') {
      return PAYMENTS_SUCCESS_URL_PATTERN.test(String(url || ''));
    }

    function normalizeOauthDelaySeconds(value = 0) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return 0;
      }
      return Math.min(3600, Math.max(0, Math.floor(numeric)));
    }

    function isHostedCheckoutSuccessWaitActive(state = {}, tabId = null) {
      if (normalizeString(state?.plusPaymentMethod).toLowerCase() !== 'paypal') {
        return false;
      }
      if (state?.plusHostedCheckoutIsFinalStep === false) {
        return false;
      }
      const nodeStatus = normalizeString(state?.nodeStatuses?.['plus-checkout-create']).toLowerCase();
      if (nodeStatus && nodeStatus !== 'running' && nodeStatus !== 'pending') {
        return false;
      }
      const checkoutTabId = Number(state?.plusCheckoutTabId);
      if (!Number.isInteger(checkoutTabId) || checkoutTabId <= 0) {
        return false;
      }
      return tabId === null || checkoutTabId === Number(tabId);
    }

    async function processPaymentsSuccessTab(tabId, successUrl = '') {
      const numericTabId = Number(tabId);
      if (!Number.isInteger(numericTabId) || activeTabIds.has(numericTabId)) {
        return null;
      }

      const initialState = await getState();
      if (!isHostedCheckoutSuccessWaitActive(initialState, numericTabId)) {
        return null;
      }

      activeTabIds.add(numericTabId);
      try {
        const latestState = await getState();
        if (!isHostedCheckoutSuccessWaitActive(latestState, numericTabId)) {
          return null;
        }

        const normalizedSuccessUrl = normalizeString(successUrl);
        await setState({
          plusReturnUrl: normalizedSuccessUrl,
        });
        const skipPostPaymentOAuthEnabled = Boolean(latestState?.skipPostPaymentOAuthEnabled);
        await addLog(
          skipPostPaymentOAuthEnabled
            ? '步骤 6：检测到 ChatGPT 支付成功页，已按设置跳过后续 OAuth 流程。'
            : '步骤 6：检测到 ChatGPT 支付成功页，准备继续 OAuth 流程。',
          'ok'
        );

        const oauthDelaySeconds = skipPostPaymentOAuthEnabled
          ? 0
          : normalizeOauthDelaySeconds(latestState?.plusHostedCheckoutOauthDelaySeconds);
        if (oauthDelaySeconds > 0) {
          await addLog(`步骤 6：已按设置等待 ${oauthDelaySeconds} 秒，之后再进入 OAuth 登录。`, 'info');
          await delay(oauthDelaySeconds * 1000);
          const delayedState = await getState();
          if (!isHostedCheckoutSuccessWaitActive(delayedState, numericTabId)) {
            return null;
          }
        }

        if (typeof completeNodeFromBackground === 'function') {
          await completeNodeFromBackground('plus-checkout-create', {
            plusReturnUrl: normalizedSuccessUrl,
            plusHostedCheckoutCompleted: true,
            plusHostedCheckoutOauthDelaySeconds: oauthDelaySeconds,
            skipPostPaymentOAuthEnabled,
          });
        }

        return {
          completed: true,
          plusReturnUrl: normalizedSuccessUrl,
          oauthDelaySeconds,
          skipPostPaymentOAuthEnabled,
        };
      } catch (error) {
        const message = normalizeString(error?.message) || 'unknown error';
        await addLog(`支付成功页收尾失败：${message}`, 'error');
        if (typeof failNodeFromBackground === 'function') {
          await failNodeFromBackground('plus-checkout-create', message);
          return {
            completed: false,
            failed: true,
            message,
          };
        }
        throw error;
      } finally {
        activeTabIds.delete(numericTabId);
      }
    }

    async function handleTabUpdated(tabId, changeInfo = {}, tab = {}) {
      if (changeInfo?.status !== 'complete') {
        return null;
      }
      const nextUrl = normalizeString(changeInfo?.url || tab?.url);
      if (!isPaymentsSuccessUrl(nextUrl)) {
        return null;
      }
      return processPaymentsSuccessTab(Number(tabId), nextUrl);
    }

    return {
      isPaymentsSuccessUrl,
      isHostedCheckoutSuccessWaitActive,
      processPaymentsSuccessTab,
      handleTabUpdated,
    };
  }

  return {
    createPlusSuccessSessionUploadManager,
  };
});
