// Main exports for the CodeMirror merge package
export { MergeView, acceptAllChunksMergeView } from './mergeview';
export type { MergeConfig, DirectMergeConfig } from './mergeview';

export { unifiedMergeView, acceptChunk, rejectChunk, getOriginalDoc, originalDocChangeEffect, updateOriginalDoc, acceptAllChunksUnifiedView } from './unified';

export { Chunk } from './chunk';
export { getChunks, goToNextChunk, goToPreviousChunk } from './merge';

export { diff, presentableDiff } from './diff';
export type { DiffConfig, Change } from './diff';

export { mergeKeymap, defaultMergeKeymap } from './keymap';
export type { MergeKeymapConfig } from './keymap';