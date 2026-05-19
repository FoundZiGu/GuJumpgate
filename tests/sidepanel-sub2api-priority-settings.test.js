const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

test('sidepanel exposes SUB2API account priority below group setting', () => {
  assert.match(html, /id="row-sub2api-account-priority"/);
  assert.match(html, /id="input-sub2api-account-priority"/);
  assert.match(html, /<span class="data-label">优先级<\/span>/);
  const inputTag = html.match(/<input[^>]*id="input-sub2api-account-priority"[^>]*>/)?.[0] || '';
  assert.match(inputTag, /type="number"/);
  assert.match(inputTag, /min="1"/);
  assert.match(inputTag, /step="1"/);
  assert.ok(
    html.indexOf('id="row-sub2api-account-priority"') > html.indexOf('id="row-sub2api-group"'),
    'priority row should be placed below the SUB2API group row'
  );
  assert.ok(
    html.indexOf('id="row-sub2api-account-priority"') < html.indexOf('id="row-sub2api-default-proxy"'),
    'priority row should remain above the SUB2API default proxy row'
  );
});

test('sidepanel persists and locks SUB2API account priority setting', () => {
  assert.match(
    source,
    /const rowSub2ApiAccountPriority = document\.getElementById\('row-sub2api-account-priority'\);/
  );
  assert.match(
    source,
    /const inputSub2ApiAccountPriority = document\.getElementById\('input-sub2api-account-priority'\);/
  );
  assert.match(source, /function normalizeSub2ApiAccountPriorityValue\(/);
  assert.match(source, /const sub2apiAccountPriorityNormalizer = typeof normalizeSub2ApiAccountPriorityValue === 'function'/);
  assert.match(source, /sub2apiAccountPriority: sub2apiAccountPriorityNormalizer\(/);
  assert.match(
    source,
    /inputSub2ApiAccountPriority\.value = String\(normalizeSub2ApiAccountPriorityValue\(state\?\.sub2apiAccountPriority\)\);/
  );
  assert.match(source, /rowSub2ApiAccountPriority\.style\.display = !hideOAuthSourceSettings && useSub2Api \? '' : 'none';/);
  assert.match(source, /inputSub2ApiAccountPriority\.disabled = locked;/);
  assert.match(
    source,
    /inputSub2ApiAccountPriority\.addEventListener\('input', \(\) => \{[\s\S]*scheduleSettingsAutoSave\(\);[\s\S]*\}\);/
  );
  assert.match(
    source,
    /inputSub2ApiAccountPriority\.addEventListener\('blur', \(\) => \{[\s\S]*saveSettings\(\{ silent: true \}\)/
  );
});
