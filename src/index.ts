// Main exports for the CodeMirror merge package
export { MergeView, acceptAllChunks as acceptAllChunksMergeView } from './codemirror-merge/mergeview';
export type { MergeConfig, DirectMergeConfig } from './codemirror-merge/mergeview';

export { unifiedMergeView, acceptChunk, rejectChunk, getOriginalDoc, originalDocChangeEffect, updateOriginalDoc, acceptAllChunks as acceptAllChunksUnified } from './codemirror-merge/unified';

export { Chunk } from './codemirror-merge/chunk';
export { getChunks, goToNextChunk, goToPreviousChunk } from './codemirror-merge/merge';

export { diff, presentableDiff } from './codemirror-merge/diff';
export type { DiffConfig, Change } from './codemirror-merge/diff';

export { mergeKeymap, defaultMergeKeymap } from './codemirror-merge/keymap';
export type { MergeKeymapConfig } from './codemirror-merge/keymap';