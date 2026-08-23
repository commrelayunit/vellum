const OpenAI = require('openai');

const EDIT_DOCUMENT_TOOL = {
  type: 'function',
  function: {
    name: 'edit_document',
    description: 'Edit the document by replacing an exact, unique excerpt of its current content with new text.',
    parameters: {
      type: 'object',
      properties: {
        old_string: {
          type: 'string',
          description: 'The exact text to replace. Must match the current document content exactly and appear only once.'
        },
        new_string: {
          type: 'string',
          description: 'The text to replace it with.'
        }
      },
      required: ['old_string', 'new_string']
    }
  }
};

const MAX_TOOL_ROUNDS = 6;

function buildSystemPrompt(filePath, fileContent) {
  return `You are an AI assistant helping edit a document called ${filePath}. You can edit this document directly using the edit_document tool - use it when the user asks you to change something, rather than only describing the change in your reply. Current document content:\n\n${fileContent}`;
}

function formatContentWithSelections(content, selections) {
  if (!selections || selections.length === 0) {
    return content;
  }
  // String(s.quotedText ?? '') defends against a pre-existing malformed row
  // in the DB (e.g. persisted before src/server.js started normalizing
  // `selections` on ingest) - without it, a missing/non-string quotedText
  // throws here on every request that re-processes this file's history,
  // bricking the conversation until "Clear chat" discards it.
  const quotes = selections
    .map((s) => `> lines ${s.startLine}-${s.endLine}:\n> ${String(s.quotedText ?? '').replace(/\n/g, '\n> ')}`)
    .join('\n\n');
  return `${quotes}\n\n${content}`;
}

function toRequestMessage(message) {
  return {
    role: message.role === 'error' ? 'assistant' : message.role,
    content: formatContentWithSelections(message.content, message.selections)
  };
}

function accumulateToolCallDeltas(accumulated, deltaToolCalls) {
  deltaToolCalls.forEach((deltaCall) => {
    const index = deltaCall.index;
    if (!accumulated[index]) {
      accumulated[index] = { id: '', name: '', arguments: '' };
    }
    if (deltaCall.id) accumulated[index].id = deltaCall.id;
    if (deltaCall.function && deltaCall.function.name) accumulated[index].name = deltaCall.function.name;
    if (deltaCall.function && deltaCall.function.arguments) accumulated[index].arguments += deltaCall.function.arguments;
  });
}

function createChatCompletionService({ createClient } = {}) {
  const clientFactory = createClient || ((apiKey, baseURL) => new OpenAI({ apiKey, baseURL }));

  return {
    async complete({
      apiKey, baseUrl, model, reasoningEffort, filePath, fileContent, history, userMessage, selections,
      onDelta, onToolStart, onToolEnd, executeTool
    }) {
      const client = clientFactory(apiKey, baseUrl);
      const messages = [
        { role: 'system', content: buildSystemPrompt(filePath, fileContent) },
        ...history.map(toRequestMessage),
        { role: 'user', content: formatContentWithSelections(userMessage, selections) }
      ];

      let fullText = '';
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const isFinalAllowedRound = round === MAX_TOOL_ROUNDS - 1;
        const requestBody = { model, messages, stream: true };
        if (!isFinalAllowedRound && executeTool) {
          requestBody.tools = [EDIT_DOCUMENT_TOOL];
        }
        if (reasoningEffort) {
          requestBody.reasoning_effort = reasoningEffort;
        }

        const stream = await client.chat.completions.create(requestBody);
        let roundText = '';
        const toolCallAccumulator = {};
        for await (const chunk of stream) {
          const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
          if (delta && delta.content) {
            roundText += delta.content;
            fullText += delta.content;
            onDelta(delta.content);
          }
          if (delta && delta.tool_calls) {
            accumulateToolCallDeltas(toolCallAccumulator, delta.tool_calls);
          }
        }

        const toolCalls = Object.values(toolCallAccumulator).filter((call) => call.name);
        if (toolCalls.length === 0) {
          return fullText;
        }

        messages.push({
          role: 'assistant',
          content: roundText || null,
          tool_calls: toolCalls.map((call, i) => ({
            id: call.id || `call_${i}`,
            type: 'function',
            function: { name: call.name, arguments: call.arguments }
          }))
        });

        // Indexed so the tool-result message's tool_call_id falls back to the
        // exact same `call_${i}` the assistant message above generated for
        // this call. A constant fallback would make 2+ parallel tool calls
        // that both lack an API-provided id collide on one id.
        for (let i = 0; i < toolCalls.length; i++) {
          const call = toolCalls[i];
          let args;
          try {
            args = JSON.parse(call.arguments || '{}');
          } catch {
            args = {};
          }
          if (onToolStart) onToolStart(call.name);
          let result;
          try {
            result = await executeTool(call.name, args);
          } catch (err) {
            result = { success: false, message: err && err.message ? err.message : String(err) };
          }
          if (onToolEnd) onToolEnd(call.name, !!(result && result.success));
          let toolResultContent = (result && result.message) || (result && result.success ? 'Edit applied.' : 'Edit failed.');
          // Without this, a second edit_document call in the same turn is
          // checked by the model against the stale snapshot from the system
          // prompt rather than what the first call actually produced, so a
          // second edit re-quoting the model's own just-written text can
          // fail to match.
          if (result && typeof result.content === 'string') {
            toolResultContent += `\n\nCurrent document content:\n\n${result.content}`;
          }
          messages.push({
            role: 'tool',
            tool_call_id: call.id || `call_${i}`,
            content: toolResultContent
          });
        }
      }

      return fullText;
    }
  };
}

module.exports = { createChatCompletionService };
