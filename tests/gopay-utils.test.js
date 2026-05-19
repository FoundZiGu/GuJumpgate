const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadGoPayUtils() {
  const source = fs.readFileSync('shared/payment/gopay-utils.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.GoPayUtils;`)(globalScope);
}

test('GoPay utils normalize manual OTP input', () => {
  const api = loadGoPayUtils();
  assert.equal(api.normalizeGoPayOtp(' 12-34 56 '), '123456');
  assert.equal(api.normalizeGoPayOtp('abc'), '');
  assert.equal(api.normalizeGpcOtpChannel('sms'), 'sms');
  assert.equal(api.normalizeGpcOtpChannel('wa'), 'whatsapp');
  assert.equal(api.normalizeGpcOtpChannel('unknown'), 'whatsapp');
  assert.equal(api.normalizeGpcHelperPhoneMode('auto'), 'auto');
  assert.equal(api.normalizeGpcHelperPhoneMode('builtin'), 'auto');
  assert.equal(api.normalizeGpcHelperPhoneMode('manual'), 'manual');
  assert.equal(api.normalizeGpcHelperPhoneMode('unknown'), 'manual');
});

test('GoPay utils keeps GPC helper payment method distinct', () => {
  const api = loadGoPayUtils();
  assert.equal(api.normalizePlusPaymentMethod('gpc-helper'), 'gpc-helper');
  assert.equal(api.normalizePlusPaymentMethod('gopay'), 'gopay');
  assert.equal(api.normalizePlusPaymentMethod('unknown'), 'paypal');
});

test('GoPay utils builds GPC queue task and balance URLs from helper endpoints', () => {
  const api = loadGoPayUtils();
  assert.equal(api.DEFAULT_GPC_HELPER_API_URL, 'https://your-gpc-helper-domain.example');
  assert.equal(api.normalizeGpcHelperBaseUrl(''), 'https://your-gpc-helper-domain.example');
  assert.equal(api.normalizeGpcHelperBaseUrl('https://example.com/api/gp/tasks'), 'https://example.com');
  assert.equal(
    api.buildGpcHelperApiUrl('', '/api/checkout/start'),
    'https://your-gpc-helper-domain.example/api/checkout/start'
  );
  assert.equal(
    api.buildGpcApiKeyBalanceUrl('http://localhost:18473/'),
    'http://localhost:18473/api/gp/balance'
  );
  assert.equal(
    api.buildGpcCardBalanceUrl('https://your-gpc-helper-domain.example/api/gp/balance'),
    'https://your-gpc-helper-domain.example/api/gp/balance'
  );
  assert.deepEqual(
    api.buildGpcApiKeyHeaders(' gpc-123 ', { Accept: 'application/json' }),
    { Accept: 'application/json', 'X-API-Key': 'gpc-123' }
  );
  assert.equal(
    api.buildGpcTaskCreateUrl('https://your-gpc-helper-domain.example/api/checkout/start'),
    'https://your-gpc-helper-domain.example/api/gp/tasks'
  );
  assert.equal(
    api.buildGpcTaskQueryUrl('https://your-gpc-helper-domain.example/api/gp/tasks/task_old?card_key=old', 'task/1'),
    'https://your-gpc-helper-domain.example/api/gp/tasks/task%2F1'
  );
  assert.equal(
    api.buildGpcTaskActionUrl('https://your-gpc-helper-domain.example/api/gp/tasks/task_old/stop', 'task_1', 'pin'),
    'https://your-gpc-helper-domain.example/api/gp/tasks/task_1/pin'
  );
});

test('GoPay utils builds GPC queue OTP/PIN payloads without card_key', () => {
  const api = loadGoPayUtils();
  assert.deepEqual(
    api.buildGpcTaskOtpPayload({ otp: ' 12-34 56 ', card_key: ' card_1 ', reference_id: 'ref_1' }),
    { otp: '123456' }
  );
  assert.deepEqual(
    api.buildGpcTaskPinPayload({ pin: '65-43-21', cardKey: 'card_1', challengeId: 'challenge_1' }),
    { pin: '654321' }
  );
});

test('GoPay utils formats balance and maps linked-account errors', () => {
  const api = loadGoPayUtils();
  assert.equal(
    api.formatGpcBalancePayload({ remaining_uses: 12, status: 'active', used_uses: 2, flow_id: 'flow_1' }),
    '余额 12，已用 2，状态 active，flow_id flow_1'
  );
  assert.equal(
    api.formatGpcBalancePayload({
      code: 200,
      message: 'ok',
      data: { remaining_uses: 0, total_uses: 3, used_uses: 3, status: 'active', auto_mode_enabled: false },
    }),
    '余额 0/3，已用 3，状态 active'
  );
  assert.equal(
    api.formatGpcBalancePayload({
      code: 200,
      message: 'ok',
      data: { remaining_uses: 998, total_uses: 1000, used_uses: 2, status: 'active', auto_mode_enabled: true },
    }),
    '余额 998/1000，已用 2，状态 active'
  );
  assert.equal(api.getGpcBalanceRemainingUses({ data: { remaining_uses: 998 } }), 998);
  assert.equal(api.isGpcAutoModeEnabled({ data: { auto_mode_enabled: true } }), true);
  assert.equal(api.isGpcAutoModeEnabled({ data: { auto_mode_enabled: false } }), false);
  assert.deepEqual(
    api.unwrapGpcResponse({ code: 200, message: 'ok', data: { task_id: 'task_1' } }),
    { task_id: 'task_1' }
  );
  assert.equal(
    api.extractGpcResponseErrorDetail({ errors: [{ loc: ['body', 'otp'], msg: 'Field required' }] }, 422),
    'body.otp: Field required'
  );
  assert.equal(
    api.extractGpcResponseErrorDetail({
      code: 400,
      message: 'invalid_param',
      data: { detail: '手机号不能为空', fields: [{ field: 'phone_number', message: '必填' }] },
    }, 400),
    '手机号不能为空'
  );
  assert.equal(
    api.extractGpcResponseErrorDetail({
      code: 400,
      message: 'invalid_param',
      data: { fields: [{ field: 'phone_number', message: '必填' }] },
    }, 400),
    'phone_number: 必填'
  );
  assert.equal(
    api.extractGpcResponseErrorDetail({ error_messages: ['account already linked'] }, 406),
    'GOPAY已经绑了订阅，需要手动解绑'
  );
});
