import { useEffect, useRef } from "react"
import { EditorView, basicSetup } from "codemirror"
import { json } from "@codemirror/lang-json"
import { Compartment, EditorState } from "@codemirror/state"

// A CodeMirror 6 editor. mode picks JSON highlighting or plain text. It keeps its
// own document and only takes `value` when it differs, so typing never loses the cursor.
export function CodeEditor({ value, onChange, mode, label }: { value: string; onChange: (v: string) => void; mode: "json" | "text"; label: string }) {
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
          lang.current.of(mode === "json" ? json() : []),
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((u) => u.docChanged && change.current(u.state.doc.toString())),
          EditorView.theme({ "&": { backgroundColor: "transparent", color: "var(--foreground)", fontSize: "12px" }, ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--foreground)" }, ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", border: "none" }, ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--accent)" }, ".cm-scroller": { minHeight: "10rem", maxHeight: "24rem" } }),
        ],
      }),
    })
    view.current = v
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

  return <div ref={host} className="overflow-hidden rounded-lg border border-input bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50" />
}
