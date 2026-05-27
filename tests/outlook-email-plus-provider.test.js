const assert = require('node:assert/strict');
const test = require('node:test');

const outlookEmailPlusUtils = require('../outlook-email-plus-utils.js');
require('../background/outlook-email-plus-provider.js');

const { createOutlookEmailPlusProvider } = globalThis.MultiPageBackgroundOutlookEmailPlusProvider;

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function createProviderHarness(routeHandler, initialState = {}) {
  const requests = [];
  const logs = [];
  const persistedEmails = [];
  const state = {
    outlookEmailPlusBaseUrl: 'https://outlook-plus.test/api/external/health',
    outlookEmailPlusApiKey: 'secret-key',
    outlookEmailPlusProvider: 'outlook',
    outlookEmailPlusProjectKey: 'openai',
    outlookEmailPlusCallerIdPrefix: 'gujumpgate',
    ...initialState,
  };
  const buildProvider = () => createOutlookEmailPlusProvider({
    ...outlookEmailPlusUtils,
    addLog: async (message, level) => logs.push({ message, level }),
    broadcastDataUpdate: () => {},
    fetchImpl: async (url, options = {}) => {
      const request = {
        url,
        options,
        body: options.body ? JSON.parse(options.body) : null,
      };
      requests.push(request);
      return routeHandler(request, state, requests);
    },
    getState: async () => state,
    persistRegistrationEmailState: async (_state, email, options) => {
      persistedEmails.push({ email, options });
      state.email = email;
      state.registrationEmailState = {
        ...(state.registrationEmailState || {}),
        current: email,
      };
    },
    setPersistentSettings: async (patch) => Object.assign(state, patch),
    setState: async (patch) => Object.assign(state, patch),
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    OUTLOOK_EMAIL_PLUS_GENERATOR: 'outlook-email-plus',
    OUTLOOK_EMAIL_PLUS_PROVIDER: 'outlook-email-plus',
  });
  const provider = buildProvider();
  return { logs, persistedEmails, provider, recreateProvider: buildProvider, requests, state };
}

function claimPayload(accountId, email, claimToken) {
  return {
    success: true,
    data: {
      account_id: accountId,
      email,
      email_domain: email.split('@')[1],
      claim_token: claimToken,
      claimed_at: '2026-05-23T00:00:00Z',
      lease_expires_at: '2026-05-23T00:10:00Z',
    },
  };
}

test('base claims generate PayPal aliases and store session claim state without raw payloads', async () => {
  const harness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/pool/claim-random') {
      return createJsonResponse(claimPayload('acct-1', 'User@Example.com', 'claim-token-1'));
    }
    if (url.pathname === '/api/external/pool/claim-complete') {
      return createJsonResponse({ success: true, data: { ok: true } });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, { outlookEmailPlusAliasMaxPerMailbox: 3 });

  const address = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'Task 42' });

  assert.equal(address, 'user+PayPal1@example.com');
  assert.equal(harness.persistedEmails[0].email, 'user+PayPal1@example.com');
  const claimRequest = harness.requests[0];
  assert.equal(claimRequest.body.provider, 'outlook');
  assert.equal(claimRequest.body.project_key, 'openai');
  assert.match(claimRequest.body.caller_id, /^gujumpgate-/);
  assert.equal(claimRequest.body.task_id, 'task-42');
  assert.equal(claimRequest.options.headers['X-API-Key'], 'secret-key');
  assert.equal(harness.state.currentOutlookEmailPlusClaim.claimToken, 'claim-token-1');
  assert.equal(harness.state.currentOutlookEmailPlusClaim.raw, undefined);
  assert.equal(harness.state.currentOutlookEmailPlusClaim.taskId, claimRequest.body.task_id);
  assert.equal(harness.state.currentOutlookEmailPlusClaim.address, 'user@example.com');
  assert.equal(harness.state.currentOutlookEmailPlusClaim.baseAddress, 'user@example.com');
  assert.equal(harness.state.currentOutlookEmailPlusClaim.registrationEmail, 'user+PayPal1@example.com');
  assert.equal(harness.state.currentOutlookEmailPlusClaim.isAliasClaim, false);
  assert.equal(harness.state.currentOutlookEmailPlusClaim.aliasIndex, 1);
  assert.equal(harness.state.currentOutlookEmailPlusClaim.aliasMax, 3);
  assert.equal(harness.state.currentOutlookEmailPlusClaim.aliasUsed, false);
  assert.ok(harness.state.currentOutlookEmailPlusClaim.usageKey.startsWith('outlook-email-plus:'));
  assert.equal(
    harness.state.hotmailAliasUsage[harness.state.currentOutlookEmailPlusClaim.usageKey].aliases['user+paypal1@example.com'].used,
    false
  );

  const result = await harness.provider.completeOutlookEmailPlusClaim(harness.state);

  assert.deepEqual(result, { completed: true });
  const completeRequest = harness.requests[1];
  assert.equal(new URL(completeRequest.url).pathname, '/api/external/pool/claim-complete');
  assert.equal(completeRequest.body.account_id, 'acct-1');
  assert.equal(completeRequest.body.email, 'user@example.com');
  assert.equal(completeRequest.body.claim_token, 'claim-token-1');
  assert.equal(completeRequest.body.caller_id, claimRequest.body.caller_id);
  assert.equal(completeRequest.body.task_id, claimRequest.body.task_id);
  assert.equal(completeRequest.body.result, 'success');
  assert.equal(harness.state.currentOutlookEmailPlusClaim, null);
});

