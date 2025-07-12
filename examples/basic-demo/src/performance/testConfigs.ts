import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { unifiedMergeView } from "../../../../src/unified";
import { MergeView } from "../../../../src/mergeview";
import { TestConfig } from "./types";
import { highlightJsExtension } from "./highlightjsExtension";

export const sampleCode = {
  original: `import { useEffect, useRef } from 'react';
import { MergeView, getChunks } from '@codemirror/merge';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { DiffViewProps } from './types';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { keymap } from '@codemirror/view';
import { useFocusStore } from '@/store/focusStore';
import { useShallow } from 'zustand/react/shallow';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { KeyBinding } from '@/utils/keyboardShortcuts';
import { createDiffConfig } from './diffAlgorithms';
import { renderRevertControl } from './utils';

const moveByChunk =
  (dir: number) =>
  ({ state, dispatch }: { state: EditorState; dispatch: (tr: Transaction) => void }) => {
    let { chunks, side } = getChunks(state) || { chunks: [], side: 'a' };
    if (!chunks || !chunks.length || !side) return false;
    let { head } = state.selection.main,
      pos = 0;
    for (let i = chunks.length - 1; i >= 0; i--) {
      let chunk = chunks[i];
      let [from, to] = side == 'b' ? [chunk.fromB, chunk.toB] : [chunk.fromA, chunk.toA];
      if (to < head) {
        pos = i + 1;
        break;
      }
      if (from <= head) {
        if (chunks.length == 1) return false;
        pos = i + (dir < 0 ? 0 : 1);
        break;
      }
    }

    if (pos + dir < 0 || pos + dir > chunks.length) {
      console.log(\`No next chunk in direction \${dir}, pos=\${pos}, returning false\`);
      return false;
    }

    let next = chunks[(pos + (dir < 0 ? chunks.length - 1 : 0)) % chunks.length];

    let [from, to] = side == 'b' ? [next.fromB, next.toB] : [next.fromA, next.toA];
    dispatch(
      state.update({
        selection: { anchor: dir < 0 ? to - 1 : from },
        userEvent: 'select.byChunk',
        effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: 'center' }),
      })
    );
    return true;
  };`,
  modified: `import { useEffect, useRef, useMemo, useCallback } from 'react';
import { MergeView, getChunks } from '@codemirror/merge';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { DiffViewProps } from './types';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { keymap } => '@codemirror/view';
import { useFocusStore } from '@/store/focusStore';
import { useShallow } from 'zustand/react/shallow';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { KeyBinding } from '@/utils/keyboardShortcuts';
import { createDiffConfig } from './diffAlgorithms';
import { renderRevertControl } from './utils';

const moveByChunk =
  (dir: number) =>
  ({ state, dispatch }: { state: EditorState; dispatch: (tr: Transaction) => void }) => {
    let { chunks, side } = getChunks(state) || { chunks: [], side: 'a' };
    if (!chunks || !chunks.length || !side) return false;
    let { head } = state.selection.main,
      pos = 0;
    for (let i = chunks.length - 1; i >= 0; i--) {
      let chunk = chunks[i];
      let [from, to] = side == 'b' ? [chunk.fromB, chunk.toB] : [chunk.fromA, chunk.toA];
      if (to < head) {
        pos = i + 1;
        break;
      }
      if (from <= head) {
        if (chunks.length == 1) return false;
        pos = i + (dir < 0 ? 0 : 1);
        break;
      }
    }

    if (pos + dir < 0 || pos + dir > chunks.length) {
      console.log(\`No next chunk in direction \${dir}, pos=\${pos}, returning false\`);
      return false;
    }

    let next = chunks[(pos + (dir < 0 ? chunks.length - 1 : 0)) % chunks.length];

    let [from, to] = side == 'b' ? [next.fromB, next.toB] : [next.fromA, next.toA];
    dispatch(
      state.update({
        selection: { anchor: dir < 0 ? to - 1 : from },
        userEvent: 'select.byChunk',
        effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: 'center' }),
      })
    );
    return true;
  };

// Memoize diff config to prevent recreation
const diffConfig = useMemo(() => createDiffConfig('myers', {
  ignoreWhitespace: true,
  semanticCleanup: true,
}), []);

// Enhanced performance optimizations
const handleDocumentChange = useCallback((newContent: string, isOriginal: boolean) => {
  if (isUpdatingRef.current) return;
  
  if (isOriginal && newContent !== lastOriginalRef.current) {
    lastOriginalRef.current = newContent;
    setCurrentOriginal(newContent);
  } else if (!isOriginal && newContent !== lastModifiedRef.current) {
    lastModifiedRef.current = newContent;
    setCurrentModified(newContent);
  }
}, [setCurrentOriginal, setCurrentModified]);`,
};

