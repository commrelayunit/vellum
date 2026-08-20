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

const db = createConnection(config.dbPath);
migrate(db);
const projectsRepo = createProjectsRepo(db);
const filesRepo = createFilesRepo(db);
const secrets = createSecretsService(config.encryptionKey);
const providersRepo = createProvidersRepo(db, secrets);
const userProfileRepo = createUserProfileRepo(db);
const chatMessagesRepo = createChatMessagesRepo(db);

const app = express();
app.locals.chatCompletionService = createChatCompletionService();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict' }
}));

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
  const success = filesRepo.updateContent(fileId, content);
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

app.post('/api/providers', requireAuth, (req, res) => {
  const { label, baseUrl, apiKey, defaultModel, avatarUrl } = req.body;
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ success: false, message: 'Label is required' });
  }
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return res.status(400).json({ success: false, message: 'Base URL is required' });
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ success: false, message: 'API key is required' });
  }
  const provider = providersRepo.create({
    label: label.trim(),
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    defaultModel: typeof defaultModel === 'string' && defaultModel.trim() ? defaultModel.trim() : null,
    avatarUrl: typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl.trim() : null
  });
  res.status(201).json({ success: true, provider });
});

app.post('/api/providers/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { label, baseUrl, apiKey, defaultModel, avatarUrl, activeInWorkspace } = req.body;
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ success: false, message: 'Label is required' });
  }
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return res.status(400).json({ success: false, message: 'Base URL is required' });
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
    activeInWorkspace: typeof activeInWorkspace === 'boolean' ? activeInWorkspace : existing.activeInWorkspace
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
  const { label, avatarUrl } = req.body;
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ success: false, message: 'Label is required' });
  }
  const profile = userProfileRepo.update({
    label: label.trim(),
    avatarUrl: typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl.trim() : null
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
  const fileId = parseInt(req.params.fileId, 10);
  const file = filesRepo.getById(fileId);
  if (!file) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  const { providerId, message } = req.body;
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Message is required' });
  }
  const provider = providersRepo.getById(parseInt(providerId, 10));
  if (!provider || !provider.activeInWorkspace) {
    return res.status(400).json({ success: false, message: 'Provider is not active in this workspace' });
  }

  const trimmedMessage = message.trim();
  chatMessagesRepo.create({ fileId, role: 'user', content: trimmedMessage });
  const history = chatMessagesRepo.listForFile(fileId).slice(0, -1);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const apiKey = providersRepo.getDecryptedApiKey(provider.id);
    const fullText = await req.app.locals.chatCompletionService.complete({
      apiKey,
      baseUrl: provider.baseUrl,
      model: provider.defaultModel,
      reasoningEffort: provider.defaultReasoningEffort,
      filePath: file.path,
      fileContent: file.content,
      history,
      userMessage: trimmedMessage,
      onDelta: (delta) => writeSseEvent(res, { type: 'delta', text: delta })
    });
    chatMessagesRepo.create({ fileId, role: 'assistant', content: fullText, providerLabel: provider.label });
    writeSseEvent(res, { type: 'done' });
    res.end();
  } catch (err) {
    const errorText = `Request failed: ${err.message}`;
    chatMessagesRepo.create({ fileId, role: 'error', content: errorText });
    writeSseEvent(res, { type: 'error', message: errorText });
    res.end();
  }
});

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
  app.listen(config.port, () => {
    console.log(`Vellum server running on http://localhost:${config.port}`);
  });
}

module.exports = app;
