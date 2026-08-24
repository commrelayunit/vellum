// src/client/editor-sync.js
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, drawSelection, lineNumbers, ViewPlugin, Decoration, WidgetType } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import * as Y from 'yjs';
import { yCollab } from 'y-codemirror.next';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

function buildTheme(localColor, showLineNumbers) {
  return EditorView.theme({
    '&': {
      color: 'var(--ink)',
      backgroundColor: 'transparent',
      height: '100%',
      flex: '1',
      minHeight: '0'
    },
    '.cm-content': {
      fontFamily: "'Courier New', monospace",
      fontSize: '14px',
      lineHeight: '1.5',
      padding: '0',
      caretColor: 'var(--ink)'
    },
    '.cm-scroller': {
      fontFamily: "'Courier New', monospace",
      overflow: 'auto'
    },
    // Gutters only exist in the DOM at all when lineNumbers() is included
    // below (no other gutter-producing extension is registered), so forcing
    // display:none unconditionally would hide the line numbers we just
    // asked for - it's only needed for the disabled case. When enabled, kept
    // small and subtle: muted relative to the main text, no border/
    // background of its own, so it reads as a light margin rather than UI
    // chrome.
    '.cm-gutters': showLineNumbers ? {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'color-mix(in srgb, var(--ink) 40%, transparent)',
      fontSize: '11px'
    } : { display: 'none' },
    '&.cm-focused': { outline: 'none' },
    '.cm-activeLine': {
      backgroundColor: `color-mix(in srgb, ${localColor} 14%, transparent)`
    },
    '.cm-ySelectionCaret': {
      borderLeftWidth: '2px'
    },
    // Themes the LOCAL user's own text selection (rendered via
    // drawSelection() below) to match their chosen cursor color, instead of
    // leaving it as the browser's native ::selection default - matching how
    // a remote peer's selection is already themed with their color.
    '.cm-selectionBackground': {
      backgroundColor: `color-mix(in srgb, ${localColor} 20%, transparent) !important`
    }
  });
}

function buildSelectionReference(state, ytext, from, to) {
  return {
    quotedText: state.sliceDoc(from, to),
    startLine: state.doc.lineAt(from).number,
    endLine: state.doc.lineAt(to).number,
    anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from)),
    // assoc: -1 pins `to` to the character just BEFORE it (left-associated)
    // rather than Yjs's default right-associated 0, which - when `to` lands
    // exactly at the document's current end - resolves as "the end of the
    // text" as a moving concept, silently absorbing anything typed
    // afterward into the resolved range. See Finding 2 in the final-review
    // fix report.
    head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to, -1))
  };
}

function resolveJumpTarget(ydoc, ytext, anchorJSON, headJSON) {
  const anchorPos = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(anchorJSON), ydoc);
  const headPos = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(headJSON), ydoc);
  if (!anchorPos || !headPos || anchorPos.type !== ytext || headPos.type !== ytext) {
    return null;
  }
  return {
    from: Math.min(anchorPos.index, headPos.index),
    to: Math.max(anchorPos.index, headPos.index)
  };
}

// Shows a small floating button near a non-empty selection; clicking it
// turns that selection into a chat reference. Deletion of the referenced
// content is not specially detected here - resolveJumpTarget (used by
// window.__vellumJumpToReference at click-to-jump time, not here) handles
// that gracefully on its own.
function selectionReferencePlugin(ytext) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.button = document.createElement('button');
      this.button.type = 'button';
      this.button.className = 'selection-reference-btn';
      this.button.setAttribute('aria-label', 'Reference this selection in chat');
      this.button.title = 'Reference in chat';
      this.button.innerHTML = '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
      this.button.style.display = 'none';
      this.button.style.position = 'fixed';
      // mousedown, not click: fires before the editor's own selection/blur
      // handling can clear the selection (and hide this button) out from
      // under a pending click.
      this.button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const sel = this.view.state.selection.main;
        if (sel.from === sel.to) return;
        const reference = buildSelectionReference(this.view.state, ytext, sel.from, sel.to);
        document.dispatchEvent(new CustomEvent('vellum:selection-referenced', { detail: reference }));
        this.button.style.display = 'none';
      });
      document.body.appendChild(this.button);
      this.updateVisibility();
    }

    updateVisibility() {
      // coordsAtPos() must not be called synchronously from update(): it
      // calls readMeasured(), which throws whenever called while CodeMirror
      // is in the middle of an update cycle. requestMeasure() defers the
      // read (and its DOM-writing counterpart) to CodeMirror's own safe
      // measurement phase instead - see Finding 1 in the final-review fix
      // report for the full failure mode this avoids. requestMeasure()
      // already no-ops once the view is destroyed (measure() bails out via
      // its own `this.destroyed` check), so no extra guard is needed here.
      this.view.requestMeasure({
        read: (view) => {
          const sel = view.state.selection.main;
          if (sel.from === sel.to || !view.hasFocus) return null;
          return view.coordsAtPos(sel.to);
        },
        write: (coords) => {
          if (!coords) {
            this.button.style.display = 'none';
            return;
          }
          this.button.style.display = 'flex';
          this.button.style.top = `${coords.top - 26}px`;
          this.button.style.left = `${coords.left}px`;
        }
      });
    }

    update(update) {
      if (update.selectionSet || update.focusChanged || update.geometryChanged) {
        this.updateVisibility();
      }
    }

    destroy() {
      this.button.remove();
    }
  });
}

