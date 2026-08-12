---
type: project
status: concept
summary: Private, self-hostable collaborative writing workspace with project files, live Markdown editing, file-scoped chat, C-3PO agent edits, and git-like history.
owner: C-3PO
related_people: [Velitchko, C-3PO, R2-D2]
related_projects: [Mission Control, GraphMate, In My Voice]
related_topics: [Collaborative Writing, Agent Interfaces, Markdown, Versioning]
related_practices: [Knowledge Base First Practice, Coding Harness Practice, Task Decomposition Practice]
candidate_names: [Vellum, Quire, Verso, Draftroom, Margin, Linea]
repository: https://github.com/commrelayunit/vellum
next_milestone: Turn this concept into a Mission Control implementation brief and MVP task artifact.
---

# Vellum Writing Workspace

## Working Name

**Vellum**.

Rationale: the tool is a serious shared writing surface for humans and agents. Vellum is short, memorable, writing-native, and broad enough to open-source later without sounding tied to GraphMate or C-3PO.

Other candidate names:

- **Quire**: distinctive and writing-native, but slightly obscure.
- **Verso**: polished book/page reference, product-ready.
- **Draftroom**: clear and practical, but two-word/compound feel.
- **Margin**: simple and tied to comments/agent presence, but generic.
- **Linea**: elegant text/line/versioning feel, but abstract.
- **Marginalia**: conceptually apt but too awkward as a product name.

Current recommendation: use **Vellum** for the project and reserve a more explicit subtitle:

> Vellum: a shared writing workspace for humans and agents.

Earlier working name: **Marginalia**.

