const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function extractFunctionSource(source, functionName) {
  const asyncSignature = `async function ${functionName}`;
  const syncSignature = `function ${functionName}`;
  const signature = source.includes(asyncSignature) ? asyncSignature : syncSignature;
  const startIndex = source.indexOf(signature);
  if (startIndex < 0) {
    throw new Error(`Unable to find function ${functionName}`);
  }
  const paramsStart = source.indexOf('(', startIndex);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      paramsDepth += 1;
    } else if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = source.indexOf('{', index);
        break;
      }
    }
  }
  if (bodyStart < 0) {
    throw new Error(`Unable to find body for ${functionName}`);
  }
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract full source for ${functionName}`);
}

test('checkout startup fails when document never reaches complete', async () => {
  const filePath = path.join(__dirname, '..', 'content', 'plus-checkout.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const timeoutMatch = source.match(/const PLUS_CHECKOUT_DOCUMENT_COMPLETE_TIMEOUT_MS = (\d+);/);
  if (!timeoutMatch) {
    throw new Error('Unable to find PLUS_CHECKOUT_DOCUMENT_COMPLETE_TIMEOUT_MS');
  }

  let fakeNow = 0;
  const sandbox = {
    document: { readyState: 'loading' },
    throwIfStopped: () => {},
    sleep: async (ms) => {
      fakeNow += ms;
    },
    Date: {
      now: () => fakeNow,
    },
    Error,
  };
  sandbox.globalThis = sandbox;

  const script = [
    `const PLUS_CHECKOUT_DOCUMENT_COMPLETE_TIMEOUT_MS = ${timeoutMatch[1]};`,
    extractFunctionSource(source, 'waitUntil'),
    extractFunctionSource(source, 'waitForDocumentComplete'),
    'globalThis.__waitForDocumentComplete = waitForDocumentComplete;',
  ].join('\n');
  vm.runInNewContext(script, sandbox, { filename: filePath });

  await assert.rejects(
    () => sandbox.__waitForDocumentComplete(),
    /页面加载完成等待超时/
  );
});