// y-codemirror.next's own remote-cursor rendering (yCollab) only paints a
// background for an actual multi-character selection - for a bare cursor
// (anchor === head, which is all agent-editor.js's updateCursor() ever
// sets), it draws just the caret widget, with no line highlight. This adds
// the missing piece: an .cm-activeLine-style background under any remote
// peer's cursor line, in that peer's own color, so a collaborator or agent
// editing the document is exactly as visible as it is for the local user's
// own cursor.
function remoteActiveLinePlugin(ytext, awareness) {
  const ydoc = ytext.doc;

  function buildDecorations(view) {
    const decorations = [];
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.doc.clientID) return;
      const cursor = state.cursor;
      if (!cursor || cursor.anchor == null) return;
      const pos = Y.createAbsolutePositionFromRelativePosition(cursor.anchor, ydoc);
      if (!pos || pos.type !== ytext) return;
      const color = (state.user && state.user.color) || '#30bced';
      const colorLight = (state.user && state.user.colorLight) || `${color}33`;
      const index = Math.min(pos.index, view.state.doc.length);
      const line = view.state.doc.lineAt(index);
      decorations.push({
        from: line.from,
        to: line.from,
        value: Decoration.line({ attributes: { style: `background-color: ${colorLight}` } })
      });
    });
    return Decoration.set(decorations, true);
  }

  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.decorations = buildDecorations(view);
      // Mirrors yCollab's own YRemoteSelectionsPluginValue: an awareness
      // change (a remote cursor moving) has no accompanying doc change, so
      // it never triggers update() on its own - an empty dispatch forces
      // CodeMirror to re-run update() and pick up the new position.
      this.onAwarenessChange = ({ added, updated, removed }) => {
        const clients = added.concat(updated).concat(removed);
        if (clients.some((id) => id !== awareness.doc.clientID)) {
          view.dispatch({});
        }
      };
      awareness.on('change', this.onAwarenessChange);
    }

    update(update) {
      // Unconditional, matching yCollab's own YRemoteSelectionsPluginValue:
      // the awareness-triggered dispatch above is an empty transaction, so
      // a docChanged/viewportChanged guard here would skip rebuilding on
      // exactly the update it exists to react to.
      this.decorations = buildDecorations(update.view);
    }

    destroy() {
      awareness.off('change', this.onAwarenessChange);
    }
  }, {
    decorations: (v) => v.decorations
  });
}

// y-codemirror.next's remote-cursor widget (the small name tag) only ever
// renders for OTHER peers - by design, you don't usually need to label your
// own cursor. This adds the missing counterpart: a name tag at the local
// user's own cursor/selection head, built from the exact same DOM shape and
// CSS classes (cm-ySelectionCaret/cm-ySelectionCaretDot/cm-ySelectionInfo)
// the remote widget uses, so one CSS rule styles both consistently.
class LocalCursorLabelWidget extends WidgetType {
  constructor(name, color) {
    super();
    this.name = name;
    this.color = color;
  }

  eq(other) {
    return other.name === this.name && other.color === this.color;
  }

  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-ySelectionCaret';
    wrap.style.backgroundColor = this.color;
    wrap.style.borderColor = this.color;
    wrap.appendChild(document.createTextNode('⁠'));
    const dot = document.createElement('div');
    dot.className = 'cm-ySelectionCaretDot';
    wrap.appendChild(dot);
    wrap.appendChild(document.createTextNode('⁠'));
    const info = document.createElement('div');
    info.className = 'cm-ySelectionInfo';
    info.textContent = this.name;
    wrap.appendChild(info);
    wrap.appendChild(document.createTextNode('⁠'));
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function buildLocalCursorLabelDecorations(view, profileLabel, localColor) {
  const head = view.state.selection.main.head;
  return Decoration.set([
    Decoration.widget({ widget: new LocalCursorLabelWidget(profileLabel, localColor), side: 1 }).range(head)
  ]);
}

function localCursorLabelPlugin(profileLabel, localColor) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = buildLocalCursorLabelDecorations(view, profileLabel, localColor);
    }

    update(update) {
      if (update.selectionSet || update.docChanged || update.viewportChanged) {
        this.decorations = buildLocalCursorLabelDecorations(update.view, profileLabel, localColor);
      }
    }
  }, {
    decorations: (v) => v.decorations
  });
}