test('claim reuse survives provider recreation with persisted alias usage and stored claim token', async () => {
  const claims = [
    claimPayload('acct-1', 'first@example.com', 'token-1'),
    claimPayload('acct-2', 'second@example.com', 'token-2'),
  ];
  const harness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/pool/claim-random') {
      return createJsonResponse(claims.shift());
    }
    if (url.pathname === '/api/external/pool/claim-complete') {
      return createJsonResponse({ success: true, data: { ok: true } });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, { outlookEmailPlusAliasMaxPerMailbox: 2 });

  const first = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'batch' });
  const restartedProvider = harness.recreateProvider();
  const repeated = await restartedProvider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'batch' });
  assert.equal(first, 'first+PayPal1@example.com');
  assert.equal(repeated, 'first+PayPal1@example.com');
  assert.equal(harness.requests.filter((request) => new URL(request.url).pathname === '/api/external/pool/claim-random').length, 1);

  const usedFirst = await restartedProvider.markOutlookEmailPlusAliasUsed(harness.state);
  assert.equal(usedFirst.exhausted, false);
  assert.equal(usedFirst.aliasIndex, 1);
  const second = await restartedProvider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'batch' });
  assert.equal(second, 'first+PayPal2@example.com');
  assert.equal(harness.requests.filter((request) => new URL(request.url).pathname === '/api/external/pool/claim-random').length, 1);

  const usedSecond = await restartedProvider.markOutlookEmailPlusAliasUsed(harness.state);
  assert.equal(usedSecond.exhausted, true);
  assert.equal(usedSecond.aliasIndex, 2);
  await restartedProvider.completeOutlookEmailPlusClaim(harness.state, { result: 'success' });
  const third = await restartedProvider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'batch-2' });

  assert.equal(third, 'second+PayPal1@example.com');
  const completeRequest = harness.requests.find((request) => new URL(request.url).pathname === '/api/external/pool/claim-complete');
  assert.equal(completeRequest.body.account_id, 'acct-1');
  assert.equal(completeRequest.body.email, 'first@example.com');
  assert.equal(completeRequest.body.claim_token, 'token-1');
  assert.equal(completeRequest.body.result, 'success');
  assert.equal(harness.requests.filter((request) => new URL(request.url).pathname === '/api/external/pool/claim-random').length, 2);
});

