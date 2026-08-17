// src/server.js
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');

const { config } = require('./config');
const { createConnection } = require('./db/connection');
const { migrate } = require('./db/schema');
const { createProjectsRepo } = require('./db/projects');
const { createFilesRepo } = require('./db/files');

const db = createConnection(config.dbPath);
migrate(db);
const projectsRepo = createProjectsRepo(db);
const filesRepo = createFilesRepo(db);

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/projects'));

app.get('/projects', (req, res) => {
  const projects = projectsRepo.list().map((project) => {
    const files = filesRepo.listByProjectId(project.id);
    const latestUpdate = files.reduce(
      (latest, f) => (f.updated_at > latest ? f.updated_at : latest),
      project.updated_at
    );
    return {
      ...project,
      fileCount: files.length,
      updatedAt: latestUpdate,
      recentFiles: files.slice(0, 3).map((f) => f.path)
    };
  });
  res.render('projects', { projects });
});

app.post('/api/projects', (req, res) => {
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

app.get('/writing', (req, res) => {
  const projectId = parseInt(req.query.project, 10);
  const project = projectsRepo.getById(projectId);
  if (!project) {
    return res.status(404).send('Project not found');
  }
  const file = req.query.file
    ? filesRepo.getById(parseInt(req.query.file, 10))
    : filesRepo.getFirstForProject(project.id);
  if (!file) {
    return res.status(404).send('No file to open for this project');
  }
  res.render('writing', { project, file });
});

app.post('/api/save-file/:fileId', (req, res) => {
  const fileId = parseInt(req.params.fileId, 10);
  const { content } = req.body;
  const success = filesRepo.updateContent(fileId, content);
  if (success) {
    res.json({ success: true, message: 'File saved successfully' });
  } else {
    res.status(404).json({ success: false, message: 'File not found' });
  }
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Vellum server running on http://localhost:${config.port}`);
  });
}

module.exports = app;
