import { EditorView } from "@codemirror/view";
import { MergeView } from "../../../../src/mergeview";
import { TestConfig, TestResult, ActiveTest } from "./types";

export const measureMemory = (): number | undefined => {
  if ('memory' in performance && (performance as any).memory) {
    return (performance as any).memory.usedJSHeapSize;
  }
  return undefined;
};

export const createEditorContainer = (): HTMLElement => {
  const editorDiv = document.createElement("div");
  editorDiv.className = "editor-item mb-2 border border-gray-300 rounded";
  editorDiv.style.height = "200px";
  editorDiv.style.overflow = "auto";
  editorDiv.style.marginBottom = "8px";
  return editorDiv;
};

export const executeTest = async (
  config: TestConfig,
  count: number,
  container: HTMLElement,
  onProgress?: (current: number, total: number) => void
): Promise<{ editors: (EditorView | MergeView)[]; result: TestResult }> => {
  const startTime = performance.now();
  const editors: (EditorView | MergeView)[] = [];
  const batchSize = Math.min(5, count);

  for (let i = 0; i < count; i += batchSize) {
    const batch = Math.min(batchSize, count - i);

    for (let j = 0; j < batch; j++) {
      const editorDiv = createEditorContainer();
      const editor = config.createEditor(editorDiv);
      editors.push(editor);
      container.appendChild(editorDiv);
    }

    onProgress?.(i + batch, count);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const endTime = performance.now();
  const creationTime = endTime - startTime;
  const memoryUsage = measureMemory();

  const result: TestResult = {
    config: config.name,
    editorCount: count,
    creationTime,
    avgPerEditor: creationTime / count,
    memoryUsage,
  };

  return { editors, result };
};

export const cleanupTest = (activeTest: ActiveTest | null) => {
  if (activeTest) {
    activeTest.editors.forEach((editor) => activeTest.config.cleanup(editor));
  }
};