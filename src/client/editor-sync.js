// src/client/editor-sync.js
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

function buildTheme() {
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
    '.cm-gutters': { display: 'none' },
    '&.cm-focused': { outline: 'none' },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--presence-you) 14%, transparent)'
    }
  });
}

function mountEditor(container, initialContent) {
  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      highlightActiveLine(),
      buildTheme(),
      EditorView.lineWrapping
    ]
  });
  return new EditorView({ state, parent: container });
}

const container = document.getElementById('markdown-editor');
if (container) {
  const initialContentEl = document.getElementById('editor-initial-content');
  const initialContent = initialContentEl ? JSON.parse(initialContentEl.textContent) : '';
  window.__vellumEditorView = mountEditor(container, initialContent);
}
