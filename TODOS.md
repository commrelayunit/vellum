# Vellum MVP Implementation Todos

## Completed Tasks

### M1: Local Private Workspace (Core MVP) - Minimalist Interface
- [x] Route setup (/projects, /writing)
- [x] Project/file CRUD
- [x] Markdown editor with clean writing surface
- [x] Save/load content
- [x] Preview toggle (with working markdown conversion)
- [x] Download/export current file as .md
- [x] Minimalist UI with monospace font and no borders
- [x] Collapsible chat panel with '✕' button
- [x] No horizontal border between header and content
- [x] Monochrome buttons without background or borders
- [x] Enter key support for chat (Ctrl+Enter style)
- [x] Proper margins on sides for window spacing
- [x] Responsive design for mobile devices
- [x] Menu button with vertical dots (⋮)
- [x] Auto-save functionality
- [x] Export functionality

## In Progress Tasks

### M2: Chat Bound to Project/File
- [ ] Implement project-scoped messages
- [ ] Implement file-scoped messages
- [ ] Include current file context when invoking agent
- [ ] Persist chat history

### M3: Selection-Aware Agent Edits
- [ ] Capture text selection
- [ ] Add selection action toolbar
- [ ] Implement propose_patch agent operation
- [ ] Show diff/proposed edit cards
- [ ] Apply/Reject controls
- [ ] Resulting snapshot after apply

### M3.5: Agent Live Presence
- [ ] Show active file/range state
- [ ] Implement presence states (reading, reviewing, proposing patch, etc.)
- [ ] Highlight active range in editor
- [ ] Show pending edit cards
- [ ] Record activity log entries

### M4: History and Named Versions
- [ ] Autosave snapshots
- [ ] Snapshot list
- [ ] Compare current vs previous
- [ ] Restore snapshot
- [ ] Named versions/checkpoints

### M5: Git Materialization
- [ ] Local git repo per writing project
- [ ] Named version creates git commit
- [ ] Export project archive
- [ ] Basic commit metadata

## Future Work

### M6: Live Collaboration
- [ ] Yjs document state
- [ ] Multi-client editing
- [ ] Awareness/cursors
- [ ] Periodic canonical text snapshots

### M7: Browser-Control Escape Hatch
- [ ] Explicit browser-control mode
- [ ] Visible browser-control active state
- [ ] Limited UI operation permissions
- [ ] Optional trace/session metadata

## Deployment Considerations

- [x] Configure Proxmox container settings
- [x] Set up Tailscale network access
- [ ] Configure reverse proxy if needed
- [x] Document container deployment instructions
- [ ] Test in containerized environment