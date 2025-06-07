# CodeMirror Merge Implementation

This directory contains the core implementation of the CodeMirror merge functionality.

## Structure

- `index.ts` - Main exports and public API
- `mergeview.ts` - Split merge view implementation
- `unified.ts` - Unified merge view implementation  
- `chunk.ts` - Diff chunk handling
- `diff.ts` - Diff algorithm
- `merge.ts` - Merge utilities and state management
- `deco.ts` - Decorations and visual styling
- `theme.ts` - Theme definitions

## Usage

```typescript
import { MergeView, unifiedMergeView } from '../codemirror-merge';
```

This is the actual CodeMirror merge package implementation.