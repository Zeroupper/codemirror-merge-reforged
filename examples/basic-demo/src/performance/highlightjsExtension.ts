import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, StateField, StateEffect } from "@codemirror/state";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";

// Register JavaScript language
hljs.registerLanguage('javascript', javascript);

// State effect to trigger re-highlighting
const rehighlightEffect = StateEffect.define<void>();

// Extension that provides highlight.js syntax highlighting
export function highlightJsExtension(language: string = 'javascript') {
  const highlightField = StateField.define({
    create() {
      return { version: 0 };
    },
    update(value, tr) {
      if (tr.docChanged || tr.effects.some(e => e.is(rehighlightEffect))) {
        return { version: value.version + 1 };
      }
      return value;
    }
  });

  const highlightPlugin = ViewPlugin.fromClass(class {
    constructor(private view: EditorView) {
      this.highlight();
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.state.field(highlightField).version !== update.startState.field(highlightField).version) {
        this.highlight();
      }
    }

    private highlight() {
      const { view } = this;
      const doc = view.state.doc;
      const text = doc.toString();
      
      try {
        const result = hljs.highlight(text, { language });
        
        // Apply highlighting by updating DOM directly
        requestAnimationFrame(() => {
          const content = view.contentDOM;
          if (content) {
            // Create a temporary container to parse the highlighted HTML
            const temp = document.createElement('div');
            temp.innerHTML = result.value;
            
            // Apply highlighting classes to the editor content
            this.applyHighlighting(content, temp);
          }
        });
      } catch (error) {
        console.warn('Highlight.js failed:', error);
      }
    }

    private applyHighlighting(editorContent: Element, highlightedContent: Element) {
      // Simple approach: add CSS classes based on highlight.js output
      const lines = editorContent.querySelectorAll('.cm-line');
      const highlightedText = highlightedContent.textContent || '';
      const originalText = editorContent.textContent || '';
      
      if (highlightedText === originalText) {
        // Apply basic highlighting by finding and marking keywords
        lines.forEach(line => {
          const text = line.textContent || '';
          if (text.includes('function') || text.includes('const') || text.includes('let') || text.includes('var')) {
            line.classList.add('hljs-highlighted');
          }
        });
      }
    }
  });

  return [
    highlightField,
    highlightPlugin,
    EditorView.theme({
      ".hljs-highlighted": {
        fontWeight: "bold"
      },
      ".hljs-keyword": { 
        color: "#c678dd",
        fontWeight: "bold"
      },
      ".hljs-string": { 
        color: "#98c379" 
      },
      ".hljs-comment": { 
        color: "#5c6370",
        fontStyle: "italic"
      },
      ".hljs-function": { 
        color: "#61afef" 
      },
      ".hljs-variable": { 
        color: "#e06c75" 
      },
      ".hljs-number": { 
        color: "#d19a66" 
      },
    })
  ];
}