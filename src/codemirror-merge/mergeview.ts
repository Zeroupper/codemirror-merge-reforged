import {EditorView} from "@codemirror/view"
import {EditorStateConfig, Transaction, EditorState, StateEffect, Prec, Compartment, ChangeSet} from "@codemirror/state"
import {history, undo, redo, undoDepth, redoDepth} from "@codemirror/commands"
import {keymap} from "@codemirror/view"
import {Chunk, defaultDiffConfig} from "./chunk"
import {DiffConfig} from "./diff"
import {setChunks, ChunkField, mergeConfig} from "./merge"
import {decorateChunks, updateSpacers, Spacers, adjustSpacers, collapseUnchanged, changeGutter} from "./deco"
import {baseTheme, externalTheme} from "./theme"

/// Configuration options to `MergeView` that can be provided both
/// initially and to [`reconfigure`](#merge.MergeView.reconfigure).
export interface MergeConfig {
  /// Controls whether editor A or editor B is shown first. Defaults
  /// to `"a-b"`.
  orientation?: "a-b" | "b-a",
  /// Controls whether revert controls are shown between changed
  /// chunks.
  revertControls?: "a-to-b" | "b-to-a"
  /// When given, this function is called to render the button to
  /// revert a chunk.
  renderRevertControl?: () => HTMLElement,
  /// By default, the merge view will mark inserted and deleted text
  /// in changed chunks. Set this to false to turn that off.
  highlightChanges?: boolean,
  /// Controls whether a gutter marker is shown next to changed lines.
  gutter?: boolean,
  /// When given, long stretches of unchanged text are collapsed.
  /// `margin` gives the number of lines to leave visible after/before
  /// a change (default is 3), and `minSize` gives the minimum amount
  /// of collapsible lines that need to be present (defaults to 4).
  collapseUnchanged?: {margin?: number, minSize?: number},
  /// Pass options to the diff algorithm. By default, the merge view
  /// sets [`scanLimit`](#merge.DiffConfig.scanLimit) to 500.
  diffConfig?: DiffConfig
}

/// Configuration options given to the [`MergeView`](#merge.MergeView)
/// constructor.
export interface DirectMergeConfig extends MergeConfig {
  /// Configuration for the first editor (the left one in a
  /// left-to-right context).
  a: EditorStateConfig
  /// Configuration for the second editor.
  b: EditorStateConfig
  /// Parent element to append the view to.
  parent?: Element | DocumentFragment
  /// An optional root. Only necessary if the view is mounted in a
  /// shadow root or a document other than the global `document`
  /// object.
  root?: Document | ShadowRoot
}

// Shared history state for unified undo/redo
class SharedHistory {
  private history: {editor: 'a' | 'b', transaction: Transaction}[] = []
  private currentIndex = -1
  
  private log(action: string, extra?: any) {
    console.group(`=== SharedHistory: ${action} ===`);
    console.log('Current index:', this.currentIndex);
    console.log('History length:', this.history.length);
    console.log('History:', this.history.map((entry, i) => `${i}: ${entry.editor} - Transaction`));
    console.log('Can undo:', this.canUndo());
    console.log('Can redo:', this.canRedo());
    if (extra) console.log('Extra:', extra);
    console.groupEnd();
  }
  
  addTransaction(editor: 'a' | 'b', transaction: Transaction) {
    console.log(`Adding transaction for editor ${editor}`);
    
    // Remove any future history when adding new transaction
    this.history = this.history.slice(0, this.currentIndex + 1)
    
    this.history.push({editor, transaction})
    this.currentIndex++
    
    this.log('addTransaction', { editor, transactionDocChanged: transaction.docChanged });
  }
  
  canUndo() {
    return this.currentIndex >= 0
  }
  
  canRedo() {
    return this.currentIndex < this.history.length - 1
  }
  
  undo(): {editor: 'a' | 'b', transaction: Transaction} | null {
    if (!this.canUndo()) {
      this.log('undo - cannot undo');
      return null;
    }
    
    const result = this.history[this.currentIndex]
    this.currentIndex--
    
    this.log('undo', { 
      undoingIndex: this.currentIndex + 1,
      editor: result.editor
    });
    
    return result
  }
  
