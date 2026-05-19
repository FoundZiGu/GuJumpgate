const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('sidepanel loads reusable form dialog and paypal manager before sidepanel bootstrap', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  const formDialogIndex = html.indexOf('<script src="form-dialog.js"></script>');
  const editableListPickerIndex = html.indexOf('<script src="editable-list-picker.js"></script>');
  const managerIndex = html.indexOf('<script src="paypal-manager.js"></script>');
  const hostedSmsPoolManagerIndex = html.indexOf('<script src="hosted-sms-pool-manager.js"></script>');
  const sidepanelIndex = html.indexOf('<script src="sidepanel.js"></script>');

  assert.notEqual(formDialogIndex, -1);
  assert.notEqual(editableListPickerIndex, -1);
  assert.notEqual(managerIndex, -1);
  assert.notEqual(hostedSmsPoolManagerIndex, -1);
  assert.notEqual(sidepanelIndex, -1);
  assert.ok(formDialogIndex < editableListPickerIndex);
  assert.ok(editableListPickerIndex < managerIndex);
  assert.ok(managerIndex < sidepanelIndex);
  assert.ok(hostedSmsPoolManagerIndex < sidepanelIndex);
});

test('sidepanel html contains paypal select and GoPay controls', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

  assert.match(html, /id="row-plus-payment-method"/);
  assert.match(html, /id="select-plus-payment-method"/);
  assert.match(html, /id="row-paypal-account"/);
  assert.match(html, /id="select-paypal-account"/);
  assert.match(html, /id="paypal-account-picker"/);
  assert.match(html, /id="btn-paypal-account-menu"/);
  assert.match(html, /id="paypal-account-menu"/);
  assert.match(html, /id="btn-add-paypal-account"/);
  assert.match(html, /id="row-paypal-hosted-settings"/);
  assert.match(html, /PayPal Hosted/);
  assert.match(html, /支付后继续 OAuth/);
  assert.match(html, /Hosted 接码池/);
  assert.match(html, /id="btn-hosted-sms-pool-import"/);
  assert.match(html, /id="hosted-sms-pool-list"/);
  const hostedPoolStart = html.indexOf('id="row-hosted-checkout-sms-pool"');
  const hostedPoolEnd = html.indexOf('id="row-gpc-helper-api"', hostedPoolStart);
  const hostedPoolHtml = html.slice(hostedPoolStart, hostedPoolEnd);
  assert.match(hostedPoolHtml, /清空次数/);
  assert.doesNotMatch(hostedPoolHtml, /清空已用/);
  assert.match(html, /1234567890&#10;&#10;https:\/\/mail\.test\.com\/api\/text-relay\/eca_tr_xxxxxxxxx/);
  assert.doesNotMatch(html, /\+15822452843----http:\/\/a\.62-us\.com\/api\/get_sms/);
  assert.match(html, /默认关闭，支付成功后直接结束/);
  assert.doesNotMatch(html, /<span class="data-label">验证码接口<\/span>/);
  assert.doesNotMatch(html, /<span class="data-label">PayPal 电话<\/span>/);
  assert.match(html, /id="row-gopay-phone"/);
  assert.match(html, /id="input-gopay-phone"/);
  assert.match(html, /id="row-gopay-otp"/);
  assert.match(html, /id="input-gopay-otp"/);
  assert.match(html, /id="row-gopay-pin"/);
  assert.match(html, /id="input-gopay-pin"/);
  assert.match(html, /id="shared-form-modal"/);
});

test('sidepanel html places OAuth toggle first and Hotmail pool below registration email', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  const hostedPanelIndex = html.indexOf('id="row-paypal-hosted-settings"');
  const oauthToggleIndex = html.indexOf('id="row-skip-post-payment-oauth"');
  const paypalAccountIndex = html.indexOf('id="row-paypal-account"');
  const registerEmailIndex = html.indexOf('id="row-auto-run-controls"');
  const hotmailSectionIndex = html.indexOf('id="hotmail-section"');
  const runSettingsIndex = html.indexOf('id="run-settings-card"');
  const statusIndex = html.indexOf('当前状态');
  const settingsCardStartIndex = html.indexOf('id="settings-card"');
  const settingsCardEndIndex = html.indexOf('id="run-settings-card"');
  const settingsCardBody = html.slice(settingsCardStartIndex, settingsCardEndIndex);

  assert.ok(hostedPanelIndex >= 0);
  assert.ok(oauthToggleIndex > hostedPanelIndex);
  assert.ok(paypalAccountIndex > oauthToggleIndex);
  assert.ok(registerEmailIndex >= 0);
  assert.ok(hotmailSectionIndex > registerEmailIndex);
  assert.ok(runSettingsIndex > hotmailSectionIndex);
  assert.ok(statusIndex > runSettingsIndex);
  assert.match(settingsCardBody, /id="row-mail-provider"/);
  assert.match(settingsCardBody, /id="row-auto-run-controls"/);
  assert.match(settingsCardBody, /id="hotmail-section"/);
  assert.doesNotMatch(html, /基础配置/);
});

