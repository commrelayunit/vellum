// src/server.js
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');

const { config } = require('./config');
const { createConnection } = require('./db/connection');
const { migrate } = require('./db/schema');
const { createProjectsRepo } = require('./db/projects');
const { createFilesRepo } = require('./db/files');
const { createSecretsService } = require('./crypto/secrets');
const { createProvidersRepo } = require('./db/providers');
const { createUserProfileRepo } = require('./db/user-profile');
const { createChatMessagesRepo } = require('./db/chat-messages');
const { createChatCompletionService } = require('./services/chat-completion');
const { requireAuth, verifyPassword } = require('./auth/middleware');
const { WebSocketServer } = require('ws');
const { createSyncDocManager } = require('./services/sync-doc-manager');
const { createAgentEditSession } = require('./services/agent-editor');
const { handleSyncConnection } = require('./services/sync-connection');

const db = createConnection(config.dbPath);
migrate(db);
const projectsRepo = createProjectsRepo(db);
const filesRepo = createFilesRepo(db);
const secrets = createSecretsService(config.encryptionKey);
const providersRepo = createProvidersRepo(db, secrets);
const userProfileRepo = createUserProfileRepo(db);
const chatMessagesRepo = createChatMessagesRepo(db);
const syncDocManager = createSyncDocManager({ filesRepo });

const app = express();
app.locals.chatCompletionService = createChatCompletionService();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict' }
});
app.use(sessionMiddleware);

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (verifyPassword(password, config.authPasswordHash)) {
    req.session.authenticated = true;
    return res.redirect('/projects');
  }
  res.status(401).render('login', { error: 'Wrong password' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', (req, res) => res.redirect('/projects'));

app.get('/projects', requireAuth, (req, res) => {
  const projects = projectsRepo.list().map((project) => {
    const files = filesRepo.listByProjectId(project.id);
    const latestUpdate = files.reduce(
      (latest, f) => (f.updated_at > latest ? f.updated_at : latest),
      project.updated_at
    );
    return {
      ...project,
      fileCount: files.length,
      // SQLite's datetime('now') yields a naive UTC string with no timezone
      // marker (e.g. "2026-08-18 06:26:40"); without converting to real
      // ISO-8601 UTC, the client would parse it as local time.
      updatedAt: `${latestUpdate.replace(' ', 'T')}Z`,
      recentFiles: files.slice(0, 3).map((f) => f.path)
    };
  });
  res.render('projects', { projects });
});

app.post('/api/projects', requireAuth, (req, res) => {
  if (req.body.name !== undefined && typeof req.body.name !== 'string') {
    return res.status(400).json({ success: false, message: 'Project name must be a string' });
  }
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, message: 'Project name is required' });
  }
  const project = projectsRepo.create({ name, description: '' });
  const file = filesRepo.create({
    projectId: project.id,
    path: 'Untitled.md',
    title: 'Untitled',
    content: `# ${name}\n`
  });
  res.status(201).json({ success: true, project, file });
});

app.post('/api/projects/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.body.name !== undefined && typeof req.body.name !== 'string') {
    return res.status(400).json({ success: false, message: 'Project name must be a string' });
  }
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, message: 'Project name is required' });
  }
  const existing = projectsRepo.getById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }
  const description = typeof req.body.description === 'string' ? req.body.description.trim() : existing.description;
  const project = projectsRepo.update(id, { name, description });
  res.json({ success: true, project });
});

app.get('/writing', requireAuth, (req, res) => {
  const projectId = parseInt(req.query.project, 10);
  const project = projectsRepo.getById(projectId);
  if (!project) {
    return res.status(404).send('Project not found');
  }
  const file = req.query.file
    ? filesRepo.getById(parseInt(req.query.file, 10))
    : filesRepo.getFirstForProject(project.id);
  if (!file || file.project_id !== project.id) {
    return res.status(404).send('No file to open for this project');
  }
  const profile = userProfileRepo.get();
  const activeProviders = providersRepo.list().filter((p) => p.activeInWorkspace);
  res.render('writing', { project, file, profile, activeProviders });
});

