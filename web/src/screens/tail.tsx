// The Live tail: core NATS messages on a subject filter as they are published,
// fed by a "tail:<filter>" topic on the live socket. The backend caps the rate
// and holds payloads up to a memory budget; opening a row fetches its payload.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { X } from "lucide-react"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { CopyCli } from "@/components/copy-cli"
import { ScreenHeader } from "@/components/screen-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { refKey, useActiveContext } from "@/contexts"
import { TopicTailPrefix, type Tail, type TailRow } from "@/gen/api"
import { announce, subscribe, usePaused } from "@/live"
import { bytes } from "@/screens/overview"
import { shellQuote } from "@/stream-config"
import { add, emptyRing, type Entry } from "@/tail-ring"

const ROW = 28
const RATE_CAP = 1000 // the backend's token bucket, per second
const FRESH_MS = 1500 // how long a new row stays highlighted

export function TailScreen() {
  const { subject } = useSearch({ from: "/tail" })
  const navigate = useNavigate()
  const { data: active } = useActiveContext()
  const ctx = active?.context ? refKey(active.context) : ""
  return (
    <>
      <ScreenHeader title="Live tail">
        <LiveOrPaused />
      </ScreenHeader>
      <div className="space-y-4 px-8 pb-8">
        <SubjectForm key={subject} value={subject ?? ""} onApply={(s) => void navigate({ to: "/tail", search: s ? { subject: s } : {} })} />
        {subject ? (
          <TailView key={`${ctx} ${subject}`} filter={subject} />
        ) : (
          <p className="text-muted-foreground">Enter a subject filter to watch messages as they are published. Use * for one token and &gt; for the rest, as in orders.&gt;.</p>
        )}
      </div>
    </>
  )
}

function LiveOrPaused() {
  return <p className="text-xs text-muted-foreground">{usePaused() ? <span className="text-warning">Paused</span> : "Live"}</p>
}

function SubjectForm({ value, onApply }: { value: string; onApply: (subject: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onApply(draft.trim())
      }}
    >
      <label htmlFor="tail-subject" className="shrink-0 text-xs text-muted-foreground">
        Subject filter
      </label>
      <Input id="tail-subject" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="orders.> or orders.*.new" className="w-64 font-mono" />
      <Button type="submit" variant="outline">
        Tail
      </Button>
      {value && <CopyCli cmd={`nats sub ${shellQuote(value)}`} />}
    </form>
  )
}

function TailView({ filter }: { filter: string }) {
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
      {stats && <Meter t={stats} />}
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      <div className="flex items-center gap-2">
        <label htmlFor="tail-show" className="shrink-0 text-xs text-muted-foreground">
          Show rows containing
        </label>
        <Input id="tail-show" value={show} onChange={(e) => setShow(e.target.value)} placeholder="text in the subject or payload" className="w-64" />
        <Button variant="ghost" onClick={() => setRing((r) => ({ ...r, entries: [] }))}>
          Clear
        </Button>
      </div>
      <div className="flex min-h-0 gap-4">
        <Rows entries={visible} held={(r) => r.held && r.id >= heldFrom} open={open} onOpen={setOpen} filtered={!!show} />
        {open && <Detail key={open.id} filter={filter} row={open} held={open.held && open.id >= heldFrom} onClose={() => setOpen(undefined)} />}
      </div>
    </>
  )
}

