const assert = require('node:assert/strict');

const utils = require('../mail-provider-utils.js');

assert.equal(utils.normalizeMailProvider('icloud'), 'icloud');
assert.equal(utils.ICLOUD_PROVIDER, 'icloud');
assert.equal(utils.normalizeMailProvider('icloud-api'), 'icloud-api');
assert.equal(utils.ICLOUD_API_PROVIDER, 'icloud-api');

const config = utils.getMailProviderConfig({ mailProvider: 'icloud' });
assert.equal(config.source, 'icloud-mail');
assert.equal(config.url, 'https://www.icloud.com/mail/');
assert.equal(config.label, 'iCloud 邮箱');
assert.equal(config.navigateOnReuse, true);

const apiConfig = utils.getMailProviderConfig({ mailProvider: 'icloud-api' });
assert.equal(apiConfig.provider, 'icloud-api');
assert.equal(apiConfig.label, 'iCloud API（QQ 转发）');

assert.equal(
  utils.normalizeIcloudApiBaseUrl('worker.example.com/api/verification-code?x=1'),
  'https://worker.example.com'
);
assert.equal(
  utils.buildIcloudApiEndpoint('https://worker.example.com/root/api/admin/import'),
  'https://worker.example.com/root/api/verification-code'
);

assert.deepEqual(
  utils.parseHiddenEmailCredential('Alias@Example.com----secret-token'),
  {
    email: 'alias@example.com',
    credential: 'Alias@Example.com----secret-token',
  }
);
assert.deepEqual(
  utils.parseHiddenEmailCredential('plain@example.com'),
  {
    email: 'plain@example.com',
    credential: '',
  }
);

console.log('mail-provider-utils iCloud tests passed');