app.post('/api/save-file/:fileId', requireAuth, (req, res) => {
  const fileId = parseInt(req.params.fileId, 10);
  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ success: false, message: 'content must be a string' });
  }
  // Use updateYjsSnapshot (with contentYjs explicitly nulled) rather than
  // updateContent here. This is the fallback plain-text-only save path,
  // used when the WebSocket sync isn't connected - it must not leave a
  // stale content_yjs snapshot in place that no longer matches the content
  // being saved here. sync-doc-manager.js's loadInitialContent already
  // falls back to seeding a fresh Y.Doc from plain-text content whenever
  // content_yjs is null, so nulling it here guarantees the next WebSocket
  // connection re-seeds from this truly-current content instead of loading
  // stale (possibly empty) Yjs state - closing off the empty-doc race that
  // the client-side fix in editor-sync.js also addresses.
  const success = filesRepo.updateYjsSnapshot(fileId, { content, contentYjs: null });
  if (success) {
    res.json({ success: true, message: 'File saved successfully' });
  } else {
    res.status(404).json({ success: false, message: 'File not found' });
  }
});

app.get('/settings', requireAuth, (req, res) => {
  const providers = providersRepo.list();
  const profile = userProfileRepo.get();
  res.render('settings', { providers, profile });
});

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isValidColor(value) {
  return typeof value !== 'string' || value.trim() === '' || HEX_COLOR_RE.test(value.trim());
}

app.post('/api/providers', requireAuth, (req, res) => {
  const { label, baseUrl, apiKey, defaultModel, avatarUrl, color, defaultReasoningEffort } = req.body;
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ success: false, message: 'Label is required' });
  }
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return res.status(400).json({ success: false, message: 'Base URL is required' });
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ success: false, message: 'API key is required' });
  }
  if (!isValidColor(color)) {
    return res.status(400).json({ success: false, message: 'Color must be a hex value like #5b6eae' });
  }
  const provider = providersRepo.create({
    label: label.trim(),
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    defaultModel: typeof defaultModel === 'string' && defaultModel.trim() ? defaultModel.trim() : null,
    avatarUrl: typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl.trim() : null,
    color: typeof color === 'string' && color.trim() ? color.trim() : null,
    defaultReasoningEffort: typeof defaultReasoningEffort === 'string' && defaultReasoningEffort.trim() ? defaultReasoningEffort.trim() : null
  });
  res.status(201).json({ success: true, provider });
});

app.post('/api/providers/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { label, baseUrl, apiKey, defaultModel, avatarUrl, color, activeInWorkspace, defaultReasoningEffort } = req.body;
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ success: false, message: 'Label is required' });
  }
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return res.status(400).json({ success: false, message: 'Base URL is required' });
  }
  if (!isValidColor(color)) {
    return res.status(400).json({ success: false, message: 'Color must be a hex value like #5b6eae' });
  }
  const existing = providersRepo.getById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Provider not found' });
  }
  const provider = providersRepo.update(id, {
    label: label.trim(),
    baseUrl: baseUrl.trim(),
    apiKey: typeof apiKey === 'string' ? apiKey.trim() : '',
    defaultModel: typeof defaultModel === 'string' && defaultModel.trim() ? defaultModel.trim() : null,
    avatarUrl: typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl.trim() : null,
    color: typeof color === 'string' && color.trim() ? color.trim() : null,
    activeInWorkspace: typeof activeInWorkspace === 'boolean' ? activeInWorkspace : existing.activeInWorkspace,
    defaultReasoningEffort: typeof defaultReasoningEffort === 'string' ? (defaultReasoningEffort.trim() || null) : existing.defaultReasoningEffort
  });
  res.json({ success: true, provider });
});

app.post('/api/providers/:id/delete', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const removed = providersRepo.remove(id);
  if (removed) {
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, message: 'Provider not found' });
  }
});

app.post('/api/profile', requireAuth, (req, res) => {
  const { label, avatarUrl, cursorColor, showLineNumbers } = req.body;
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ success: false, message: 'Label is required' });
  }
  if (!isValidColor(cursorColor)) {
    return res.status(400).json({ success: false, message: 'Color must be a hex value like #5b6eae' });
  }
  const profile = userProfileRepo.update({
    label: label.trim(),
    avatarUrl: typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl.trim() : null,
    cursorColor: typeof cursorColor === 'string' && cursorColor.trim() ? cursorColor.trim() : null,
    showLineNumbers: showLineNumbers === true
  });
  res.json({ success: true, profile });
});

function writeSseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

app.get('/api/chat/:fileId/messages', requireAuth, (req, res) => {
  const fileId = parseInt(req.params.fileId, 10);
  res.json({ success: true, messages: chatMessagesRepo.listForFile(fileId) });
});