test('hosted sms pool manager deletes all entries and clears old fallback fields', async () => {
  const source = fs.readFileSync('sidepanel/hosted-sms-pool-manager.js', 'utf8');
  const windowObject = {};
  const api = new Function('window', `${source}; return window.SidepanelHostedSmsPoolManager;`)(windowObject);

  let text = '+15822452843----http://a.62-us.com/api/get_sms?key=old';
  let usage = { [text]: { useCount: 2, usedAt: 1, lastError: 'failed' } };
  let fallbackCleared = false;
  const handlers = {};
  const manager = api.createHostedSmsPoolManager({
    dom: {
      btnHostedSmsPoolRefresh: { disabled: false, addEventListener() {} },
      btnHostedSmsPoolClearUsed: { disabled: false, addEventListener() {} },
      btnHostedSmsPoolDeleteAll: {
        disabled: false,
        addEventListener(type, handler) {
          handlers[type] = handler;
        },
      },
      inputHostedSmsPoolImport: { disabled: false, addEventListener() {} },
      btnHostedSmsPoolImport: { disabled: false, addEventListener() {} },
      hostedSmsPoolSummary: { textContent: '' },
      hostedSmsPoolList: { innerHTML: '' },
    },
    helpers: {
      openConfirmModal: async () => true,
      showToast() {},
    },
    state: {
      getText: () => text,
      setText: (nextText) => {
        text = nextText;
      },
      getUsage: () => usage,
      setUsage: (nextUsage) => {
        usage = nextUsage;
      },
    },
    actions: {
      clearFallback: () => {
        fallbackCleared = true;
      },
      persistPool: async () => {},
    },
  });

  manager.bindEvents();
  handlers.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(text, '');
  assert.deepEqual(usage, {});
  assert.equal(fallbackCleared, true);
});

test('hosted sms pool manager accepts phone and relay url as two-line import hint format', async () => {
  const source = fs.readFileSync('sidepanel/hosted-sms-pool-manager.js', 'utf8');
  const windowObject = {};
  const originalDocument = global.document;
  global.document = {
    createElement: () => ({
      className: '',
      innerHTML: '',
      querySelector: () => ({ addEventListener() {} }),
    }),
  };
  try {
    const api = new Function('window', `${source}; return window.SidepanelHostedSmsPoolManager;`)(windowObject);
    let text = '';
    let usage = {};
    const handlers = {};
    const manager = api.createHostedSmsPoolManager({
      dom: {
        btnHostedSmsPoolRefresh: { disabled: false, addEventListener() {} },
        btnHostedSmsPoolClearUsed: { disabled: false, addEventListener() {} },
        btnHostedSmsPoolDeleteAll: { disabled: false, addEventListener() {} },
        inputHostedSmsPoolImport: {
          value: '1234567890\n\nhttps://mail.test.com/api/text-relay/eca_tr_xxxxxxxxx',
          disabled: false,
          addEventListener() {},
        },
        btnHostedSmsPoolImport: {
          disabled: false,
          addEventListener(type, handler) {
            handlers[type] = handler;
          },
        },
        hostedSmsPoolSummary: { textContent: '' },
        hostedSmsPoolList: {
          innerHTML: '',
          appendChild() {},
        },
      },
      helpers: {
        escapeHtml: (value) => String(value || ''),
        showToast() {},
      },
      state: {
        getText: () => text,
        setText: (nextText) => {
          text = nextText;
        },
        getUsage: () => usage,
        setUsage: (nextUsage) => {
          usage = nextUsage;
        },
      },
      actions: {
        persistPool: async () => {},
      },
      constants: {
        copyIcon: '',
      },
    });

    manager.bindEvents();
    handlers.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(text, '1234567890----https://mail.test.com/api/text-relay/eca_tr_xxxxxxxxx');
  } finally {
    global.document = originalDocument;
  }
});

