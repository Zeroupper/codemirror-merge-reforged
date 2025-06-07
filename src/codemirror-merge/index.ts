// Main exports for the CodeMirror merge package
export { MergeView } from './mergeview';
export type { MergeConfig, DirectMergeConfig } from './mergeview';

export { unifiedMergeView, acceptChunk, rejectChunk, getOriginalDoc, originalDocChangeEffect, updateOriginalDoc } from './unified';

export { Chunk } from './chunk';
export { getChunks, goToNextChunk, goToPreviousChunk } from './merge';

export { diff, presentableDiff } from './diff';
export type { DiffConfig, Change } from './diff';