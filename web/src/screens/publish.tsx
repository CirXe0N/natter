// Publish / Request: a workbench that sends one message to a subject, or sends
// it as a request and shows the reply. The request bar holds the Example message
// being edited (load, save, copy to other Contexts), the editor its payload,
// headers and repeat or timeout, and the bottom panel the response and history.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { EditorView } from "codemirror"
import { ArrowLeftRight, Braces, CircleAlert, CircleCheck, Clock, Copy, Eye, Lock, Plus, Dices, Save, Send, Trash, Wand2, X } from "lucide-react"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { CodeEditor } from "@/components/code-editor"
import { CopyCli } from "@/components/copy-cli"
import { examplesKey, ExamplesPicker, ModeTag, TransferDialog } from "@/components/examples-picker"
import { ScreenHeader } from "@/components/screen-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useActiveContext, useSetSettings } from "@/contexts"
import type { Example, SendPreview, SendRequest, SendResult, SendStatus } from "@/gen/api"
import { bytes } from "@/screens/overview"
import { messageSize, sendCli } from "@/send"

type Draft = Omit<Example, "id" | "context">
type Entry = { id: number; at: Date; request: SendRequest; result?: SendResult; refused?: string }

const blank = (): Draft => ({ name: "Untitled", folder: "", mode: "pub", subject: "", headers: [], payload: "", timeoutMs: 2000 })
const fields = (d: Draft) => JSON.stringify([d.name, d.folder, d.mode, d.subject, d.headers, d.payload, d.timeoutMs ?? 0])

// The history lives in the query cache so it survives leaving the screen, and a
// Context switch refetches it empty: it belongs to the Context that was active.
const historyKey = ["send", "history"] as const
const MAX_HISTORY = 50

// natscli's template functions, inserted verbatim so "copy as CLI" sends the same thing.
const placeholders = [
  { insert: "{{Count}}", help: "message number in this run, from 1" },
  { insert: "{{ID}}", help: "a unique ID" },
  { insert: "{{TimeStamp}}", help: "current time, RFC 3339" },
  { insert: "{{Unix}}", help: "seconds since 1970, UTC" },
  { insert: "{{UnixNano}}", help: "nanoseconds since 1970, UTC" },
  { insert: "{{Time}}", help: "current time" },
  { insert: "{{Random 10 20}}", help: "random string, 10 to 20 characters" },
]

const statusText: Record<SendStatus, string> = { published: "published", ok: "reply", "no-responders": "no responders", timeout: "timeout", error: "error" }
const statusDot: Record<SendStatus, string> = { published: "bg-success", ok: "bg-success", "no-responders": "bg-warning", timeout: "bg-warning", error: "bg-destructive" }
const tabClass = "-mb-px border-b-2 px-1 pt-3 pb-2.5 text-[13px] border-transparent text-muted-foreground hover:text-foreground aria-selected:border-primary aria-selected:text-foreground"
const subhead = "mb-1.5 text-[11px] font-medium tracking-wide text-fg-faint uppercase"

