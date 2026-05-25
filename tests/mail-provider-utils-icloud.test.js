const assert = require('assert');

const utils = require('../mail-provider-utils.js');

assert.strictEqual(utils.normalizeMailProvider('icloud'), 'icloud');
assert.strictEqual(utils.ICLOUD_PROVIDER, 'icloud');

const config = utils.getMailProviderConfig({ mailProvider: 'icloud' });
assert.strictEqual(config.source, 'icloud-mail');
assert.strictEqual(config.url, 'https://www.icloud.com/mail/');
assert.strictEqual(config.label, 'iCloud 邮箱');
assert.strictEqual(config.navigateOnReuse, true);

console.log('mail-provider-utils iCloud tests passed');