  redo(): {editor: 'a' | 'b', transaction: Transaction} | null {
    if (!this.canRedo()) {
      this.log('redo - cannot redo');
      return null;
    }
    
    this.currentIndex++
    const result = this.history[this.currentIndex]
    
    this.log('redo', {
      redoingIndex: this.currentIndex,
      editor: result.editor
    });
    
    return result
  }
}

const collapseCompartment = new Compartment, configCompartment = new Compartment

/// A merge view manages two editors side-by-side, highlighting the
/// difference between them and vertically aligning unchanged lines.
/// If you want one of the editors to be read-only, you have to
/// configure that in its extensions.
///
/// By default, views are not scrollable. Style them (`.cm-mergeView`)
/// with a height and `overflow: auto` to make them scrollable.
export class MergeView {
  /// The first editor.
  a: EditorView
  /// The second editor.
  b: EditorView

  /// The outer DOM element holding the view.
  dom: HTMLElement
  private editorDOM: HTMLElement
  private revertDOM: HTMLElement | null = null
  private revertToA = false
  private revertToLeft = false
  private renderRevert: (() => HTMLElement) | undefined
  private diffConf: DiffConfig | undefined
  private sharedHistory = new SharedHistory()

  /// The current set of changed chunks.
  chunks: readonly Chunk[]

  private measuring = -1

