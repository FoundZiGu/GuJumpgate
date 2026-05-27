const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRegistrationEmailStateModule() {
  const filePath = path.join(__dirname, '..', 'background', 'registration-email-state.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageRegistrationEmailState;
}

test('clearing an invalidated email preserves phone signup identity and the previous email baseline', () => {
  const module = loadRegistrationEmailStateModule();
  const helpers = module.createRegistrationEmailStateHelpers();
  const state = {
    email: 'alias@example.com',
    registrationEmailState: {
      current: 'alias@example.com',
      previous: 'alias@example.com',
      source: 'generated:icloud',
      updatedAt: 123,
    },
    accountIdentifierType: 'phone',
    accountIdentifier: '+15550001111',
    signupPhoneNumber: '+15550001111',
    signupPhoneActivation: { activationId: 'phone-1', phoneNumber: '+15550001111' },
    signupPhoneCompletedActivation: { activationId: 'phone-1', phoneNumber: '+15550001111' },
    signupPhoneVerificationRequestedAt: 456,
    signupPhoneVerificationPurpose: 'signup',
  };

  const updates = helpers.buildClearedRegistrationEmailStateUpdates(state, {
    preserveAccountIdentity: true,
    preservePrevious: true,
    source: 'invalidated:email_in_use',
  });

  assert.equal(updates.email, null);
  assert.equal(updates.registrationEmailState.current, '');
  assert.equal(updates.registrationEmailState.previous, 'alias@example.com');
  assert.equal(updates.registrationEmailState.source, 'generated:icloud');
  assert.equal(updates.accountIdentifierType, 'phone');
  assert.equal(updates.accountIdentifier, '+15550001111');
  assert.equal(updates.signupPhoneNumber, '+15550001111');
  assert.deepEqual(updates.signupPhoneActivation, state.signupPhoneActivation);
  assert.deepEqual(updates.signupPhoneCompletedActivation, state.signupPhoneCompletedActivation);
  assert.equal(updates.signupPhoneVerificationRequestedAt, 456);
  assert.equal(updates.signupPhoneVerificationPurpose, 'signup');
});
