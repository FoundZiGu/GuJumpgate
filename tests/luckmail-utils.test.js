const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_LUCKMAIL_BASE_URL,
  DEFAULT_LUCKMAIL_EMAIL_TYPE,
  DEFAULT_LUCKMAIL_PRESERVE_TAG_NAME,
  buildLuckmailBaselineCursor,
  buildLuckmailMailCursor,
  extractLuckmailVerificationCode,
  filterReusableLuckmailPurchases,
  isLuckmailMailNewerThanCursor,
  isLuckmailPurchaseForProject,
  normalizeLuckmailBaseUrl,
  normalizeLuckmailEmailType,
  normalizeLuckmailProjectName,
  normalizeLuckmailPurchaseListPage,
  normalizeLuckmailTags,
  normalizeLuckmailUsedPurchases,
  normalizeTimestamp,
  normalizeLuckmailTokenCode,
  normalizeLuckmailTokenMail,
  pickReusableLuckmailPurchase,
  pickLuckmailVerificationMail,
} = require('../shared/mail/luckmail-utils.js');

test('normalizeLuckmailEmailType keeps supported values and falls back to ms_graph', () => {
  assert.equal(normalizeLuckmailEmailType('self_built'), 'self_built');
  assert.equal(normalizeLuckmailEmailType('ms_imap'), 'ms_imap');
  assert.equal(normalizeLuckmailEmailType('ms_graph'), 'ms_graph');
  assert.equal(normalizeLuckmailEmailType('google_variant'), 'google_variant');
  assert.equal(normalizeLuckmailEmailType(''), DEFAULT_LUCKMAIL_EMAIL_TYPE);
  assert.equal(normalizeLuckmailEmailType('unknown'), DEFAULT_LUCKMAIL_EMAIL_TYPE);
});

test('normalizeLuckmailBaseUrl trims invalid input to default base url', () => {
  assert.equal(normalizeLuckmailBaseUrl(''), DEFAULT_LUCKMAIL_BASE_URL);
  assert.equal(normalizeLuckmailBaseUrl('https://mails.luckyous.com/'), DEFAULT_LUCKMAIL_BASE_URL);
  assert.equal(normalizeLuckmailBaseUrl('https://demo.example.com/api/'), 'https://demo.example.com/api');
  assert.equal(normalizeLuckmailBaseUrl('notaurl'), DEFAULT_LUCKMAIL_BASE_URL);
});

test('normalizeLuckmailTokenCode and normalizeLuckmailTokenMail extract verification code', () => {
  const tokenCode = normalizeLuckmailTokenCode({
    email_address: 'demo@outlook.com',
    project: 'openai',
    has_new_mail: true,
    verification_code: '123456',
    mail: {
      message_id: 'mail-1',
      from: 'noreply@openai.com',
      subject: 'Your ChatGPT code is 123456',
      received_at: '2026-04-14T10:00:00Z',
    },
  });

  assert.equal(tokenCode.verification_code, '123456');
  assert.equal(tokenCode.mail.message_id, 'mail-1');
  assert.equal(tokenCode.mail.verification_code, '123456');

  const normalizedMail = normalizeLuckmailTokenMail({
    message_id: 'mail-2',
    from: 'noreply@openai.com',
    subject: 'OpenAI security message',
    body: 'Your verification code is 654321.',
    received_at: '2026-04-14T10:01:00Z',
  });

  assert.equal(normalizedMail.verification_code, '654321');
  assert.equal(extractLuckmailVerificationCode('你的验证码为 778899'), '778899');
  assert.equal(
    extractLuckmailVerificationCode('ChatGPT Log-in Code\nIf that was you, enter this code:\n\n982219'),
    '982219'
  );

  const suspiciousLoginMail = normalizeLuckmailTokenMail({
    message_id: 'mail-3',
    from: 'noreply@openai.com',
    subject: 'ChatGPT Log-in Code',
    body: 'We noticed a suspicious log-in on your account. If that was you, enter this code:\n\n982219',
    received_at: '2026-04-14T10:02:00Z',
  });

  assert.equal(suspiciousLoginMail.verification_code, '982219');
});

test('normalizeLuckmailProjectName and isLuckmailPurchaseForProject match openai case-insensitively', () => {
  assert.equal(normalizeLuckmailProjectName(' OpenAi '), 'openai');
  assert.equal(isLuckmailPurchaseForProject({
    id: 1,
    email_address: 'demo@outlook.com',
    token: 'tok-1',
    project_name: 'OpenAi',
  }, 'openai'), true);
  assert.equal(isLuckmailPurchaseForProject({
    id: 2,
    email_address: 'other@example.com',
    token: 'tok-2',
    project: 'OtherProject',
  }, 'openai'), false);
});