test('claimed aliases use the base mailbox for numbered registration aliases without nesting', async () => {
  const harness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/pool/claim-random') {
      return createJsonResponse(claimPayload('acct-alias', 'User+Claimed@Example.com', 'claim-token-alias'));
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, { outlookEmailPlusAliasMaxPerMailbox: 2 });

  const address = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'alias-case' });

  assert.equal(address, 'user+PayPal1@example.com');
  assert.equal(harness.persistedEmails[0].email, 'user+PayPal1@example.com');
  assert.equal(harness.state.currentOutlookEmailPlusClaim.address, 'user+claimed@example.com');
  assert.equal(harness.state.currentOutlookEmailPlusClaim.baseAddress, 'user@example.com');
  assert.equal(harness.state.currentOutlookEmailPlusClaim.registrationEmail, 'user+PayPal1@example.com');
  assert.equal(harness.state.currentOutlookEmailPlusClaim.isAliasClaim, true);
  assert.equal(harness.state.currentOutlookEmailPlusClaim.aliasIndex, 1);
  assert.equal(harness.state.currentOutlookEmailPlusClaim.aliasMax, 2);
});

test('claim reuse advances aliases up to the configured mailbox limit before claiming a new mailbox', async () => {
  const claims = [
    claimPayload('acct-1', 'first@example.com', 'token-1'),
    claimPayload('acct-2', 'second@example.com', 'token-2'),
  ];
  const harness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/pool/claim-random') {
      return createJsonResponse(claims.shift());
    }
    if (url.pathname === '/api/external/pool/claim-complete') {
      return createJsonResponse({ success: true, data: { ok: true } });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, { outlookEmailPlusAliasMaxPerMailbox: 2 });

  const first = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'batch' });
  const repeated = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'batch' });
  assert.equal(first, 'first+PayPal1@example.com');
  assert.equal(repeated, 'first+PayPal1@example.com');
  assert.equal(harness.requests.filter((request) => new URL(request.url).pathname === '/api/external/pool/claim-random').length, 1);

  const usedFirst = await harness.provider.markOutlookEmailPlusAliasUsed(harness.state);
  assert.equal(usedFirst.exhausted, false);
  assert.equal(usedFirst.aliasIndex, 1);

  const second = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'batch' });
  assert.equal(second, 'first+PayPal2@example.com');
  assert.equal(harness.requests.filter((request) => new URL(request.url).pathname === '/api/external/pool/claim-random').length, 1);

  const usedSecond = await harness.provider.markOutlookEmailPlusAliasUsed(harness.state);
  assert.equal(usedSecond.exhausted, true);
  assert.equal(usedSecond.aliasIndex, 2);

  await harness.provider.completeOutlookEmailPlusClaim(harness.state, { result: 'success' });
  const third = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'batch-2' });
  assert.equal(third, 'second+PayPal1@example.com');
  assert.equal(harness.requests.filter((request) => new URL(request.url).pathname === '/api/external/pool/claim-random').length, 2);
  assert.equal(harness.state.currentOutlookEmailPlusClaim.address, 'second@example.com');
  assert.equal(harness.state.currentOutlookEmailPlusClaim.registrationEmail, 'second+PayPal1@example.com');
  assert.equal(harness.state.currentOutlookEmailPlusClaim.aliasIndex, 1);
  assert.equal(harness.state.currentOutlookEmailPlusClaim.aliasUsed, false);
});

test('burning a conflicted alias keeps the current claim reusable until the mailbox is exhausted', async () => {
  const claims = [
    claimPayload('acct-1', 'first@example.com', 'token-1'),
    claimPayload('acct-2', 'second@example.com', 'token-2'),
  ];
  const harness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/pool/claim-random') {
      return createJsonResponse(claims.shift());
    }
    if (url.pathname === '/api/external/pool/claim-complete') {
      return createJsonResponse({ success: true, data: { ok: true } });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, { outlookEmailPlusAliasMaxPerMailbox: 2 });

  const first = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'conflict' });
  const burnedFirst = await harness.provider.markOutlookEmailPlusAliasUsed(harness.state);
  const second = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'conflict' });
  const burnedSecond = await harness.provider.markOutlookEmailPlusAliasUsed(harness.state);
  await harness.provider.completeOutlookEmailPlusClaim(harness.state, { result: 'user_already_exists' });
  const third = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'conflict-next' });

  assert.equal(first, 'first+PayPal1@example.com');
  assert.equal(burnedFirst.exhausted, false);
  assert.equal(second, 'first+PayPal2@example.com');
  assert.equal(burnedSecond.exhausted, true);
  assert.equal(third, 'second+PayPal1@example.com');
});