export function PublishScreen() {
  const qc = useQueryClient()
  const { data: active } = useActiveContext()
  const setSettings = useSetSettings()
  const ctx = active?.context?.name ?? ""
  const readOnly = !!active?.context?.readOnly
  const connected = active?.status === "connected"

  const all = useQuery({ queryKey: examplesKey, queryFn: ({ signal }) => api.examples(signal) }).data ?? []
  const mine = all.filter((e) => e.context === ctx)
  const [selId, setSelId] = useState<string>()
  const [edit, setEdit] = useState<Draft>(blank)
  const [count, setCount] = useState("1")
  const [tab, setTab] = useState<"payload" | "headers" | "options">("payload")
  const [resTab, setResTab] = useState<"result" | "history">("result")
  const [previewing, setPreviewing] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [transfer, setTransfer] = useState<{ mode: "copy" | "import"; ids: string[] }>()
  const [confirm, setConfirm] = useState<{ title: string; body: ReactNode; action: string; run: () => void }>()
  const editor = useRef<EditorView>(null)

  // Examples belong to a Context: switching Context starts a new, unsaved message.
  const [ctxSeen, setCtxSeen] = useState(ctx)
  if (ctxSeen !== ctx) {
    setCtxSeen(ctx)
    setSelId(undefined)
    setEdit(blank())
  }
  const saved = mine.find((e) => e.id === selId)
  const dirty = !saved || fields(saved) !== fields(edit)
  const set = (p: Partial<Draft>) => setEdit((d) => ({ ...d, ...p }))
  const load = (e?: Example) => {
    setSelId(e?.id)
    setEdit(e ? { name: e.name, folder: e.folder, mode: e.mode, subject: e.subject, headers: e.headers, payload: e.payload, timeoutMs: e.timeoutMs || 2000 } : blank())
    setPreviewing(false)
    if (e) setRecent((r) => [e.id, ...r.filter((x) => x !== e.id)].slice(0, 5))
  }
  const pick = (e?: Example) =>
    saved && dirty ? setConfirm({ title: "Discard changes?", body: <>You have unsaved changes to {saved.name}.</>, action: "Discard", run: () => load(e) }) : load(e)

  const examplesDone = () => qc.invalidateQueries({ queryKey: examplesKey })
  const create = useMutation({ mutationFn: (d: Draft) => api.createExample({ ...d, context: ctx }), onSuccess: (e) => (setSelId(e.id), setEdit((d) => ({ ...d, name: e.name })), examplesDone()) })
  const update = useMutation({ mutationFn: (e: Example) => api.updateExample(e), onSuccess: examplesDone })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteExample(id), onSuccess: () => (load(undefined), examplesDone()) })
  const save = () => (saved ? update.mutate({ ...saved, ...edit }) : create.mutate(edit))
  const exampleError = [create, update, remove].find((m) => m.error)?.error?.message

  // Sending.
  const n = Math.max(1, Math.trunc(Number(count)) || 1)
  const request: SendRequest = { mode: edit.mode, subject: edit.subject.trim(), headers: edit.headers.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]), payload: edit.payload, timeoutMs: edit.mode === "req" ? edit.timeoutMs || 0 : 0, count: n }
  const history = useQuery({ queryKey: historyKey, queryFn: (): Entry[] => [], staleTime: Infinity })
  const entries = history.data ?? []
  const [shown, setShown] = useState<number>()
  const record = (e: Entry) => {
    qc.setQueryData<Entry[]>(historyKey, (old) => [e, ...(old ?? [])].slice(0, MAX_HISTORY))
    setShown(e.id)
    setResTab("result")
  }
  const send = useMutation({
    mutationFn: (r: SendRequest) => api.send(r),
    onSuccess: (result, r) => record({ id: Date.now(), at: new Date(), request: r, result }),
    onError: (err, r) => record({ id: Date.now(), at: new Date(), request: r, refused: err.message }),
  })

  // The server renders the Placeholders; the browser only asks, a moment after typing stops.
  const hasPlaceholder = [request.subject, request.payload, ...request.headers.map(([, v]) => v)].some((t) => t.includes("{{"))
  const [settled, setSettled] = useState(request)
  const requestKey = JSON.stringify(request)
  useEffect(() => {
    const t = setTimeout(() => setSettled(JSON.parse(requestKey)), 300)
    return () => clearTimeout(t)
  }, [requestKey])
  const preview = useQuery({ queryKey: ["send", "preview", settled], queryFn: ({ signal }) => api.sendPreview(settled, signal), enabled: hasPlaceholder, placeholderData: (p) => p })
  const pv = hasPlaceholder ? preview.data : undefined
  const badHeader = pv?.headerErrors.some(Boolean) ?? false

  const max = active?.maxPayload
  const size = messageSize(request.payload, request.headers)
  const over = max !== undefined && size > max
  const invalid = !request.subject || over || !connected || badHeader
  const blockedId = "publish-blocked"
  const doSend = () => !invalid && !readOnly && !send.isPending && send.mutate(request)
  const sendRef = useRef(doSend)
  sendRef.current = doSend
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation() // before the editor turns it into a new line
        sendRef.current()
      }
    }
    window.addEventListener("keydown", k, true)
    return () => window.removeEventListener("keydown", k, true)
  }, [])

  const json = jsonState(pv ? pv.payload : edit.payload, hasPlaceholder, !!pv?.payloadError)
  const insert = (token: string) => {
    const v = editor.current
    setPreviewing(false)
    if (!v) return set({ payload: edit.payload + token })
    const { from, to } = v.state.selection.main
    v.dispatch({ changes: { from, to, insert: token }, selection: { anchor: from + token.length } })
    v.focus()
  }
  const cliContext = active?.context?.source === "cli" ? active.context.name : undefined
  const sel = entries.find((e) => e.id === shown) ?? entries[0]
  const recentExamples = recent.map((id) => mine.find((e) => e.id === id)).filter((e) => !!e)
  const problems = [
    pv?.subjectError && placeholderProblem(pv.subjectError, "Subject"),
    ...(pv?.headerErrors ?? []).map((e, i) => e && placeholderProblem(e, `Header ${i + 1}`, true)),
    pv?.payloadError && placeholderProblem(pv.payloadError, "Payload"),
    over && `Too large: ${size.toLocaleString()} B is over this server's max_payload of ${max!.toLocaleString()} B. Nothing will be sent.`,
  ].filter((p): p is string => !!p)

  return (
    <>
      <ScreenHeader title="Publish / Request" />
      <div className="flex h-[calc(100vh-8.5rem)] min-h-150 flex-col gap-4 px-8 pb-8">
        {/* Request bar */}
        <section aria-label="Message" className="shrink-0 rounded-xl border bg-card">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
            <ExamplesPicker context={ctx} examples={mine} selected={selId} onPick={pick} onNew={() => pick(undefined)} onImport={() => setTransfer({ mode: "import", ids: [] })} />
            <span aria-hidden className="text-fg-faint">/</span>
            <input aria-label="Folder" value={edit.folder} onChange={(e) => set({ folder: e.target.value })} placeholder="No folder" className="h-7 w-28 rounded bg-transparent px-1 text-xs text-muted-foreground placeholder:text-fg-faint" />
            <span aria-hidden className="text-fg-faint">/</span>
            <input aria-label="Name" value={edit.name} onChange={(e) => set({ name: e.target.value })} className="h-7 min-w-0 flex-1 rounded bg-transparent px-1 text-sm font-medium" />
            {dirty && (
              <span className="flex items-center gap-1 text-[11px] whitespace-nowrap text-warning">
                <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                {saved ? "unsaved changes" : "not saved yet"}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={save} disabled={!dirty || !edit.name.trim() || !ctx || create.isPending || update.isPending}>
              <Save aria-hidden />
              Save
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Save as new example" title="Save as new example" disabled={!saved || !ctx} onClick={() => create.mutate({ ...edit, name: `${edit.name} (copy)` })}>
              <Copy aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" title="Copy to another Context" disabled={!saved} onClick={() => setTransfer({ mode: "copy", ids: saved ? [saved.id] : [] })}>
              <ArrowLeftRight aria-hidden />
              Copy to…
            </Button>
            {saved && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete example"
                title="Delete example"
                onClick={() => setConfirm({ title: "Delete example?", body: <>Delete {saved.name} from the examples on {ctx}?</>, action: "Delete", run: () => remove.mutate(saved.id) })}
              >
                <Trash aria-hidden />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="New example" title="New example" onClick={() => pick(undefined)}>
              <Plus aria-hidden />
            </Button>
          </div>

          <div className="flex items-center gap-3 px-4 py-3">
            <div role="group" aria-label="Send as" className="flex h-10 shrink-0 rounded-lg border p-0.5">
              {(["pub", "req"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={edit.mode === m}
                  onClick={() => set({ mode: m })}
                  className={`rounded-md px-3.5 text-xs font-medium ${edit.mode === m ? (m === "pub" ? "bg-success/15 text-success" : "bg-info/15 text-info") : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m === "pub" ? "Publish" : "Request"}
                </button>
              ))}
            </div>
            <input
              aria-label="Subject"
              value={edit.subject}
              onChange={(e) => set({ subject: e.target.value })}
              placeholder="subject, e.g. orders.created"
              autoComplete="off"
              spellCheck={false}
              className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3.5 font-mono text-sm placeholder:text-fg-faint focus-visible:border-primary/60"
            />
            <CopyCli cmd={sendCli(request, cliContext)} compact />
            <Button
              className="h-10 gap-2 px-5"
              disabled={invalid || readOnly || send.isPending}
              focusableWhenDisabled
              aria-describedby={readOnly ? blockedId : undefined}
              aria-label={edit.mode === "req" ? (n > 1 ? `Send ${n} requests` : "Send request") : n > 1 ? `Publish ${n} messages` : "Publish message"}
              title={!connected ? "Connect a Context first" : "Ctrl/⌘ + Enter"}
              onClick={doSend}
            >
              <Send aria-hidden />
              {send.isPending ? "Sending…" : edit.mode === "req" ? (n > 1 ? `Send ×${n}` : "Send") : n > 1 ? `Publish ×${n}` : "Publish"}
            </Button>
          </div>

          {readOnly && active?.context && (
            <div className="flex items-center gap-2 border-t border-warning/20 bg-warning/5 px-4 py-2 text-xs text-warning">
              <Lock size={12} aria-hidden className="shrink-0" />
              <span id={blockedId}>
                Read-only mode is on for this Context, so nothing is sent: publishes and requests are both blocked, because a request can change data in whichever service answers it.
              </span>
              <button
                type="button"
                onClick={() => setSettings.mutate({ c: active.context!, settings: { monitoringUrl: active.context!.monitoringUrl, readOnly: false } })}
                className="ml-auto rounded-md border border-warning/30 px-2 py-0.5 whitespace-nowrap hover:bg-warning/10"
              >
                Switch to Writable
              </button>
            </div>
          )}
          {!connected && <p className="border-t px-4 py-2 text-xs text-muted-foreground">Connect a Context first.</p>}
          {problems.map((p) => (
            <p key={p} role="alert" className="flex items-center gap-2 border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
              <CircleAlert size={12} aria-hidden className="shrink-0" />
              {p}
            </p>
          ))}
          {exampleError && (
            <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">
              {exampleError}
            </p>
          )}
          {recentExamples.length > 0 && (
            <div className="flex items-center gap-1.5 border-t border-border/60 px-4 py-2 text-[11px]">
              <span className="mr-1 text-fg-faint">Recent</span>
              {recentExamples.map((e) => (
                <button key={e.id} type="button" onClick={() => pick(e)} className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 ${selId === e.id ? "border-primary/40 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <ModeTag mode={e.mode} small />
                  {e.name}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Editor */}
        <section aria-label="Editor" className="flex min-h-0 flex-3 flex-col overflow-hidden rounded-xl border bg-card">
          <div role="tablist" aria-label="Editor" className="flex items-center gap-5 border-b px-4">
            <button type="button" role="tab" aria-selected={tab === "payload"} onClick={() => setTab("payload")} className={tabClass}>
              Payload
            </button>
            <button type="button" role="tab" aria-selected={tab === "headers"} onClick={() => setTab("headers")} className={tabClass}>
              Headers {edit.headers.length > 0 && <span className="ml-1 rounded bg-accent px-1.5 text-[10px]">{edit.headers.length}</span>}
            </button>
            <button type="button" role="tab" aria-selected={tab === "options"} onClick={() => setTab("options")} className={tabClass}>
              {edit.mode === "pub" ? "Repeat" : "Timeout"}{" "}
              <span className="ml-1 text-[11px] text-fg-faint">{edit.mode === "pub" ? `×${n}` : `${edit.timeoutMs || 0}ms${n > 1 ? ` ×${n}` : ""}`}</span>
            </button>
            {tab === "payload" && (
              <span className="ml-auto flex items-center gap-4 text-[11px]">
                <span className={json.ok ? "text-success" : "text-destructive"}>{json.msg}</span>
                <span className={`flex items-center gap-2 tabular-nums ${over ? "text-destructive" : "text-fg-faint"}`}>
                  {bytes(size)}
                  {max !== undefined && ` / ${bytes(max)}`}
                  {max !== undefined && (
                    <span aria-hidden className="h-1 w-16 overflow-hidden rounded-full bg-accent">
                      <span className={`block h-full ${over ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.min(100, (size / max) * 100)}%` }} />
                    </span>
                  )}
                </span>
                <button type="button" onClick={() => set({ payload: pretty(edit.payload) })} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  <Wand2 size={11} aria-hidden />
                  Prettify
                </button>
              </span>
            )}
            {tab === "headers" && (
              <button type="button" onClick={() => set({ headers: [...edit.headers, ["", ""]] })} className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                <Plus size={11} aria-hidden />
                Add header
              </button>
            )}
          </div>

          <div role="tabpanel" className="min-h-0 flex-1 overflow-auto">
            {tab === "payload" && (
              <div className="flex h-full flex-col">
                {previewing ? (
                  <PreviewPane p={pv} n={n} hasPlaceholder={hasPlaceholder} payload={edit.payload} onReroll={() => void preview.refetch()} />
                ) : (
                  <div className="min-h-0 flex-1">
                    <CodeEditor fill viewRef={editor} value={edit.payload} onChange={(payload) => set({ payload })} mode={/^\s*[[{]/.test(edit.payload) ? "json" : "text"} label="Payload" />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-4 py-2 text-[11px]">
                  <Braces size={12} aria-hidden className="text-fg-faint" />
                  <span className="mr-1 text-fg-faint">Insert</span>
                  {placeholders.map((p) => (
                    <button key={p.insert} type="button" title={p.help} onClick={() => insert(p.insert)} className="rounded-md border px-1.5 py-0.5 font-mono text-muted-foreground hover:border-primary/40 hover:text-primary">
                      {p.insert}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={previewing}
                    onClick={() => setPreviewing(!previewing)}
                    className={`ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 ${previewing ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Eye size={12} aria-hidden />
                    {previewing ? "Back to editing" : "Preview next send"}
                  </button>
                </div>
              </div>
            )}
            {tab === "headers" && <HeadersEditor headers={edit.headers} onChange={(headers) => set({ headers })} />}
            {tab === "options" && (
              <div className="flex flex-wrap items-center gap-2 p-4 text-xs text-muted-foreground">
                Send
                <input aria-label="Count" type="number" min={1} max={10000} value={count} onChange={(e) => setCount(e.target.value)} className="h-8 w-20 rounded-md border bg-background px-2.5 font-mono tabular-nums" />
                {n === 1 ? "time" : "times"}
                {edit.mode === "req" && (
                  <>
                    , waiting up to
                    <input
                      aria-label="Timeout (ms)"
                      type="number"
                      min={1}
                      max={60000}
                      value={edit.timeoutMs || ""}
                      onChange={(e) => set({ timeoutMs: Number(e.target.value) || 0 })}
                      className="h-8 w-24 rounded-md border bg-background px-2.5 font-mono tabular-nums"
                    />
                    ms for each reply
                  </>
                )}
                <span className="basis-full pt-1 text-fg-faint">{"{{Count}}"} runs from 1 to the count, as in nats pub --count.</span>
              </div>
            )}
          </div>
        </section>

        {/* Response */}
        <section aria-label="Response" className="flex min-h-0 flex-2 flex-col overflow-hidden rounded-xl border bg-card">
          <div role="tablist" aria-label="Response" className="flex items-center gap-5 border-b px-4">
            <button type="button" role="tab" aria-selected={resTab === "result"} onClick={() => setResTab("result")} className={tabClass}>
              Response
            </button>
            <button type="button" role="tab" aria-selected={resTab === "history"} onClick={() => setResTab("history")} className={tabClass}>
              History {entries.length > 0 && <span className="ml-1 rounded bg-accent px-1.5 text-[10px]">{entries.length}</span>}
            </button>
            <span className="ml-auto truncate text-[11px] text-fg-faint">
              {resTab === "history" ? `this session · ${ctx}` : sel ? `${sel.at.toLocaleTimeString()} · ${sel.request.subject}` : ""}
            </span>
          </div>
          <div role="tabpanel" className="min-h-0 flex-1 overflow-auto">
            {resTab === "result" &&
              (sel ? (
                <div className="p-4">
                  <ResultView e={sel} />
                </div>
              ) : (
                <p className="grid h-full place-items-center text-xs text-fg-faint">
                  <span>
                    Send something to see the response · <kbd className="font-mono">Ctrl/⌘ + Enter</kbd>
                  </span>
                </p>
              ))}
            {resTab === "history" && (
              <ul aria-label="History">
                {entries.length === 0 && <li className="p-4 text-xs text-fg-faint">Nothing sent yet</li>}
                {entries.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => (setShown(e.id), setResTab("result"))}
                      className="grid w-full grid-cols-[8px_6rem_2.5rem_1fr_7rem_5rem] items-center gap-3 border-b border-border/60 px-4 py-2 text-left text-xs hover:bg-accent/40"
                    >
                      <span aria-hidden className={`size-1.5 rounded-full ${e.result ? statusDot[e.result.status] : "bg-destructive"}`} />
                      <span className="text-fg-faint tabular-nums">{e.at.toLocaleTimeString()}</span>
                      <ModeTag mode={e.request.mode} small />
                      <span className="truncate font-mono">{e.request.subject}</span>
                      <span className="text-muted-foreground">{e.result ? statusText[e.result.status] : "refused"}</span>
                      <span className="text-right text-fg-faint tabular-nums">{e.result ? (e.request.count > 1 ? `×${e.result.sent}` : `${e.result.latencyMs.toFixed(1)}ms`) : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {transfer && <TransferDialog mode={transfer.mode} context={ctx} all={all} preselected={transfer.ids} onClose={() => setTransfer(undefined)} />}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(undefined)}>
        {confirm && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirm.title}</DialogTitle>
              <DialogDescription>{confirm.body}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(undefined)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => (confirm.run(), setConfirm(undefined))}>
                {confirm.action}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

function HeadersEditor({ headers, onChange }: { headers: [string, string][]; onChange: (h: [string, string][]) => void }) {
  const setAt = (i: number, h: [string, string]) => onChange(headers.map((x, j) => (j === i ? h : x)))
  if (!headers.length)
    return (
      <div className="p-4">
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-fg-faint">
          No headers.{" "}
          <button type="button" onClick={() => onChange([["", ""]])} className="text-muted-foreground underline-offset-2 hover:underline">
            Add one
          </button>
        </p>
      </div>
    )
  const row = "grid grid-cols-[40%_1fr_2.25rem] items-center"
  return (
    <div className="p-4">
      <div className="overflow-hidden rounded-lg border">
        <div className={`${row} border-b bg-accent/30 px-3 py-1.5 text-[11px] tracking-wide text-fg-faint uppercase`}>
          <span>Name</span>
          <span>Value</span>
          <span />
        </div>
        {headers.map(([k, v], i) => (
          <div key={i} className={`${row} border-b last:border-0`}>
            <input aria-label={`Header ${i + 1} name`} value={k} onChange={(e) => setAt(i, [e.target.value, v])} placeholder="Name" className="h-9 border-r bg-transparent px-3 font-mono text-xs placeholder:text-fg-faint" />
            <input aria-label={`Header ${i + 1} value`} value={v} onChange={(e) => setAt(i, [k, e.target.value])} placeholder="Value" className="h-9 bg-transparent px-3 font-mono text-xs placeholder:text-fg-faint" />
            <button type="button" aria-label={`Remove header ${i + 1}`} onClick={() => onChange(headers.filter((_, j) => j !== i))} className="grid h-9 place-items-center text-fg-faint hover:text-destructive">
              <X size={13} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// PreviewPane is message 1 as the server renders it.
function PreviewPane({ p, n, hasPlaceholder, payload, onReroll }: { p?: SendPreview; n: number; hasPlaceholder: boolean; payload: string; onReroll: () => void }) {
  return (
    <section aria-label="Preview" className="relative min-h-0 flex-1 overflow-auto bg-primary/[0.03]">
      <div className="sticky top-0 flex items-center gap-2 border-b border-primary/15 bg-card/90 px-4 py-1.5 text-[11px] text-primary backdrop-blur">
        <Eye size={12} aria-hidden />
        Preview of message 1{n > 1 ? ` of ${n}` : ""}. Every send renders fresh values.
        {hasPlaceholder && (
          <button type="button" onClick={onReroll} className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <Dices size={12} aria-hidden />
            Re-roll
          </button>
        )}
      </div>
      {p && (
        <div className="space-y-0.5 border-b border-border/60 px-4 py-2 font-mono text-xs">
          <div className="break-all">{p.subject}</div>
          {p.headers.map(([k, v], i) => (
            <div key={i} className="break-all text-muted-foreground">
              {k}: {v}
            </div>
          ))}
        </div>
      )}
      <pre aria-label="Preview payload" className="p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
        {(hasPlaceholder ? p?.payload : payload) || <span className="text-fg-faint">(empty)</span>}
      </pre>
    </section>
  )
}

function ResultView({ e }: { e: Entry }) {
  const r = e.result
  const at = <span className="text-fg-faint">at {e.at.toLocaleTimeString()}</span>
  const subject = <span className="font-mono text-primary">{e.request.subject}</span>
  const sentOf = r && e.request.count > 1 && <span className="text-fg-faint tabular-nums">{r.sent} of {e.request.count} sent</span>
  let body: ReactNode
  if (!r)
    body = (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-destructive">
          <CircleAlert size={14} aria-hidden />
          Refused before sending
        </div>
        <p role="alert" className="text-destructive">
          {e.refused}
        </p>
      </div>
    )
  else if (r.status === "published")
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <CircleCheck size={14} aria-hidden className="text-success" />
        Published {r.sent > 1 ? `${r.sent} messages` : "1 message"} to {subject} {at}
        <span className="text-fg-faint tabular-nums">· {r.latencyMs.toFixed(1)} ms</span>
        {sentOf}
      </div>
    )
  else if (r.status === "no-responders")
    body = (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-warning">
          <CircleAlert size={14} aria-hidden />
          No responders
        </div>
        <p className="text-muted-foreground">Nothing is subscribed to {subject} on this Context, so the server answered 503 straight away.</p>
      </div>
    )
  else if (r.status === "timeout")
    body = (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-warning">
          <Clock size={14} aria-hidden />
          Timed out after {e.request.timeoutMs} ms
        </div>
        <p className="text-muted-foreground">Something is subscribed, but no reply came before the timeout.</p>
      </div>
    )
  else
    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {r.status === "ok" ? <Badge tone="success">reply · {r.latencyMs.toFixed(1)} ms</Badge> : <Badge tone="destructive">error · {r.latencyMs.toFixed(1)} ms</Badge>}
          {r.reply && <span className="font-mono text-fg-faint">{r.reply.subject}</span>}
          {sentOf}
        </div>
        {r.error && (
          <p role="alert" className="text-destructive">
            {r.error}
          </p>
        )}
        {r.reply && (
          <>
            <div>
              <div className={subhead}>Headers</div>
              {r.reply.headers.length ? (
                <table className="w-full">
                  <tbody>
                    {r.reply.headers.map(([k, v], i) => (
                      <tr key={i} className="border-b border-border/60 last:border-0">
                        <td className="py-1 pr-3 font-mono text-muted-foreground">{k}</td>
                        <td className="py-1 font-mono break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-fg-faint">No headers</p>
              )}
            </div>
            <div>
              <div className={subhead}>
                Payload <span className="normal-case">· {r.reply.size.toLocaleString()} B</span>
              </div>
              <pre aria-label="Reply payload" className="max-h-72 overflow-auto rounded-lg border bg-background p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all">
                {pretty(r.reply.payload)}
              </pre>
            </div>
          </>
        )}
      </div>
    )
  return (
    <div role="region" aria-label="Result" className="text-xs">
      {body}
    </div>
  )
}

function placeholderProblem(text: string, where: string, fatal?: boolean) {
  return `${where}: Unknown or broken placeholder. ${text}. ${fatal ? "The send is refused until it is fixed." : "This text is sent as typed."}`
}

function jsonState(p: string, rendered: boolean, broken: boolean): { ok: boolean; msg: string } {
  if (broken) return { ok: false, msg: "Unknown or broken placeholder" }
  if (!p.trim()) return { ok: true, msg: "Empty payload" }
  if (!/^\s*[[{"]/.test(p)) return { ok: true, msg: "Text" }
  try {
    JSON.parse(p)
    return { ok: true, msg: rendered ? "Valid JSON after placeholders" : "Valid JSON" }
  } catch (e) {
    return { ok: false, msg: (e as Error).message.replace(/^JSON\.parse: /, "") }
  }
}

function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}
