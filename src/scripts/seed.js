const { createConnection } = require('../db/connection');
const { migrate } = require('../db/schema');
const { createProjectsRepo, slugify } = require('../db/projects');
const { createFilesRepo } = require('../db/files');

const SEED_DATA = [
  {
    name: 'Sample Project',
    description: 'A sample project for demonstration',
    files: [
      {
        path: 'README.md',
        title: 'README',
        content:
          "# Sample Project\n\nThis is a sample project to demonstrate Vellum's capabilities.\n\n## Features\n\n- Project-based file organization\n- Markdown editing\n- File history and versioning\n- Agent-assisted writing (coming soon)"
      },
      { path: 'Draft.md', title: 'Draft', content: '# Draft Document\n\nThis is a draft document that can be edited and improved.' },
      { path: 'Notes.md', title: 'Notes', content: '# Notes\n\nImportant notes and ideas for this project.' },
      {
        path: 'Checklist.md',
        title: 'Checklist',
        content: '# Checklist\n\n- [ ] Complete initial setup\n- [ ] Create first document\n- [ ] Test editing features\n- [ ] Review history functionality'
      }
    ]
  },
  {
    name: 'Documentation',
    description: 'Project documentation and notes',
    files: [
      { path: 'README.md', title: 'README', content: '# Documentation Project\n\nThis project contains all documentation for our software.' }
    ]
  }
];

function seedDatabase(db) {
  migrate(db);
  const projects = createProjectsRepo(db);
  const files = createFilesRepo(db);

  SEED_DATA.forEach((seed) => {
    const existing = projects.getBySlug(slugify(seed.name));
    if (existing) return;

    const project = projects.create({ name: seed.name, description: seed.description });
    seed.files.forEach((f) => {
      files.create({ projectId: project.id, path: f.path, title: f.title, content: f.content });
    });
  });

  return projects.list();
}

if (require.main === module) {
  const db = createConnection();
  const seeded = seedDatabase(db);
  console.log(`Seeded ${seeded.length} project(s).`);
  db.close();
}

module.exports = { seedDatabase, SEED_DATA };
