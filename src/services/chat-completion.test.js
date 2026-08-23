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

test('complete() tells the model in the system message that it can call edit_document directly', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  await service.complete({
    apiKey: 'key', baseUrl: 'http://x', model: 'gpt-5',
    filePath: 'notes.md', fileContent: '# My Notes', history: [], userMessage: 'hi', onDelta: () => {}
  });
  assert.match(capture.request.messages[0].content, /edit_document/);
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

function toolCallingClient(rounds) {
  let call = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const chunks = rounds[call];
          call += 1;
          return {
            [Symbol.asyncIterator]: async function* () {
              for (const chunk of chunks) yield chunk;
            }
          };
        }
      }
    }
  };
}

test('complete() executes a tool call and feeds the result back for a second round', async () => {
  const round1 = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'edit_document', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"old_string":"foo","new' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '_string":"bar"}' } }] } }] }
  ];
  const round2 = [
    { choices: [{ delta: { content: 'Done!' } }] }
  ];
  const service = createChatCompletionService({ createClient: () => toolCallingClient([round1, round2]) });

  const executedCalls = [];
  const toolEvents = [];
  const deltas = [];
  const fullText = await service.complete({
    apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: 'foo',
    history: [], userMessage: 'change foo to bar',
    onDelta: (d) => deltas.push(d),
    onToolStart: (tool) => toolEvents.push(['start', tool]),
    onToolEnd: (tool, success) => toolEvents.push(['end', tool, success]),
    executeTool: async (name, args) => {
      executedCalls.push({ name, args });
      return { success: true, message: 'Edit applied.' };
    }
  });

  assert.deepEqual(executedCalls, [{ name: 'edit_document', args: { old_string: 'foo', new_string: 'bar' } }]);
  assert.deepEqual(toolEvents, [['start', 'edit_document'], ['end', 'edit_document', true]]);
  assert.equal(fullText, 'Done!');
  assert.deepEqual(deltas, ['Done!']);
});

test('complete() returns the reply directly when the model makes no tool call', async () => {
  const round1 = [{ choices: [{ delta: { content: 'Just a reply.' } }] }];
  const service = createChatCompletionService({ createClient: () => toolCallingClient([round1]) });
  const executedCalls = [];
  const fullText = await service.complete({
    apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '',
    history: [], userMessage: 'hi',
    onDelta: () => {},
    executeTool: async (name, args) => { executedCalls.push({ name, args }); return { success: true, message: '' }; }
  });
  assert.equal(fullText, 'Just a reply.');
  assert.deepEqual(executedCalls, []);
});

test('complete() feeds a failed tool result back to the model as the tool message content', async () => {
  const round1 = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'edit_document', arguments: '{"old_string":"missing","new_string":"x"}' } }] } }] }
  ];
  const round2 = [{ choices: [{ delta: { content: 'Could not find that text.' } }] }];
  const capture = {};
  const client = {
    chat: {
      completions: {
        create: async (request) => {
          if (!capture.firstRequest) capture.firstRequest = request;
          else capture.secondRequest = request;
          const chunks = capture.secondRequest ? round2 : round1;
          return { [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c; } };
        }
      }
    }
  };
  const service = createChatCompletionService({ createClient: () => client });
  const fullText = await service.complete({
    apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '',
    history: [], userMessage: 'edit it',
    onDelta: () => {},
    executeTool: async () => ({ success: false, message: 'old_string not found in the document' })
  });
  assert.equal(fullText, 'Could not find that text.');
  const toolMessage = capture.secondRequest.messages.find((m) => m.role === 'tool');
  assert.equal(toolMessage.content, 'old_string not found in the document');
});

test('complete() stops attaching tools on the final allowed round, forcing a plain reply', async () => {
  // A model that keeps calling the tool every round should be cut off after
  // the round cap, with the final request omitting `tools` so the API
  // cannot return another tool call.
  const alwaysToolCall = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_x', type: 'function', function: { name: 'edit_document', arguments: '{"old_string":"a","new_string":"b"}' } }] } }] }
  ];
  const finalPlain = [{ choices: [{ delta: { content: 'Giving up on further edits.' } }] }];
  const requests = [];
  const client = {
    chat: {
      completions: {
        create: async (request) => {
          requests.push(request);
          const chunks = requests.length <= 5 ? alwaysToolCall : finalPlain;
          return { [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c; } };
        }
      }
    }
  };
  const service = createChatCompletionService({ createClient: () => client });
  const fullText = await service.complete({
    apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '',
    history: [], userMessage: 'keep editing',
    onDelta: () => {},
    executeTool: async () => ({ success: true, message: 'Edit applied.' })
  });
  assert.equal(requests.length, 6);
  assert.equal('tools' in requests[5], false, 'the 6th and final request must not attach tools');
  assert.equal(fullText, 'Giving up on further edits.');
});

test('complete() works with no executeTool/onToolStart/onToolEnd passed, matching today\'s callers', async () => {
  const chunks = [{ choices: [{ delta: { content: 'plain reply' } }] }];
  const service = createChatCompletionService({ createClient: () => fakeClient(chunks) });
  const fullText = await service.complete({
    apiKey: 'key', baseUrl: 'http://x', model: 'gpt-5',
    filePath: 'a.md', fileContent: '# A', history: [], userMessage: 'hi',
    onDelta: () => {}
  });
  assert.equal(fullText, 'plain reply');
});
