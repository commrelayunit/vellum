// Simple in-memory database implementation for MVP
class MemoryDB {
    constructor() {
        this.projects = [
            {
                id: 1,
                name: 'Sample Project',
                slug: 'sample-project',
                description: 'A sample project for demonstration',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                id: 2,
                name: 'Documentation',
                slug: 'documentation',
                description: 'Project documentation and notes',
                created_at: new Date(),
                updated_at: new Date()
            }
        ];
        
        this.files = [
            {
                id: 1,
                project_id: 1,
                path: 'README.md',
                title: 'README',
                mime_type: 'text/markdown',
                content: '# Sample Project\n\nThis is a sample project to demonstrate Vellum\'s capabilities.\n\n## Features\n\n- Project-based file organization\n- Markdown editing\n- File history and versioning\n- Agent-assisted writing (coming soon)',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                id: 2,
                project_id: 1,
                path: 'Draft.md',
                title: 'Draft',
                mime_type: 'text/markdown',
                content: '# Draft Document\n\nThis is a draft document that can be edited and improved.',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                id: 3,
                project_id: 1,
                path: 'Notes.md',
                title: 'Notes',
                mime_type: 'text/markdown',
                content: '# Notes\n\nImportant notes and ideas for this project.',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                id: 4,
                project_id: 1,
                path: 'Checklist.md',
                title: 'Checklist',
                mime_type: 'text/markdown',
                content: '# Checklist\n\n- [ ] Complete initial setup\n- [ ] Create first document\n- [ ] Test editing features\n- [ ] Review history functionality',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                id: 5,
                project_id: 2,
                path: 'README.md',
                title: 'README',
                mime_type: 'text/markdown',
                content: '# Documentation Project\n\nThis project contains all documentation for our software.',
                created_at: new Date(),
                updated_at: new Date()
            }
        ];
        
        this.snapshots = [];
        this.messages = [];
        this.agentActions = [];
    }
    
    // Projects methods
    getAllProjects() {
        return this.projects;
    }
    
    getProjectById(id) {
        return this.projects.find(p => p.id === id);
    }
    
    getProjectBySlug(slug) {
        return this.projects.find(p => p.slug === slug);
    }
    
    // Files methods
    getFilesByProjectId(projectId) {
        return this.files.filter(f => f.project_id === projectId);
    }
    
    getFileById(id) {
        return this.files.find(f => f.id === id);
    }
    
    getFileByPathAndProject(path, projectId) {
        return this.files.find(f => f.path === path && f.project_id === projectId);
    }
    
    // Save file content
    updateFileContent(fileId, content) {
        const fileIndex = this.files.findIndex(f => f.id === fileId);
        if (fileIndex !== -1) {
            this.files[fileIndex].content = content;
            this.files[fileIndex].updated_at = new Date();
            return true;
        }
        return false;
    }
    
    // Export methods
    exportProject(projectId) {
        const project = this.getProjectById(projectId);
        const files = this.getFilesByProjectId(projectId);
        
        return {
            project,
            files
        };
    }
}

module.exports = new MemoryDB();