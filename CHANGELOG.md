# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

History prior to 1.0.0 was not tracked in this file.

## [1.1.5] - 2026-11-01

### Fixed

- The Review tab no longer takes over as a full-width overlay with the
  editor marked inert behind it - it renders in the same right-side panel
  slot as Chat, with the editor staying visible and interactive underneath
  the entire time.
- The inline editor diff (struck-through original, proposed-replacement
  pill) and its hover/focus popover now color both the original and
  proposed text in the proposing author's own configured color, instead of
  a semantic red/green pair; "what changed" still reads without color via
  strikethrough vs. pill shape (and dashed vs. solid borders in the
  popover). The Review tab's own proposal cards keep their semantic
  old/new red/green treatment unchanged.
- Chat message author tints/rails/chips, and the editor diff/popover's
  author color, now resolve live against each provider's currently
  configured color (refreshed on load and whenever the tab regains
  visibility) instead of only the snapshot taken when that message or
  proposal was created - a provider's color changed in Settings now
  reaches history already on screen.
- Collapsing the sidebar now shows a compact vertical toolbar with distinct
  Chat and Review icons (badged with the pending-proposal count) that
  expand straight back to whichever panel you pick, and always reflects
  which tab is active. Previously, collapsing while Review was open left
  its full proposal list squashed into the 40px rail with no indication of
  which panel it was, and the toggle was hidden entirely while reviewing.
- The proposal hover/focus popover's width now scales with the editor's
  available on-screen width (capped well short of unreasonably wide)
  instead of a fixed 22rem ceiling that wrapped long proposed edits into a
  tall, narrow column regardless of how much room was actually available.

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
