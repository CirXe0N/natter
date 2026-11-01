// Publish / request: send one message to a subject, or send it as a request and see the reply.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { BlockedButton } from "@/components/blocked-button"
import { CodeEditor } from "@/components/code-editor"
import { CopyCli } from "@/components/copy-cli"
import { ScreenHeader } from "@/components/screen-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useActiveContext, useBlockedReason } from "@/contexts"
import type { SendMode, SendRequest, SendResult, SendStatus } from "@/gen/api"
import { messageSize, sendCli } from "@/send"

type Entry = { id: number; at: Date; request: SendRequest; result?: SendResult; refused?: string }

// The history lives in the query cache so it survives leaving the screen, and a
// Context switch refetches it empty: it belongs to the Context that was active.
const historyKey = ["send", "history"] as const
const MAX_HISTORY = 50

const label = "text-xs font-medium text-muted-foreground"
const tones: Record<SendStatus, { tone: "success" | "warning" | "destructive" | "info"; text: string }> = {
  published: { tone: "info", text: "Published" },
  ok: { tone: "success", text: "Reply" },
  "no-responders": { tone: "warning", text: "No responders" },
  timeout: { tone: "warning", text: "Timeout" },
  error: { tone: "destructive", text: "Error" },
}
const explain: Partial<Record<SendStatus, string>> = {
  "no-responders": "The server answered 503: nothing is subscribed to this subject, so the request went nowhere.",
  timeout: "Something is subscribed, but no reply came before the timeout.",
}

function Segmented<T extends string>({ value, onChange, options, name }: { value: T; onChange: (v: T) => void; options: [T, string][]; name: string }) {
  return (
    <div role="group" aria-label={name} className="inline-flex gap-1">
      {options.map(([v, text]) => (
        <Button key={v} type="button" size="sm" variant={v === value ? "secondary" : "outline"} aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </Button>
      ))}
    </div>
  )
}

