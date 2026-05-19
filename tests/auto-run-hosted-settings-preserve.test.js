const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('auto-run fresh round reset preserves PayPal Hosted settings', () => {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const keepSettingsIndex = source.indexOf('const keepSettings = {');
  assert.notEqual(keepSettingsIndex, -1);
  const resetIndex = source.indexOf('await resetState();', keepSettingsIndex);
  assert.ok(resetIndex > keepSettingsIndex);
  const keepSettingsBlock = source.slice(keepSettingsIndex, resetIndex);

  for (const field of [
    'plusPaymentMethod',
    'plusHostedCheckoutIsFinalStep',
    'plusHostedCheckoutOauthDelaySeconds',
    'skipPostPaymentOAuthEnabled',
    'paypalAccounts',
    'currentPayPalAccountId',
    'hostedCheckoutVerificationUrl',
    'hostedCheckoutPhoneNumber',
    'hostedCheckoutSmsPoolText',
    'hostedCheckoutSmsPoolUsage',
  ]) {
    assert.match(keepSettingsBlock, new RegExp(`${field}: prevState\\.${field}`));
  }
});
