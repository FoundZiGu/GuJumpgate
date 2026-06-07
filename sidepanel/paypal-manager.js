(function attachSidepanelPayPalManager(globalScope) {
  function createPayPalManager(context = {}) {
    const {
      state,
      dom,
      helpers,
      runtime,
      paypalUtils = {},
    } = context;

    let actionInFlight = false;
    let payPalAccountPicker = null;

    function getPayPalAccounts(currentState = state.getLatestState()) {
      return helpers.getPayPalAccounts(currentState);
    }

    function getCurrentPayPalAccountId(currentState = state.getLatestState()) {
      return String(currentState?.currentPayPalAccountId || '').trim();
    }

    function buildSelectOptions(accounts = []) {
      if (!accounts.length) {
        return '<option value=""></option>';
      }
      return accounts.map((account) => (
        `<option value="${helpers.escapeHtml(account.id)}">${helpers.escapeHtml(account.email || '(Tài khoản chưa đặt tên)')}</option>`
      )).join('');
    }

    function getPayPalAccountValue(account = {}) {
      return String(account?.id || '').trim();
    }

    function getPayPalAccountLabel(account = {}) {
      return String(account?.email || '(Tài khoản chưa đặt tên)');
    }

    function normalizePickerPayPalAccounts(accounts = []) {
      return Array.isArray(accounts)
        ? accounts.filter((account) => getPayPalAccountValue(account))
        : [];
    }

    function getPayPalAccountPicker() {
      if (payPalAccountPicker) {
        return payPalAccountPicker;
      }

      const pickerModule = helpers.editableListPicker || globalScope.SidepanelEditableListPicker;
      const createEditableListPicker = pickerModule?.createEditableListPicker;
      if (
        typeof createEditableListPicker !== 'function'
        || !dom.payPalAccountPickerRoot
        || !dom.btnPayPalAccountMenu
        || !dom.payPalAccountCurrent
        || !dom.payPalAccountMenu
      ) {
        return null;
      }

      payPalAccountPicker = createEditableListPicker({
        root: dom.payPalAccountPickerRoot,
        input: dom.selectPayPalAccount,
        trigger: dom.btnPayPalAccountMenu,
        current: dom.payPalAccountCurrent,
        menu: dom.payPalAccountMenu,
        emptyLabel: '',
        itemLabel: 'Tài khoản',
        normalizeItems: normalizePickerPayPalAccounts,
        normalizeValue: (value) => String(value || '').trim(),
        getItemValue: getPayPalAccountValue,
        getItemLabel: getPayPalAccountLabel,
        getItemDeleteLabel: getPayPalAccountLabel,
        onDelete: (accountId) => handleDeletePayPalAccount(accountId),
        onDeleteError: (error, fallbackMessage) => {
          helpers.showToast(error?.message || fallbackMessage, 'error');
        },
      });
      return payPalAccountPicker;
    }

    function applyPayPalAccountMutation(account) {
      if (!account?.id) return;
      const latestState = state.getLatestState();
      const nextAccounts = typeof paypalUtils.upsertPayPalAccountInList === 'function'
        ? paypalUtils.upsertPayPalAccountInList(getPayPalAccounts(latestState), account)
        : [...getPayPalAccounts(latestState), account];
      state.syncLatestState({ paypalAccounts: nextAccounts });
      renderPayPalAccounts();
    }

    function renderPayPalAccounts() {
      if (!dom.selectPayPalAccount) return;

      const latestState = state.getLatestState();
      const accounts = getPayPalAccounts(latestState);
      const currentId = getCurrentPayPalAccountId(latestState);
      const selectedId = accounts.some((account) => account.id === currentId) ? currentId : '';
      const picker = getPayPalAccountPicker();

      if (picker) {
        picker.render(accounts, selectedId);
        return;
      }

      dom.selectPayPalAccount.innerHTML = buildSelectOptions(accounts);
      dom.selectPayPalAccount.disabled = accounts.length === 0;
      dom.selectPayPalAccount.value = selectedId;
    }

    async function syncSelectedPayPalAccount(options = {}) {
      const { silent = false } = options;
      const accountId = String(dom.selectPayPalAccount?.value || '').trim();
      if (!accountId) {
        state.syncLatestState({
          currentPayPalAccountId: null,
          paypalEmail: '',
          paypalPassword: '',
        });
        renderPayPalAccounts();
        return null;
      }

      const response = await runtime.sendMessage({
        type: 'SELECT_PAYPAL_ACCOUNT',
        source: 'sidepanel',
        payload: { accountId },
      });
      if (response?.error) {
        throw new Error(response.error);
      }

      state.syncLatestState({
        currentPayPalAccountId: response.account?.id || accountId,
        paypalEmail: String(response.account?.email || '').trim(),
        paypalPassword: String(response.account?.password || ''),
      });
      renderPayPalAccounts();
      if (!silent) {
        helpers.showToast(`已切换当前 Tài khoản PayPal为 ${response.account?.email || accountId}`, 'success', 1800);
      }
      return response.account || null;
    }

    async function handleDeletePayPalAccount(accountId) {
      if (actionInFlight) return;

      const targetId = String(accountId || '').trim();
      if (!targetId) {
        return;
      }

      const latestState = state.getLatestState();
      const accounts = getPayPalAccounts(latestState);
      const targetAccount = accounts.find((account) => account.id === targetId);
      if (!targetAccount) {
        return;
      }

      actionInFlight = true;
      if (dom.btnAddPayPalAccount) {
        dom.btnAddPayPalAccount.disabled = true;
      }

      try {
        const nextAccounts = accounts.filter((account) => account.id !== targetId);
        const currentId = getCurrentPayPalAccountId(latestState);
        const nextCurrentAccount = currentId === targetId
          ? (nextAccounts[0] || null)
          : (nextAccounts.find((account) => account.id === currentId) || null);
        const payload = {
          paypalAccounts: nextAccounts,
          currentPayPalAccountId: nextCurrentAccount?.id || '',
          paypalEmail: String(nextCurrentAccount?.email || '').trim(),
          paypalPassword: String(nextCurrentAccount?.password || ''),
        };

        const response = await runtime.sendMessage({
          type: 'SAVE_SETTING',
          source: 'sidepanel',
          payload,
        });
        if (response?.error) {
          throw new Error(response.error);
        }

        state.syncLatestState({
          ...payload,
          currentPayPalAccountId: payload.currentPayPalAccountId || null,
        });
        renderPayPalAccounts();
        helpers.showToast(`已Xoá Tài khoản PayPal：${targetAccount.email || targetId}`, 'success', 1600);
      } finally {
        actionInFlight = false;
        if (dom.btnAddPayPalAccount) {
          dom.btnAddPayPalAccount.disabled = false;
        }
      }
    }

    async function openPayPalAccountDialog() {
      if (typeof helpers.openFormDialog !== 'function') {
        throw new Error('Khả năng popup biểu mẫu chưa được tải, hãy làm mới extension rồi thử lại.');
      }
      return helpers.openFormDialog({
        title: '添加 Tài khoản PayPal',
        confirmLabel: 'Lưu tài khoản',
        confirmVariant: 'btn-primary',
        fields: [
          {
            key: 'email',
            label: 'Tài khoản PayPal',
            type: 'text',
            placeholder: 'Hãy nhập email đăng nhập PayPal',
            autocomplete: 'username',
            required: true,
            requiredMessage: '请先填写 Tài khoản PayPal。',
            validate: (value) => {
              const normalized = String(value || '').trim();
              if (!normalized.includes('@')) {
                return 'Tài khoản PayPal需填写邮箱格式。';
              }
              return '';
            },
          },
          {
            key: 'password',
            label: 'Mật khẩu PayPal',
            type: 'password',
            placeholder: 'Hãy nhập mật khẩu đăng nhập PayPal',
            autocomplete: 'current-password',
            required: true,
            requiredMessage: '请先填写 Mật khẩu PayPal。',
          },
        ],
      });
    }

    async function handleAddPayPalAccount() {
      if (actionInFlight) return;

      const formValues = await openPayPalAccountDialog();
      if (!formValues) {
        return;
      }

      actionInFlight = true;
      if (dom.btnAddPayPalAccount) {
        dom.btnAddPayPalAccount.disabled = true;
      }

      try {
        const response = await runtime.sendMessage({
          type: 'UPSERT_PAYPAL_ACCOUNT',
          source: 'sidepanel',
          payload: {
            email: String(formValues.email || '').trim(),
            password: String(formValues.password || ''),
          },
        });
        if (response?.error) {
          throw new Error(response.error);
        }

        applyPayPalAccountMutation(response.account);
        if (response.account?.id) {
          state.syncLatestState({ currentPayPalAccountId: response.account.id });
          renderPayPalAccounts();
          dom.selectPayPalAccount.value = response.account.id;
          await syncSelectedPayPalAccount({ silent: true });
        }
        helpers.showToast(`Đã lưu Tài khoản PayPal ${response.account?.email || ''}`, 'success', 2200);
      } catch (error) {
        helpers.showToast(`保存 Tài khoản PayPalThất bại：${error.message}`, 'error');
        throw error;
      } finally {
        actionInFlight = false;
        if (dom.btnAddPayPalAccount) {
          dom.btnAddPayPalAccount.disabled = false;
        }
      }
    }

    function bindPayPalEvents() {
      dom.btnAddPayPalAccount?.addEventListener('click', () => {
        void handleAddPayPalAccount();
      });
      dom.selectPayPalAccount?.addEventListener('change', () => {
        void syncSelectedPayPalAccount().catch((error) => {
          helpers.showToast(error.message, 'error');
          renderPayPalAccounts();
        });
      });
    }

    return {
      bindPayPalEvents,
      handleDeletePayPalAccount,
      renderPayPalAccounts,
      syncSelectedPayPalAccount,
    };
  }

  globalScope.SidepanelPayPalManager = {
    createPayPalManager,
  };
})(window);
