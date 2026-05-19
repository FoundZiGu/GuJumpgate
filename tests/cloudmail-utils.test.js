const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCloudMailHeaders,
  getCloudMailTokenFromResponse,
  normalizeCloudMailBaseUrl,
  normalizeCloudMailDomain,
  normalizeCloudMailDomains,
  normalizeCloudMailMailApiMessages,
} = require('../shared/mail/cloudmail-utils.js');

test('normalizeCloudMailBaseUrl normalizes host and preserves path', () => {
  assert.equal(
    normalizeCloudMailBaseUrl('mail.example.com/api/'),
    'https://mail.example.com/api'
  );
  assert.equal(
    normalizeCloudMailBaseUrl('http://127.0.0.1:8080'),
    'http://127.0.0.1:8080'
  );
  assert.equal(normalizeCloudMailBaseUrl('::::'), '');
});

test('normalizeCloudMailDomain and domains de-duplicate valid entries', () => {
  assert.equal(normalizeCloudMailDomain('@Mail.Example.com'), 'mail.example.com');
  assert.equal(normalizeCloudMailDomain('not-a-domain'), '');
  assert.deepEqual(
    normalizeCloudMailDomains(['mail.example.com', 'MAIL.EXAMPLE.COM', 'bad-value']),
    ['mail.example.com']
  );
});

test('buildCloudMailHeaders includes token and content type when needed', () => {
  assert.deepEqual(
    buildCloudMailHeaders({ token: 'token-value' }, { json: true }),
    {
      Authorization: 'token-value',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  );
});

test('normalizeCloudMailMailApiMessages extracts rows from nested Cloud Mail payloads', () => {
  const messages = normalizeCloudMailMailApiMessages({
    data: {
      records: [
        {
          emailId: 'mail-1',
          toEmail: 'User@Example.com',
          sendEmail: 'noreply@tm.openai.com',
          subject: 'OpenAI verification code',
          content: '<p>Your code is <strong>654321</strong> &amp; ready.</p>',
          createTime: '2026-05-07 10:20:00',
        },
      ],
    },
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'mail-1');
  assert.equal(messages[0].address, 'user@example.com');
  assert.equal(messages[0].from.emailAddress.address, 'noreply@tm.openai.com');
  assert.match(messages[0].bodyPreview, /654321/);
  assert.match(messages[0].bodyPreview, /& ready/);
  assert.equal(messages[0].receivedDateTime, '2026-05-07T10:20:00.000Z');
});

test('getCloudMailTokenFromResponse supports direct and nested response shapes', () => {
  assert.equal(getCloudMailTokenFromResponse({ token: 'one' }), 'one');
  assert.equal(getCloudMailTokenFromResponse({ data: { accessToken: 'two' } }), 'two');
});