Repository: [commrelayunit/vellum](https://github.com/commrelayunit/vellum).

## Visual Identity and Look

Vellum should feel like a simple shared writing surface: quiet, focused, and collaborative without becoming a busy productivity dashboard.

Logo assets:

- [Vellum mark](../assets/brand/vellum-mark.svg)
- [Vellum lockup](../assets/brand/vellum-lockup.svg)

### Logo Direction

Use a minimal folded sheet with a live cursor mark in the margin. Keep the primary mark free of secondary dots, badges, or notification-like accents.

The mark should communicate:

- document surface;
- writing/editing;
- a collaborator or agent present in the text through the cursor/presence system;
- version/history through subtle page layering or folded paper, not through a visible git graph.

Avoid:

- quills;
- parchment scrolls;
- robot heads;
- sparkles;
- mascot-like assistant marks;
- complex document stacks;
- busy AI-gradient branding.

The logo should work as:

- favicon/app icon;
- sidebar product mark;
- GitHub/OpenGraph preview;
- simple monochrome stamp.

### Palette

Primary palette:

- **Ink**: `#1F2A2E` for text, outlines, and primary controls.
- **Vellum**: `#F6F1E8` for app background.
- **Paper**: `#FFFCF6` for editor/document surfaces.
- **Presence Green**: `#2F6F64` for cursor, live agent state, and primary accents.
- **Review Copper**: `#C96F48` for comments, pending suggestions, and review states.
- **Soft Rule**: `#BAC8C1` for dividers, text lines, and inactive strokes.

Use accents sparingly. The UI should read as paper, ink, and quiet presence, not as a colorful dashboard.

### Typography

Use an italic lowercase serif for the wordmark. It should feel like a quiet writing surface rather than a generic SaaS label. The mark can pair with a readable interface sans-serif, but the logo lockup should keep the softer literary wordform.

Writing/editor text should prioritize readability:

- comfortable line height;
- restrained measure;
- no decorative display type inside the workspace;
- no oversized marketing headings in the product UI.

### Interface Feel

Vellum should feel calm and low-friction:

- document-first layout;
- minimal chrome around the editor;
- project/file navigation available but visually secondary;
- chat attached to the current file/range, not floating as a separate product;
- comments and suggestions visible when needed, quiet when not;
- C-3PO presence shown as range focus, status, and pending actions rather than theatrical typing.

Default layout should support:

- focused writing mode with editor dominant;
- split editor/preview when useful;
- chat panel collapsed or narrow by default;
- visible current file path and version/checkpoint state;
- clear Apply/Reject controls for proposed edits.

### Product Tone

Interface copy should be short and practical:

- "Ask C-3PO"
- "Propose edit"
- "Apply"
- "Reject"
- "Checkpoint"
- "Restore"
- "Export"

Avoid hype wording such as "unlock creativity", "AI-powered magic", or "supercharge your writing". Vellum is a working surface, not a pitch deck wearing shoes.

## Problem

Current C-3PO writing collaboration is split across Telegram, email, Overleaf, local files, GitHub pull requests, OSF text, and one-off Markdown attachments. This creates predictable friction:

- paragraph-level context gets lost in chat;
- drafts are duplicated across channels;
- edits are hard to compare or restore;
- C-3PO receives text as pasted fragments rather than file/range-aware context;
- support prose such as README files, demo scripts, submission notes, and reviewer responses has no canonical workspace;
- the collaboration loop is not private, live, or structured around projects.

The immediate trigger was GraphMate VISxGenAI writing: paper edits live in Overleaf, support prose moved through Telegram/email, and version boundaries became annoying quickly.

## Product Goal

Build a private collaborative writing environment where Velitchko and C-3PO can work on project documents together.

The workspace should combine:

- project folders and files;
- live Markdown editing;
- file- and selection-scoped chat;
- agent-assisted rewrite/review actions;
- visible cursors and selections;
- git-like history, diffs, and restore;
- export paths for Markdown, plain text, and later LaTeX / OSF / GitHub / Overleaf flows.

The core shift is to make the document the center of the interaction. Chat becomes attached to files, selections, and project state.

## Intended Users

Initial users:

- Velitchko as writer/reviewer.
- C-3PO as writing partner and agent operator.

Open-source/self-hosted users later:

- researchers writing papers, READMEs, rebuttals, grant text, documentation, and teaching materials with an agent;
- small labs or teams who want a private writing surface without sending every draft through public SaaS tools;
- agent builders who need a simple document-centered interface for range-aware edits and provenance.

## Scope

### In Scope

- Private login-only workspace.
- Project list and project-level file tree.
- Markdown editor with preview.
- Live collaborative editing.
- File-scoped chat.
- Selection-scoped instructions to the agent.
- Agent responses as chat, proposed patches, comments, or applied edits.
- Agent live-presence indicators: active file, active range, reading/reviewing state, pending edits, and action history.
- Optional browser-control mode for UI inspection and manual intervention when structured document operations are insufficient.
- Version history, named versions, diffs, restore.
- Git-backed project export/checkpoints.
- Download/export as `.md` and `.txt`.
- Mission Control integration for the first private deployment.

### Later Scope

- Overleaf Git pull/push for LaTeX projects.
- GitHub repository sync for README/docs.
- OSF README export packaging.
- Google Docs import/export.
- Comment threads anchored to ranges.
- Suggested edits mode with accept/reject per hunk.
- Session replay or browser-operation trace for agent browser-control sessions.
- Voice-profile selection, e.g. "Velitchko paper voice", "demo narration voice".
- Reusable prompt/action templates.

### Out of Scope for MVP

- Full Google Docs clone.
- WYSIWYG academic publishing.
- Multi-tenant SaaS billing.
- Real-time character-by-character agent typing.
- Public anonymous collaboration.
- Complex branch/merge UI beyond basic named versions and restore.

## Core UX

### Layout

Three-pane interface:

1. **Project and file sidebar**
   - Projects.
   - File tree.
   - New file/folder.
   - Import/export.

2. **Editor pane**
   - Markdown editor.
   - Preview toggle or split view.
   - Visible collaborators/cursors.
   - Selection toolbar for agent actions.

3. **Chat / agent pane**
   - Project chat.
   - File chat.
   - Selection-scoped messages.
   - Proposed edit cards.
   - Apply/reject buttons.
   - History of agent actions.

### Typical Flow

1. Velitchko opens `GraphMate / OSF README.md`.
2. He highlights a paragraph and writes: "make this less promotional and more review-package oriented".
3. C-3PO receives:
   - project metadata;
   - file path;
   - full file or relevant context window;
   - selected range;
   - user instruction;
   - active voice/profile hint.
4. C-3PO returns a proposed patch.
5. The UI shows a diff card.
6. Velitchko applies, edits manually, or rejects.
7. The accepted edit becomes a versioned change with provenance.

## Agent Integration

The agent should interact with documents through structured operations, not by pretending to be a human keystroke stream.

Supported operations:

- `reply`: normal chat response.
- `comment`: add a comment anchored to a file/range.
- `replace_range`: replace selected text.
- `insert_at_cursor`: insert text at cursor.
- `create_file`: create a new project file.
- `rename_file`: rename a file.
- `propose_patch`: return a diff for review.
- `summarize_changes`: describe the last changes.
- `commit_version`: create a named checkpoint.

Every operation should record:

- user request;
- file path;
- range or selection context;
- model/agent identity where appropriate;
- generated patch;
- accepted/rejected/applied state;
- resulting version id.

Important UX rule: C-3PO should not "type" character by character. For small requested fixes, direct edits are acceptable. For larger rewrites, the default should be proposed patches with diff/apply.

## Agent Presence and Browser Control

Vellum should make C-3PO feel present in the workspace without making browser automation the core editing mechanism.

### Default Model: Agent-as-Service With Live Presence

The default implementation should route C-3PO through the structured agent bridge and render that activity as live collaborator presence.

Visible presence states:

- active project and file;
- active range or paragraph being reviewed;
- "reading", "drafting", "proposing edit", "applying edit", and "committing version" states;
- highlighted range focus in the editor;
- pending edit cards in the chat pane;
- anchored comments;
- applied patch animation or compact diff;
- activity log entries for read/propose/apply/reject/commit events.

This gives Velitchko live feedback about what C-3PO is doing while keeping edits auditable, versionable, and permission-controlled.

The app should treat agent presence as first-class collaboration state, similar to Yjs awareness, but separate from ordinary human cursor movement. The useful signal is not a theatrical cursor; it is anchored intent: which document area is being inspected, what action is pending, and what changed.

### Optional Mode: Agent-as-Browser-User

Vellum can also support an explicit browser-control mode where C-3PO opens the app through a browser automation session and interacts with the UI like a remote collaborator.

Use cases:

- inspect the UI exactly as Velitchko sees it;
- test collaborative editing behavior;
- operate controls that are not yet exposed through structured APIs;
- debug layout, auth, permissions, or document state problems;
- record or replay an agent-assisted writing session.

Possible browser-user affordances:

- visible C-3PO cursor;
- live selection;
- typing indicator;
- file navigation events;
- screen/session trace;
- handoff back to structured edit mode.

This should not be the normal route for serious writing edits. Browser automation is slower, more fragile, easier to desync, and harder to make safe than structured document operations. It belongs as an escape hatch and inspection tool, not the editing backbone.

### Combined Interaction Rule

Use structured operations for document changes and render them as live presence.

Use browser-control mode only when the task is about the UI itself, when a structured operation is missing, or when live inspection is useful.

Example:

1. C-3PO "enters" `GraphMate / OSF README.md`.
2. The editor highlights the selected paragraph as C-3PO's active range.
3. Chat shows "C-3PO is drafting a proposed edit".
4. A diff card appears.
5. Velitchko applies or rejects it.
6. The action is stored as provenance and linked to a snapshot/named version.

## Collaboration Model

Use a CRDT layer for live editing.

Recommended stack:

- **Yjs** for shared document state.
- **CodeMirror 6** for Markdown editing.
- **y-websocket** or equivalent provider for live sync.
- Awareness states for cursors, selections, and editing presence.

Visible collaborator state:

- Velitchko cursor/selection.
- C-3PO active range or pending edit card.
- Optional "C-3PO is reading this file" / "C-3PO proposed an edit" indicators.

Avoid making the agent cursor cute or theatrical. The useful primitive is anchored intent: what range is being reviewed, edited, or commented on.

For the C-3PO presence layer, model awareness as operation state rather than only cursor coordinates:

- `agent_reading_file`;
- `agent_reviewing_range`;
- `agent_proposing_patch`;
- `agent_applying_patch`;
- `agent_waiting_for_approval`;
- `agent_browser_control_active`.

## Versioning Model

Versioning should feel git-like without requiring git for every paragraph.

### Layer 1: Autosave History

Every meaningful content change creates a restorable snapshot.

Snapshot metadata:

- id;
- project id;
- file id/path;
- timestamp;
- author;
- content hash;
- optional summary;
- parent snapshot id.

Purpose: restore recent work and inspect what changed during a session.

### Layer 2: Named Versions / Commits

Users can mark a state as a named version:

- "OSF README uploaded";
- "demo narration before ElevenLabs";
- "abstract before final compression";
- "submission package final".

Named versions support:

- compare to current;
- restore;
- export;
- tag/release labels;
- optional commit message.

### Layer 3: Agent Provenance

Every agent edit links request, context, proposed patch, and accepted result.

This matters because writing agents can otherwise silently flatten voice, scope, or claims. Provenance should make it possible to answer:

- What did we ask C-3PO to change?
- Which text was selected?
- What patch was proposed?
- Was it accepted as-is, edited, or rejected?
- Which version contains the result?

### Git Under the Hood

Best architecture: combine app-level snapshots with a real git repository per project.

The app stores live/Yjs state and snapshot metadata for fast UI operations. Periodically, or on named versions, the project is materialized to a local git repo and committed.

Benefits:

- durable portable history;
- easy export;
- possible GitHub/Overleaf sync later;
- recovery outside the app;
- familiar diff semantics.

Git should be an implementation/provenance layer, not the primary UX.

## Storage Model

Likely database tables:

- `writing_projects`
  - id, name, slug, description, created_at, updated_at, owner_id
- `writing_files`
  - id, project_id, path, title, mime_type, current_snapshot_id, created_at, updated_at
- `writing_snapshots`
  - id, file_id, content_hash, content, parent_snapshot_id, author_id, created_at, summary
- `writing_named_versions`
  - id, project_id, name, message, created_at, author_id, git_commit_sha
- `writing_messages`
  - id, project_id, file_id nullable, range nullable, author, body, created_at
- `writing_agent_actions`
  - id, message_id, action_type, input_context_json, output_patch_json, status, resulting_snapshot_id
- `writing_agent_presence`
  - id, project_id, file_id nullable, range nullable, agent_id, state, status_message, updated_at
- `writing_browser_sessions`
  - id, project_id, agent_id, status, started_at, ended_at, trace_path nullable
- `writing_comments`
  - id, file_id, range, body, author, status, created_at, resolved_at

If Yjs is used, store Yjs document updates separately:

- `writing_yjs_updates`
  - id, file_id, update_binary, created_at

Also keep periodic canonical text snapshots for search, export, and git materialization.

## Open-Source / Self-Hosted Positioning

Vellum should be designed so other people can host it.

Principles:

- self-host first;
- local filesystem/git export;
- no required proprietary LLM provider;
- agent integration through a generic adapter;
- private by default;
- Markdown-first;
- inspectable history;
- easy backup.

Potential deployment modes:

1. **Personal mode**
   - single user or small trusted pair;
   - SQLite;
   - local filesystem/git storage;
   - one agent endpoint.

2. **Lab mode**
   - small team;
   - Postgres;
   - project permissions;
   - multiple agent profiles.

3. **Hosted mode**
   - not a near-term goal;
   - would require account management, billing, backups, data-retention controls, and a much stricter security posture.

Open-source README should emphasize:

- collaborative Markdown editor;
- chat attached to documents;
- agent edits as proposed patches;
- git-like versioning;
- self-hostable privacy.

## Security and Privacy

MVP should remain private inside Mission Control.

Minimum requirements:

- reuse Mission Control auth;
- no public anonymous edit links;
- server-side permission checks on project/file access;
- audit log for agent edits;
- do not expose local filesystem paths in user-facing exports unless explicitly requested;
- no credentials or tokens in project files;
- project git repos stored under a controlled application data directory;
- backups must include database plus git materialized files.

For open-source self-hosting:

- document that operators are responsible for securing their agent/LLM endpoints;
- avoid bundling any personal C-3PO secrets or OpenClaw-specific credentials;
- provide `.env.example`;
- keep provider adapters optional.

## Mission Control Integration

First implementation target should be Mission Control, because:

- it is already the private C-3PO operational surface;
- authentication and deployment exist;
- the main use case is C-3PO-assisted project work;
- building a separate app would create avoidable hosting and auth overhead.

Mission Control route:

- `/writing`
- or `/workspace/writing`

Initial sidebar entry:

- **Writing**

Initial seed project:

- `GraphMate / VISxGenAI`

Initial seed files:

- `OSF README.md`
- `Demo narration.md`
- `Abstract variants.md`
- `Submission checklist.md`

## MVP Milestones

### M0: Specification and Decision

- Save project note.
- Confirm working name.
- Confirm Mission Control as implementation target.
- Decide MVP editor stack.

### M1: Local Private Workspace

- Project/file CRUD.
- Markdown editor.
- Save/load from database.
- Basic preview.
- Download file.

### M2: Chat Bound to Project/File

- Chat panel.
- Messages can be project-scoped or file-scoped.
- Include current file context when invoking C-3PO.

### M3: Selection-Aware Agent Edits

- User can select text and ask for rewrite/review.
- Agent receives selected text plus context.
- Agent returns proposed replacement.
- UI shows apply/reject.

### M3.5: C-3PO Live Presence

- Show C-3PO's active file/range.
- Show reading/reviewing/proposing/applying states.
- Render proposed edits as live pending cards.
- Record all presence-backed actions in the activity log.

### M4: History and Named Versions

- Autosave snapshots.
- Compare previous/current.
- Restore snapshot.
- Named versions.

### M5: Git Materialization

- Create local git repo per writing project.
- Commit named versions.
- Export project archive.

### M6: Live Collaboration

- Yjs/CRDT editing.
- Presence/cursors.
- Multi-client editing safety.

### M7: Browser-Control Escape Hatch

- Launch a controlled browser session for C-3PO.
- Show browser-control active state in the workspace.
- Support UI inspection and limited manual operation.
- Store optional trace/session metadata.

Order note: live collaboration is valuable, but MVP utility starts earlier with project files, chat, selection-aware edits, and versioning. Do not block all work on CRDT polish.

## Implementation Questions

- CodeMirror or TipTap for Markdown editing?
- Should live collaboration be included in the first PR, or staged after basic save/chat?
- Where should writing project git repos live on disk?
- Should C-3PO agent calls use the existing OpenClaw session API directly, or a narrower internal "writing action" API?
- How much of Mission Control's existing task/session model can be reused?
- Should named versions create git commits automatically, or only when the user clicks "checkpoint"?
- Should suggestions be line-based diffs, range replacements, or richer prose-edit cards?
- Which agent presence states are enough for MVP without overbuilding a session-observability system?
- Should browser-control sessions use assistant-local browser automation first, or a dedicated server-side browser worker?
- What actions should browser-control mode be allowed to perform without explicit confirmation?

## Initial Recommendation

Build Vellum inside Mission Control as a private MVP.

Do not start with the full collaborative editor. Start with:

1. project/files;
2. Markdown editor;
3. file-scoped chat;
4. selection-aware C-3PO rewrite/review;
5. C-3PO live presence for active file/range and pending edits;
6. snapshots and named versions;
7. export/download.

Then add Yjs live editing, git-backed checkpointing, and browser-control mode as an escape hatch for UI inspection/manual operation.

This gets the immediate GraphMate writing problem out of Telegram/email quickly while leaving a clean path toward a self-hostable open-source tool.