export function PublishScreen() {
  const qc = useQueryClient()
  const { data: active } = useActiveContext()
  const blocked = useBlockedReason()
  const [mode, setMode] = useState<SendMode>("pub")
  const [subject, setSubject] = useState("")
  const [timeoutMs, setTimeoutMs] = useState("2000")
  const [headers, setHeaders] = useState<[string, string][]>([])
  const [payload, setPayload] = useState("")
  const [format, setFormat] = useState<"json" | "text">("json")
  const [shown, setShown] = useState<number>()

  const history = useQuery({ queryKey: historyKey, queryFn: (): Entry[] => [], staleTime: Infinity })
  const entries = history.data ?? []
  const record = (e: Entry) => {
    qc.setQueryData<Entry[]>(historyKey, (old) => [e, ...(old ?? [])].slice(0, MAX_HISTORY))
    setShown(e.id)
  }

  const request: SendRequest = { mode, subject: subject.trim(), headers: headers.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]), payload, timeoutMs: mode === "req" ? Number(timeoutMs) || 0 : 0 }
  const send = useMutation({
    mutationFn: (r: SendRequest) => api.send(r),
    onSuccess: (result, r) => record({ id: Date.now(), at: new Date(), request: r, result }),
    onError: (err, r) => record({ id: Date.now(), at: new Date(), request: r, refused: err.message }),
  })

  const max = active?.maxPayload
  const size = messageSize(request.payload, request.headers)
  const over = max !== undefined && size > max
  const connected = active?.status === "connected"
  const jsonError = format === "json" && payload.trim() ? jsonProblem(payload) : undefined
  const invalid = !request.subject || over || !connected
  const cliContext = active?.context?.source === "cli" ? active.context.name : undefined
  const sel = entries.find((e) => e.id === shown) ?? entries[0]

  return (
    <>
      <ScreenHeader title="Publish / request">
        <CopyCli cmd={sendCli(request, cliContext)} />
      </ScreenHeader>
      <div className="grid gap-6 px-8 pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!invalid && !blocked) send.mutate(request)
          }}
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <span className={label}>Send as</span>
              <Segmented name="Send as" value={mode} onChange={setMode} options={[["pub", "Publish"], ["req", "Request"]]} />
            </div>
            <label className="flex min-w-48 flex-1 flex-col gap-1.5">
              <span className={label}>Subject</span>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="orders.eu.new" className="font-mono" autoComplete="off" spellCheck={false} />
            </label>
            {mode === "req" && (
              <label className="flex w-32 flex-col gap-1.5">
                <span className={label}>Timeout (ms)</span>
                <Input type="number" min={1} max={60000} value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} className="tabular-nums" />
              </label>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className={label}>Headers</legend>
            {headers.map(([k, v], i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label={`Header ${i + 1} name`} value={k} onChange={(e) => setHeaders(headers.map((h, j) => (j === i ? [e.target.value, h[1]] : h)))} placeholder="Name" className="font-mono" />
                <Input aria-label={`Header ${i + 1} value`} value={v} onChange={(e) => setHeaders(headers.map((h, j) => (j === i ? [h[0], e.target.value] : h)))} placeholder="Value" className="font-mono" />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove header ${i + 1}`} onClick={() => setHeaders(headers.filter((_, j) => j !== i))}>
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setHeaders([...headers, ["", ""]])}>
                <Plus aria-hidden /> Add header
              </Button>
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className={label}>Payload</span>
              <Segmented name="Payload mode" value={format} onChange={setFormat} options={[["json", "JSON"], ["text", "Text"]]} />
            </div>
            <CodeEditor value={payload} onChange={setPayload} mode={format} label="Payload" />
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <span className={jsonError ? "text-destructive" : "text-muted-foreground"}>{jsonError ?? (format === "json" && payload.trim() ? "Valid JSON" : "")}</span>
              <span role={over ? "alert" : undefined} className={`tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
                {size.toLocaleString()} B{max !== undefined && ` of ${max.toLocaleString()} B max_payload`}
                {over && ". Too large: nothing will be sent."}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <BlockedButton type="submit" reason={blocked} disabled={invalid || send.isPending}>
              {send.isPending ? "Sending…" : mode === "pub" ? "Publish message" : "Send request"}
            </BlockedButton>
            {!connected && <span className="text-xs text-muted-foreground">Connect a Context first.</span>}
          </div>
        </form>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Results">
          {sel ? <ResultView e={sel} /> : <p className="text-sm text-muted-foreground">Sends and their results show up here.</p>}
          {entries.length > 0 && (
            <section aria-label="History">
              <h2 className={`${label} mb-1.5`}>History (this session)</h2>
              <ul className="flex flex-col rounded-xl border bg-card text-xs">
                {entries.map((e) => (
                  <li key={e.id} className="border-b last:border-0">
                    <button type="button" aria-pressed={e.id === sel?.id} onClick={() => setShown(e.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent aria-pressed:bg-accent">
                      <span className="text-muted-foreground tabular-nums">{e.at.toLocaleTimeString()}</span>
                      <span className="text-muted-foreground">{e.request.mode === "pub" ? "pub" : "req"}</span>
                      <span className="min-w-0 flex-1 truncate font-mono">{e.request.subject}</span>
                      <StatusBadge e={e} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  )
}

function StatusBadge({ e }: { e: Entry }) {
  if (e.refused) return <Badge tone="destructive">Refused</Badge>
  const t = tones[e.result!.status]
  return <Badge tone={t.tone}>{t.text}</Badge>
}

function ResultView({ e }: { e: Entry }) {
  const r = e.result
  return (
    <section aria-label="Result" className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-xs">
      <div className="flex items-center gap-2">
        <StatusBadge e={e} />
        {r && <span className="text-muted-foreground tabular-nums">{r.latencyMs.toFixed(1)} ms</span>}
      </div>
      {e.refused && <p role="alert" className="text-destructive">{e.refused}</p>}
      {r && explain[r.status] && <p className="text-muted-foreground">{explain[r.status]}</p>}
      {r?.error && <p role="alert" className="text-destructive">{r.error}</p>}
      {r?.reply && (
        <>
          <dl className="font-mono">
            {r.reply.headers.map(([k, v], i) => (
              <div key={i} className="flex gap-2">
                <dt className="text-muted-foreground">{k}:</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
          <pre aria-label="Reply payload" className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-3 font-mono">{pretty(r.reply.payload)}</pre>
          <span className="text-muted-foreground">{r.reply.size.toLocaleString()} B from {r.reply.subject}</span>
        </>
      )}
    </section>
  )
}

function jsonProblem(s: string): string | undefined {
  try {
    JSON.parse(s)
  } catch (e) {
    return (e as Error).message
  }
}

function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}