  /// Create a new merge view.
  constructor(config: DirectMergeConfig) {
    this.diffConf = config.diffConfig || defaultDiffConfig

    // Create unified undo/redo commands
    const unifiedUndo = () => {
      console.log('🔄 UNIFIED UNDO CALLED - Our custom implementation');
      const historyEntry = this.sharedHistory.undo()
      if (historyEntry) {
        const {editor, transaction} = historyEntry
        const targetEditor = editor === 'a' ? this.a : this.b
        
        console.log(`Undoing transaction from editor ${editor}`);
        
        // Create inverse transaction to undo the change
        const inverseChanges = transaction.changes.invert(transaction.startState.doc)
        
        targetEditor.dispatch({
          changes: inverseChanges,
          userEvent: "undo",
          annotations: [Transaction.addToHistory.of(false)]
        })
        return true
      } else {
        console.log('No history entry to undo');
      }
      return false
    }

    const unifiedRedo = () => {
      console.log('🔄 UNIFIED REDO CALLED - Our custom implementation');
      const historyEntry = this.sharedHistory.redo()
      if (historyEntry) {
        const {editor, transaction} = historyEntry
        const targetEditor = editor === 'a' ? this.a : this.b
        
        console.log(`Redoing transaction from editor ${editor}`);
        
        // Re-apply the original changes
        targetEditor.dispatch({
          changes: transaction.changes,
          userEvent: "redo",
          annotations: [Transaction.addToHistory.of(false)]
        })
        return true
      } else {
        console.log('No history entry to redo');
      }
      return false
    }

     // Unified keymap for both editors - with highest precedence
     const unifiedKeymap = keymap.of([
      {key: "Mod-z", run: (view) => {
        console.log('🎯 Mod-z pressed - calling unified undo');
        return unifiedUndo();
      }},
      {key: "Mod-y", run: (view) => {
        console.log('🎯 Mod-y pressed - calling unified redo');
        return unifiedRedo();
      }},
      {key: "Mod-Shift-z", run: (view) => {
        console.log('🎯 Mod-Shift-z pressed - calling unified redo');
        return unifiedRedo();
      }}
    ])

    let sharedExtensions = [
      Prec.low(decorateChunks),
      baseTheme,
      externalTheme,
      Spacers,
      Prec.highest(unifiedKeymap), // Our unified keymap with highest priority
      EditorView.updateListener.of(update => {
        if (this.measuring < 0 && (update.heightChanged || update.viewportChanged) &&
            !update.transactions.some(tr => tr.effects.some(e => e.is(adjustSpacers))))
          this.measure()
      }),
    ]

    let configA = [mergeConfig.of({
      side: "a",
      sibling: () => this.b,
      highlightChanges: config.highlightChanges !== false,
      markGutter: config.gutter !== false
    })]
    if (config.gutter !== false) configA.push(changeGutter)
    let stateA = EditorState.create({
      doc: config.a.doc,
      selection: config.a.selection,
      extensions: [
        config.a.extensions || [],
        EditorView.editorAttributes.of({class: "cm-merge-a"}),
        configCompartment.of(configA),
        // Remove individual history - we'll handle it ourselves
        sharedExtensions
      ]
    })

    let configB = [mergeConfig.of({
      side: "b",
      sibling: () => this.a,
      highlightChanges: config.highlightChanges !== false,
      markGutter: config.gutter !== false
    })]
    if (config.gutter !== false) configB.push(changeGutter)
    let stateB = EditorState.create({
      doc: config.b.doc,
      selection: config.b.selection,
      extensions: [
        config.b.extensions || [],
        EditorView.editorAttributes.of({class: "cm-merge-b"}),
        configCompartment.of(configB),
        // Remove individual history - we'll handle it ourselves
        sharedExtensions
      ]
    })
    this.chunks = Chunk.build(stateA.doc, stateB.doc, this.diffConf)
    let add = [
      ChunkField.init(() => this.chunks),
      collapseCompartment.of(config.collapseUnchanged ? collapseUnchanged(config.collapseUnchanged) : [])
    ]
    stateA = stateA.update({effects: StateEffect.appendConfig.of(add)}).state
    stateB = stateB.update({effects: StateEffect.appendConfig.of(add)}).state

    this.dom = document.createElement("div")
    this.dom.className = "cm-mergeView"
    this.editorDOM = this.dom.appendChild(document.createElement("div"))
    this.editorDOM.className = "cm-mergeViewEditors"
    let orientation = config.orientation || "a-b"
    let wrapA = document.createElement("div")
    wrapA.className = "cm-mergeViewEditor"
    let wrapB = document.createElement("div")
    wrapB.className = "cm-mergeViewEditor"
    this.editorDOM.appendChild(orientation == "a-b" ? wrapA : wrapB)
    this.editorDOM.appendChild(orientation == "a-b" ? wrapB : wrapA)
    this.a = new EditorView({
      state: stateA,
      parent: wrapA,
      root: config.root,
      dispatchTransactions: trs => this.dispatch(trs, this.a)
    })
    this.b = new EditorView({
      state: stateB,
      parent: wrapB,
      root: config.root,
      dispatchTransactions: trs => this.dispatch(trs, this.b)
    })
    this.setupRevertControls(!!config.revertControls, config.revertControls == "b-to-a", config.renderRevertControl)
    if (config.parent) config.parent.appendChild(this.dom)
    this.scheduleMeasure()
  }

  private dispatch(trs: readonly Transaction[], target: EditorView) {
    if (trs.some(tr => tr.docChanged)) {
      let last = trs[trs.length - 1]
      let changes = trs.reduce((chs, tr) => chs.compose(tr.changes), ChangeSet.empty(trs[0].startState.doc.length))
      
      // Check if this is an undo/redo transaction - don't add to history
      const userEvent = last.annotation(Transaction.userEvent)
      const addToHistory = last.annotation(Transaction.addToHistory)
      const isUndoRedo = userEvent === "undo" || userEvent === "redo" || addToHistory === false
      
      console.log(`Dispatch: editor ${target === this.a ? 'a' : 'b'}, userEvent: ${userEvent}, addToHistory: ${addToHistory}, isUndoRedo: ${isUndoRedo}`);
      
      // Only add to shared history if it's not an undo/redo operation
      if (!isUndoRedo) {
        this.sharedHistory.addTransaction(target === this.a ? 'a' : 'b', last)
      } else {
        console.log('Skipping history addition for undo/redo transaction');
      }
      
      this.chunks = target == this.a ? Chunk.updateA(this.chunks, last.newDoc, this.b.state.doc, changes, this.diffConf)
        : Chunk.updateB(this.chunks, this.a.state.doc, last.newDoc, changes, this.diffConf)
      target.update([...trs, last.state.update({effects: setChunks.of(this.chunks)})])
      let other = target == this.a ? this.b : this.a
      other.update([other.state.update({effects: setChunks.of(this.chunks)})])
      this.scheduleMeasure()
    } else {
      target.update(trs)
    }
  }

