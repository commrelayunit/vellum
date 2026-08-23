const OpenAI = require('openai');

function buildSystemPrompt(filePath, fileContent) {
  return `You are an AI assistant helping edit a document called ${filePath}. Current document content:\n\n${fileContent}`;
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

function createChatCompletionService({ createClient } = {}) {
  const clientFactory = createClient || ((apiKey, baseURL) => new OpenAI({ apiKey, baseURL }));

  return {
    async complete({ apiKey, baseUrl, model, reasoningEffort, filePath, fileContent, history, userMessage, selections, onDelta }) {
      const client = clientFactory(apiKey, baseUrl);
      const messages = [
        { role: 'system', content: buildSystemPrompt(filePath, fileContent) },
        ...history.map(toRequestMessage),
        { role: 'user', content: formatContentWithSelections(userMessage, selections) }
      ];
      const requestBody = { model, messages, stream: true };
      if (reasoningEffort) {
        requestBody.reasoning_effort = reasoningEffort;
      }
      const stream = await client.chat.completions.create(requestBody);
      let fullText = '';
      for await (const chunk of stream) {
        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
        if (delta) {
          fullText += delta;
          onDelta(delta);
        }
      }
      return fullText;
    }
  };
}

module.exports = { createChatCompletionService };
