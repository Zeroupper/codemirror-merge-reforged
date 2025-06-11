import React, { useState, useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import Container from "./components/Container";
import Button from "./components/Button";
import { unifiedMergeView } from "../../../src/unified";

const sampleCode = {
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

type ViewType = "regular" | "unified";

const PerformanceTest: React.FC = () => {
  const [editorCount, setEditorCount] = useState(10);
  const [viewType, setViewType] = useState<ViewType>("regular");
  const [editors, setEditors] = useState<EditorView[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [creationTime, setCreationTime] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const createEditors = async () => {
    if (!containerRef.current) return;

    setIsCreating(true);
    const startTime = performance.now();

    // Clear existing editors
    editors.forEach((editor) => editor.destroy());
    containerRef.current.innerHTML = "";

    const newEditors: EditorView[] = [];

    // Create editors in batches to avoid blocking UI
    const batchSize = 10;
    for (let i = 0; i < editorCount; i += batchSize) {
      const batch = Math.min(batchSize, editorCount - i);

      for (let j = 0; j < batch; j++) {
        const editorDiv = document.createElement("div");
        editorDiv.className = "editor-item mb-4 border border-gray-300 rounded";
        editorDiv.style.height = "200px";
        editorDiv.style.overflow = "auto";

        const extensions = [
          basicSetup,
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { overflow: "auto" },
          }),
          EditorView.lineWrapping,
        ];

        let editor: EditorView;

        if (viewType === "unified") {
          // Add unified merge view extension
          extensions.push(
            unifiedMergeView({
              original: sampleCode.original,
              mergeControls: true,
              highlightChanges: true,
              gutter: true,
            })
          );

          editor = new EditorView({
            parent: editorDiv,
            doc: sampleCode.modified,
            extensions,
          });
        } else {
          // Regular editor
          editor = new EditorView({
            parent: editorDiv,
            doc: sampleCode.modified,
            extensions,
          });
        }

        newEditors.push(editor);
        containerRef.current.appendChild(editorDiv);
      }

      // Allow UI to update between batches
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const endTime = performance.now();
    setCreationTime(endTime - startTime);
    setEditors(newEditors);
    setIsCreating(false);

    console.log(
      `Created ${editorCount} ${viewType} editors in ${endTime - startTime}ms`
    );
  };

  const destroyEditors = () => {
    editors.forEach((editor) => editor.destroy());
    setEditors([]);
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }
    setCreationTime(null);
  };

  useEffect(() => {
    return () => {
      editors.forEach((editor) => editor.destroy());
    };
  }, []);

  return (
    <Container>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-4">CodeMirror Performance Test</h2>

        <div className="flex items-center gap-6 mb-4">
          <label className="flex items-center gap-2">
            Editor Count:
            <input
              type="number"
              value={editorCount}
              onChange={(e) =>
                setEditorCount(Math.max(1, parseInt(e.target.value) || 1))
              }
              className="border border-gray-300 rounded px-2 py-1 w-20"
              min="1"
              max="1000"
            />
          </label>

          <div className="flex items-center gap-2">
            <span>View Type:</span>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                value="regular"
                checked={viewType === "regular"}
                onChange={(e) => setViewType(e.target.value as ViewType)}
              />
              Regular
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                value="unified"
                checked={viewType === "unified"}
                onChange={(e) => setViewType(e.target.value as ViewType)}
              />
              Unified Merge
            </label>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <Button
            onClick={createEditors}
            className="bg-blue-500 hover:bg-blue-600"
          >
            {isCreating ? "Creating..." : `Create ${viewType} Editors`}
          </Button>

          <Button
            onClick={destroyEditors}
            className="bg-red-500 hover:bg-red-600"
          >
            Destroy All
          </Button>
        </div>

        <div className="mb-4 text-sm text-gray-600">
          <div>
            Active Editors: {editors.length} ({viewType})
          </div>
          {creationTime && (
            <div>Creation Time: {creationTime.toFixed(2)}ms</div>
          )}
          {creationTime && editors.length > 0 && (
            <div>
              Avg per Editor: {(creationTime / editors.length).toFixed(2)}ms
            </div>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="editors-container max-h-96 overflow-y-auto border border-gray-200 rounded p-4"
        style={{ maxHeight: "600px" }}
      />
    </Container>
  );
};

export default PerformanceTest;
