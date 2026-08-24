# Vellum MVP Implementation Todos

## Completed Tasks

### M1: Local Private Workspace (Core MVP) - Minimalist Interface
- [x] Route setup (/projects, /writing)
- [x] Project/file CRUD, including in-place renaming of both projects and files, and multiple files per project (file-switcher dropdown, new/rename/delete in the editor header)
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
- [x] Optional line numbers (off by default, toggle in Settings) and a loading indicator on every async action

### M2: Chat Bound to Project/File
- [x] Implement project-scoped messages
- [x] Implement file-scoped messages
- [x] Include current file context when invoking agent
- [x] Persist chat history
- [x] Reference an editor selection (single or multiple) in a chat message, with click-to-jump back to it later even if the document has changed since

### M6: Live Collaboration
- [x] Yjs document state
- [x] Multi-client editing
- [x] Awareness/cursors, with a customizable color per writer and per AI provider
- [x] Periodic canonical text snapshots

### M3: Agent Document Editing (shipped in a different shape than originally speced — see note)

**Note:** the original M3 vision below (selection toolbar → propose_patch → diff/apply-reject cards) was superseded this session by a different, more direct design: a configured AI provider can edit the document live during a chat conversation via a model-callable tool, streaming the change into the document character-by-character with a visible cursor in the provider's color — the same way a human collaborator's edit appears, with no separate propose/review/apply step. This was a deliberate decision, not an oversight; the two designs are not compatible, so the original checklist below is kept for history rather than checked off.

- [x] Capture text selection (built as "reference a selection in chat", not as an edit-selection toolbar)
- [ ] ~~Add selection action toolbar~~ — superseded (see note above)
- [ ] ~~Implement propose_patch agent operation~~ — superseded; edits are applied live and directly, not proposed
- [ ] ~~Show diff/proposed edit cards~~ — superseded; no diff/proposal UI exists
- [ ] ~~Apply/Reject controls~~ — superseded; there is no pending state to apply or reject
- [ ] ~~Resulting snapshot after apply~~ — not applicable under the live-edit design
- [x] Agent editing is scoped only to the AI providers already configured in Settings — a write API for an agent *outside* this app (e.g. your own self-hosted agent reachable over Tailscale) is still not built; see "Deferred / not yet started" below

## In Progress Tasks

*(none currently — see "Deferred / not yet started" for what's next)*

## Deferred / not yet started

### M3.5: Agent Live Presence
- [x] Show active file/range state (the agent's cursor while it is actively editing)
- [ ] Distinct presence states beyond "editing" (reading, reviewing, proposing patch, etc.) — today there is only one state, shown while a tool call is in flight
- [x] Highlight active range in editor (via the live typing cursor)
- [ ] Show pending edit cards — not applicable under the live-edit design (M3 note above)
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

### M7: Browser-Control Escape Hatch
- [ ] Explicit browser-control mode
- [ ] Visible browser-control active state
- [ ] Limited UI operation permissions
- [ ] Optional trace/session metadata

### Other deferred items
- [ ] Overleaf-style margin comments (a separate, smaller sub-project from agent editing; never started)
- [ ] A write API for agents outside this app (e.g. your own self-hosted agent reachable over Tailscale) — today's agent editing only covers the AI providers configured in Settings
- [x] Refresh the agent's view of the document mid-conversation when it makes multiple edits in one turn — `agent-editor.js`'s `applyEdit` now returns the live document content on every path, and `chat-completion.js` feeds it back into the tool-result message so a second edit sees real post-edit state
- [x] SSE heartbeat during a large/slow agent edit — `server.js` emits a `heartbeat` frame every 15s while a tool call is in flight, well under a reverse proxy's default 60s read timeout

## Deployment Considerations

- [x] Configure Proxmox container settings
- [x] Set up Tailscale network access
- [x] Document reverse-proxy configuration, including the WebSocket-upgrade-forwarding note nginx deployments need (see docs/DOCKER.md) — actually configuring one is still the deployer's own choice
- [x] Document container deployment instructions
- [x] Test in containerized environment (Docker: build/run/restart/persistence/security posture all live-verified; Proxmox LXC script still needs a run against real hardware)
- [ ] Push this repository's local commits to `origin/main` — blocked on a missing SSH key in this environment, needs to be done from a machine with the right credentials
