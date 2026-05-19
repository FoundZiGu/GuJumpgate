const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCloudflareTempEmailHeaders,
  getCloudflareTempEmailAddressFromResponse,
  normalizeCloudflareTempEmailBaseUrl,
  normalizeCloudflareTempEmailDomain,
  normalizeCloudflareTempEmailDomains,
  normalizeCloudflareTempEmailMailApiMessages,
} = require('../shared/mail/cloudflare-temp-email-utils.js');

test('normalizeCloudflareTempEmailBaseUrl normalizes host and preserves path', () => {
  assert.equal(
    normalizeCloudflareTempEmailBaseUrl('temp.example.com/api/'),
    'https://temp.example.com/api'
  );
  assert.equal(
    normalizeCloudflareTempEmailBaseUrl('http://127.0.0.1:8787'),
    'http://127.0.0.1:8787'
  );
  assert.equal(normalizeCloudflareTempEmailBaseUrl('::::'), '');
});

test('normalizeCloudflareTempEmailDomain and domains de-duplicate valid entries', () => {
  assert.equal(normalizeCloudflareTempEmailDomain('@Mail.Example.com'), 'mail.example.com');
  assert.equal(normalizeCloudflareTempEmailDomain('not-a-domain'), '');
  assert.deepEqual(
    normalizeCloudflareTempEmailDomains(['mail.example.com', 'MAIL.EXAMPLE.COM', 'bad-value']),
    ['mail.example.com']
  );
});

test('buildCloudflareTempEmailHeaders includes auth headers and content type when needed', () => {
  assert.deepEqual(
    buildCloudflareTempEmailHeaders(
      {
        adminAuth: 'admin-secret',
        customAuth: 'site-secret',
      },
      { json: true }
    ),
    {
      'x-admin-auth': 'admin-secret',
      'x-custom-auth': 'site-secret',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  );
});

test('normalizeCloudflareTempEmailMailApiMessages extracts sender, subject, code, and address from raw mime', () => {
  const messages = normalizeCloudflareTempEmailMailApiMessages({
    data: [
      {
        id: 'mail-1',
        address: 'user@example.com',
        original_recipient: 'Forwarded.User@Duck.com',
        created_at: '2026-04-13T09:15:00.000Z',
        raw: [
          'From: OpenAI <noreply@tm.openai.com>',
          'Subject: =?UTF-8?B?T3BlbkFJIHZlcmlmaWNhdGlvbiBjb2Rl?=',
          'Content-Type: text/plain; charset=UTF-8',
          '',
          'Your verification code is 654321.',
        ].join('\r\n'),
      },
    ],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'mail-1');
  assert.equal(messages[0].address, 'user@example.com');
  assert.equal(messages[0].originalRecipient, 'forwarded.user@duck.com');
  assert.equal(messages[0].subject, 'OpenAI verification code');
  assert.equal(messages[0].from.emailAddress.address, 'OpenAI <noreply@tm.openai.com>');
  assert.match(messages[0].bodyPreview, /654321/);
});

test('normalizeCloudflareTempEmailMailApiMessages decodes multipart quoted printable html bodies', () => {
  const messages = normalizeCloudflareTempEmailMailApiMessages([
    {
      id: 'mail-2',
      address: 'user@example.com',
      received_at: '2026-04-13T09:20:00.000Z',
      source: [
        'From: ChatGPT <noreply@tm.openai.com>',
        'Subject: Login code',
        'Content-Type: multipart/alternative; boundary="abc123"',
        '',
        '--abc123',
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        '<p>Your login code is <strong>112233</strong>.</p>',
        '--abc123--',
      ].join('\r\n'),
    },
  ]);

  assert.equal(messages.length, 1);
  assert.match(messages[0].bodyPreview, /112233/);
  assert.equal(messages[0].subject, 'Login code');
});

test('getCloudflareTempEmailAddressFromResponse supports direct and nested response shapes', () => {
  assert.equal(getCloudflareTempEmailAddressFromResponse({ address: 'one@example.com' }), 'one@example.com');
  assert.equal(getCloudflareTempEmailAddressFromResponse({ data: { address: 'two@example.com' } }), 'two@example.com');
});
