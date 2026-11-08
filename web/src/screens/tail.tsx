// The Live tail: core NATS messages on a subject filter as they are published,
// fed by a "tail:<filter>" topic on the live socket. The backend caps the rate
// and holds payloads up to a memory budget; opening a row fetches its payload.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { CircleAlert, Funnel, X } from "lucide-react"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { CopyCli } from "@/components/copy-cli"
import { FilterField, FilterForm } from "@/components/filter-field"
import { ScreenHeader } from "@/components/screen-header"
import { Button } from "@/components/ui/button"
import { refKey, useActiveContext } from "@/contexts"
import { TopicTailPrefix, type Tail, type TailRow } from "@/gen/api"
import { announce, PauseLive, subscribe, usePaused } from "@/live"
import { bytes } from "@/screens/overview"
import { shellQuote } from "@/stream-config"
import { add, emptyRing, type Entry } from "@/tail-ring"

const ROW = 24
const RATE_CAP = 1000 // the backend's token bucket, per second
const FRESH_MS = 1500 // how long a new row stays highlighted

export function TailScreen() {
  const { subject } = useSearch({ from: "/tail" })
  const navigate = useNavigate()
  const { data: active } = useActiveContext()
  const ctx = active?.context ? refKey(active.context) : ""
  const form = <SubjectForm key={subject} value={subject ?? ""} onApply={(s) => void navigate({ to: "/tail", search: s ? { subject: s } : {} })} />
  return (
    <>
      <ScreenHeader title="Live tail" />
      <div className="flex h-[calc(100vh-8.5rem)] min-h-100 gap-4 px-8 pb-8">
        {subject ? (
          <TailView key={`${ctx} ${subject}`} filter={subject} form={form} />
        ) : (
          <section aria-label="Live tail" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
            <Toolbar dot="bg-fg-faint">{form}</Toolbar>
            <p className="grid flex-1 place-items-center px-8 text-center text-xs text-fg-faint">
              Enter a subject filter to watch messages as they are published. Use * for one token and &gt; for the rest, as in orders.&gt;.
            </p>
          </section>
        )}
      </div>
    </>
  )
}

function Toolbar({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
      {children}
    </div>
  )
}

// Enter applies the filter; the Tail button shows while the typed filter is not the one tailed.
function SubjectForm({ value, onApply }: { value: string; onApply: (subject: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onApply(draft.trim())
      }}
    >
      <FilterField label="Subject filter" mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="orders.>" autoComplete="off" spellCheck={false} className="w-48" />
      {(draft.trim() !== value || !value) && (
        <Button type="submit" variant="ghost" size="sm" disabled={!draft.trim()}>
          Tail
        </Button>
      )}
    </form>
  )
}

function TailView({ filter, form }: { filter: string; form: ReactNode }) {
  const paused = usePaused()
  const [ring, setRing] = useState(emptyRing)
  const [stats, setStats] = useState<Tail>()
  const [error, setError] = useState("")
  const behind = useRef(false) // a gap marker came; the next rows follow the gap
  useEffect(
    () =>
      subscribe(TopicTailPrefix + filter, (f) => {
        if (f.error) setError(f.error)
        if (f.gap) behind.current = true
        const t = f.tail
        if (!t) return
        const b = t.rows.length > 0 && behind.current
        if (t.rows.length) behind.current = false
        setRing((r) => add(r, t, b, Date.now()))
        setStats(t)
      }),
    [filter],
  )
  const problem = error || stats?.problem
  useEffect(() => {
    if (problem) announce(problem)
  }, [problem])
  const disconnects = stats?.disconnects ?? 0
  useEffect(() => {
    if (disconnects) announce("The server closed the Live tail's connection.")
  }, [disconnects])

  const [show, setShow] = useState("")
  const [open, setOpen] = useState<TailRow>()
  const visible = useMemo(
    () => (show ? ring.entries.filter((e) => !("row" in e) || e.row.subject.includes(show) || e.row.preview?.includes(show)) : ring.entries),
    [ring.entries, show],
  )
  const heldFrom = stats?.heldFrom ?? 0

  return (
    <>
      <section aria-label="Live tail" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <Toolbar dot={problem ? "bg-destructive" : paused ? "bg-warning" : "bg-success motion-safe:animate-pulse"}>
          {form}
          <PauseLive />
          <Button variant="ghost" size="sm" onClick={() => setRing((r) => ({ ...r, entries: [] }))}>
            Clear rows
          </Button>
          <FilterForm label="Show rows containing" icon={Funnel} value={show} onApply={setShow} placeholder="Show rows containing…" className="w-48" />
          <span className="flex-1" />
          {stats && <Meter t={stats} />}
          <CopyCli cmd={`nats sub ${shellQuote(filter)}`} compact />
        </Toolbar>
        {problem && (
          <p role="alert" className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <CircleAlert size={12} aria-hidden className="shrink-0" />
            {problem}
          </p>
        )}
        <Rows entries={visible} held={(r) => r.held && r.id >= heldFrom} open={open} onOpen={setOpen} filtered={!!show} />
      </section>
      {open && <Detail key={open.id} filter={filter} row={open} held={open.held && open.id >= heldFrom} onClose={() => setOpen(undefined)} />}
    </>
  )
}

