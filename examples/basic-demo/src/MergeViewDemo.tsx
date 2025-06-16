import React, { useState, useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { StateEffect, Transaction, Text } from "@codemirror/state";
import EditorContainer from "./components/EditorContainer";
import Container from "./components/Container";
import ViewTypeToggle from "./components/ViewTypeToggle";
import Select from "./components/Select";
import { history, historyKeymap } from "@codemirror/commands";
import {
  acceptAllChunksMergeView,
  acceptAllChunksUnifiedView,
  MergeView,
  unifiedMergeView,
  getOriginalDoc,
} from "codemirror-merge-reforged";
import { ChunkField } from "../../../src/merge";
import { oneDark } from "@codemirror/theme-one-dark";
import { langs } from "@uiw/codemirror-extensions-langs";

interface Example {
  name: string;
  original: string;
  modified: string;
}

const examples: Record<string, Example> = {
  javascript: {
    name: "JavaScript Functions",
    original: `function helloWorld() {
    console.log("Hello World!");
    return true;
}

const name = "Alice";
console.log("Welcome " + name);`,
    modified: `function helloNew() {
    console.log("Hello!");
    return false;
}

const userName = "Bob";
console.log("Welcome " + userName);
console.log("Have a great day!");`,
  },
  python: {
    name: "Python Script",
    original: `# Python Example
def calculate(x, y):
    result = x + y
    return result

numbers = [1, 2, 3]
print(numbers)`,
    modified: `# Python Example - Updated
def calculate(x, y, operation="add"):
    if operation == "add":
        result = x + y
    elif operation == "multiply":
        result = x * y
    else:
        result = 0
    return result

numbers = [1, 2, 3, 4, 5]
total = sum(numbers)
print(f"Numbers: {numbers}")
print(f"Total: {total}")`,
  },
  complex: {
    name: "Complex Changes",
    original: `const users = [
    { name: "John", age: 25 },
    { name: "Jane", age: 30 }
];

function getUser(id) {
    return users[id];
}`,
    modified: `const users = [
    { name: "John", age: 25, active: true },
    { name: "Jane", age: 30, active: false },
    { name: "Bob", age: 35, active: true }
];

function getUser(id) {
    if (id >= users.length) {
        return null;
    }
    return users[id];
}

function getActiveUsers() {
    return users.filter(user => user.active);
}`,
  },
};

type ViewType = "split" | "unified";

const MergeViewDemo: React.FC = () => {
  const [viewType, setViewType] = useState<ViewType>("split");
  const [selectedExample, setSelectedExample] = useState<string>("javascript");
  const [eventLog, setEventLog] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | EditorView | null>(null);

  // Shared document content for both views
  const docsRef = useRef<{
    original: Text;
    modified: Text;
  }>({
    original: Text.of(examples.javascript.original.split(/\r?\n/)),
    modified: Text.of(examples.javascript.modified.split(/\r?\n/)),
  });

  // Reset shared docs when example changes
  useEffect(() => {
    const example = examples[selectedExample];
    docsRef.current = {
      original: Text.of(example.original.split(/\r?\n/)),
      modified: Text.of(example.modified.split(/\r?\n/)),
    };
  }, [selectedExample]);

  const createSplitView = () => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = "";
    const { original, modified } = docsRef.current;

    viewRef.current = new MergeView({
      a: {
        doc: original,
        extensions: [
          langs.javascript(),
          oneDark,
          history(),
          keymap.of(historyKeymap),
          EditorView.lineWrapping,
        ],
      },
      b: {
        doc: modified,
        extensions: [
          langs.javascript(),
          oneDark,
          history(),
          keymap.of(historyKeymap),
          EditorView.lineWrapping,
        ],
      },
      parent: containerRef.current,
      revertControls: "a-to-b",
      highlightChanges: true,
      gutter: true,
    });

    // Update shared docs when editors change
    const recordChanges = (side: "a" | "b") =>
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          docsRef.current[side === "a" ? "original" : "modified"] =
            update.state.doc;
        }
      });

    viewRef.current.a.dispatch({
      effects: StateEffect.appendConfig.of(recordChanges("a")),
    });
    viewRef.current.b.dispatch({
      effects: StateEffect.appendConfig.of(recordChanges("b")),
    });
  };

  const createUnifiedView = () => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = "";
    const { original, modified } = docsRef.current;

    const editorView = new EditorView({
      parent: containerRef.current,
      doc: modified,
      extensions: [
        langs.javascript(),
        oneDark,
        history(),
        keymap.of(historyKeymap),
        EditorView.lineWrapping,
        EditorView.theme({
          ".cm-changeGutter": {
            width: "4px !important",
            backgroundColor: "transparent !important",
          },
        }),
        unifiedMergeView({
          original: original,
          mergeControls: true,
          highlightChanges: true,
          allowInlineDiffs: true,
          gutter: true,
        }),
        // Listen to chunk events and update shared docs
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions) {
            const evt = tr.annotation(Transaction.userEvent);
            if (evt === "accept" || evt === "accept.all" || evt === "revert") {
              // Update original doc when chunks are accepted/reverted
              docsRef.current.original = getOriginalDoc(update.state);
              console.log(
                "chunks left:",
                update.state.field(ChunkField, false)?.length ?? 0
              );
              break;
            }
          }
          // Update modified doc when document changes
          if (update.docChanged) {
            docsRef.current.modified = update.state.doc;
          }
        }),
      ],
    });

    viewRef.current = editorView;
  };

  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.destroy();
    }

    // Clear event log when switching examples or view types
    setEventLog([]);

    if (viewType === "split") {
      createSplitView();
    } else {
      createUnifiedView();
    }

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
      }
    };
  }, [viewType, selectedExample]);

  const selectOptions = Object.entries(examples).map(([key, example]) => ({
    value: key,
    label: example.name,
  }));

  const handleAcceptAllChunks = () => {
    if (!viewRef.current) return;

    if (viewType === "unified") {
      acceptAllChunksUnifiedView(viewRef.current as EditorView);
    } else if (viewType === "split") {
      acceptAllChunksMergeView(viewRef.current as MergeView, "a-to-b");
    }
  };

  const clearEventLog = () => {
    setEventLog([]);
  };

  return (
    <Container>
      <ViewTypeToggle viewType={viewType} onViewTypeChange={setViewType} />

      <div className="mb-6">
        <Select
          value={selectedExample}
          onChange={setSelectedExample}
          options={selectOptions}
          label="Example:"
        />
      </div>

      <div className="button-group">
        <button
          className="button button-primary"
          onClick={handleAcceptAllChunks}
        >
          Accept All Chunks
        </button>
        {viewType === "unified" && eventLog.length > 0 && (
          <button className="button button-secondary" onClick={clearEventLog}>
            Clear Event Log
          </button>
        )}
      </div>

      {viewType === "unified" && eventLog.length > 0 && (
        <div className="mb-4 p-3 bg-gray-100 rounded-md">
          <h3 className="text-sm font-medium mb-2">Event Log:</h3>
          <div className="text-xs space-y-1 max-h-32 overflow-y-auto">
            {eventLog.map((event, index) => (
              <div key={index} className="text-gray-700">
                {event}
              </div>
            ))}
          </div>
        </div>
      )}

      <EditorContainer ref={containerRef} />
    </Container>
  );
};

export default MergeViewDemo;
