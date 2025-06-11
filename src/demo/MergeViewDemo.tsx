import React, { useState, useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import Container from "./ui/Container";
import ViewTypeToggle from "./ui/ViewTypeToggle";
import Select from "./ui/Select";
import EditorContainer from "./ui/EditorContainer";
import { history, historyKeymap } from "@codemirror/commands";
import { MergeView } from "../codemirror-merge/mergeview";
import { unifiedMergeView } from "../codemirror-merge/unified";
import { acceptAllChunks as acceptAllChunksMergeView } from "../codemirror-merge/mergeview";
import { acceptAllChunks as acceptAllChunksUnified } from "../codemirror-merge/unified";

interface Example {
  name: string;
  original: string;
  modified: string;
}

const examples: Record<string, Example> = {
  javascript: {
    name: "JavaScript Functions",
    original: `function hello() {
    console.log("Hello World!");
    return true;
}

const name = "Alice";
console.log("Welcome " + name);`,
    modified: `function hello(name = "World") {
    console.log("Hello " + name + "!");
    console.log("This is a new line");
    return true;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | EditorView | null>(null);

  const createSplitView = (example: Example) => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = "";

    viewRef.current = new MergeView({
      a: {
        doc: example.original,
        extensions: [
          EditorView.lineWrapping,
          EditorView.theme({
            ".cm-changeGutter": {
              width: "4px !important", // Slightly wider to accommodate rounded elements
              backgroundColor: "transparent !important",
            },
          }),
        ],
      },
      b: {
        doc: example.modified,
        extensions: [
          EditorView.lineWrapping,
          EditorView.theme({
            ".cm-changeGutter": {
              width: "4px !important", // Slightly wider to accommodate rounded elements
              backgroundColor: "transparent !important",
            },
          }),
        ],
      },
      keymap: {
        undo: "Mod-z",
        redo: "Mod-y",
      },
      parent: containerRef.current,
      revertControls: "a-to-b",
      highlightChanges: true,
      gutter: true,
    });
  };

  const createUnifiedView = (example: Example) => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = "";

    viewRef.current = new EditorView({
      parent: containerRef.current,
      doc: example.modified,
      extensions: [
        history(),
        keymap.of(historyKeymap),
        EditorView.lineWrapping,
        EditorView.theme({
          ".cm-changeGutter": {
            width: "4px !important", // Slightly wider to accommodate rounded elements
            backgroundColor: "transparent !important",
          },
        }),
        unifiedMergeView({
          original: example.original,
          mergeControls: true,
          highlightChanges: true,
          gutter: true,
        }),
      ],
    });
  };

  useEffect(() => {
    const example = examples[selectedExample];

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    if (viewType === "split") {
      createSplitView(example);
    } else {
      createUnifiedView(example);
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
      // For unified view, use the unified acceptAllChunks function
      acceptAllChunksUnified(viewRef.current as EditorView);
    } else if (viewType === "split") {
      // For split view, use the MergeView acceptAllChunks function
      acceptAllChunksMergeView(viewRef.current as MergeView, "a-to-b");
    }
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
      </div>

      <EditorContainer ref={containerRef} />
    </Container>
  );
};

export default MergeViewDemo;