  /// Reconfigure an existing merge view.
  reconfigure(config: MergeConfig) {
    if ("diffConfig" in config) {
      this.diffConf = config.diffConfig
    }
    if ("orientation" in config) {
      let aB = config.orientation != "b-a"
      if (aB != (this.editorDOM.firstChild == this.a.dom.parentNode)) {
        let domA = this.a.dom.parentNode as HTMLElement, domB = this.b.dom.parentNode as HTMLElement
        domA.remove()
        domB.remove()
        this.editorDOM.insertBefore(aB ? domA : domB, this.editorDOM.firstChild)
        this.editorDOM.appendChild(aB ? domB : domA)
        this.revertToLeft = !this.revertToLeft
        if (this.revertDOM) this.revertDOM.textContent = ""
      }
    }
    if ("revertControls" in config || "renderRevertControl" in config) {
      let controls = !!this.revertDOM, toA = this.revertToA, render = this.renderRevert
      if ("revertControls" in config) {
        controls = !!config.revertControls
        toA = config.revertControls == "b-to-a"
      }
      if ("renderRevertControl" in config) render = config.renderRevertControl
      this.setupRevertControls(controls, toA, render)
    }
    let highlight = "highlightChanges" in config, gutter = "gutter" in config, collapse = "collapseUnchanged" in config
    if (highlight || gutter || collapse) {
      let effectsA: StateEffect<unknown>[] = [], effectsB: StateEffect<unknown>[] = []
      if (highlight || gutter) {
        let currentConfig = this.a.state.facet(mergeConfig)
        let markGutter = gutter ? config.gutter !== false : currentConfig.markGutter
        let highlightChanges = highlight ? config.highlightChanges !== false : currentConfig.highlightChanges
        effectsA.push(configCompartment.reconfigure([
          mergeConfig.of({side: "a", sibling: () => this.b, highlightChanges, markGutter}),
          markGutter ? changeGutter : []
        ]))
        effectsB.push(configCompartment.reconfigure([
          mergeConfig.of({side: "b", sibling: () => this.a, highlightChanges, markGutter}),
          markGutter ? changeGutter : []
        ]))
      }
      if (collapse) {
        let effect = collapseCompartment.reconfigure(
          config.collapseUnchanged ? collapseUnchanged(config.collapseUnchanged) : [])
        effectsA.push(effect)
        effectsB.push(effect)
      }
      this.a.dispatch({effects: effectsA})
      this.b.dispatch({effects: effectsB})
    }
    this.scheduleMeasure()
  }

  private setupRevertControls(controls: boolean, toA: boolean, render: (() => HTMLElement) | undefined) {
    this.revertToA = toA
    this.revertToLeft = this.revertToA == (this.editorDOM.firstChild == this.a.dom.parentNode)
    this.renderRevert = render
    if (!controls && this.revertDOM) {
      this.revertDOM.remove()
      this.revertDOM = null
    } else if (controls && !this.revertDOM) {
      this.revertDOM = this.editorDOM.insertBefore(document.createElement("div"), this.editorDOM.firstChild!.nextSibling)
      this.revertDOM.addEventListener("mousedown", e => this.revertClicked(e))
      this.revertDOM.className = "cm-merge-revert"
    } else if (this.revertDOM) {
      this.revertDOM.textContent = ""
    }
  }

  private scheduleMeasure() {
    if (this.measuring < 0) {
      let win = (this.dom.ownerDocument.defaultView || window)
      this.measuring = win.requestAnimationFrame(() => {
        this.measuring = -1
        this.measure()
      })
    }
  }

  private measure() {
    updateSpacers(this.a, this.b, this.chunks)
    if (this.revertDOM) this.updateRevertButtons()
  }

