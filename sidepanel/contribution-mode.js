  (function attachSidepanelContributionMode(globalScope) {
    const ACTIVE_STATUSES = new Set(['started', 'waiting', 'processing']);
    const FINAL_STATUSES = new Set(['auto_approved', 'auto_rejected', 'expired', 'error']);
    const translate = globalScope.GuJumpgateI18n?.t
      ? (key, params = {}, fallback = '') => globalScope.GuJumpgateI18n.t(key, params, fallback)
      : (_key, _params = {}, fallback = '') => fallback || '';
    const DEFAULT_COPY = translate('settings.contributionCopy', {}, 'Tài khoản hiện tại sẽ được dùng để hỗ trợ duy trì dự án. Extension sẽ tự xin địa chỉ đăng nhập đóng góp và theo dõi trạng thái ủy quyền; nếu phát hiện callback thì sẽ tự gửi và tiếp tục chờ xác nhận từ máy chủ.');
    const CONTRIBUTION_SOURCE_CPA = 'cpa';
    const CONTRIBUTION_SOURCE_SUB2API = 'sub2api';
    const CONTRIBUTION_SUB2API_DEFAULT_GROUP_NAME = 'codex号池';

  function createContributionModeManager(context = {}) {
    const {
      state,
      dom,
      helpers,
      runtime,
      constants = {},
    } = context;

    const contributionPortalUrl = constants.contributionPortalUrl || '';
    const guideRepositoryUrl = constants.guideRepositoryUrl || 'https://github.com/FoundZiGu/GuJumpgate';
    const contributionUploadUrl = constants.contributionUploadUrl || '';
    const pollIntervalMs = Math.max(1500, Math.floor(Number(constants.pollIntervalMs) || 2500));

    const hiddenRows = [
      dom.rowVpsUrl,
      dom.rowVpsPassword,
      dom.rowLocalCpaStep9Mode,
      dom.rowSub2ApiUrl,
      dom.rowSub2ApiEmail,
      dom.rowSub2ApiPassword,
      dom.rowSub2ApiGroup,
      dom.rowSub2ApiDefaultProxy,
      dom.rowCodex2ApiUrl,
      dom.rowCodex2ApiAdminKey,
      dom.rowCustomPassword,
      dom.rowAccountRunHistoryHelperBaseUrl,
    ].filter(Boolean);

    let actionInFlight = false;
    let pollInFlight = false;
    let pollTimer = null;

    function getLatestState() {
      return state.getLatestState?.() || {};
    }

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function normalizeStatus(value = '') {
      const normalized = normalizeString(value).toLowerCase();
      if (ACTIVE_STATUSES.has(normalized) || FINAL_STATUSES.has(normalized)) {
        return normalized;
      }
      return '';
    }

    function normalizeCallbackStatus(value = '') {
      const normalized = normalizeString(value).toLowerCase();
      switch (normalized) {
        case 'waiting':
        case 'captured':
        case 'submitting':
        case 'submitted':
        case 'failed':
        case 'idle':
          return normalized;
        default:
          return '';
      }
    }

    function normalizeContributionSource(value = '') {
      const normalized = normalizeString(value).toLowerCase();
      return normalized === CONTRIBUTION_SOURCE_SUB2API
        ? CONTRIBUTION_SOURCE_SUB2API
        : CONTRIBUTION_SOURCE_CPA;
    }

    function getContributionSource(currentState = getLatestState()) {
      return normalizeContributionSource(currentState.contributionSource || currentState.panelMode);
    }

    function getContributionSourceLabel(currentState = getLatestState()) {
      return getContributionSource(currentState) === CONTRIBUTION_SOURCE_SUB2API ? 'SUB2API' : 'CPA';
    }

    function isContributionModeEnabled(currentState = getLatestState()) {
      return Boolean(currentState.contributionMode);
    }

    function hasActiveContributionSession(currentState = getLatestState()) {
      const status = normalizeStatus(currentState.contributionStatus);
      return Boolean(normalizeString(currentState.contributionSessionId) && status && !FINAL_STATUSES.has(status));
    }

    function isModeSwitchBlocked() {
      return Boolean(helpers.isModeSwitchBlocked?.(getLatestState()));
    }

    function setContributionHidden(element, hidden) {
      element?.classList.toggle('is-contribution-hidden', hidden);
    }

    function syncContributionRows(enabled) {
      hiddenRows.forEach((row) => {
        setContributionHidden(row, enabled);
      });
    }

    function syncContributionButton(enabled, blocked) {
      if (!dom.btnContributionMode) {
        return;
      }

      dom.btnContributionMode.classList.toggle('is-active', enabled);
      dom.btnContributionMode.setAttribute('aria-pressed', String(enabled));
      dom.btnContributionMode.disabled = false;
      dom.btnContributionMode.title = translate('header.guide', {}, 'Hướng dẫn sử dụng');
    }

    function stopPolling() {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    }

    function schedulePolling(delayMs = pollIntervalMs) {
      stopPolling();
      if (!isContributionModeEnabled() || !hasActiveContributionSession()) {
        return;
      }

      pollTimer = setTimeout(() => {
        pollOnce({ silentError: true }).catch(() => {});
      }, delayMs);
    }

    function ensurePolling() {
      if (!isContributionModeEnabled() || !hasActiveContributionSession()) {
        stopPolling();
        return;
      }

      if (!pollTimer && !pollInFlight) {
        schedulePolling(1200);
      }
    }

    function getOauthStatusText(currentState = getLatestState()) {
      const status = normalizeStatus(currentState.contributionStatus);
      const hasAuthUrl = Boolean(normalizeString(currentState.contributionAuthUrl));
      if (!normalizeString(currentState.contributionSessionId) || !hasAuthUrl) {
        return translate('settings.oauthPending', {}, 'Chưa tạo địa chỉ đăng nhập');
      }
      if (status === 'waiting') {
        return 'Đang chờ gửi callback';
      }
      if (status === 'processing' || status === 'auto_approved' || status === 'auto_rejected') {
        return status === 'processing' ? 'Đã gửi callback' : 'Đã kết thúc ủy quyền';
      }
      if (status === 'expired' || status === 'error') {
        return 'Ủy quyền thất bại';
      }
      if (Number(currentState.contributionAuthOpenedAt) > 0) {
        return 'Đã mở trang ủy quyền';
      }
      return 'Đã tạo địa chỉ đăng nhập';
    }

    function getCallbackStatusText(currentState = getLatestState()) {
      const status = normalizeCallbackStatus(currentState.contributionCallbackStatus);
      switch (status) {
        case 'captured':
          return 'Đã bắt được địa chỉ callback';
        case 'submitting':
          return 'Đang gửi callback';
        case 'submitted':
          return 'Đã gửi callback';
        case 'failed':
          return 'Gửi callback thất bại';
        case 'waiting':
        case 'idle':
        default:
          return normalizeString(currentState.contributionCallbackUrl)
            ? 'Đã bắt được địa chỉ callback'
            : translate('settings.callbackWaiting', {}, 'Đang chờ callback');
      }
    }

    function getSummaryText(currentState = getLatestState()) {
      const statusMessage = normalizeString(currentState.contributionStatusMessage);
      if (statusMessage) {
        return statusMessage;
      }
      if (getContributionSource(currentState) === CONTRIBUTION_SOURCE_SUB2API) {
        const groupName = normalizeString(currentState.contributionTargetGroupName) || CONTRIBUTION_SUB2API_DEFAULT_GROUP_NAME;
        return `Tài khoản hiện tại sẽ được dùng để hỗ trợ duy trì dự án. Đóng góp sẽ được hoàn tất qua SUB2API và luôn ghi vào nhóm ${groupName}; nếu phát hiện callback, extension sẽ tự gửi và chờ xác nhận từ máy chủ.`;
      }
      return DEFAULT_COPY;
    }

    function getContributionPortalPageUrl() {
      return normalizeString(contributionPortalUrl);
    }

    function getContributionUploadPageUrl() {
      return normalizeString(contributionUploadUrl);
    }

    function openContributionPortalPage() {
      const targetUrl = getContributionPortalPageUrl();
      if (!targetUrl) {
        return;
      }
      helpers.openExternalUrl?.(targetUrl);
    }

    function openContributionUploadPage() {
      const targetUrl = getContributionUploadPageUrl();
      if (!targetUrl) {
        return;
      }
      helpers.openExternalUrl?.(targetUrl);
    }

    async function syncContributionProfile(partial = {}) {
      const payload = {
        nickname: normalizeString(partial.nickname),
        qq: normalizeString(partial.qq),
      };
      const response = await runtime.sendMessage({
        type: 'SET_CONTRIBUTION_PROFILE',
        source: 'sidepanel',
        payload,
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      if (response?.state) {
        helpers.applySettingsState?.(response.state);
      }
    }

    async function requestContributionMode(enabled) {
      const response = await runtime.sendMessage({
        type: 'SET_CONTRIBUTION_MODE',
        source: 'sidepanel',
        payload: { enabled: Boolean(enabled) },
      });

      if (response?.error) {
        throw new Error(response.error);
      }
      if (!response?.state) {
        throw new Error('Không nhận được trạng thái mới sau khi chuyển chế độ đóng góp.');
      }

      helpers.applySettingsState?.(response.state);
      helpers.updateStatusDisplay?.(response.state);
      render();
    }

    async function pollOnce(options = {}) {
      if (pollInFlight || !isContributionModeEnabled() || !hasActiveContributionSession()) {
        if (!hasActiveContributionSession()) {
          stopPolling();
        }
        return;
      }

      pollInFlight = true;
      try {
        const response = await runtime.sendMessage({
          type: 'POLL_CONTRIBUTION_STATUS',
          source: 'sidepanel',
          payload: {
            reason: options.reason || 'sidepanel_poll',
          },
        });

        if (response?.error) {
          throw new Error(response.error);
        }
        if (response?.state) {
          helpers.applySettingsState?.(response.state);
          helpers.updateStatusDisplay?.(response.state);
        }
      } finally {
        pollInFlight = false;
        render();
        if (hasActiveContributionSession()) {
          schedulePolling();
        } else {
          stopPolling();
        }
      }
    }

    async function startContributionFlow() {
      if (typeof helpers.startContributionAutoRun !== 'function') {
        throw new Error('Chế độ đóng góp hiện chưa nối vào khả năng khởi động luồng tự động chính.');
      }

      const profile = helpers.getContributionProfile?.() || {};
      const qq = normalizeString(profile.qq);
      if (qq && !/^\d{1,20}$/.test(qq)) {
        throw new Error('QQ 只能填写数字，且长度不能超过 20 位。');
      }
      await syncContributionProfile(profile);

      const started = await helpers.startContributionAutoRun();
      if (!started) {
        return;
      }

      helpers.showToast?.('Luồng tự động đóng góp đã khởi chạy.', 'info', 1800);
      render();
    }

    async function enterContributionMode() {
      await requestContributionMode(true);
      helpers.showToast?.('Đã vào chế độ đóng góp.', 'success', 1800);
    }

    async function exitContributionMode() {
      stopPolling();
      await requestContributionMode(false);
      helpers.showToast?.('Đã thoát chế độ đóng góp.', 'info', 1800);
    }

    function render() {
      const currentState = getLatestState();
      const enabled = isContributionModeEnabled(currentState);
      const blocked = isModeSwitchBlocked();
      const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
      const sourceLabel = getContributionSourceLabel(currentState);

      if (enabled && dom.selectPanelMode) {
        dom.selectPanelMode.value = getContributionSource(currentState);
      }

      helpers.updatePanelModeUI?.();
      helpers.updateAccountRunHistorySettingsUI?.();

      if (dom.contributionModePanel) {
        dom.contributionModePanel.hidden = !enabled;
      }
      if (dom.contributionModeText) {
        dom.contributionModeText.textContent = getSummaryText({
          contributionSource: currentState.contributionSource,
          contributionTargetGroupName: currentState.contributionTargetGroupName,
        });
      }
      if (dom.contributionModeBadge) {
        dom.contributionModeBadge.textContent = enabled ? sourceLabel : '';
      }
      if (dom.inputContributionNickname && activeElement !== dom.inputContributionNickname) {
        const nextNickname = normalizeString(currentState.contributionNickname);
        if (nextNickname || !normalizeString(dom.inputContributionNickname.value)) {
          dom.inputContributionNickname.value = nextNickname;
        }
      }
      if (dom.inputContributionQq && activeElement !== dom.inputContributionQq) {
        const nextQq = normalizeString(currentState.contributionQq);
        if (nextQq || !normalizeString(dom.inputContributionQq.value)) {
          dom.inputContributionQq.value = nextQq;
        }
      }
      if (dom.contributionOauthStatus) {
        dom.contributionOauthStatus.textContent = getOauthStatusText(currentState);
      }
      if (dom.contributionCallbackStatus) {
        dom.contributionCallbackStatus.textContent = getCallbackStatusText(currentState);
      }
      if (dom.contributionModeSummary) {
        dom.contributionModeSummary.textContent = getSummaryText(currentState);
      }

      syncContributionRows(enabled);
      syncContributionButton(enabled, blocked);

      if (dom.selectPanelMode) {
        dom.selectPanelMode.disabled = enabled;
      }

      if (dom.btnStartContribution) {
        dom.btnStartContribution.disabled = actionInFlight || blocked;
      }

      if (dom.btnOpenContributionUpload) {
        dom.btnOpenContributionUpload.disabled = !getContributionUploadPageUrl();
      }

      if (dom.btnExitContributionMode) {
        dom.btnExitContributionMode.disabled = actionInFlight || blocked;
        dom.btnExitContributionMode.title = blocked ? 'Quy trình hiện tại đang chạy, tạm thời chưa thể thoát chế độ đóng góp' : 'Thoát chế độ đóng góp';
      }

      if (dom.btnOpenAccountRecords) {
        dom.btnOpenAccountRecords.disabled = enabled;
      }

      if (enabled) {
        helpers.closeConfigMenu?.();
        helpers.closeAccountRecordsPanel?.();
        ensurePolling();
      } else {
        stopPolling();
      }

      helpers.updateConfigMenuControls?.();
    }

    function bindEvents() {
      dom.btnContributionMode?.addEventListener('click', async () => {
        try {
          helpers.openExternalUrl?.(guideRepositoryUrl);
        } catch (error) {
          helpers.showToast?.(`Mở trang hướng dẫn thất bại: ${error.message}`, 'error');
        }
      });

      dom.btnStartContribution?.addEventListener('click', async () => {
        if (actionInFlight) {
          return;
        }
        actionInFlight = true;
        render();
        try {
          await startContributionFlow();
        } catch (error) {
          helpers.showToast?.(error.message, 'error');
        } finally {
          actionInFlight = false;
          render();
        }
      });

      dom.inputContributionNickname?.addEventListener('change', async () => {
        try {
          await syncContributionProfile({
            nickname: dom.inputContributionNickname?.value,
            qq: dom.inputContributionQq?.value,
          });
        } catch (error) {
          helpers.showToast?.(error.message, 'error');
        } finally {
          render();
        }
      });

      dom.inputContributionQq?.addEventListener('change', async () => {
        try {
          await syncContributionProfile({
            nickname: dom.inputContributionNickname?.value,
            qq: dom.inputContributionQq?.value,
          });
        } catch (error) {
          helpers.showToast?.(error.message, 'error');
        } finally {
          render();
        }
      });

      dom.btnOpenContributionUpload?.addEventListener('click', () => {
        try {
          openContributionUploadPage();
        } catch (error) {
          helpers.showToast?.(`Mở trang tải lên thất bại: ${error.message}`, 'error');
        }
      });

      dom.btnExitContributionMode?.addEventListener('click', async () => {
        if (actionInFlight) {
          return;
        }
        actionInFlight = true;
        render();
        try {
          await exitContributionMode();
        } catch (error) {
          helpers.showToast?.(error.message, 'error');
        } finally {
          actionInFlight = false;
          render();
        }
      });
    }

    return {
      bindEvents,
      pollOnce,
      render,
      stopPolling,
    };
  }

  globalScope.SidepanelContributionMode = {
    createContributionModeManager,
  };
})(typeof window !== 'undefined' ? window : globalThis);
