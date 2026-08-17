const db = require('../models/database');
const path = require('path');

// Seed data for MVP
const seedData = [
    {
        name: 'Sample Project',
        slug: 'sample-project',
        description: 'A sample project for demonstration',
        files: [
            {
                path: 'README.md',
                title: 'README',
                content: '# Sample Project\n\nThis is a sample project to demonstrate Vellum\'s capabilities.\n\n## Features\n\n- Project-based file organization\n- Markdown editing\n- File history and versioning\n- Agent-assisted writing (coming soon)'
            },
            {
                path: 'Draft.md',
                title: 'Draft',
                content: '# Draft Document\n\nThis is a draft document that can be edited and improved.'
            },
            {
                path: 'Notes.md',
                title: 'Notes',
                content: '# Notes\n\nImportant notes and ideas for this project.'
            },
            {
                path: 'Checklist.md',
                title: 'Checklist',
                content: '# Checklist\n\n- [ ] Complete initial setup\n- [ ] Create first document\n- [ ] Test editing features\n- [ ] Review history functionality'
            }
        ]
    },
    {
        name: 'Documentation',
        slug: 'documentation',
        description: 'Project documentation and notes',
        files: [
            {
                path: 'README.md',
                title: 'README',
                content: '# Documentation Project\n\nThis project contains all documentation for our software.'
            }
        ]
    }
];

console.log('Seeding database with sample data...');

db.serialize(() => {
    // Insert projects and files
    seedData.forEach(project => {
        // Insert project
        const projectStmt = db.prepare(`INSERT OR IGNORE INTO projects (name, slug, description) VALUES (?, ?, ?)`);
        projectStmt.run(project.name, project.slug, project.description);
        projectStmt.finalize();
        
        // Get project ID
        const projectId = db.prepare(`SELECT id FROM projects WHERE slug = ?`).get(project.slug).id;
        
        // Insert files
        project.files.forEach(file => {
            const fileStmt = db.prepare(`INSERT OR IGNORE INTO files (project_id, path, title, content) VALUES (?, ?, ?, ?)`);
            fileStmt.run(projectId, file.path, file.title, file.content);
            fileStmt.finalize();
        });
    });
    
    console.log('Database seeded successfully!');
});

// Close database connection
db.close();