test('claim reuse follows the current mailbox alias limit instead of a stale stored claim limit', async () => {
  const harness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/pool/claim-random') {
      return createJsonResponse(claimPayload('acct-1', 'first@example.com', 'token-1'));
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, { outlookEmailPlusAliasMaxPerMailbox: 2 });

  await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'expanded-limit' });
  harness.state.outlookEmailPlusAliasMaxPerMailbox = 5;

  await harness.provider.markOutlookEmailPlusAliasUsed(harness.state);
  const second = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'expanded-limit' });
  const usedSecond = await harness.provider.markOutlookEmailPlusAliasUsed(harness.state);
  const third = await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'expanded-limit' });

  assert.equal(second, 'first+PayPal2@example.com');
  assert.equal(usedSecond.exhausted, false);
  assert.equal(third, 'first+PayPal3@example.com');
  assert.equal(harness.requests.filter((request) => new URL(request.url).pathname === '/api/external/pool/claim-random').length, 1);
});

test('alias max defaults to 5 and clamps configured values to 1 through 50', async () => {
  const defaultHarness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/pool/claim-random') {
      return createJsonResponse(claimPayload('acct-default', 'default@example.com', 'token-default'));
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });

  await defaultHarness.provider.claimOutlookEmailPlusAddress(defaultHarness.state, { taskId: 'default-max' });
  assert.equal(defaultHarness.state.currentOutlookEmailPlusClaim.aliasMax, 5);

  const clampedHarness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/pool/claim-random') {
      return createJsonResponse(claimPayload('acct-clamped', 'clamped@example.com', 'token-clamped'));
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, { outlookEmailPlusAliasMaxPerMailbox: 99 });

  await clampedHarness.provider.claimOutlookEmailPlusAddress(clampedHarness.state, { taskId: 'clamped-max' });
  assert.equal(clampedHarness.state.currentOutlookEmailPlusClaim.aliasMax, 50);

  const minimumHarness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/pool/claim-random') {
      return createJsonResponse(claimPayload('acct-minimum', 'minimum@example.com', 'token-minimum'));
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, { outlookEmailPlusAliasMaxPerMailbox: 0 });

  await minimumHarness.provider.claimOutlookEmailPlusAddress(minimumHarness.state, { taskId: 'minimum-max' });
  assert.equal(minimumHarness.state.currentOutlookEmailPlusClaim.aliasMax, 1);

  const singleAliasHarness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/pool/claim-random') {
      return createJsonResponse(claimPayload('acct-single', 'single@example.com', 'token-single'));
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  }, { outlookEmailPlusAliasMaxPerMailbox: 1 });

  await singleAliasHarness.provider.claimOutlookEmailPlusAddress(singleAliasHarness.state, { taskId: 'single-max' });
  assert.equal(singleAliasHarness.state.currentOutlookEmailPlusClaim.aliasMax, 1);
});

test('release uses remembered claim token and original claimed address', async () => {
  const harness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/pool/claim-random') {
      return createJsonResponse(claimPayload('acct-2', 'release@example.com', 'claim-token-2'));
    }
    if (url.pathname === '/api/external/pool/claim-release') {
      return createJsonResponse({ success: true, data: { ok: true } });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });

  await harness.provider.claimOutlookEmailPlusAddress(harness.state, { taskId: 'manual-task' });
  const result = await harness.provider.releaseOutlookEmailPlusClaim(harness.state, { reason: 'flow_failed' });

  assert.deepEqual(result, { released: true });
  const releaseRequest = harness.requests[1];
  assert.equal(new URL(releaseRequest.url).pathname, '/api/external/pool/claim-release');
  assert.equal(releaseRequest.body.account_id, 'acct-2');
  assert.equal(releaseRequest.body.email, 'release@example.com');
  assert.equal(releaseRequest.body.claim_token, 'claim-token-2');
  assert.equal(releaseRequest.body.task_id, 'manual-task');
  assert.equal(releaseRequest.body.reason, 'flow_failed');
  assert.equal(harness.state.currentOutlookEmailPlusClaim, null);
});

