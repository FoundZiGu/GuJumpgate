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

test('step 5 post-completion validation recovers about-you retry page before allowing success', async () => {
  const api = new Function(`
const logs = [];
const messages = [];
let stateReadCount = 0;

const chrome = {
  tabs: {
    async get() {
      return { url: 'https://auth.openai.com/about-you' };
    },
  },
};

async function sendToContentScriptResilient(source, message) {
  messages.push({ source, type: message.type });
  if (message.type === 'GET_STEP5_SUBMIT_STATE') {
    stateReadCount += 1;
    if (stateReadCount === 1) {
      return {
        retryPage: true,
        retryEnabled: true,
        maxCheckAttemptsBlocked: false,
        userAlreadyExistsBlocked: false,
        successState: '',
        profileVisible: false,
        errorText: '',
        unknownAuthPage: false,
        url: 'https://auth.openai.com/about-you',
      };
    }
    return {
      retryPage: false,
      retryEnabled: false,
      maxCheckAttemptsBlocked: false,
      userAlreadyExistsBlocked: false,
      successState: 'logged_in_home',
      profileVisible: false,
      errorText: '',
      unknownAuthPage: false,
      url: 'https://chatgpt.com/',
    };
  }
  if (message.type === 'RECOVER_STEP5_SUBMIT_RETRY_PAGE') {
    return { recovered: true, clickCount: 1 };
  }
  throw new Error('unexpected message type: ' + message.type);
}

async function addLog(message, level, meta) {
  logs.push({ message, level, meta });
}

async function waitForTabStableComplete() {}

${extractFunction('parseUrlSafely')}
${extractFunction('isSignupEntryHost')}
${extractFunction('isLikelyLoggedInChatgptHomeUrl')}
${extractFunction('getStep5SubmitStateFromContent')}
${extractFunction('recoverStep5SubmitRetryPageOnTab')}
${extractFunction('validateStep5PostCompletion')}

return {
  async run() {
    return validateStep5PostCompletion(99, {});
  },
  snapshot() {
    return { logs, messages, stateReadCount };
  },
};
`)();

  const result = await api.run();
  const snapshot = api.snapshot();

  assert.equal(result.successState, 'logged_in_home');
  assert.deepStrictEqual(
    snapshot.messages.map(({ type }) => type),
    ['GET_STEP5_SUBMIT_STATE', 'RECOVER_STEP5_SUBMIT_RETRY_PAGE', 'GET_STEP5_SUBMIT_STATE']
  );
  assert.equal(snapshot.stateReadCount, 2);
  assert.equal(
    snapshot.logs.some(({ message }) => /检测到认证重试页/.test(message)),
    true
  );
});

test('step 5 post-completion validation accepts left-profile completion state', async () => {
  const api = new Function(`
const chrome = {
  tabs: {
    async get() {
      return { url: 'https://pay.openai.com/c/pay/hosted_cs_next' };
    },
  },
};

async function sendToContentScriptResilient(source, message) {
  if (message.type === 'GET_STEP5_SUBMIT_STATE') {
    return {
      retryPage: false,
      retryEnabled: false,
      maxCheckAttemptsBlocked: false,
      userAlreadyExistsBlocked: false,
      successState: 'left_profile',
      profileVisible: false,
      errorText: '',
      unknownAuthPage: false,
      url: 'https://pay.openai.com/c/pay/hosted_cs_next',
    };
  }
  throw new Error('unexpected message type: ' + message.type);
}

async function addLog() {}
async function waitForTabStableComplete() {}

${extractFunction('parseUrlSafely')}
${extractFunction('isSignupEntryHost')}
${extractFunction('isLikelyLoggedInChatgptHomeUrl')}
${extractFunction('getStep5SubmitStateFromContent')}
${extractFunction('recoverStep5SubmitRetryPageOnTab')}
${extractFunction('validateStep5PostCompletion')}

return {
  run() {
    return validateStep5PostCompletion(99, {});
  },
};
`)();

  const result = await api.run();

  assert.equal(result.successState, 'left_profile');
  assert.equal(result.url, 'https://pay.openai.com/c/pay/hosted_cs_next');
});
