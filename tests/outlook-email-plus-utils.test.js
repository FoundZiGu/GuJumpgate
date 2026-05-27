const assert = require('node:assert/strict');
const test = require('node:test');

const outlookEmailPlusUtils = require('../outlook-email-plus-utils.js');

test('Outlook Email Plus normalizes base URLs and strips external API paths', () => {
  assert.equal(outlookEmailPlusUtils.normalizeOutlookEmailPlusBaseUrl(''), '');
  assert.equal(
    outlookEmailPlusUtils.normalizeOutlookEmailPlusBaseUrl('mail.example.com/api/external/verification-code?x=1'),
    'https://mail.example.com'
  );
  assert.equal(
    outlookEmailPlusUtils.normalizeOutlookEmailPlusBaseUrl('http://mail.example.com/root/api/external/pool/claim-random'),
    'http://mail.example.com/root'
  );
  assert.equal(
    outlookEmailPlusUtils.joinOutlookEmailPlusUrl('mail.example.com/api/external/pool/claim-random', '/api/external/verification-code'),
    'https://mail.example.com/api/external/verification-code'
  );
});

test('Outlook Email Plus builds API headers for JSON requests', () => {
  assert.deepEqual(
    outlookEmailPlusUtils.buildOutlookEmailPlusHeaders({ outlookEmailPlusApiKey: 'secret-key' }, { json: true }),
    {
      'X-API-Key': 'secret-key',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  );
});

test('Outlook Email Plus unwraps success payloads and raw payloads', () => {
  assert.deepEqual(
    outlookEmailPlusUtils.unwrapOutlookEmailPlusResponse({ success: true, data: { email: 'demo@example.com' } }),
    { email: 'demo@example.com' }
  );
  assert.deepEqual(
    outlookEmailPlusUtils.unwrapOutlookEmailPlusResponse({ ok: true, data: { code: '123456' } }),
    { code: '123456' }
  );
  assert.deepEqual(
    outlookEmailPlusUtils.unwrapOutlookEmailPlusResponse({ email: 'raw@example.com' }),
    { email: 'raw@example.com' }
  );
});

test('Outlook Email Plus unwrap throws explicit business errors with message and code', () => {
  assert.throws(
    () => outlookEmailPlusUtils.unwrapOutlookEmailPlusResponse({ success: false, message: 'busy', code: 'E_BUSY' }),
    /busy.*E_BUSY/
  );
  assert.throws(
    () => outlookEmailPlusUtils.unwrapOutlookEmailPlusResponse({ ok: false, error: 'denied' }),
    /denied/
  );
});

test('Outlook Email Plus normalizes claim payload fields to camelCase', () => {
  assert.deepEqual(
    outlookEmailPlusUtils.normalizeOutlookEmailPlusClaim({
      account_id: 'acct_1',
      email: 'User+tag@Example.com',
      email_domain: 'Example.com',
      claim_token: 'claim_123',
      claimed_at: '2026-05-23T10:00:00.000Z',
      lease_expires_at: '2026-05-23T10:30:00.000Z',
    }),
    {
      accountId: 'acct_1',
      address: 'user+tag@example.com',
      domain: 'example.com',
      claimToken: 'claim_123',
      claimedAt: '2026-05-23T10:00:00.000Z',
      leaseExpiresAt: '2026-05-23T10:30:00.000Z',
      raw: {
        account_id: 'acct_1',
        email: 'User+tag@Example.com',
        email_domain: 'Example.com',
        claim_token: 'claim_123',
        claimed_at: '2026-05-23T10:00:00.000Z',
        lease_expires_at: '2026-05-23T10:30:00.000Z',
      },
    }
  );
});

test('Outlook Email Plus parses aliases, derives base addresses, and builds sanitized aliases', () => {
  assert.deepEqual(
    outlookEmailPlusUtils.parseOutlookEmailPlusAddressParts('User+Claimed@Example.com'),
    {
      local: 'user+claimed',
      domain: 'example.com',
      baseLocal: 'user',
      tag: 'claimed',
      isTaggedAlias: true,
    }
  );
  assert.equal(outlookEmailPlusUtils.isOutlookEmailPlusTaggedAlias('user+claimed@example.com'), true);
  assert.equal(outlookEmailPlusUtils.isOutlookEmailPlusTaggedAlias('user@example.com'), false);
  assert.equal(outlookEmailPlusUtils.deriveOutlookEmailPlusBaseAddress('User+Claimed@Example.com'), 'user@example.com');
  assert.equal(outlookEmailPlusUtils.deriveOutlookEmailPlusBaseAddress('User@Example.com'), 'user@example.com');
  assert.equal(outlookEmailPlusUtils.sanitizeOutlookEmailPlusTag('  Run ID:42 / Demo  '), 'run-id-42-demo');
  assert.equal(
    outlookEmailPlusUtils.generateOutlookEmailPlusTag('Manual Task', 'OpenAI', 'Run_01'),
    'manual-task-openai-run_01'
  );
  assert.equal(
    outlookEmailPlusUtils.buildOutlookEmailPlusAliasAddress('User@Example.com', '  Run ID:42 / Demo  '),
    'user+run-id-42-demo@example.com'
  );
  assert.equal(
    outlookEmailPlusUtils.buildOutlookEmailPlusPayPalAliasAddress('User@Example.com', 2),
    'user+PayPal2@example.com'
  );
  assert.equal(
    outlookEmailPlusUtils.getOutlookEmailPlusPayPalAliasIndex('USER+PayPal2@Example.com', 'user@example.com'),
    2
  );
  assert.equal(
    outlookEmailPlusUtils.getOutlookEmailPlusPayPalAliasIndex('user+other@example.com', 'user@example.com'),
    null
  );
});

test('Outlook Email Plus normalizes nested verification payloads', () => {
  const result = outlookEmailPlusUtils.normalizeOutlookEmailPlusVerificationCode({
    data: {
      verification_code: '654321',
      received_at: '2026-05-23T10:02:03.000Z',
      mail_id: 'mail_42',
    },
  });

  assert.equal(result.code, '654321');
  assert.equal(result.emailTimestamp, Date.parse('2026-05-23T10:02:03.000Z'));
  assert.equal(result.mailId, 'mail_42');
  assert.deepEqual(result.raw, {
    verification_code: '654321',
    received_at: '2026-05-23T10:02:03.000Z',
    mail_id: 'mail_42',
  });
});
