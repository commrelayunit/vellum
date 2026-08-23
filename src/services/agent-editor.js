// src/services/agent-editor.js
const Y = require('yjs');
const awarenessProtocol = require('y-protocols/awareness');

const CHUNK_SIZE = 4;
const CHUNK_DELAY_MS = 20;
// Matches src/public/js/main.js's / src/client/editor-sync.js's existing
// AVATAR_COLORS/hashString convention exactly, so an agent with no chosen
// color falls back to the same hash-derived default a provider avatar
// would use elsewhere in the app.
const AVATAR_COLORS = ['var(--presence-you)', 'var(--presence-2)', 'var(--presence-3)'];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function createAgentEditSession({ docManager, fileId, providerLabel, providerColor, chunkSize = CHUNK_SIZE, chunkDelayMs = CHUNK_DELAY_MS }) {
  const { doc, awareness } = docManager.acquire(fileId);
  const ytext = doc.getText('content');

  let presenceDoc = null;
  let presenceAwareness = null;
  let presenceClientId = null;

  function ensurePresence() {
    if (presenceAwareness) return;
    presenceDoc = new Y.Doc();
    presenceAwareness = new awarenessProtocol.Awareness(presenceDoc);
    presenceClientId = presenceAwareness.clientID;
    const color = providerColor || AVATAR_COLORS[hashString(providerLabel) % AVATAR_COLORS.length];
    presenceAwareness.setLocalStateField('user', {
      name: providerLabel,
      color,
      colorLight: `color-mix(in srgb, ${color} 20%, transparent)`
    });
    const update = awarenessProtocol.encodeAwarenessUpdate(presenceAwareness, [presenceClientId]);
    awarenessProtocol.applyAwarenessUpdate(awareness, update, 'agent');
  }

  function updateCursor(index) {
    if (!presenceAwareness) return;
    const pos = Y.createRelativePositionFromTypeIndex(ytext, index);
    presenceAwareness.setLocalStateField('cursor', { anchor: pos, head: pos });
    const update = awarenessProtocol.encodeAwarenessUpdate(presenceAwareness, [presenceClientId]);
    awarenessProtocol.applyAwarenessUpdate(awareness, update, 'agent');
  }

  return {
    getCurrentContent() {
      return ytext.toString();
    },

    async applyEdit(oldString, newString) {
      // The tool schema's "type": "string" is advisory only - a model asked to
      // change a year or a version number can emit `"old_string": 2024`
      // unquoted. Without this guard, countOccurrences() spins forever
      // (`needle.length` is undefined -> `index + NaN` -> indexOf restarts
      // from 0), blocking the whole event loop, and a non-string/missing
      // new_string silently deletes old_string while reporting success. This
      // must return BEFORE any document read or mutation.
      if (typeof oldString !== 'string' || typeof newString !== 'string') {
        return { success: false, message: 'old_string and new_string must both be strings', content: ytext.toString() };
      }
      const current = ytext.toString();
      const occurrences = countOccurrences(current, oldString);
      if (occurrences === 0) {
        return { success: false, message: 'old_string not found in the document', content: current };
      }
      if (occurrences > 1) {
        return { success: false, message: `old_string matches ${occurrences} times - quote more surrounding context to make it unique`, content: current };
      }

      ensurePresence();
      const start = current.indexOf(oldString);
      doc.transact(() => {
        ytext.delete(start, oldString.length);
      });
      updateCursor(start);

      // Re-resolved from a Y.RelativePosition anchor before every chunk (not
      // computed from stale integer arithmetic), so a concurrent human edit
      // anywhere in the document - before OR after this insertion point -
      // can never cause a chunk to land in the wrong place. The anchor is
      // itself re-derived from the position just resolved on each iteration,
      // so it always reflects the document's real current state.
      let anchorPos = Y.createRelativePositionFromTypeIndex(ytext, start);
      let inserted = 0;
      while (inserted < newString.length) {
        const chunk = newString.slice(inserted, inserted + chunkSize);
        const resolved = Y.createAbsolutePositionFromRelativePosition(anchorPos, doc);
        const insertAt = resolved ? resolved.index : ytext.length;
        doc.transact(() => {
          ytext.insert(insertAt, chunk);
        });
        inserted += chunk.length;
        const nextIndex = insertAt + chunk.length;
        updateCursor(nextIndex);
        // assoc: -1 binds this position to the character just inserted
        // (left-associated) rather than Yjs's default right-associated 0,
        // which would bind to "whatever comes next" - including a
        // concurrent human edit landing at this exact point between
        // chunks, splicing it into the middle of the agent's own text.
        // This codebase hit this exact trap once before; see
        // src/client/editor-sync.js's buildSelectionReference head
        // position for the same fix and reasoning.
        anchorPos = Y.createRelativePositionFromTypeIndex(ytext, nextIndex, -1);
        if (inserted < newString.length) {
          await sleep(chunkDelayMs);
        }
      }

      return { success: true, message: 'Edit applied.', content: ytext.toString() };
    },

    end() {
      if (presenceAwareness) {
        awarenessProtocol.removeAwarenessStates(awareness, [presenceClientId], 'agent');
        presenceAwareness.destroy();
      }
      docManager.release(fileId);
    }
  };
}

module.exports = { createAgentEditSession };
