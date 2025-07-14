import { EditorView } from "@codemirror/view";
import { MergeView } from "../../../../src/mergeview";

export interface TestConfig {
  name: string;
  description: string;
  createEditor: (container: HTMLElement) => EditorView | MergeView;
  cleanup: (editor: EditorView | MergeView) => void;
}

export interface TestResult {
  config: string;
  editorCount: number;
  creationTime: number;
  avgPerEditor: number;
  memoryUsage?: number;
}

export interface ActiveTest {
  config: TestConfig;
  editors: (EditorView | MergeView)[];
  result: TestResult;
}