// Meter shows the arrival rate against the cap, and every drop by its source.
function Meter({ t }: { t: Tail }) {
  const n = (v: number) => v.toLocaleString("en-US")
  const dropped = t.rateDrops + t.pendingDrops
  return (
    <span className="flex items-center gap-2 text-fg-faint">
      <span className="tabular-nums" title={`${n(t.received)} received`}>
        <span className="text-foreground">{n(t.rate)}</span> msgs/s
      </span>
      <span aria-hidden className="h-1 w-16 overflow-hidden rounded-full bg-accent">
        <span className={`block h-full ${t.rate > RATE_CAP ? "bg-warning" : "bg-primary"}`} style={{ width: `${Math.min(100, (t.rate / RATE_CAP) * 100)}%` }} />
      </span>
      <span>cap {n(RATE_CAP)}/s · keeps 10,000</span>
      <Badge tone={dropped ? "warning" : "muted"} title="Over the rate cap of 1,000 per second, or dropped by the NATS client because the tail's pending buffer was full">
        {n(t.rateDrops)} dropped by the rate cap
        {t.pendingDrops > 0 && ` · ${n(t.pendingDrops)} by the client pending limit`}
      </Badge>
      {t.disconnects > 0 && (
        <Badge tone="destructive" title="The number of messages missed while disconnected is not known">
          {n(t.disconnects)} server {t.disconnects === 1 ? "disconnect" : "disconnects"}
        </Badge>
      )}
    </span>
  )
}

