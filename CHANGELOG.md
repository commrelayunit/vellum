# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

History prior to 1.0.0 was not tracked in this file.

## [1.1.3] - 2026-11-01

### Added

- Durable, reviewable agent edit proposals with anchored accept/reject history,
  explicit conflict outcomes, and a Review panel alongside file chat.
- Pending proposals now render inline in the editor as a persistent,
  author-colored diff (struck-through original, proposed replacement shown
  alongside it) that stays anchored until Accept/Reject/stale/conflict, with
  the full original/proposed text exposed on hover and keyboard focus.
- Revise now opens a persistent, dismissible context card above the chat
  composer quoting the proposal's original/proposed text and author, instead
  of inserting text into the input; that context is included with the next
  message sent.

### Removed

- The "Apply agent edits live" opt-in checkbox. Agent edits always go through
  the durable proposal workflow now - there is no path in normal product
  operation for an agent to mutate document text before Accept.

## [1.0.1] - 2026-08-24

### Fixed

- Send a stable, non-secret Vellum conversation identifier to compatible
  agent bridges, preserving session continuity across chat-completion rounds.

## [1.0.0] - 2026-08-24

### Added

- Public first release of the self-hostable collaborative writing workspace.
- OpenClaw Vellum Bridge connection guidance for live document editing.