export const createTestConfigs = (): TestConfig[] => [
  {
    name: "Basic Editor",
    description: "Plain CodeMirror editor with minimal extensions",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.theme({ "&": { height: "200px" } }),
          EditorView.lineWrapping,
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Editor with Language",
    description: "CodeMirror editor with JavaScript language support",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.theme({ "&": { height: "200px" } }),
          EditorView.lineWrapping,
          javascript(),
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Editor with Highlight.js",
    description: "CodeMirror editor with highlight.js syntax highlighting",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.theme({ "&": { height: "200px" } }),
          EditorView.lineWrapping,
          highlightJsExtension('javascript'),
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Editor with Theme",
    description: "CodeMirror editor with dark theme",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.theme({ "&": { height: "200px" } }),
          EditorView.lineWrapping,
          oneDark,
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Editor with Theme + Language",
    description: "CodeMirror editor with JavaScript and dark theme",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.theme({ "&": { height: "200px" } }),
          EditorView.lineWrapping,
          javascript(),
          oneDark,
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Editor with Theme + Highlight.js",
    description: "CodeMirror editor with highlight.js and dark theme",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.theme({ "&": { height: "200px" } }),
          EditorView.lineWrapping,
          highlightJsExtension('javascript'),
          oneDark,
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Unified Merge View (Basic)",
    description: "Unified merge view with minimal configuration",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.theme({ "&": { height: "200px" } }),
          EditorView.lineWrapping,
          unifiedMergeView({
            original: sampleCode.original,
            mergeControls: false,
            highlightChanges: true,
            gutter: false,
          }),
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Unified Merge View + Language",
    description: "Unified merge view with JavaScript language support",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.lineWrapping,
          javascript(),
          unifiedMergeView({
            original: sampleCode.original,
            mergeControls: true,
            highlightChanges: true,
            gutter: true,
          }),
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Unified Merge with Highlight.js",
    description: "Unified merge view with highlight.js syntax highlighting",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.lineWrapping,
          highlightJsExtension('javascript'),
          unifiedMergeView({
            original: sampleCode.original,
            mergeControls: true,
            highlightChanges: true,
            gutter: true,
            syntaxHighlightDeletions: false,
          }),
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Unified Merge View + Theme",
    description: "Unified merge view with dark theme",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.lineWrapping,
          oneDark,
          unifiedMergeView({
            original: sampleCode.original,
            mergeControls: true,
            highlightChanges: true,
            gutter: true,
          }),
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Unified Merge View (Full)",
    description: "Unified merge view with all features enabled",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.lineWrapping,
          javascript(),
          oneDark,
          unifiedMergeView({
            original: sampleCode.original,
            mergeControls: true,
            highlightChanges: true,
            gutter: true,
            syntaxHighlightDeletions: true,
            allowInlineDiffs: true,
          }),
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Unified Merge View (Full) with Highlight.js",
    description: "Unified merge view with all features enabled using highlight.js",
    createEditor: (container) => {
      return new EditorView({
        parent: container,
        doc: sampleCode.modified,
        extensions: [
          EditorView.lineWrapping,
          highlightJsExtension('javascript'),
          oneDark,
          unifiedMergeView({
            original: sampleCode.original,
            mergeControls: true,
            highlightChanges: true,
            gutter: true,
            syntaxHighlightDeletions: false,
            allowInlineDiffs: true,
          }),
        ],
      });
    },
    cleanup: (editor) => (editor as EditorView).destroy(),
  },
  {
    name: "Side-by-Side Merge View (Basic)",
    description: "Basic side-by-side merge view",
    createEditor: (container) => {
      return new MergeView({
        a: { doc: sampleCode.original },
        b: { doc: sampleCode.modified },
        parent: container,
        highlightChanges: true,
        gutter: false,
      });
    },
    cleanup: (editor) => (editor as MergeView).destroy(),
  },
  {
    name: "Side-by-Side Merge View + Language",
    description: "Side-by-side merge view with JavaScript language support",
    createEditor: (container) => {
      return new MergeView({
        a: { doc: sampleCode.original, extensions: [javascript()] },
        b: { doc: sampleCode.modified, extensions: [javascript()] },
        parent: container,
        highlightChanges: true,
        gutter: true,
      });
    },
    cleanup: (editor) => (editor as MergeView).destroy(),
  },
  {
    name: "Side-by-Side Merge with Highlight.js",
    description: "Side-by-side merge view with highlight.js syntax highlighting",
    createEditor: (container) => {
      return new MergeView({
        a: { doc: sampleCode.original, extensions: [highlightJsExtension('javascript')] },
        b: { doc: sampleCode.modified, extensions: [highlightJsExtension('javascript')] },
        parent: container,
        highlightChanges: true,
        gutter: true,
      });
    },
    cleanup: (editor) => (editor as MergeView).destroy(),
  },
  {
    name: "Side-by-Side Merge View + Theme",
    description: "Side-by-side merge view with dark theme",
    createEditor: (container) => {
      return new MergeView({
        a: { doc: sampleCode.original, extensions: [oneDark] },
        b: { doc: sampleCode.modified, extensions: [oneDark] },
        parent: container,
        highlightChanges: true,
        gutter: true,
      });
    },
    cleanup: (editor) => (editor as MergeView).destroy(),
  },
  {
    name: "Side-by-Side Merge View (Full)",
    description: "Side-by-side merge view with all features enabled",
    createEditor: (container) => {
      return new MergeView({
        a: { doc: sampleCode.original, extensions: [javascript(), oneDark] },
        b: { doc: sampleCode.modified, extensions: [javascript(), oneDark] },
        parent: container,
        highlightChanges: true,
        gutter: true,
        revertControls: "a-to-b",
      });
    },
    cleanup: (editor) => (editor as MergeView).destroy(),
  },
  {
    name: "Side-by-Side Merge View (Full) with Highlight.js",
    description: "Side-by-side merge view with all features enabled using highlight.js",
    createEditor: (container) => {
      return new MergeView({
        a: { doc: sampleCode.original, extensions: [highlightJsExtension('javascript'), oneDark] },
        b: { doc: sampleCode.modified, extensions: [highlightJsExtension('javascript'), oneDark] },
        parent: container,
        highlightChanges: true,
        gutter: true,
        revertControls: "a-to-b",
      });
    },
    cleanup: (editor) => (editor as MergeView).destroy(),
  },
];