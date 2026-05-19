const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractVerificationCodeFromMessages,
  fetchMicrosoftMailboxMessages,
  fetchMicrosoftVerificationCode,
  normalizeMailboxId,
} = require('../shared/mail/microsoft-email.js');

test('extractVerificationCodeFromMessages 支持显式过滤条件并跳过排除的验证码', () => {
  const result = extractVerificationCodeFromMessages([
    {
      From: { EmailAddress: { Address: 'noreply@openai.com' } },
      Subject: 'Your code is 112233',
      BodyPreview: '112233',
      ReceivedDateTime: '2026-04-14T09:00:00.000Z',
      Id: 'too-old',
    },
    {
      From: { EmailAddress: { Address: 'alerts@example.com' } },
      Subject: 'Your code is 223344',
      BodyPreview: '223344',
      ReceivedDateTime: '2026-04-14T10:00:00.000Z',
      Id: 'wrong-sender',
    },
    {
      From: { EmailAddress: { Address: 'account-security@openai.com' } },
      Subject: 'OpenAI verification',
      BodyPreview: 'Use 334455 to continue',
      ReceivedDateTime: '2026-04-14T10:05:00.000Z',
      Id: 'matched',
    },
  ], {
    filterAfterTimestamp: Date.UTC(2026, 3, 14, 9, 30, 0),
    senderFilters: ['openai'],
    subjectFilters: ['verification'],
    excludeCodes: ['112233'],
  });

  assert.deepEqual(result, {
    code: '334455',
    emailTimestamp: Date.UTC(2026, 3, 14, 10, 5, 0),
    messageId: 'matched',
    sender: 'account-security@openai.com',
    subject: 'OpenAI verification',
    mailbox: 'INBOX',
    message: {
      mailbox: 'INBOX',
      from: {
        emailAddress: {
          address: 'account-security@openai.com',
          name: '',
        },
      },
      subject: 'OpenAI verification',
      receivedDateTime: '2026-04-14T10:05:00.000Z',
      bodyPreview: 'Use 334455 to continue',
      body: {
        content: '',
      },
      recipients: {
        to: [],
        cc: [],
        bcc: [],
        all: [],
      },
      id: 'matched',
    },
  });
});

test('extractVerificationCodeFromMessages supports keyword hints and runtime code patterns without OpenAI-specific fallback', () => {
  const result = extractVerificationCodeFromMessages([
    {
      From: { EmailAddress: { Address: 'alerts@example.com' } },
      Subject: 'Security center',
      BodyPreview: 'Use pin A-551199 to continue',
      ReceivedDateTime: '2026-04-14T10:07:00.000Z',
      Id: 'mail-1',
    },
    {
      From: { EmailAddress: { Address: 'news@example.com' } },
      Subject: 'Newsletter',
      BodyPreview: 'pin A-000000',
      ReceivedDateTime: '2026-04-14T10:06:00.000Z',
      Id: 'mail-2',
    },
  ], {
    filterAfterTimestamp: 0,
    senderFilters: [],
    subjectFilters: [],
    requiredKeywords: ['security'],
    codePatterns: [{ source: 'pin\\s+A-(\\d{6})', flags: 'i' }],
    excludeCodes: [],
  });

  assert.equal(result.code, '551199');
  assert.equal(result.messageId, 'mail-1');
  assert.equal(result.sender, 'alerts@example.com');
});

test('normalizeMailboxId 将 Junk 归一为微软邮箱夹 ID', () => {
  assert.equal(normalizeMailboxId('INBOX'), 'inbox');
  assert.equal(normalizeMailboxId('junk'), 'junkemail');
  assert.equal(normalizeMailboxId('Junk Email'), 'junkemail');
});

