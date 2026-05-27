const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/steps/create-plus-checkout.js');

function createExecutor() {
  return globalThis.MultiPageBackgroundPlusCheckoutCreate.createPlusCheckoutCreateExecutor({});
}

test('Hermes review_consent state does not trigger recovery even when URL stays on Hermes', () => {
  const executor = createExecutor();
  const result = executor.__test.assessHostedHermesRecoveryState(
    'https://www.paypal.com/webapps/hermes?token=test',
    {
      hostedStage: 'review_consent',
      reviewConsentReady: true,
      bodyTextPreview: 'Set up once. Pay faster next time',
      readyState: 'complete',
    },
    {
      count: executor.__test.HOSTED_HERMES_STALL_OBSERVATION_LIMIT - 1,
      signature: 'stale',
    }
  );

  assert.equal(result.shouldRecover, false);
  assert.equal(result.nextCount, 0);
  assert.equal(result.shouldWait, false);
});

test('Hermes redirecting message freezes recovery counting and waits for URL change', () => {
  const executor = createExecutor();
  const result = executor.__test.assessHostedHermesRecoveryState(
    'https://www.paypal.com/webapps/hermes?token=test',
    {
      hostedStage: 'redirecting',
      hostedRedirecting: true,
      hostedRedirectingMessage: 'Saving your info... sending you back to the merchant.',
      bodyTextPreview: 'Saving your info... sending you back to the merchant.',
      readyState: 'complete',
    },
    {
      count: executor.__test.HOSTED_HERMES_STALL_OBSERVATION_LIMIT - 1,
      signature: 'stale',
    }
  );

  assert.equal(result.shouldRecover, false);
  assert.equal(result.nextCount, 0);
  assert.equal(result.shouldWait, true);
});

test('Hermes approval state only triggers recovery after repeated stalled observations', () => {
  const executor = createExecutor();
  const url = 'https://www.paypal.com/webapps/hermes?token=test';
  const pageState = {
    hostedStage: 'approval',
    approveReady: true,
    bodyTextPreview: 'Approve your payment',
    readyState: 'complete',
  };
  const signature = executor.__test.buildHostedHermesObservationSignature(url, pageState);
  const result = executor.__test.assessHostedHermesRecoveryState(
    url,
    pageState,
    {
      count: executor.__test.HOSTED_HERMES_STALL_OBSERVATION_LIMIT - 1,
      signature,
    }
  );

  assert.equal(result.nextCount, executor.__test.HOSTED_HERMES_STALL_OBSERVATION_LIMIT);
  assert.equal(result.shouldRecover, true);
  assert.equal(result.shouldWait, false);
});