test('normalizeLuckmailPurchaseListPage and normalizeLuckmailTags normalize list payloads', () => {
  const page = normalizeLuckmailPurchaseListPage({
    list: [{
      id: 3,
      email_address: 'demo@outlook.com',
      token: 'tok-3',
      project_name: 'OpenAi',
    }],
    total: 4,
    page: 2,
    page_size: 1,
  });
  assert.equal(page.total, 4);
  assert.equal(page.page, 2);
  assert.equal(page.page_size, 1);
  assert.equal(page.list[0].project_code, 'openai');

  const tags = normalizeLuckmailTags([{
    id: 9,
    name: DEFAULT_LUCKMAIL_PRESERVE_TAG_NAME,
    limit_type: 0,
  }]);
  assert.deepEqual(tags[0], {
    id: 9,
    name: DEFAULT_LUCKMAIL_PRESERVE_TAG_NAME,
    remark: '',
    limit_type: 0,
    purchase_count: 0,
    created_at: null,
  });
});

test('normalizeLuckmailUsedPurchases keeps positive numeric keys only', () => {
  assert.deepEqual(normalizeLuckmailUsedPurchases({
    1: true,
    foo: true,
    '-2': true,
    3: false,
  }), {
    1: true,
    3: false,
  });
});

test('pickReusableLuckmailPurchase only returns reusable openai purchase', () => {
  const purchases = [{
    id: 10,
    email_address: 'used@outlook.com',
    token: 'tok-used',
    project_name: 'openai',
  }, {
    id: 11,
    email_address: 'preserved@outlook.com',
    token: 'tok-preserved',
    project_name: 'OpenAi',
    tag_name: DEFAULT_LUCKMAIL_PRESERVE_TAG_NAME,
  }, {
    id: 12,
    email_address: 'disabled@outlook.com',
    token: 'tok-disabled',
    project_name: 'openai',
    user_disabled: 1,
  }, {
    id: 13,
    email_address: 'expired@outlook.com',
    token: 'tok-expired',
    project_name: 'openai',
    warranty_until: '2026-04-14T09:00:00Z',
  }, {
    id: 14,
    email_address: 'other@example.com',
    token: 'tok-other',
    project_name: 'other',
  }, {
    id: 15,
    email_address: 'ready@outlook.com',
    token: 'tok-ready',
    project_name: 'OpenAi',
    warranty_until: '2026-04-15T09:00:00Z',
  }];

  const reusable = filterReusableLuckmailPurchases(purchases, {
    projectCode: 'openai',
    usedPurchases: { 10: true },
    preserveTagName: DEFAULT_LUCKMAIL_PRESERVE_TAG_NAME,
    now: Date.parse('2026-04-14T10:00:00Z'),
  });

  assert.deepEqual(reusable.map((purchase) => purchase.id), [15]);
  assert.equal(pickReusableLuckmailPurchase(purchases, {
    projectCode: 'openai',
    usedPurchases: { 10: true },
    preserveTagName: DEFAULT_LUCKMAIL_PRESERVE_TAG_NAME,
    now: Date.parse('2026-04-14T10:00:00Z'),
  }).id, 15);
});

test('pickLuckmailVerificationMail respects sender filters, time filters, and excluded codes', () => {
  const match = pickLuckmailVerificationMail([
    {
      message_id: 'old-mail',
      from: 'noreply@openai.com',
      subject: 'Your code is 111111',
      received_at: '2026-04-14T09:59:00Z',
    },
    {
      message_id: 'new-mail',
      from: 'noreply@openai.com',
      subject: 'Your code is 222222',
      received_at: '2026-04-14T10:05:00Z',
    },
  ], {
    senderFilters: ['openai'],
    subjectFilters: ['code'],
    excludeCodes: ['111111'],
    afterTimestamp: Date.parse('2026-04-14T10:00:00Z'),
  });

  assert.equal(match.code, '222222');
  assert.equal(match.mail.message_id, 'new-mail');
});

test('isLuckmailMailNewerThanCursor compares message id and timestamp safely', () => {
  const cursor = buildLuckmailMailCursor({
    message_id: 'mail-1',
    received_at: '2026-04-14T10:00:00Z',
  });

  assert.equal(isLuckmailMailNewerThanCursor({
    message_id: 'mail-1',
    received_at: '2026-04-14T10:00:00Z',
  }, cursor), false);

  assert.equal(isLuckmailMailNewerThanCursor({
    message_id: 'mail-2',
    received_at: '2026-04-14T10:01:00Z',
  }, cursor), true);
});

test('normalizeLuckmailMailCursor tolerates null cursor input', () => {
  const { normalizeLuckmailMailCursor } = require('../shared/mail/luckmail-utils.js');
  assert.deepEqual(normalizeLuckmailMailCursor(null), {
    messageId: '',
    receivedAt: '',
  });
});

test('normalizeTimestamp treats LuckMail naive datetime strings as UTC', () => {
  assert.equal(
    normalizeTimestamp('2026-04-14 13:32:05'),
    Date.UTC(2026, 3, 14, 13, 32, 5, 0)
  );
});

test('buildLuckmailBaselineCursor tracks newest existing mail as baseline', () => {
  const cursor = buildLuckmailBaselineCursor([
    {
      message_id: 'mail-old',
      received_at: '2026-04-14 13:31:15',
      subject: '你的 ChatGPT 代码为 111111',
    },
    {
      message_id: 'mail-new',
      received_at: '2026-04-14 13:32:05',
      subject: '你的 ChatGPT 代码为 222222',
    },
  ]);

  assert.deepEqual(cursor, {
    messageId: 'mail-new',
    receivedAt: '2026-04-14 13:32:05',
  });
});
