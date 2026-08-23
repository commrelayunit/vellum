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

test('complete() prepends selections as quoted excerpts before the new user message', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  await service.complete({
    apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '',
    history: [],
    userMessage: 'What does this mean?',
    selections: [{ quotedText: 'Hello\nworld', startLine: 3, endLine: 4 }],
    onDelta: () => {}
  });
  const userRequestMessage = capture.request.messages[capture.request.messages.length - 1];
  assert.equal(userRequestMessage.role, 'user');
  assert.match(userRequestMessage.content, /lines 3-4/);
  assert.match(userRequestMessage.content, /Hello\n> world/);
  assert.match(userRequestMessage.content, /What does this mean\?$/);
});

test('complete() applies the same selections formatting to historical messages', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  await service.complete({
    apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '',
    history: [
      { role: 'user', content: 'earlier question', selections: [{ quotedText: 'old excerpt', startLine: 1, endLine: 1 }] }
    ],
    userMessage: 'follow-up',
    onDelta: () => {}
  });
  const historyMessage = capture.request.messages[1];
  assert.match(historyMessage.content, /lines 1-1/);
  assert.match(historyMessage.content, /old excerpt/);
  assert.match(historyMessage.content, /earlier question$/);
});

test('complete() leaves message content untouched when selections is absent', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  await service.complete({
    apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '',
    history: [{ role: 'user', content: 'first' }],
    userMessage: 'second',
    onDelta: () => {}
  });
  assert.deepEqual(capture.request.messages.slice(1), [
    { role: 'user', content: 'first' },
    { role: 'user', content: 'second' }
  ]);
});

test('complete() does not throw when a selection entry has a missing or non-string quotedText', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  // Defends against a pre-existing malformed row surviving in the DB from
  // before src/server.js started normalizing `selections` on ingest - this
  // must never brick the request that re-processes it.
  await service.complete({
    apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '',
    history: [{ role: 'user', content: 'earlier question', selections: [{ startLine: 1, endLine: 1 }] }],
    userMessage: 'follow-up',
    selections: [{ startLine: 2, endLine: 2, quotedText: undefined }],
    onDelta: () => {}
  });
  const historyMessage = capture.request.messages[1];
  const userRequestMessage = capture.request.messages[capture.request.messages.length - 1];
  assert.match(historyMessage.content, /lines 1-1/);
  assert.match(userRequestMessage.content, /lines 2-2/);
  assert.match(userRequestMessage.content, /follow-up$/);
});

test('complete() formats 2 stacked selections on one message as separate quoted blocks in order', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  await service.complete({
    apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '',
    history: [],
    userMessage: 'Compare these two',
    selections: [
      { quotedText: 'first excerpt', startLine: 1, endLine: 1 },
      { quotedText: 'second excerpt', startLine: 5, endLine: 6 }
    ],
    onDelta: () => {}
  });
  const userRequestMessage = capture.request.messages[capture.request.messages.length - 1];
  assert.equal(
    userRequestMessage.content,
    '> lines 1-1:\n> first excerpt\n\n> lines 5-6:\n> second excerpt\n\nCompare these two'
  );
});

test('complete() propagates a rejection when the client throws', async () => {
  const client = { chat: { completions: { create: async () => { throw new Error('401 Unauthorized'); } } } };
  const service = createChatCompletionService({ createClient: () => client });
  await assert.rejects(
    () => service.complete({ apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '', history: [], userMessage: 'hi', onDelta: () => {} }),
    /401 Unauthorized/
  );
});