app.post('/api/chat/:fileId/messages', requireAuth, async (req, res) => {
  // Everything in this block runs before any SSE headers are set, so on
  // failure we can still respond with a normal JSON error. This section is
  // guarded because Express 4 does not catch synchronous throws or promise
  // rejections from async handlers — an uncaught one here (e.g. a
  // SQLITE_BUSY error from a sync better-sqlite3 call) would otherwise
  // crash the whole process.
  let file;
  let provider;
  let trimmedMessage;
  let history;
  let validSelections;
  try {
    const fileId = parseInt(req.params.fileId, 10);
    file = filesRepo.getById(fileId);
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    const { providerId, message, selections } = req.body;
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }
    provider = providersRepo.getById(parseInt(providerId, 10));
    if (!provider || !provider.activeInWorkspace) {
      return res.status(400).json({ success: false, message: 'Provider is not active in this workspace' });
    }

    trimmedMessage = message.trim();
    // Normalize (not just type-check) selections on ingest: a malformed
    // entry (e.g. missing quotedText) that made it into the DB unchanged
    // would crash formatContentWithSelections on every subsequent message
    // to this file, since history.map(toRequestMessage) re-processes every
    // past selection on every request - bricking the conversation until
    // "Clear chat". Filtering + coercing here keeps only well-shaped rows.
    validSelections = Array.isArray(selections)
      ? selections
          .filter((s) => s && typeof s.quotedText === 'string')
          .map((s) => ({
            quotedText: s.quotedText,
            startLine: Number(s.startLine) || 0,
            endLine: Number(s.endLine) || 0,
            anchor: s.anchor,
            head: s.head
          }))
      : [];
    chatMessagesRepo.create({ fileId: file.id, role: 'user', content: trimmedMessage, selections: validSelections });
    // Cap history sent to the model to the last 40 prior messages, excluding
    // the user message just inserted above (slice(-41, -1): drop the last
    // element, then keep at most 40 before it), so a long-lived conversation
    // can't grow unbounded and eventually exceed the model's context window.
    history = chatMessagesRepo.listForFile(file.id).slice(-41, -1);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  // Without this, a deployer following docs/DOCKER.md's nginx reverse-proxy
  // path (proxy_buffering on by default) gets the whole stream buffered and
  // delivered as one blob at the end, defeating the point of streaming.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // From here on, headers are already committed to SSE, so any failure
  // (including a non-Error throw/rejection from the completion service)
  // must be turned into an SSE error frame rather than left unhandled.
  try {
    const apiKey = providersRepo.getDecryptedApiKey(provider.id);
    const agentSession = createAgentEditSession({
      docManager: syncDocManager,
      fileId: file.id,
      providerLabel: provider.label,
      providerColor: provider.color
    });
    // A large edit_document call (many chunks at agent-editor.js's
    // chunkSize/chunkDelayMs) can run for a while without any other SSE
    // frame going out, risking a dropped connection at a reverse proxy's
    // default ~60s read timeout (docs/DOCKER.md's own sample nginx config
    // has no proxy_read_timeout override). 15s gives ~4x headroom under
    // that default. Unrecognized frame types are already silently ignored
    // by src/public/js/main.js's SSE handler, so no client change is needed.
    let heartbeatTimer = null;
    try {
      const fullText = await req.app.locals.chatCompletionService.complete({
        apiKey,
        baseUrl: provider.baseUrl,
        model: provider.defaultModel,
        reasoningEffort: provider.defaultReasoningEffort,
        filePath: file.path,
        fileContent: agentSession.getCurrentContent(),
        history,
        userMessage: trimmedMessage,
        selections: validSelections,
        onDelta: (delta) => writeSseEvent(res, { type: 'delta', text: delta }),
        onToolStart: (tool) => {
          writeSseEvent(res, { type: 'tool-start', tool });
          heartbeatTimer = setInterval(() => writeSseEvent(res, { type: 'heartbeat' }), 15000);
        },
        onToolEnd: (tool, success) => {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
          writeSseEvent(res, { type: 'tool-end', tool, success });
        },
        executeTool: (name, args) => {
          if (name !== 'edit_document') {
            return Promise.resolve({ success: false, message: `Unknown tool: ${name}` });
          }
          return agentSession.applyEdit(args.old_string, args.new_string);
        }
      });
      chatMessagesRepo.create({ fileId: file.id, role: 'assistant', content: fullText, providerLabel: provider.label });
      writeSseEvent(res, { type: 'done' });
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      agentSession.end();
    }
  } catch (err) {
    const errorText = `Request failed: ${err && err.message ? err.message : String(err)}`;
    // Persisting the error row is itself a DB call that could throw (e.g.
    // SQLITE_BUSY) while we're already handling a failure; guard it
    // separately so it can never prevent res.end() from running below.
    try {
      chatMessagesRepo.create({ fileId: file.id, role: 'error', content: errorText });
    } catch (persistErr) {
      console.error('Failed to persist chat error message:', persistErr);
    }
    try {
      writeSseEvent(res, { type: 'error', message: errorText });
    } catch (writeErr) {
      console.error('Failed to write SSE error frame:', writeErr);
    }
  }

  res.end();
});

