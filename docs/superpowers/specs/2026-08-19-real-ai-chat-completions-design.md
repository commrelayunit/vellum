# Real AI Chat Completions — Design

## Purpose

The writing view's chat panel is currently decorative: it echoes your message back and fakes a canned reply after a 1s delay, with no real AI provider ever called. AI provider credentials are already stored (Settings page, encrypted, with an `active_in_workspace` toggle that surfaces providers in the presence stack), but nothing has ever used them to make a completion call. This project wires the chat panel to a real, streaming completion from whichever active provider you select, with the conversation persisted per file.

This is **Sub-project A** of a larger effort. Two related capabilities are explicitly out of scope here, each its own future project:

- **Sub-project B** — select a line/range in the editor and attach it as a reference to an outgoing chat message. Builds directly on this project's chat-completion plumbing once it exists.
- **Sub-project C** — Overleaf-style margin comments anchored to text ranges, optionally addressed to the model. Deliberately kept as a separate system from the chat panel (not unified), decided after weighing that chat is conversational/ephemeral while editorial comments are positional/persistent/resolvable — forcing both through one UI would compromise both.

## Scope

**In scope:**
- Real chat-completion calls to a selected active provider, streamed token-by-token into the chat panel.
- A provider selector in the chat panel when multiple providers are active in the workspace.
- Chat history persisted per file, surviving reload/restart.
- The current file's content automatically included as context on every request.
- Per-provider default reasoning effort (none/low/medium/high), sent as `reasoning_effort` when set.
- Inline error messages in the chat history when a request fails.

**Explicitly out of scope:** Sub-projects B and C (above); the model editing the document directly (this project is chat-only — the model replies in the chat panel, you apply anything yourself); real-time multi-user collaboration (unrelated, milestone M6).

## Dependency decision

This project adds the official `openai` npm package as a new dependency, calling it against each provider's stored `baseUrl` (its client supports arbitrary OpenAI-compatible base URLs, not just openai.com). This is a deliberate departure from every other feature built this session, which stayed dependency-free — justified here because the SDK's streaming ergonomics (async iteration over completion chunks) meaningfully simplify the one place in the app that talks to an external, non-Anthropic-Claude-Code-tooling API surface.

## Data model

Two new migrations, continuing the numbered sequence from the safe-migrations work (`0001`-`0003` already shipped):

```sql
-- 0004_chat_messages.js
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant','error')),
  content TEXT NOT NULL,
  provider_label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`provider_label` is a snapshot of the provider's label at send time, not a foreign key — if a provider is later renamed or deleted, historical messages still show who answered, with no join or orphaned-reference handling needed.

```sql
-- 0005_provider_reasoning_effort.js
ALTER TABLE ai_providers ADD COLUMN default_reasoning_effort TEXT;
```

`NULL` means "none" — the field is omitted from the completion request entirely. Otherwise one of `'low'` / `'medium'` / `'high'`, matching OpenAI's actual `reasoning_effort` parameter values. A provider/model that doesn't support the parameter either ignores it or the value is simply left unset for that provider.

## Repositories

`src/db/chat-messages.js`, matching the shape of the other repos:

```js
createChatMessagesRepo(db) => {
  listForFile(fileId) => [{id, role, content, providerLabel, createdAt}, ...],
  create({fileId, role, content, providerLabel}) => same shape
}
```

`src/db/providers.js` gains:
- `defaultReasoningEffort` threaded through `toViewModel`/`create`/`update`, same pattern as `defaultModel`.
- A new method, `getDecryptedApiKey(id)`, returning the plaintext key. This is the one place in the whole app that ever exposes a decrypted key outside the masked-display path. It is used *only* inside the new chat-completion route — never returned from any HTTP response, never logged, never sent to the client.

## Routes

- `GET /api/chat/:fileId/messages` (`requireAuth`) — returns `chatMessagesRepo.listForFile(fileId)`.
- `POST /api/chat/:fileId/messages` (`requireAuth`) — body `{ providerId, message }`.
  1. Validates `message` is a non-empty string and `providerId` refers to a provider that is `activeInWorkspace`.
  2. Persists the user message (`role: 'user'`) immediately.
  3. Builds the completion request: a system message containing the file's current content (`"You are an AI assistant helping edit a document called <path>. Current document content:\n\n<content>"`), followed by the file's persisted history, followed by the new user message.
  4. Calls `new OpenAI({ apiKey: providersRepo.getDecryptedApiKey(providerId), baseURL: provider.baseUrl }).chat.completions.create({ model: provider.defaultModel, messages, stream: true, ...(provider.defaultReasoningEffort ? { reasoning_effort: provider.defaultReasoningEffort } : {}) })`.
  5. Streams each text delta from the SDK's async iterator to the client as a chunked response (`Content-Type: text/plain`, no `EventSource` — that's GET-only and this is a POST, so the client reads via `fetch()` + `response.body.getReader()`).
  6. On stream completion, persists the full assembled reply as one `role: 'assistant'` row, with `providerLabel` set to the provider's current label.
  7. On any failure (bad key, network error, non-2xx, provider error mid-stream): persists and streams back a `role: 'error'` row with a concise description (e.g. `"Request failed: 401 Unauthorized"`).

## Chat panel UI

- On page load, `GET /api/chat/:fileId/messages` replaces the current hardcoded two-message markup in `writing.ejs`/rendering in `main.js`.
- A provider `<select>` is added to `.chat-header`, populated from `activeProviders` (already passed to the view for the presence stack), defaulting to the first active provider. If `activeProviders` is empty, the chat input and send button are disabled with inline text pointing to Settings.
- `sendMessage()` in `main.js` is rewritten: append the user's message locally, `POST` to the new route with the selected `providerId`, then read the streaming response and append text into a growing assistant message bubble as chunks arrive — replacing the current `setTimeout`-based mock entirely.
- A new `.message.error-message` CSS variant renders `role: 'error'` entries distinctly, following the existing `.message`/`.agent-message` pattern.

## Settings UI

The provider form gains a "Reasoning effort" `<select>` (none/low/medium/high) next to the existing "Default Model" field, following the same inline-edit pattern already built for the rest of the provider form.

## Testing

- `src/db/chat-messages.js` — repo tests: create/list round-trip, ordering, multiple files stay isolated from each other's history.
- `src/db/schema.test.js` — extended with the same no-data-loss pattern proven for `active_in_workspace`: a pre-existing `ai_providers`/`files` row survives migrations `0004`/`0005` untouched.
- `src/db/providers.test.js` — extended for `defaultReasoningEffort` create/update/default-null behavior.
- `src/server.test.js` — the streaming completion route is the one piece that can't hit a real provider in CI. The `openai` SDK's client is mocked at the module boundary (new precedent for this codebase, which has no mocking so far) to verify: message persistence, auto-context construction in the request, error-path persistence, and auth-gating — without making real network calls.
- No automated test for the chat panel's streaming JS, matching the established no-frontend-test-runner precedent elsewhere in `main.js` (cursor-line tracking, avatar resolution). Verified manually in a real browser, same pattern as prior client-only work.
