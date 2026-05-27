const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadStepDefinitionsModule() {
  const filePath = path.join(__dirname, '..', 'data', 'step-definitions.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageStepDefinitions;
}

test('sms_oauth phone signup flow uses checkout before oauth login', () => {
  const stepDefinitions = loadStepDefinitionsModule();
  const steps = stepDefinitions.getSteps({
    panelMode: 'cpa',
    plusModeEnabled: true,
    plusAccountAccessStrategy: 'sms_oauth',
    signupMethod: 'phone',
  });

  const summary = steps.map((step) => ({
    id: step.id,
    key: step.key,
    title: step.title,
  }));

  assert.equal(JSON.stringify(summary), JSON.stringify([
    { id: 1, key: 'open-chatgpt', title: '打开 ChatGPT 官网' },
    { id: 2, key: 'submit-signup-email', title: '注册并输入手机号' },
    { id: 3, key: 'fill-password', title: '填写密码并继续' },
    { id: 4, key: 'fetch-signup-code', title: '获取手机验证码' },
    { id: 5, key: 'fill-profile', title: '填写姓名和生日' },
    { id: 6, key: 'plus-checkout-create', title: '创建 Plus Checkout' },
    { id: 7, key: 'oauth-login', title: '刷新 OAuth 并登录' },
    { id: 8, key: 'fetch-login-code', title: '获取登录验证码' },
    { id: 9, key: 'bind-email', title: '绑定邮箱' },
    { id: 10, key: 'fetch-bind-email-code', title: '获取绑定邮箱验证码' },
    { id: 11, key: 'confirm-oauth', title: '自动确认 OAuth' },
    { id: 12, key: 'platform-verify', title: 'CPA 回调验证' },
  ]));
});

test('sms_oauth platform-verify keeps original panel titles', () => {
  const stepDefinitions = loadStepDefinitionsModule();
  const cases = [
    ['cpa', 'platform-verify', 'CPA 回调验证'],
    ['sub2api', 'platform-verify', 'SUB2API 回调验证'],
    ['codex2api', 'platform-verify', 'Codex2API 回调验证'],
    ['local-cpa-json', 'platform-verify', '本地CPA JSON 有RT 导出'],
    ['local-cpa-json-no-rt', 'local-cpa-json-export', '本地CPA JSON 无RT 导出'],
  ];

  for (const [panelMode, expectedKey, expectedTitle] of cases) {
    const steps = stepDefinitions.getSteps({
      panelMode,
      plusModeEnabled: true,
      plusAccountAccessStrategy: 'sms_oauth',
      signupMethod: 'phone',
    });
    const finalStep = steps[steps.length - 1];
    assert.equal(finalStep?.key, expectedKey);
    assert.equal(finalStep?.title, expectedTitle);
  }
});

test('phone_bind_oauth flow uses checkout before oauth login', () => {
  const stepDefinitions = loadStepDefinitionsModule();
  const steps = stepDefinitions.getSteps({
    panelMode: 'cpa',
    plusModeEnabled: true,
    plusAccountAccessStrategy: 'phone_bind_oauth',
    signupMethod: 'email',
  });

  const summary = steps.map((step) => ({
    id: step.id,
    key: step.key,
    title: step.title,
  }));

  assert.equal(JSON.stringify(summary), JSON.stringify([
    { id: 1, key: 'open-chatgpt', title: '打开 ChatGPT 官网' },
    { id: 2, key: 'submit-signup-email', title: '注册并输入邮箱' },
    { id: 3, key: 'fill-password', title: '填写密码并继续' },
    { id: 4, key: 'fetch-signup-code', title: '获取注册验证码' },
    { id: 5, key: 'fill-profile', title: '填写姓名和生日' },
    { id: 6, key: 'plus-checkout-create', title: '创建 Plus Checkout' },
    { id: 7, key: 'oauth-login', title: '刷新 OAuth 并登录' },
    { id: 8, key: 'fetch-login-code', title: '获取登录验证码' },
    { id: 9, key: 'post-login-phone-verification', title: '手机号验证' },
    { id: 10, key: 'confirm-oauth', title: '自动确认 OAuth' },
    { id: 11, key: 'platform-verify', title: 'CPA 回调验证' },
  ]));
});