// Rows is a windowed list, newest first. While scrolled down, new rows keep
// the view where it is.
function Rows({ entries, held, open, onOpen, filtered }: { entries: Entry[]; held: (r: TailRow) => boolean; open?: TailRow; onOpen: (r: TailRow) => void; filtered: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [vh, setVh] = useState(0)
  const [top, setTop] = useState(0)
  useLayoutEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setVh(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const newest = useRef<string>(undefined)
  useLayoutEffect(() => {
    const el = box.current!
    const was = newest.current
    newest.current = entries.at(-1)?.key
    if (!was || el.scrollTop === 0) return
    const i = entries.findLastIndex((e) => e.key === was)
    if (i >= 0 && i < entries.length - 1) {
      el.scrollTop += (entries.length - 1 - i) * ROW
      setTop(el.scrollTop)
    }
  }, [entries])

  const n = entries.length
  const first = Math.floor(top / ROW)
  const last = Math.min(n, first + Math.ceil(vh / ROW) + 1)
  const now = Date.now()
  const shown = []
  for (let i = first; i < last; i++) {
    const e = entries[n - 1 - i]
    shown.push(
      <div key={e.key} role="listitem" className="absolute inset-x-0" style={{ top: i * ROW, height: ROW }}>
        {"note" in e ? (
          <p className="flex h-full items-center truncate border-y border-dashed border-warning/40 bg-warning/10 px-3 text-[11.5px] text-warning">{e.note}</p>
        ) : (
          <RowButton row={e.row} held={held(e.row)} fresh={now - e.at < FRESH_MS} selected={open?.id === e.row.id} onOpen={onOpen} />
        )}
      </div>,
    )
  }
  return (
    <div ref={box} tabIndex={0} aria-label="Tailed messages, newest first, scrollable" className="relative min-h-0 flex-1 overflow-y-auto" onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      {n === 0 && <p className="px-4 py-8 text-center text-xs text-fg-faint">{filtered ? "No rows match." : "Waiting for messages…"}</p>}
      <div role="list" aria-label="Tailed messages" style={{ height: n * ROW }}>
        {shown}
      </div>
    </div>
  )
}

// A new row fades from a tint when motion is allowed; with reduced motion it
// keeps the tint, unanimated, for as long as it is new.
function RowButton({ row, held, fresh, selected, onOpen }: { row: TailRow; held: boolean; fresh: boolean; selected: boolean; onOpen: (r: TailRow) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      aria-current={selected || undefined}
      className={`grid h-full w-full grid-cols-[6.5rem_minmax(8rem,14rem)_minmax(0,1fr)] items-center gap-3 px-3 text-left font-mono text-[11.5px] hover:bg-accent/40 ${selected ? "bg-accent" : fresh ? "motion-safe:animate-tail-in motion-reduce:bg-primary/5" : ""}`}
    >
      <span className="text-fg-faint tabular-nums">{new Date(row.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 })}</span>
      <span className="truncate text-primary">{row.subject}</span>
      <span className="truncate text-muted-foreground">
        {row.preview !== undefined ? row.preview || <i className="font-sans">empty</i> : <i className="font-sans">{!held ? "payload no longer held" : row.kind === "binary" ? `binary, ${bytes(row.size)}` : "open to see the payload"}</i>}
      </span>
    </button>
  )
}

function Detail({ filter, row, held, onClose }: { filter: string; row: TailRow; held: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["tail", filter, row.id],
    queryFn: ({ signal }) => api.tailMessage(filter, row.id, signal),
    enabled: held,
    staleTime: Infinity,
    retry: false,
  })
  const m = q.data
  const payload = m?.payload !== undefined && m.kind === "json" ? JSON.stringify(JSON.parse(m.payload), null, 2) : m?.payload
  const subhead = "mb-1.5 text-[11px] font-medium tracking-wide text-fg-faint uppercase"
  return (
    <aside aria-label="Message" className="w-95 shrink-0 space-y-4 overflow-auto rounded-xl border bg-card p-4 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-mono text-sm break-all text-primary">{row.subject}</h2>
          <p className="mt-0.5 text-muted-foreground">
            <time dateTime={row.time}>{new Date(row.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 })}</time> · {row.size.toLocaleString()} bytes
          </p>
          {row.reply && <p className="mt-0.5 font-mono break-all text-fg-faint">reply to {row.reply}</p>}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close message" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      {!held ? (
        <p className="text-muted-foreground">The tail no longer holds this payload. It drops the oldest payloads to stay within its memory budget, and keeps their rows.</p>
      ) : q.error ? (
        <p className="text-destructive">{q.error.message}</p>
      ) : !m ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div>
            <div className={subhead}>Headers</div>
            {m.headerValues ? (
              <table className="w-full">
                <tbody>
                  {Object.entries(m.headerValues).flatMap(([k, vs]) =>
                    vs.map((v, i) => (
                      <tr key={`${k}-${i}`} className="border-b border-border/60 last:border-0">
                        <td className="py-1 pr-3 align-top font-mono text-muted-foreground">{k}</td>
                        <td className="py-1 font-mono break-all">{v}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            ) : (
              <p className="text-fg-faint">No headers</p>
            )}
          </div>
          <div>
            <div className={subhead}>Payload</div>
            {payload !== undefined ? (
              <pre className="max-h-[60vh] overflow-auto rounded-lg border bg-background p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all">{payload || <i className="font-sans">empty</i>}</pre>
            ) : (
              <p className="text-muted-foreground">Binary payload, {bytes(row.size)}.</p>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
