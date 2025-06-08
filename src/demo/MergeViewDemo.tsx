import React, { useState, useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { MergeView } from '../codemirror-merge';
import { unifiedMergeView } from '../codemirror-merge';
import Container from './ui/Container';
import ViewTypeToggle from './ui/ViewTypeToggle';
import Select from './ui/Select';
import EditorContainer from './ui/EditorContainer';

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
console.log("Have a great day!");`
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
print(f"Total: {total}")`
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
}`
  }
};

type ViewType = 'split' | 'unified';

const MergeViewDemo: React.FC = () => {
  const [viewType, setViewType] = useState<ViewType>('unified');
  const [selectedExample, setSelectedExample] = useState<string>('javascript');
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | EditorView | null>(null);

  const logEditorState = (view: MergeView | EditorView, type: string) => {
    console.group(`=== ${type} Editor State ===`);
    
    if (view instanceof MergeView) {
      // console.log('MergeView instance:', view);
      console.log('Editor A state:', view.a.state);
      console.log('Editor A document:', view.a.state.doc.toString());
      console.log('Editor B state:', view.b.state);
      console.log('Editor B document:', view.b.state.doc.toString());
      console.log('Chunks:', view.chunks);
    } else {
      // console.log('EditorView instance:', view);
      console.log('State:', view.state);
      console.log('Document:', view.state.doc.toString());
    }
    
    console.groupEnd();
  };

  // State change listener extension
  const stateChangeListener = EditorView.updateListener.of((update) => {
    console.group('=== Editor State Change ===');
    console.log('Update:', update);
    console.log('Doc changed:', update.docChanged);
    console.log('Selection changed:', update.selectionSet);
    console.log('View changed:', update.viewportChanged);
    console.log('Height changed:', update.heightChanged);
    console.log('Transactions:', update.transactions);
    
    if (update.docChanged) {
      console.log('Document before:', update.startState.doc.toString());
      console.log('Document after:', update.state.doc.toString());
      console.log('Changes:', update.changes);
    }
    
    if (update.selectionSet) {
      console.log('Selection before:', update.startState.selection);
      console.log('Selection after:', update.state.selection);
    }
    
    console.log('Effects:', update.transactions.flatMap(tr => tr.effects));
    console.groupEnd();
  });

  const createSplitView = (example: Example) => {
    if (!containerRef.current) return;
    
    containerRef.current.innerHTML = '';
    
    viewRef.current = new MergeView({
      a: {
        doc: example.original,
        extensions: [
          basicSetup,
          stateChangeListener
        ]
      },
      b: {
        doc: example.modified,
        extensions: [
          basicSetup,
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          stateChangeListener
        ]
      },
      parent: containerRef.current,
      revertControls: "a-to-b",
      highlightChanges: true,
      gutter: true
    });

    // Log the state after creation
    setTimeout(() => {
      if (viewRef.current) {
        logEditorState(viewRef.current, 'Split View');
      }
    }, 100);
  };

  const createUnifiedView = (example: Example) => {
    if (!containerRef.current) return;
    
    containerRef.current.innerHTML = '';
    
    viewRef.current = new EditorView({
      parent: containerRef.current,
      doc: example.modified,
      extensions: [
        basicSetup,
        unifiedMergeView({
          original: example.original,
          mergeControls: true,
          highlightChanges: true,
          gutter: true
        }),
        stateChangeListener
      ]
    });

    // Log the state after creation
    setTimeout(() => {
      if (viewRef.current) {
        logEditorState(viewRef.current, 'Unified View');
      }
    }, 100);
  };

  useEffect(() => {
    const example = examples[selectedExample];
    
    if (viewRef.current) {
      viewRef.current.destroy();
    }
    
    if (viewType === 'split') {
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
    label: example.name
  }));

  // Add a button to manually log current state
  const handleLogState = () => {
    if (viewRef.current) {
      logEditorState(viewRef.current, `Current ${viewType} View`);
    } else {
      console.log('No editor view available');
    }
  };

  return (
    <Container>
      <ViewTypeToggle 
        viewType={viewType} 
        onViewTypeChange={setViewType} 
      />
      
      <div className="mb-6">
        <Select
          value={selectedExample}
          onChange={setSelectedExample}
          options={selectOptions}
          label="Example:"
        />
      </div>

      <div className="button-group">
        <button className="button button-primary" onClick={handleLogState}>
          Log Editor State
        </button>
      </div>

      <EditorContainer ref={containerRef} />
    </Container>
  );
};

export default MergeViewDemo;