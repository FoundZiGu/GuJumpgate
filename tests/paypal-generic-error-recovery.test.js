const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/steps/create-plus-checkout.js');

function createExecutor() {
  return globalThis.MultiPageBackgroundPlusCheckoutCreate.createPlusCheckoutCreateExecutor({});
}

test('paypal generic error recovery count normalizes invalid values to zero', () => {
  const executor = createExecutor();

  assert.equal(executor.__test.getPayPalGenericErrorRecoveryCount({}), 0);
  assert.equal(executor.__test.getPayPalGenericErrorRecoveryCount({ paypalGenericErrorRecoveryCount: -3 }), 0);
  assert.equal(executor.__test.getPayPalGenericErrorRecoveryCount({ paypalGenericErrorRecoveryCount: '2.9' }), 2);
});

test('paypal approval branch recovery count normalizes invalid values to zero', () => {
  const executor = createExecutor();

  assert.equal(executor.__test.getPayPalApprovalBranchRecoveryCount({}), 0);
  assert.equal(executor.__test.getPayPalApprovalBranchRecoveryCount({ paypalApprovalBranchRecoveryCount: -4 }), 0);
  assert.equal(executor.__test.getPayPalApprovalBranchRecoveryCount({ paypalApprovalBranchRecoveryCount: '1.8' }), 1);
});

test('paypal hosted recovery thresholds allow two automatic retries before manual confirmation', () => {
  const executor = createExecutor();

  assert.equal(executor.__test.PAYPAL_GENERIC_ERROR_RECOVERY_MAX_ATTEMPTS, 2);
  assert.equal(executor.__test.PAYPAL_APPROVAL_BRANCH_RECOVERY_MAX_ATTEMPTS, 2);

  assert.equal(executor.__test.shouldAutoRecoverPayPalGenericError({ paypalGenericErrorRecoveryCount: 0 }), true);
  assert.equal(executor.__test.shouldAutoRecoverPayPalGenericError({ paypalGenericErrorRecoveryCount: 1 }), true);
  assert.equal(executor.__test.shouldAutoRecoverPayPalGenericError({ paypalGenericErrorRecoveryCount: 2 }), false);

  assert.equal(executor.__test.shouldAutoRecoverPayPalApprovalBranch({ paypalApprovalBranchRecoveryCount: 0 }), true);
  assert.equal(executor.__test.shouldAutoRecoverPayPalApprovalBranch({ paypalApprovalBranchRecoveryCount: 1 }), true);
  assert.equal(executor.__test.shouldAutoRecoverPayPalApprovalBranch({ paypalApprovalBranchRecoveryCount: 2 }), false);
});

test('paypal session cookie matcher covers required domains and subdomains only', () => {
  const executor = createExecutor();
  const shouldClear = executor.__test.shouldClearPayPalSessionCookie;

  assert.equal(shouldClear({ domain: '.www.paypal.com' }), true);
  assert.equal(shouldClear({ domain: '.d.paypal.com' }), true);
  assert.equal(shouldClear({ domain: '.www.paypalobjects.com' }), true);
  assert.equal(shouldClear({ domain: '.www.recaptcha.net' }), true);
  assert.equal(shouldClear({ domain: '.sub.recaptcha.net' }), true);
  assert.equal(shouldClear({ domain: '.example.com' }), false);
});

test('paypal cookie cleanup before checkout create only triggers for pending paypal recovery', () => {
  const executor = createExecutor();
  const shouldClearBeforeCreate = executor.__test.shouldClearPayPalSessionCookiesBeforeCheckoutCreate;

  assert.equal(shouldClearBeforeCreate({
    plusPaymentMethod: 'paypal',
    pendingPayPalCookieCleanupBeforeCheckoutCreate: true,
  }), true);
  assert.equal(shouldClearBeforeCreate({
    plusPaymentMethod: 'paypal',
    pendingPayPalCookieCleanupBeforeCheckoutCreate: false,
  }), false);
  assert.equal(shouldClearBeforeCreate({
    plusPaymentMethod: 'gopay',
    pendingPayPalCookieCleanupBeforeCheckoutCreate: true,
  }), false);
});
