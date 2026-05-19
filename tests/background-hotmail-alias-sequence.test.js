const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }

  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('Hotmail Outlook aliases are allocated as PayPal sequence tags', async () => {
  const api = new Function(`
const OUTLOOK_ALIAS_DEFAULT_MAX_PER_ACCOUNT = 5;
const OUTLOOK_ALIAS_MAX_PER_ACCOUNT_LIMIT = 50;
let state = {
  email: '',
  outlookAliasMaxPerAccount: 3,
  hotmailAliasUsage: {},
};
const allocated = [];

async function getState() {
  return state;
}
async function checkOutlookAliasSubscriptionUsage() {
  return { used: false, checked: true };
}
async function setHotmailAliasUsageEntry(account, aliasEmail, updates) {
  allocated.push(aliasEmail);
  state.hotmailAliasUsage = {
    [account.id]: {
      aliases: {
        ...(state.hotmailAliasUsage[account.id]?.aliases || {}),
        [aliasEmail.toLowerCase()]: { email: aliasEmail, used: Boolean(updates.used) },
      },
    },
  };
}
async function setEmailState(email) {
  state.email = email;
}

${extractFunction('normalizeOutlookAliasMaxPerAccount')}
${extractFunction('normalizeEmailAddressForMatch')}
${extractFunction('getHotmailAliasUsageKey')}
${extractFunction('normalizeHotmailAliasUsageEntry')}
${extractFunction('normalizeHotmailAliasUsage')}
${extractFunction('getHotmailAliasEntriesForAccount')}
${extractFunction('parseEmailAddressParts')}
${extractFunction('isOutlookPlusAliasForAccount')}
${extractFunction('buildOutlookPlusAliasEmail')}
${extractFunction('buildOutlookPayPalAliasEmail')}
${extractFunction('getOutlookPayPalAliasIndex')}
${extractFunction('isHotmailAliasUsed')}
${extractFunction('ensureOutlookAliasForHotmailAccount')}

return {
  ensureOutlookAliasForHotmailAccount,
  get allocated() {
    return allocated;
  },
  get state() {
    return state;
  },
};
`)();

  const first = await api.ensureOutlookAliasForHotmailAccount({ id: 'hm-1', email: 'user@hotmail.com' });
  api.state.email = '';
  api.state.hotmailAliasUsage['hm-1'].aliases[first.toLowerCase()].used = true;
  const second = await api.ensureOutlookAliasForHotmailAccount({ id: 'hm-1', email: 'user@hotmail.com' });

  assert.equal(first, 'user+PayPal1@hotmail.com');
  assert.equal(second, 'user+PayPal2@hotmail.com');
  assert.deepEqual(api.allocated, [
    'user+PayPal1@hotmail.com',
    'user+PayPal2@hotmail.com',
  ]);
});
