# Vellum Implementation Plan

Vellum should start as a private Mission Control feature and later become a standalone self-hostable app if the core workflow holds up.

The first useful version is not a full Google Docs clone. It is a quiet Markdown workspace where a document, its file context, chat, proposed edits, and history stay together.

## Guiding Decisions

- Build the private MVP inside Mission Control first.
- Keep Markdown as the first editing format.
- Use structured agent operations for document changes.
- Render C-3PO activity as live presence, not character-by-character typing.
- Treat git as a durable checkpoint/export layer, not the primary UI.
- Defer multi-user CRDT polish until project/files/chat/range edits are useful.

## Architecture Sketch

### Frontend

- Route: `/writing` or `/workspace/writing`
- Project/file sidebar
- Markdown editor with preview toggle or split view
- File/range-aware chat panel
- Proposed edit cards with Apply / Reject
- Presence indicators for C-3PO active file/range/state

Recommended editor stack:

- CodeMirror 6 for Markdown editing
- Yjs later for live collaboration
- Plain text snapshots for MVP persistence and export

### Backend

Core backend responsibilities:

- project and file CRUD
- save/load file content
- snapshot and named-version storage
- chat message storage
- agent action records
- C-3PO writing action bridge
- optional git materialization for checkpoints

Initial storage can be ordinary application database tables. Yjs update storage can be added when live collaboration arrives.

### Agent Bridge

The app should call C-3PO through a narrow writing-action interface, not by sending loose chat transcripts.

Each request should include:

- project id and name
- file path
- current content or relevant context window
- selected range, if any
- user instruction
- requested mode, such as `reply`, `comment`, `propose_patch`, or `replace_range`
- active voice/style hint, if any
- current snapshot/version id

Each response should return a structured operation:

- chat reply
- anchored comment
- replacement text
- patch/diff
- file creation
- version/checkpoint summary

## Milestones

### M0: Repo and Spec

Goal: record the product direction.

Deliverables:

- starter repository
- product spec
- implementation plan
- brand assets

Verification:

- docs are committed and pushed
- repo is private
- Velitchko has collaborator access

### M1: Local Private Workspace

Goal: make the writing surface usable without agent magic.

Deliverables:

- `/writing` route
- project list
- file tree
- create/rename/delete project files
- Markdown editor
- save/load content
- preview toggle
- download/export current file as `.md`

Verification:

- create a project
- create a Markdown file
- edit, save, reload, and export it

### M2: Chat Bound to Project/File

Goal: stop passing writing context through Telegram.

Deliverables:

- chat panel beside editor
- project-scoped messages
- file-scoped messages
- request payload includes current project/file context
- persisted chat history

Verification:

- ask a question about the current file
- confirm backend receives the correct file context
- confirm messages persist after reload

### M3: Selection-Aware Agent Edits

Goal: make C-3PO useful at paragraph/range level.

Deliverables:

- text selection capture
- selection action toolbar
- `propose_patch` agent operation
- diff/proposed edit card
- Apply / Reject controls
- resulting snapshot after apply

Verification:

- select a paragraph
- ask for a rewrite
- inspect diff
- apply and reload
- reject leaves content unchanged

### M3.5: C-3PO Live Presence

Goal: make C-3PO visibly present without pretending to type.

Deliverables:

- active file/range state
- states: reading, reviewing, proposing patch, applying patch, waiting for approval
- highlighted active range
- activity log entries
- pending edit cards tied to presence state

Verification:

- trigger a request
- see C-3PO active range/state update
- apply/reject clears or updates presence state

### M4: History and Named Versions

Goal: make edits recoverable.

Deliverables:

- autosave snapshots
- snapshot list
- compare current vs previous
- restore snapshot
- named versions/checkpoints

Verification:

- make several edits
- compare and restore a prior version
- create a named checkpoint

### M5: Git Materialization

Goal: make project state portable.

Deliverables:

- local git repo per writing project
- named version creates git commit
- export project archive
- basic commit metadata

Verification:

- create checkpoint
- inspect generated git commit
- export project and recover files

### M6: Live Collaboration

Goal: make concurrent editing safe.

Deliverables:

- Yjs document state
- multi-client editing
- awareness/cursors
- periodic canonical text snapshots

Verification:

- open the same file in two sessions
- edit concurrently
- confirm both clients converge and snapshots remain exportable

### M7: Browser-Control Escape Hatch

Goal: let C-3PO inspect and operate the UI when structured APIs are missing.

Deliverables:

- explicit browser-control mode
- visible browser-control active state
- limited UI operation permissions
- optional trace/session metadata

Verification:

- launch controlled browser session
- navigate the writing UI
- record session metadata
- hand back to structured edit mode

## First Seed Project

Use GraphMate as the first realistic project.

Seed files:

- `OSF README.md`
- `Demo narration.md`
- `Abstract variants.md`
- `Submission checklist.md`

## Open Questions

- Should MVP storage use existing Mission Control database tables or a separate writing namespace?
- Should agent calls use an existing OpenClaw session API or a narrower writing-action endpoint?
- Should named versions commit automatically or only on explicit checkpoint?
- How much diff UI is needed before range replacement becomes trustworthy?
- Which C-3PO presence states are enough for the first usable version?
- Where should per-project git repositories live on disk?

## Recommended First PR

Implement M1 only:

- route
- project/file CRUD
- Markdown editor
- save/load
- preview
- export

Then add M2/M3 in separate PRs. That keeps the first implementation boring, testable, and hard to regret.
