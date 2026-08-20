const OpenAI = require('openai');

function buildSystemPrompt(filePath, fileContent) {
  return `You are an AI assistant helping edit a document called ${filePath}. Current document content:\n\n${fileContent}`;
}

function toRequestMessage(message) {
  return { role: message.role === 'error' ? 'assistant' : message.role, content: message.content };
}

function createChatCompletionService({ createClient } = {}) {
  const clientFactory = createClient || ((apiKey, baseURL) => new OpenAI({ apiKey, baseURL }));

  return {
    async complete({ apiKey, baseUrl, model, reasoningEffort, filePath, fileContent, history, userMessage, onDelta }) {
      const client = clientFactory(apiKey, baseUrl);
      const messages = [
        { role: 'system', content: buildSystemPrompt(filePath, fileContent) },
        ...history.map(toRequestMessage),
        { role: 'user', content: userMessage }
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
