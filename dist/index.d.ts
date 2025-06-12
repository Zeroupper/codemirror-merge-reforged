import { EditorView, DecorationSet } from '@codemirror/view';
import * as _codemirror_state from '@codemirror/state';
import { Text, ChangeDesc, EditorStateConfig, StateField, ChangeSet, EditorState, StateEffect, StateCommand } from '@codemirror/state';

declare class Change {
    readonly fromA: number;
    readonly toA: number;
    readonly fromB: number;
    readonly toB: number;
    constructor(fromA: number, toA: number, fromB: number, toB: number);
    offset(offA: number, offB?: number): Change;
}
interface DiffConfig {
    scanLimit?: number;
    timeout?: number;
}
declare function diff(a: string, b: string, config?: DiffConfig): readonly Change[];
declare function presentableDiff(a: string, b: string, config?: DiffConfig): readonly Change[];

declare class Chunk {
    readonly changes: readonly Change[];
    readonly fromA: number;
    readonly toA: number;
    readonly fromB: number;
    readonly toB: number;
    readonly precise: boolean;
    constructor(changes: readonly Change[], fromA: number, toA: number, fromB: number, toB: number, precise?: boolean);
    offset(offA: number, offB: number): Chunk;
    get endA(): number;
    get endB(): number;
    static build(a: Text, b: Text, conf?: DiffConfig): readonly Chunk[];
    static updateA(chunks: readonly Chunk[], a: Text, b: Text, changes: ChangeDesc, conf?: DiffConfig): readonly Chunk[];
    static updateB(chunks: readonly Chunk[], a: Text, b: Text, changes: ChangeDesc, conf?: DiffConfig): readonly Chunk[];
}

interface MergeKeymapConfig {
    undo?: string;
    redo?: string | string[];
    highPrecedence?: boolean;
}
declare function mergeKeymap(undoCommand: () => boolean, redoCommand: () => boolean, config?: MergeKeymapConfig): _codemirror_state.Extension;
declare function defaultMergeKeymap(undoCommand: () => boolean, redoCommand: () => boolean): _codemirror_state.Extension;

interface MergeConfig {
    orientation?: "a-b" | "b-a";
    revertControls?: "a-to-b" | "b-to-a";
    renderRevertControl?: () => HTMLElement;
    highlightChanges?: boolean;
    gutter?: boolean;
    collapseUnchanged?: {
        margin?: number;
        minSize?: number;
    };
    diffConfig?: DiffConfig;
    keymap?: MergeKeymapConfig | false;
}
interface DirectMergeConfig extends MergeConfig {
    a: EditorStateConfig;
    b: EditorStateConfig;
    parent?: Element | DocumentFragment;
    root?: Document | ShadowRoot;
}
declare class MergeView {
    a: EditorView;
    b: EditorView;
    dom: HTMLElement;
    private editorDOM;
    private revertDOM;
    private revertToA;
    private revertToLeft;
    private renderRevert;
    private diffConf;
    private sharedHistory;
    chunks: readonly Chunk[];
    private measuring;
    constructor(config: DirectMergeConfig);
    private dispatch;
    reconfigure(config: MergeConfig): void;
    private setupRevertControls;
    private scheduleMeasure;
    private measure;
    private updateRevertButtons;
    private renderRevertButton;
    private revertClicked;
    destroy(): void;
}
declare function acceptAllChunksMergeView(mergeView: MergeView, direction?: "a-to-b" | "b-to-a"): boolean;

interface UnifiedMergeConfig {
    original: Text | string;
    highlightChanges?: boolean;
    gutter?: boolean;
    syntaxHighlightDeletions?: boolean;
    allowInlineDiffs?: boolean;
    syntaxHighlightDeletionsMaxLength?: number;
    mergeControls?: boolean;
    diffConfig?: DiffConfig;
    collapseUnchanged?: {
        margin?: number;
        minSize?: number;
    };
}
declare function unifiedMergeView(config: UnifiedMergeConfig): (_codemirror_state.Extension | StateField<DecorationSet>)[];
declare const updateOriginalDoc: _codemirror_state.StateEffectType<{
    doc: Text;
    changes: ChangeSet;
}>;
declare function originalDocChangeEffect(state: EditorState, changes: ChangeSet): StateEffect<{
    doc: Text;
    changes: ChangeSet;
}>;
declare function getOriginalDoc(state: EditorState): Text;
declare function acceptChunk(view: EditorView, pos?: number): boolean;
declare function rejectChunk(view: EditorView, pos?: number): boolean;
declare function acceptAllChunksUnifiedView(view: EditorView): boolean;

declare function getChunks(state: EditorState): {
    chunks: readonly Chunk[];
    side: "a" | "b" | null;
} | null;
declare const goToNextChunk: StateCommand;
declare const goToPreviousChunk: StateCommand;

export { Change, Chunk, MergeView, acceptAllChunksMergeView, acceptAllChunksUnifiedView, acceptChunk, defaultMergeKeymap, diff, getChunks, getOriginalDoc, goToNextChunk, goToPreviousChunk, mergeKeymap, originalDocChangeEffect, presentableDiff, rejectChunk, unifiedMergeView, updateOriginalDoc };
export type { DiffConfig, DirectMergeConfig, MergeConfig, MergeKeymapConfig };
