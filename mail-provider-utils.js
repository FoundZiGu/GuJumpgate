(function attachMailProviderUtils(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.MailProviderUtils = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function createMailProviderUtils() {
  const HOTMAIL_PROVIDER = 'hotmail-api';
  const GMAIL_PROVIDER = 'gmail';
  const ICLOUD_PROVIDER = 'icloud';
  const ICLOUD_API_PROVIDER = 'icloud-api';
  const FREEMAIL_PROVIDER = 'freemail';
  const OUTLOOK_EMAIL_PLUS_PROVIDER = 'outlook-email-plus';
  const NETEASE_LIST_PATH = '/js6/main.jsp?df=mail163_letter#module=mbox.ListModule%7C%7B%22fid%22%3A1%2C%22order%22%3A%22date%22%2C%22desc%22%3Atrue%7D';
  const ICLOUD_TARGET_MAILBOX_TYPE_INBOX = 'icloud-inbox';
  const ICLOUD_TARGET_MAILBOX_TYPE_FORWARD = 'forward-mailbox';
  const ICLOUD_FORWARD_MAIL_PROVIDER_OPTIONS = [
    { value: 'qq', label: 'QQ 邮箱' },
    { value: '163', label: '163 邮箱' },
    { value: '163-vip', label: '163 VIP 邮箱' },
    { value: '126', label: '126 邮箱' },
    { value: GMAIL_PROVIDER, label: 'Gmail 邮箱' },
  ];

  function normalizeMailProvider(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    switch (normalized) {
      case HOTMAIL_PROVIDER:
      case ICLOUD_PROVIDER:
      case ICLOUD_API_PROVIDER:
      case FREEMAIL_PROVIDER:
      case OUTLOOK_EMAIL_PLUS_PROVIDER:
      case '163':
      case '163-vip':
      case '126':
      case 'qq':
      case 'inbucket':
        return normalized;
      default:
        return '163';
    }
  }

  function parseHiddenEmailCredential(value = '') {
    const raw = String(value || '').trim();
    const separatorIndex = raw.indexOf('----');
    const emailSource = separatorIndex >= 0 ? raw.slice(0, separatorIndex) : raw;
    const credential = separatorIndex >= 0 ? raw : '';
    return {
      email: emailSource.trim().toLowerCase(),
      credential: credential.trim(),
    };
  }

  function normalizeIcloudTargetMailboxType(value = '') {
    return String(value || '').trim().toLowerCase() === ICLOUD_TARGET_MAILBOX_TYPE_FORWARD
      ? ICLOUD_TARGET_MAILBOX_TYPE_FORWARD
      : ICLOUD_TARGET_MAILBOX_TYPE_INBOX;
  }

  function normalizeIcloudForwardMailProvider(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return ICLOUD_FORWARD_MAIL_PROVIDER_OPTIONS.some((option) => option.value === normalized)
      ? normalized
      : 'qq';
  }

  function getIcloudForwardMailProviderOptions() {
    return ICLOUD_FORWARD_MAIL_PROVIDER_OPTIONS.map((option) => ({ ...option }));
  }

  function getIcloudForwardMailConfig(provider = 'qq') {
    const normalizedProvider = normalizeIcloudForwardMailProvider(provider);
    if (normalizedProvider === GMAIL_PROVIDER) {
      return {
        source: 'gmail-mail',
        url: 'https://mail.google.com/mail/u/0/#inbox',
        label: 'Gmail 邮箱',
        inject: ['content/activation-utils.js', 'content/utils.js', 'content/gmail-mail.js'],
        injectSource: 'gmail-mail',
      };
    }

    return getMailProviderConfig({ mailProvider: normalizedProvider });
  }

  function normalizeIcloudApiBaseUrl(rawValue = '') {
    const raw = String(rawValue || '').trim();
    if (!raw) return '';
    const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return '';
      }
      parsed.hash = '';
      parsed.search = '';
      let pathname = String(parsed.pathname || '').replace(/\/+/g, '/');
      pathname = pathname.replace(/\/api\/(?:verification-code|latest-mail|admin\/import)$/i, '');
      pathname = pathname === '/' ? '' : pathname.replace(/\/+$/g, '');
      return `${parsed.origin}${pathname}`;
    } catch {
      return '';
    }
  }

  function buildIcloudApiEndpoint(baseUrl = '') {
    const normalizedBaseUrl = normalizeIcloudApiBaseUrl(baseUrl);
    return normalizedBaseUrl ? `${normalizedBaseUrl}/api/verification-code` : '';
  }

  function getMailProviderConfig(state = {}, options = {}) {
    const provider = normalizeMailProvider(state.mailProvider);
    const normalizeInbucketOrigin = options.normalizeInbucketOrigin || (() => '');

    if (provider === HOTMAIL_PROVIDER) {
      return { provider: HOTMAIL_PROVIDER, label: 'Hotmail（微软 Graph）' };
    }
    if (provider === ICLOUD_PROVIDER) {
      return {
        source: 'icloud-mail',
        url: 'https://www.icloud.com/mail/',
        label: 'iCloud 邮箱',
        navigateOnReuse: true,
      };
    }
    if (provider === ICLOUD_API_PROVIDER) {
      return { provider: ICLOUD_API_PROVIDER, label: 'iCloud API（QQ 转发）' };
    }
    if (provider === FREEMAIL_PROVIDER) {
      return { provider: FREEMAIL_PROVIDER, label: 'freemail' };
    }
    if (provider === OUTLOOK_EMAIL_PLUS_PROVIDER) {
      return { provider: OUTLOOK_EMAIL_PLUS_PROVIDER, label: 'Outlook Email Plus' };
    }
    if (provider === '163') {
      return {
        source: 'mail-163',
        url: `https://mail.163.com${NETEASE_LIST_PATH}`,
        label: '163 邮箱',
      };
    }
    if (provider === '163-vip') {
      return {
        source: 'mail-163',
        url: `https://webmail.vip.163.com${NETEASE_LIST_PATH}`,
        label: '163 VIP 邮箱',
      };
    }
    if (provider === '126') {
      return {
        source: 'mail-163',
        url: `https://mail.126.com${NETEASE_LIST_PATH}`,
        label: '126 邮箱',
      };
    }
    if (provider === 'inbucket') {
      const host = normalizeInbucketOrigin(state.inbucketHost);
      const mailbox = String(state.inbucketMailbox || '').trim();
      if (!host) {
        return { error: 'Inbucket 主机地址为空或无效。' };
      }
      if (!mailbox) {
        return { error: 'Inbucket 邮箱名称为空。' };
      }
      return {
        source: 'inbucket-mail',
        url: `${host}/m/${encodeURIComponent(mailbox)}/`,
        label: `Inbucket 邮箱（${mailbox}）`,
        navigateOnReuse: true,
        inject: ['content/activation-utils.js', 'content/utils.js', 'content/inbucket-mail.js'],
        injectSource: 'inbucket-mail',
      };
    }
    return { source: 'qq-mail', url: 'https://wx.mail.qq.com/', label: 'QQ 邮箱' };
  }

  return {
    GMAIL_PROVIDER,
    HOTMAIL_PROVIDER,
    ICLOUD_API_PROVIDER,
    ICLOUD_PROVIDER,
    buildIcloudApiEndpoint,
    getIcloudForwardMailConfig,
    getIcloudForwardMailProviderOptions,
    getMailProviderConfig,
    normalizeIcloudApiBaseUrl,
    normalizeIcloudForwardMailProvider,
    normalizeIcloudTargetMailboxType,
    normalizeMailProvider,
    parseHiddenEmailCredential,
  };
});
