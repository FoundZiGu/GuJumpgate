const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('package script is wired and validates migrated extension files', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const script = fs.readFileSync('scripts/package-extension.ps1', 'utf8');

  assert.match(packageJson.scripts.package, /scripts\/package-extension\.ps1|scripts\\package-extension\.ps1/);
  assert.match(script, /shared\/accounts\/managed-alias-utils\.js/);
  assert.match(script, /shared\/mail\/hotmail-utils\.js/);
  assert.match(script, /shared\/payment\/paypal-utils\.js/);
  assert.match(script, /sidepanel\/hosted-sms-pool-manager\.js/);
  assert.match(script, /Remove-Item -Force/);
  assert.match(script, /'tests'/);
  assert.match(script, /'docs'/);
  assert.match(script, /'dist'/);
});