// Meter shows the arrival rate against the cap, and every drop by its source.
function Meter({ t }: { t: Tail }) {
  const n = (v: number) => v.toLocaleString("en-US")
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          <span className="font-semibold">{n(t.rate)}</span> msgs/s
        </span>
        <span aria-hidden className="h-1.5 w-24 overflow-hidden rounded bg-muted">
          <span className={`block h-full ${t.rate > RATE_CAP ? "bg-warning" : "bg-primary"}`} style={{ width: `${Math.min(100, (t.rate / RATE_CAP) * 100)}%` }} />
        </span>
        <span className="text-muted-foreground">shows up to {n(RATE_CAP)}/s, keeps the last 10,000 rows</span>
      </div>
      <span className="text-muted-foreground tabular-nums">{n(t.received)} received</span>
      <span className="flex items-center gap-1.5">
        <Badge tone={t.rateDrops ? "warning" : "muted"} title="Messages over the rate cap of 1,000 per second">
          {n(t.rateDrops)} dropped by the rate cap
        </Badge>
        <Badge tone={t.pendingDrops ? "warning" : "muted"} title="Messages the NATS client dropped because the tail's pending buffer was full">
          {n(t.pendingDrops)} dropped by the client pending limit
        </Badge>
        {t.disconnects > 0 && (
          <Badge tone="destructive" title="The number of messages missed while disconnected is not known">
            {n(t.disconnects)} server {t.disconnects === 1 ? "disconnect" : "disconnects"}
          </Badge>
        )}
      </span>
    </div>
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
          <p className="flex h-full items-center truncate border-y border-dashed border-warning/40 bg-warning/10 px-3 text-xs text-warning">{e.note}</p>
        ) : (
          <RowButton row={e.row} held={held(e.row)} fresh={now - e.at < FRESH_MS} selected={open?.id === e.row.id} onOpen={onOpen} />
        )}
      </div>,
    )
  }
  return (
    <div ref={box} tabIndex={0} aria-label="Tailed messages, newest first, scrollable" className="relative h-[min(60vh,40rem)] min-w-0 flex-1 overflow-y-auto rounded-xl border bg-card" onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      {n === 0 && <p className="px-4 py-8 text-center text-muted-foreground">{filtered ? "No rows match." : "Waiting for messages…"}</p>}
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
      className={`grid h-full w-full grid-cols-[6.5rem_minmax(8rem,16rem)_4.5rem_minmax(0,1fr)] items-center gap-3 border-b px-3 text-left font-mono text-xs hover:bg-accent ${selected ? "bg-accent" : ""} ${fresh ? "motion-safe:animate-tail-in motion-reduce:bg-primary/10" : ""}`}
    >
      <span className="text-muted-foreground tabular-nums">{new Date(row.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 })}</span>
      <span className="truncate">{row.subject}</span>
      <span className="text-right text-muted-foreground tabular-nums">{bytes(row.size)}</span>
      <span className="truncate text-muted-foreground">
        {row.preview !== undefined ? row.preview || <i className="font-sans">empty</i> : <i className="font-sans">{!held ? "payload no longer held" : row.kind === "binary" ? "binary" : "open to see the payload"}</i>}
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
  return (
    <aside aria-label="Message" className="w-[24rem] shrink-0 space-y-3 overflow-auto rounded-xl border bg-card p-4 text-xs">
      <div className="flex items-start justify-between gap-2">
        <h2 className="break-all font-mono text-sm font-semibold">{row.subject}</h2>
        <Button variant="ghost" size="sm" aria-label="Close message" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Received</dt>
        <dd className="font-mono">{new Date(row.time).toISOString()}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd>{bytes(row.size)}</dd>
        {row.reply && (
          <>
            <dt className="text-muted-foreground">Reply to</dt>
            <dd className="break-all font-mono">{row.reply}</dd>
          </>
        )}
      </dl>
      {!held ? (
        <p className="text-muted-foreground">The tail no longer holds this payload. It drops the oldest payloads to stay within its memory budget, and keeps their rows.</p>
      ) : q.error ? (
        <p className="text-destructive">{q.error.message}</p>
      ) : !m ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          {m.headerValues && (
            <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1">
              {Object.entries(m.headerValues).flatMap(([k, vs]) =>
                vs.map((v, i) => [
                  <dt key={`${k}-${i}-k`} className="truncate font-mono text-muted-foreground">
                    {k}
                  </dt>,
                  <dd key={`${k}-${i}-v`} className="break-all font-mono">
                    {v}
                  </dd>,
                ]),
              )}
            </dl>
          )}
          {payload !== undefined ? (
            <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted p-2 font-mono whitespace-pre-wrap break-all">{payload || <i className="font-sans">empty</i>}</pre>
          ) : (
            <p className="text-muted-foreground">Binary payload, {bytes(row.size)}.</p>
          )}
        </>
      )}
    </aside>
  )
}