test('verification polling avoids over-restrictive sender and subject filters', async () => {
  const harness = createProviderHarness((request) => {
    const url = new URL(request.url);
    assert.equal(url.pathname, '/api/external/verification-code');
    assert.equal(url.searchParams.get('email'), 'target@example.com');
    assert.equal(url.searchParams.get('since_minutes'), '7');
    assert.equal(url.searchParams.get('code_length'), '6');
    assert.equal(url.searchParams.has('from_contains'), false);
    assert.equal(url.searchParams.has('subject_contains'), false);
    return createJsonResponse({
      success: true,
      data: {
        verification_code: '123456',
        message_id: 'msg-1',
        received_at: '2026-05-23T00:00:00Z',
      },
    });
  });

  const result = await harness.provider.pollOutlookEmailPlusVerificationCode(8, harness.state, {
    targetEmail: 'target@example.com',
    senderFilters: ['verify'],
    subjectFilters: ['verify'],
    sinceMinutes: 7,
    codeLength: 6,
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, '123456');
  assert.equal(result.mailId, 'msg-1');
});

test('verification polling completes the claim with timeout when no code is found', async () => {
  const harness = createProviderHarness((request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/external/verification-code') {
      assert.equal(url.searchParams.get('email'), 'timeout+paypal1@example.com');
      return createJsonResponse({ success: true, data: {} });
    }
    if (url.pathname === '/api/external/pool/claim-complete') {
      return createJsonResponse({ success: true, data: { ok: true } });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  harness.state.registrationEmailState = { current: 'timeout+PayPal1@example.com' };
  harness.state.currentOutlookEmailPlusClaim = {
    accountId: 'acct-timeout',
    address: 'timeout@example.com',
    baseAddress: 'timeout@example.com',
    registrationEmail: 'timeout+PayPal1@example.com',
    claimToken: 'token-timeout',
    callerId: 'gujumpgate-timeout',
    taskId: 'task-timeout',
    projectKey: 'openai',
    provider: 'outlook',
  };

  await assert.rejects(
    harness.provider.pollOutlookEmailPlusVerificationCode(9, harness.state, {
      maxAttempts: 2,
      intervalMs: 0,
    }),
    /未在 Outlook Email Plus 中找到新的匹配验证码/
  );

  const completeRequest = harness.requests.find((request) => new URL(request.url).pathname === '/api/external/pool/claim-complete');
  assert.equal(completeRequest.body.account_id, 'acct-timeout');
  assert.equal(completeRequest.body.email, 'timeout@example.com');
  assert.equal(completeRequest.body.claim_token, 'token-timeout');
  assert.equal(completeRequest.body.caller_id, 'gujumpgate-timeout');
  assert.equal(completeRequest.body.task_id, 'task-timeout');
  assert.equal(completeRequest.body.project_key, 'openai');
  assert.equal(completeRequest.body.result, 'verification_timeout');
  assert.equal(harness.state.currentOutlookEmailPlusClaim, null);
});

test('verification polling prefers current registration alias over claimed base address', async () => {
  const harness = createProviderHarness((request) => {
    const url = new URL(request.url);
    assert.equal(url.pathname, '/api/external/verification-code');
    assert.equal(url.searchParams.get('email'), 'user+paypal1@example.com');
    return createJsonResponse({
      success: true,
      data: {
        verification_code: '789012',
      },
    });
  });
  harness.state.email = 'user@example.com';
  harness.state.registrationEmailState = { current: 'user+PayPal1@example.com' };
  harness.state.currentOutlookEmailPlusClaim = {
    address: 'user@example.com',
    registrationEmail: 'user+PayPal2@example.com',
  };

  const result = await harness.provider.pollOutlookEmailPlusVerificationCode(4, harness.state, {});

  assert.equal(result.ok, true);
  assert.equal(result.code, '789012');
});