test('fetchMicrosoftMailboxMessages 会回退到可用的 token 策略并保留邮箱夹信息', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (String(url).includes('/oauth2/v2.0/token')) {
      const params = new URLSearchParams(String(options.body || ''));
      if (String(url).includes('/common/') && params.get('scope')?.includes('Mail.Read')) {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () => JSON.stringify({ error_description: 'common delegated failed' }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          access_token: 'access-token-1',
          refresh_token: 'refresh-token-next',
        }),
      };
    }

    assert.match(String(url), /graph\.microsoft\.com\/v1\.0\/me\/mailFolders\/junkemail\/messages/);
    return {
      ok: true,
      json: async () => ({
        value: [
          {
            from: { emailAddress: { address: 'noreply@openai.com' } },
            subject: 'OpenAI verification',
            bodyPreview: 'Use 445566 to continue',
            receivedDateTime: '2026-04-14T10:06:00.000Z',
            id: 'mail-1',
          },
        ],
      }),
    };
  };

  const result = await fetchMicrosoftMailboxMessages({
    clientId: 'client-1',
    refreshToken: 'refresh-token-1',
    mailbox: 'Junk',
    top: 5,
    fetchImpl,
  });

  assert.equal(requests.length, 3);
  assert.equal(result.nextRefreshToken, 'refresh-token-next');
  assert.equal(result.tokenStrategy, 'entra-consumers-delegated');
  assert.equal(result.transport, 'graph');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, 'mail-1');
  assert.equal(result.messages[0].mailbox, 'Junk');
});

test('fetchMicrosoftVerificationCode 会按邮箱夹轮询并在 Junk 中命中最新验证码', async () => {
  const mailboxRequests = {
    inbox: 0,
    junkemail: 0,
  };
  const logs = [];
  const fetchImpl = async (url) => {
    if (String(url).includes('/oauth2/v2.0/token')) {
      return {
        ok: true,
        json: async () => ({
          access_token: 'access-token-2',
          refresh_token: 'refresh-token-next-2',
        }),
      };
    }

    const urlString = String(url);
    if (urlString.includes('/mailFolders/inbox/messages')) {
      mailboxRequests.inbox += 1;
      return {
        ok: true,
        json: async () => ({
          value: [{
            From: { EmailAddress: { Address: 'alerts@example.com' } },
            Subject: 'Nothing useful',
            BodyPreview: 'No code',
            ReceivedDateTime: '2026-04-14T10:00:00.000Z',
            Id: 'mail-ignore',
          }],
        }),
      };
    }

    assert.match(urlString, /mailFolders\/junkemail\/messages/);
    mailboxRequests.junkemail += 1;
    if (mailboxRequests.junkemail === 1) {
      return {
        ok: true,
        json: async () => ({
          value: [{
            from: { emailAddress: { address: 'no-reply@example.com' } },
            subject: 'Nothing useful',
            bodyPreview: 'Still no code',
            receivedDateTime: '2026-04-14T10:05:00.000Z',
            id: 'mail-ignore-2',
          }],
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        value: [{
          from: { emailAddress: { address: 'account-security@openai.com' } },
          Subject: 'Your verification code',
          BodyPreview: '667788',
          ReceivedDateTime: '2026-04-14T10:10:00.000Z',
          Id: 'mail-hit',
        }],
      }),
    };
  };

  const result = await fetchMicrosoftVerificationCode({
    token: 'refresh-token-2',
    clientId: 'client-2',
    maxRetries: 2,
    retryDelayMs: 0,
    mailboxes: ['INBOX', 'Junk'],
    fetchImpl,
    log: (message) => logs.push(message),
    filterAfterTimestamp: Date.UTC(2026, 3, 14, 9, 0, 0),
    senderFilters: ['openai'],
    subjectFilters: ['verification'],
  });

  assert.equal(result.code, '667788');
  assert.equal(result.messageId, 'mail-hit');
  assert.equal(result.nextRefreshToken, 'refresh-token-next-2');
  assert.equal(result.mailbox, 'Junk');
  assert.equal(mailboxRequests.inbox, 2);
  assert.equal(mailboxRequests.junkemail, 2);
  assert.equal(logs.some((message) => /retrying/i.test(message)), true);
});