app.post('/api/chat/:fileId/clear', requireAuth, (req, res) => {
  const fileId = parseInt(req.params.fileId, 10);
  const file = filesRepo.getById(fileId);
  if (!file) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  chatMessagesRepo.deleteForFile(fileId);
  res.json({ success: true });
});

function authenticateUpgrade(req) {
  return new Promise((resolve) => {
    const fakeRes = { getHeader() {}, setHeader() {}, end() {}, writeHead() {} };
    sessionMiddleware(req, fakeRes, () => {
      resolve(!!(req.session && req.session.authenticated));
    });
  });
}

function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', async (req, socket, head) => {
    // MUST be the very first statement, before any `await` and before any
    // write to the socket. A raw upgrade socket has no 'error' listener of
    // its own, and Node's EventEmitter rethrows an unhandled 'error' event
    // as an uncaught exception that kills the process. Two things in this
    // handler open that window: the `await authenticateUpgrade(req)` below
    // (during which nothing is listening), and the `socket.end(...)`
    // rejection replies (writing to an already-reset peer). Any client can
    // reach both without a session cookie, just by opening a TCP
    // connection to /ws/files/:id and resetting it mid-handshake — so
    // without this listener, an unauthenticated remote crash is one abort
    // away. Attaching a no-op-ish listener is the same pattern ws's own
    // docs and the y-websocket reference server use; ws attaches its own
    // handlers once handleUpgrade() succeeds, and this one stays harmless
    // alongside them.
    socket.on('error', (err) => {
      console.error('WebSocket upgrade socket error:', err);
    });
    const match = req.url.match(/^\/ws\/files\/(\d+)$/);
    if (!match) {
      socket.destroy();
      return;
    }
    const authenticated = await authenticateUpgrade(req);
    if (!authenticated) {
      // .end() (not .destroy()) so the client's HTTP parser gets a chance
      // to read the full response line before the socket closes — an
      // abrupt .destroy() right after .write() can surface to the client
      // as a connection reset instead of a clean 401.
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    const fileId = parseInt(match[1], 10);
    if (!filesRepo.getById(fileId)) {
      // Same rationale as the 401 branch above: .end() lets the client's
      // HTTP parser read the full response line before the socket closes.
      // Without this check, docManager.acquire(fileId) below would throw
      // synchronously inside loadInitialContent (reading .content_yjs off
      // an undefined file row), which escapes as an unhandled rejection
      // from this async upgrade handler and crashes the whole process.
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleSyncConnection(ws, fileId, syncDocManager);
    });
  });
  return wss;
}

module.exports = app;
module.exports.attachWebSocketServer = attachWebSocketServer;

if (process.env.NODE_ENV === 'production') {
  if (!config.authPasswordHash) {
    console.warn(
      'WARNING: AUTH_PASSWORD_HASH is not set. Every login attempt will fail. ' +
      'Generate a hash with `npm run hash-password -- "your chosen password"` and set ' +
      'AUTH_PASSWORD_HASH in your .env / systemd EnvironmentFile.'
    );
  }
  if (config.sessionSecret === 'dev-secret-change-me') {
    console.warn(
      'WARNING: SESSION_SECRET is using the insecure development default. ' +
      'Set SESSION_SECRET to a random value (e.g. `openssl rand -hex 32`) in your .env / ' +
      'systemd EnvironmentFile.'
    );
  }
  if (!config.encryptionKey) {
    console.warn(
      'WARNING: ENCRYPTION_KEY is not set. Saving an AI provider will fail. ' +
      'Generate one with `openssl rand -base64 32` and set ENCRYPTION_KEY in your .env / ' +
      'systemd EnvironmentFile.'
    );
  }
}

if (require.main === module) {
  const httpServer = app.listen(config.port, () => {
    console.log(`Vellum server running on http://localhost:${config.port}`);
  });
  app.attachWebSocketServer(httpServer);
}
