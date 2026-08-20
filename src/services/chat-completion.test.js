const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChatCompletionService } = require('./chat-completion');

function fakeClient(chunks) {
  return {
    chat: {
      completions: {
        create: async () => ({
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) yield chunk;
          }
        })
      }
    }
  };
}

function capturingClient(capture) {
  return {
    chat: {
      completions: {
        create: async (request) => {
          capture.request = request;
          return { [Symbol.asyncIterator]: async function* () {} };
        }
      }
    }
  };
}

test('complete() streams deltas via onDelta and returns the full assembled text', async () => {
  const chunks = [
    { choices: [{ delta: { content: 'Hel' } }] },
    { choices: [{ delta: { content: 'lo' } }] }
  ];
  const service = createChatCompletionService({ createClient: () => fakeClient(chunks) });
  const deltas = [];
  const fullText = await service.complete({
    apiKey: 'key', baseUrl: 'http://x', model: 'gpt-5',
    filePath: 'a.md', fileContent: '# A', history: [], userMessage: 'hi',
    onDelta: (d) => deltas.push(d)
  });
  assert.equal(fullText, 'Hello');
  assert.deepEqual(deltas, ['Hel', 'lo']);
});

test('complete() includes the file path and content in a system message', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  await service.complete({
    apiKey: 'key', baseUrl: 'http://x', model: 'gpt-5',
    filePath: 'notes.md', fileContent: '# My Notes', history: [], userMessage: 'hi', onDelta: () => {}
  });
  assert.equal(capture.request.messages[0].role, 'system');
  assert.match(capture.request.messages[0].content, /notes\.md/);
  assert.match(capture.request.messages[0].content, /# My Notes/);
});

test('complete() includes reasoning_effort only when provided', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  await service.complete({ apiKey: 'k', baseUrl: 'http://x', model: 'm', reasoningEffort: 'high', filePath: 'a.md', fileContent: '', history: [], userMessage: 'hi', onDelta: () => {} });
  assert.equal(capture.request.reasoning_effort, 'high');

  await service.complete({ apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '', history: [], userMessage: 'hi', onDelta: () => {} });
  assert.equal('reasoning_effort' in capture.request, false);
});

test('complete() maps persisted history into the request, translating a prior error role to assistant', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  await service.complete({
    apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '',
    history: [{ role: 'user', content: 'first' }, { role: 'error', content: 'oops' }],
    userMessage: 'second', onDelta: () => {}
  });
  assert.deepEqual(capture.request.messages.slice(1), [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'oops' },
    { role: 'user', content: 'second' }
  ]);
});

test('complete() propagates a rejection when the client throws', async () => {
  const client = { chat: { completions: { create: async () => { throw new Error('401 Unauthorized'); } } } };
  const service = createChatCompletionService({ createClient: () => client });
  await assert.rejects(
    () => service.complete({ apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '', history: [], userMessage: 'hi', onDelta: () => {} }),
    /401 Unauthorized/
  );
});
