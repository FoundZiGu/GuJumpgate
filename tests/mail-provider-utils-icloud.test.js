const assert = require('assert');

const utils = require('../mail-provider-utils.js');

assert.strictEqual(utils.normalizeMailProvider('icloud'), 'icloud');
assert.strictEqual(utils.ICLOUD_PROVIDER, 'icloud');
assert.strictEqual(utils.normalizeMailProvider('icloud-api'), 'icloud-api');
assert.strictEqual(utils.ICLOUD_API_PROVIDER, 'icloud-api');

const config = utils.getMailProviderConfig({ mailProvider: 'icloud' });
assert.strictEqual(config.source, 'icloud-mail');
assert.strictEqual(config.url, 'https://www.icloud.com/mail/');
assert.strictEqual(config.label, 'iCloud 邮箱');
assert.strictEqual(config.navigateOnReuse, true);

const apiConfig = utils.getMailProviderConfig({ mailProvider: 'icloud-api' });
assert.strictEqual(apiConfig.provider, 'icloud-api');
assert.strictEqual(apiConfig.label, 'iCloud API（QQ 转发）');

console.log('mail-provider-utils iCloud tests passed');