const container = document.getElementById('markdown-editor');
if (container) {
  const fileId = container.dataset.fileId;
  const initialContentEl = document.getElementById('editor-initial-content');
  const initialContent = initialContentEl ? JSON.parse(initialContentEl.textContent) : '';

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  const awareness = new Awareness(ydoc);

  // Matches src/public/js/main.js's AVATAR_COLORS/hashString convention
  // exactly, so a writer's live cursor color always matches their
  // presence-stack avatar color. Duplicated here (not imported) because
  // this file is a separate, bundled entry point from the unbundled
  // main.js.
  const AVATAR_COLORS = ['var(--presence-you)', 'var(--presence-2)', 'var(--presence-3)'];
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }
  const profileLabel = container.dataset.profileLabel || 'You';
  // The color chosen in Settings, or the default "you" presence color when
  // none is set yet. Drives both the local awareness state below (so other
  // viewers of this single-user app see the chosen color) and buildTheme's
  // active-line tint, so the two visual "this is you" indicators stay
  // consistent with each other.
  const localColor = container.dataset.profileCursorColor || AVATAR_COLORS[0];
  const showLineNumbers = container.dataset.showLineNumbers === 'true';
  awareness.setLocalStateField('user', {
    name: profileLabel,
    // colorLight is what y-codemirror.next's y-remote-selections.js paints
    // a remote peer's selected text range with. It is NOT optional in
    // practice: when absent, that module derives it as `color + '33'`,
    // which - when `color` is a CSS custom-property reference rather than a
    // literal hex - yields an unparseable value and the selection highlight
    // silently disappears. Supplying it explicitly (using the same
    // color-mix() form buildTheme() above uses for the active-line
    // highlight) keeps the highlight translucent and theme-aware for both a
    // var() reference and a literal hex chosen in Settings.
    color: localColor,
    colorLight: `color-mix(in srgb, ${localColor} 20%, transparent)`
  });

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/files/${fileId}`);
  socket.binaryType = 'arraybuffer';

  let synced = false;

  function sendSyncStep1() {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, ydoc);
    socket.send(encoding.toUint8Array(enc));
  }

  // Safe offline-only fallback: seed the LOCAL ytext from initialContent,
  // but only if a real SyncStep2 was never received (synced is still
  // false). If the connection never succeeded, there is no live peer to
  // race against - no other client can be concurrently seeding the same
  // (nonexistent) session, so this is safe. If a connection later succeeds
  // via some future retry, Yjs's own CRDT merge logic reconciles these
  // local-only edits correctly, since Yjs operates on individual
  // operations rather than diffing full text.
  //
  // The `ytext.length === 0` guard also protects against double-seeding if
  // both 'error' and 'close' fire for the same failed connection (a normal
  // WebSocket sequence): the first call inserts the content, so the second
  // call's guard is already false.
  function seedIfNeverSynced() {
    if (!synced && ytext.length === 0 && initialContent) {
      ytext.insert(0, initialContent);
    }
  }
  socket.addEventListener('error', seedIfNeverSynced);
  socket.addEventListener('close', seedIfNeverSynced);

  // Registered unconditionally, NOT inside the 'open' handler below. Two
  // separate jobs ride on this one listener:
  //
  //   1. forwarding the local edit to the server over the WebSocket, which
  //      obviously only works while the socket is OPEN (guarded below -
  //      calling send() on a CONNECTING/CLOSED socket throws), and
  //   2. dispatching 'vellum:editor-changed', which is what main.js's
  //      debounced fallback save (POST /api/save-file/:fileId) listens for.
  //
  // Job 2 matters most precisely when job 1 is impossible. If the socket
  // never opens at all - a reverse proxy that doesn't forward the Upgrade
  // header is the documented failure mode - then registering this inside
  // 'open' means no listener at all: local edits dispatch nothing, the
  // fallback save never fires, and every keystroke is silently lost. The
  // 'close'/'error' seeding above restores existing content in that case
  // but cannot save anything new. So the listener must exist regardless of
  // connection state, with only the send() gated on readiness.
  //
  // Any updates typed before the socket opens are not lost to the server
  // either: the SyncStep1/SyncStep2 handshake performed on open reconciles
  // whatever the local doc accumulated in the meantime.
  ydoc.on('update', (update, origin) => {
    // origin === socket means this update arrived FROM the server (it was
    // applied by readSyncMessage with `socket` as the origin). Echoing it
    // back would loop, and dispatching 'vellum:editor-changed' for it would
    // make every remote peer's keystroke trigger a local fallback save.
    if (origin === socket) return;
    if (socket.readyState === WebSocket.OPEN) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      socket.send(encoding.toUint8Array(enc));
    }
    document.dispatchEvent(new CustomEvent('vellum:editor-changed'));
  });

  // The remaining listeners stay inside the 'open' handler because - unlike
  // the doc-update listener above - everything they do is a send, which is
  // meaningless (and throws) before the socket is actually OPEN.
  socket.addEventListener('open', () => {
    socket.addEventListener('message', (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data));
      const messageType = decoding.readVarUint(decoder);
      if (messageType === MESSAGE_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        // readSyncMessage returns the INNER sync sub-message type, which is
        // distinct from the outer MESSAGE_SYNC/MESSAGE_AWARENESS framing
        // above. The server (see src/services/sync-connection.js) sends its
        // own outbound SyncStep1 the instant the connection opens - before
        // it has even seen ours - so the first MESSAGE_SYNC frame a client
        // receives is often that content-less SyncStep1, not the SyncStep2
        // reply to the SyncStep1 we sent. Gating "synced" on sub-type
        // SyncStep2 (rather than "the first sync frame we happen to see")
        // is required so the offline-only seeding above (and any future
        // synced-dependent logic) never mistakes an unanswered SyncStep1
        // for a real, content-bearing reply.
        //
        // Note: this handler does NOT seed ytext from initialContent, even
        // though ytext may still be empty here. Doing so used to be a real
        // race: the server's Y.Doc for a file can genuinely be empty at
        // sync time (see sync-doc-manager.js's loadInitialContent), and if
        // two clients connect to that same empty doc at nearly the same
        // moment, both would independently observe ytext.length === 0 in
        // their own SyncStep2 handling and both insert initialContent -
        // Yjs merges both inserts, genuinely duplicating the content. The
        // server already seeds a genuinely-new file's Y.Doc from its
        // plain-text content the first time any client connects
        // (sync-doc-manager.js), so this client-side seeding is redundant
        // in every healthy case; the only place it is safe is the
        // offline-only fallback above, which never fires once a real
        // SyncStep2 has actually landed.
        const syncMessageType = syncProtocol.readSyncMessage(decoder, enc, ydoc, socket);
        if (encoding.length(enc) > 1) {
          socket.send(encoding.toUint8Array(enc));
        }
        if (!synced && syncMessageType === syncProtocol.messageYjsSyncStep2) {
          synced = true;
        }
      } else if (messageType === MESSAGE_AWARENESS) {
        applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), socket);
      }
    });

    awareness.on('update', ({ added, updated, removed }) => {
      const changed = added.concat(updated).concat(removed);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(awareness, changed));
      socket.send(encoding.toUint8Array(enc));
    });

    // The server only replies with the file's content (SyncStep2) in
    // response to a client-initiated SyncStep1 - it never pushes content
    // unprompted. Without this call, a newly-connecting client would never
    // receive a file's pre-existing content.
    sendSyncStep1();
  });

  // The doc seeds from ytext (empty until the Yjs sync lands), not from
  // initialContent directly: yCollab's ySync plugin only tracks changes it
  // observes on ytext, so if the view were pre-populated with initialContent
  // as a plain string here, the real content arriving later via sync (or
  // the ytext.insert(0, initialContent) fallback above) would get inserted
  // a second time on top of it, duplicating the text. initialContent is
  // only ever written into ytext itself, never used as the CM doc directly.
  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      highlightActiveLine(),
      drawSelection(),
      buildTheme(localColor, showLineNumbers),
      EditorView.lineWrapping,
      yCollab(ytext, awareness),
      remoteActiveLinePlugin(ytext, awareness),
      localCursorLabelPlugin(profileLabel, localColor),
      selectionReferencePlugin(ytext),
      ...(showLineNumbers ? [lineNumbers()] : [])
    ]
  });
  window.__vellumEditorView = new EditorView({ state, parent: container });

  window.__vellumJumpToReference = function(anchorJSON, headJSON) {
    try {
      const target = resolveJumpTarget(ydoc, ytext, anchorJSON, headJSON);
      if (!target) return;
      window.__vellumEditorView.dispatch({
        selection: { anchor: target.from, head: target.to },
        scrollIntoView: true
      });
      window.__vellumEditorView.focus();
    } catch {
      // Silent no-op per spec: malformed/incompatible stored position data
      // should never surface as a user-facing error.
    }
  };
}
