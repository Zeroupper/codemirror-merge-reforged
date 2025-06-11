import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";

/// Configuration for merge view keybindings
export interface MergeKeymapConfig {
  /// Key binding for undo. Defaults to "Mod-z"
  undo?: string;
  /// Key binding for redo. Defaults to "Mod-y" and "Mod-Shift-z"
  redo?: string | string[];
  /// Whether to use high precedence for the keymap. Defaults to true
  /// to override default editor keybindings
  highPrecedence?: boolean;
}

/// Create a keymap extension for merge views with configurable undo/redo commands
export function mergeKeymap(
  undoCommand: () => boolean,
  redoCommand: () => boolean,
  config: MergeKeymapConfig = {}
) {
  const undoKey = config.undo || "Mod-z";
  const redoKeys = Array.isArray(config.redo) 
    ? config.redo 
    : config.redo 
    ? [config.redo] 
    : ["Mod-y", "Mod-Shift-z"];
  
  const bindings = [
    { key: undoKey, run: undoCommand }
  ];
  
  for (const redoKey of redoKeys) {
    bindings.push({ key: redoKey, run: redoCommand });
  }
  
  const keymapExt = keymap.of(bindings);
  
  return config.highPrecedence !== false 
    ? Prec.highest(keymapExt)
    : keymapExt;
}

/// Default merge keymap with standard Ctrl/Cmd+Z and Ctrl/Cmd+Y bindings
export function defaultMergeKeymap(
  undoCommand: () => boolean,
  redoCommand: () => boolean
) {
  return mergeKeymap(undoCommand, redoCommand);
}