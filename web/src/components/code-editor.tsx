import { useEffect, useRef, type RefObject } from "react"
import { EditorView, basicSetup } from "codemirror"
import { json } from "@codemirror/lang-json"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { Compartment, EditorState } from "@codemirror/state"
import { tags } from "@lezer/highlight"

// JSON in the design tokens: keys teal, strings green, numbers blue, literals amber.
const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--primary)" },
  { tag: tags.string, color: "var(--success)" },
  { tag: tags.number, color: "var(--info)" },
  { tag: [tags.bool, tags.null], color: "var(--warning)" },
  { tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation], color: "var(--muted-foreground)" },
])

// A CodeMirror 6 editor. mode picks JSON highlighting or plain text. It keeps its
// own document and only takes `value` when it differs, so typing never loses the cursor.
// fill drops the border and grows to its container. viewRef hands out the view, to insert at the cursor.
export function CodeEditor({ value, onChange, mode, label, fill, viewRef }: { value: string; onChange: (v: string) => void; mode: "json" | "text"; label: string; fill?: boolean; viewRef?: RefObject<EditorView | null> }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const lang = useRef(new Compartment())
  const change = useRef(onChange)
  change.current = onChange

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          syntaxHighlighting(highlight),
          lang.current.of(mode === "json" ? json() : []),
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((u) => u.docChanged && change.current(u.state.doc.toString())),
          EditorView.theme({ "&": { backgroundColor: "transparent", color: "var(--foreground)", fontSize: "12px" }, ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--foreground)" }, ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", border: "none" }, ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--accent)" }, ".cm-scroller": fill ? { padding: "0.5rem 0" } : { minHeight: "10rem", maxHeight: "24rem" }, ...(fill && { "&": { height: "100%", backgroundColor: "transparent", color: "var(--foreground)", fontSize: "12.5px" }, "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "-2px" } }) }),
        ],
      }),
    })
    view.current = v
    if (viewRef) viewRef.current = v
    return () => v.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor is made once; value and mode are synced below
  }, [])

  useEffect(() => {
    const v = view.current!
    if (v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])
  useEffect(() => {
    view.current!.dispatch({ effects: lang.current.reconfigure(mode === "json" ? json() : []) })
  }, [mode])

  if (fill) return <div ref={host} className="h-full min-h-0" />
  return <div ref={host} className="overflow-hidden rounded-lg border border-input bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50" />
}