test('paypal manager saves a paypal account and selects it immediately', async () => {
  const source = fs.readFileSync('sidepanel/paypal-manager.js', 'utf8');
  const windowObject = {};
  const api = new Function('window', `${source}; return window.SidepanelPayPalManager;`)(windowObject);

  let latestState = {
    paypalAccounts: [],
    currentPayPalAccountId: null,
    paypalEmail: '',
    paypalPassword: '',
  };
  const events = [];
  const clickHandlers = {};
  const changeHandlers = {};
  const selectNode = {
    innerHTML: '',
    value: '',
    disabled: false,
    addEventListener(type, handler) {
      changeHandlers[type] = handler;
    },
  };
  const addButton = {
    disabled: false,
    addEventListener(type, handler) {
      clickHandlers[type] = handler;
    },
  };

  const manager = api.createPayPalManager({
    state: {
      getLatestState: () => latestState,
      syncLatestState(updates) {
        latestState = { ...latestState, ...updates };
      },
    },
    dom: {
      btnAddPayPalAccount: addButton,
      selectPayPalAccount: selectNode,
    },
    helpers: {
      escapeHtml: (value) => String(value || ''),
      getPayPalAccounts: (state) => Array.isArray(state?.paypalAccounts) ? state.paypalAccounts : [],
      openFormDialog: async () => ({ email: 'user@example.com', password: 'secret' }),
      showToast(message, tone) {
        events.push({ type: 'toast', message, tone });
      },
    },
    runtime: {
      sendMessage: async (message) => {
        events.push({ type: 'message', message });
        if (message.type === 'UPSERT_PAYPAL_ACCOUNT') {
          return {
            ok: true,
            account: {
              id: 'pp-1',
              email: 'user@example.com',
              password: 'secret',
            },
          };
        }
        if (message.type === 'SELECT_PAYPAL_ACCOUNT') {
          return {
            ok: true,
            account: {
              id: 'pp-1',
              email: 'user@example.com',
              password: 'secret',
            },
          };
        }
        throw new Error(`unexpected message ${message.type}`);
      },
    },
    paypalUtils: {
      upsertPayPalAccountInList(accounts, nextAccount) {
        const list = Array.isArray(accounts) ? accounts.slice() : [];
        const existingIndex = list.findIndex((account) => account.id === nextAccount.id);
        if (existingIndex >= 0) {
          list[existingIndex] = nextAccount;
          return list;
        }
        list.push(nextAccount);
        return list;
      },
    },
  });

  manager.bindPayPalEvents();
  manager.renderPayPalAccounts();

  assert.doesNotMatch(selectNode.innerHTML, /请先添加 PayPal 账号/);
  assert.match(selectNode.innerHTML, /<option value=""><\/option>/);
  clickHandlers.click();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepStrictEqual(
    events.filter((event) => event.type === 'message').map((event) => event.message.type),
    ['UPSERT_PAYPAL_ACCOUNT', 'SELECT_PAYPAL_ACCOUNT']
  );
  assert.equal(latestState.currentPayPalAccountId, 'pp-1');
  assert.equal(latestState.paypalEmail, 'user@example.com');
  assert.equal(latestState.paypalPassword, 'secret');
  assert.equal(selectNode.value, 'pp-1');
  assert.equal(selectNode.disabled, false);
  assert.match(events.at(-1)?.message || '', /已保存 PayPal 账号/);
});

test('paypal manager uses editable picker and deletes obsolete account', async () => {
  const source = fs.readFileSync('sidepanel/paypal-manager.js', 'utf8');
  const windowObject = {};
  const api = new Function('window', `${source}; return window.SidepanelPayPalManager;`)(windowObject);

  let latestState = {
    paypalAccounts: [
      { id: 'pp-1', email: 'old@example.com', password: 'old-secret' },
      { id: 'pp-2', email: 'next@example.com', password: 'next-secret' },
    ],
    currentPayPalAccountId: 'pp-1',
    paypalEmail: 'old@example.com',
    paypalPassword: 'old-secret',
  };
  const events = [];
  const renderCalls = [];
  let pickerConfig = null;
  const selectNode = {
    value: '',
    addEventListener() {},
  };

  const manager = api.createPayPalManager({
    state: {
      getLatestState: () => latestState,
      syncLatestState(updates) {
        latestState = { ...latestState, ...updates };
      },
    },
    dom: {
      btnAddPayPalAccount: { disabled: false, addEventListener() {} },
      btnPayPalAccountMenu: {},
      payPalAccountCurrent: {},
      payPalAccountMenu: {},
      payPalAccountPickerRoot: {},
      selectPayPalAccount: selectNode,
    },
    helpers: {
      editableListPicker: {
        createEditableListPicker(config) {
          pickerConfig = config;
          return {
            render(items, selectedValue) {
              renderCalls.push({ items, selectedValue });
              selectNode.value = selectedValue;
            },
          };
        },
      },
      escapeHtml: (value) => String(value || ''),
      getPayPalAccounts: (state) => Array.isArray(state?.paypalAccounts) ? state.paypalAccounts : [],
      openFormDialog: async () => null,
      showToast(message, tone) {
        events.push({ type: 'toast', message, tone });
      },
    },
    runtime: {
      sendMessage: async (message) => {
        events.push({ type: 'message', message });
        if (message.type === 'SAVE_SETTING') {
          return { ok: true };
        }
        throw new Error(`unexpected message ${message.type}`);
      },
    },
  });

  manager.renderPayPalAccounts();
  assert.equal(renderCalls.at(-1).selectedValue, 'pp-1');
  assert.equal(pickerConfig.getItemLabel(latestState.paypalAccounts[0]), 'old@example.com');

  await pickerConfig.onDelete('pp-1');

  const saveMessage = events.find((event) => event.type === 'message')?.message;
  assert.equal(saveMessage.type, 'SAVE_SETTING');
  assert.deepEqual(
    saveMessage.payload.paypalAccounts.map((account) => account.id),
    ['pp-2']
  );
  assert.equal(saveMessage.payload.currentPayPalAccountId, 'pp-2');
  assert.equal(latestState.currentPayPalAccountId, 'pp-2');
  assert.equal(latestState.paypalEmail, 'next@example.com');
  assert.match(events.at(-1)?.message || '', /已删除 PayPal 账号：old@example\.com/);
});
