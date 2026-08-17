const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const db = require('./models/memory-db');
const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes - serving static HTML files instead of EJS templates
app.get('/', (req, res) => {
  res.redirect('/projects');
});

app.get('/projects', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'projects.html'));
});

app.get('/writing', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'writing.html'));
});

// API endpoints for saving content
app.post('/api/save-file/:fileId', (req, res) => {
  const fileId = parseInt(req.params.fileId);
  const { content } = req.body;
  
  const success = db.updateFileContent(fileId, content);
  
  if (success) {
    res.json({ success: true, message: 'File saved successfully' });
  } else {
    res.status(404).json({ success: false, message: 'File not found' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Vellum server running on http://localhost:${PORT}`);
});

module.exports = app;