const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create database directory if it doesn't exist
const dbPath = path.join(__dirname, '..', 'data', 'vellum.db');
const fs = require('fs');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, '..', 'data'))) {
    fs.mkdirSync(path.join(__dirname, '..', 'data'));
}

// Initialize database
const db = new sqlite3.Database(dbPath);

// Create tables
db.serialize(() => {
    // Projects table
    db.run(`CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Files table
    db.run(`CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        path TEXT NOT NULL,
        title TEXT,
        mime_type TEXT DEFAULT 'text/markdown',
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects (id)
    )`);
    
    // Snapshots table
    db.run(`CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        content_hash TEXT,
        content TEXT,
        parent_snapshot_id INTEGER,
        author TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        summary TEXT,
        FOREIGN KEY (file_id) REFERENCES files (id)
    )`);
    
    // Messages table
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        file_id INTEGER,
        range_start INTEGER,
        range_end INTEGER,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects (id),
        FOREIGN KEY (file_id) REFERENCES files (id)
    )`);
    
    // Agent actions table
    db.run(`CREATE TABLE IF NOT EXISTS agent_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER,
        action_type TEXT NOT NULL,
        input_context TEXT,
        output_patch TEXT,
        status TEXT DEFAULT 'pending',
        resulting_snapshot_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages (id),
        FOREIGN KEY (resulting_snapshot_id) REFERENCES snapshots (id)
    )`);
});

module.exports = db;