  private updateRevertButtons() {
    let dom = this.revertDOM!, next = dom.firstChild as HTMLElement | null
    let vpA = this.a.viewport, vpB = this.b.viewport
    for (let i = 0; i < this.chunks.length; i++) {
      let chunk = this.chunks[i]
      if (chunk.fromA > vpA.to || chunk.fromB > vpB.to) break
      if (chunk.fromA < vpA.from || chunk.fromB < vpB.from) continue
      let top = this.a.lineBlockAt(chunk.fromA).top + "px"
      while (next && +(next.dataset.chunk!) < i) next = rm(next)
      if (next && next.dataset.chunk! == String(i)) {
        if (next.style.top != top) next.style.top = top
        next = next.nextSibling as HTMLElement | null
      } else {
        dom.insertBefore(this.renderRevertButton(top, i), next)
      }
    }
    while (next) next = rm(next)
  }

  private renderRevertButton(top: string, chunk: number) {
    let elt
    if (this.renderRevert) {
      elt = this.renderRevert()
    } else {
      elt = document.createElement("button")
      let text = this.a.state.phrase("Revert this chunk")
      elt.setAttribute("aria-label", text)
      elt.setAttribute("title", text)
      elt.textContent = this.revertToLeft ? "⇜" : "⇝"
    }
    elt.style.top = top
    elt.setAttribute("data-chunk", String(chunk))
    return elt
  }

  private revertClicked(e: MouseEvent) {
    let target = e.target as HTMLElement | null, chunk
    while (target && target.parentNode != this.revertDOM) target = target.parentNode as HTMLElement | null
    if (target && (chunk = this.chunks[target.dataset.chunk as any])) {
      let [source, dest, srcFrom, srcTo, destFrom, destTo] = this.revertToA
        ? [this.b, this.a, chunk.fromB, chunk.toB, chunk.fromA, chunk.toA]
        : [this.a, this.b, chunk.fromA, chunk.toA, chunk.fromB, chunk.toB]
      let insert = source.state.sliceDoc(srcFrom, Math.max(srcFrom, srcTo - 1))
      if (srcFrom != srcTo && destTo <= dest.state.doc.length) insert += source.state.lineBreak
      dest.dispatch({
        changes: {from: destFrom, to: Math.min(dest.state.doc.length, destTo), insert},
        userEvent: "revert"
      })
      e.preventDefault()
    }
  }

  /// Destroy this merge view.
  destroy() {
    this.a.destroy()
    this.b.destroy()
    if (this.measuring > -1)
      (this.dom.ownerDocument.defaultView || window).cancelAnimationFrame(this.measuring)
    this.dom.remove()
  }
}

/// Accept all chunks in a merge view in a single transaction.
/// This allows undoing all accepts as one operation and is more efficient
/// than accepting chunks individually.
export function acceptAllChunks(mergeView: MergeView, direction: "a-to-b" | "b-to-a" = "a-to-b") {
  const chunks = mergeView.chunks;
  if (!chunks || chunks.length === 0) return false;
  
  const [source, dest] = direction === "a-to-b" 
    ? [mergeView.a, mergeView.b] 
    : [mergeView.b, mergeView.a];
  
  let changes: {from: number, to: number, insert: string}[] = [];
  
  // Process chunks in reverse order to maintain correct positions
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const [srcFrom, srcTo, destFrom, destTo] = direction === "a-to-b"
      ? [chunk.fromA, chunk.toA, chunk.fromB, chunk.toB]
      : [chunk.fromB, chunk.toB, chunk.fromA, chunk.toA];
    
    let insert = source.state.sliceDoc(srcFrom, Math.max(srcFrom, srcTo - 1));
    if (srcFrom != srcTo && destTo <= dest.state.doc.length) {
      insert += source.state.lineBreak;
    }
    
    changes.push({
      from: destFrom,
      to: Math.min(dest.state.doc.length, destTo),
      insert
    });
  }
  
  // Apply all changes in a single transaction
  dest.dispatch({
    changes,
    userEvent: "revert.all"
  });
  
  return true;
}

function rm(elt: HTMLElement) {
  let next = elt.nextSibling
  elt.remove()
  return next as HTMLElement | null
}
