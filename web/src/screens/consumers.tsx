// The Consumers tab of a stream, and one consumer's detail with pause, resume and delete.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { BlockedButton } from "@/components/blocked-button"
import { CopyCli } from "@/components/copy-cli"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useBlockedReason } from "@/contexts"
import type { ConsumerSummary } from "@/gen/api"
import { count } from "@/screens/overview"
import { useStream } from "@/screens/stream"
import { Ago, useRefresh } from "@/screens/streams"

const th = "px-3 py-2 text-left text-[11px] font-medium text-muted-foreground"
const td = "h-(--row-h) px-3"

function useConsumers(stream: string) {
  return useQuery({ queryKey: ["streams", "consumers", stream], queryFn: ({ signal }) => api.consumers(stream, signal), refetchInterval: useRefresh() })
}

// NatterBadge marks the browsing consumers Natter creates itself.
function NatterBadge() {
  return (
    <Badge tone="info" title="Created by Natter's message browser. The server removes it after its inactive threshold.">
      Natter browsing
    </Badge>
  )
}

// LagBar shows pending messages as a share of the stream.
function LagBar({ pending, total }: { pending: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (pending / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-accent">
        <div className={`h-full ${pct >= 50 ? "bg-warning" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`tabular-nums ${pending > 0 ? "" : "text-muted-foreground"}`}>{count(pending)}</span>
    </div>
  )
}

export function StreamConsumers() {
  const { stream } = useParams({ from: "/streams/$stream" })
  const { data: s } = useStream()
  const list = useConsumers(stream)
  if (list.error) return <p className="text-destructive">{list.error.message}</p>
  if (!list.data) return <p className="text-muted-foreground">Loading consumers…</p>
  const rows = list.data.consumers
  const offline = Object.entries(list.data.offline)
  const now = Date.now() / 1000
  return (
    <>
      <div>
        <CopyCli cmd={`nats consumer ls ${stream}`} />
      </div>
      {rows.length === 0 && offline.length === 0 ? (
        <p className="text-muted-foreground">This stream has no consumers.</p>
      ) : (
        <section aria-label="Consumers" className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                {["Name", "Filter", "Ack policy", "Pending (lag)", "Ack pending", "Redelivered", "Waiting", "Paused", "Last active"].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.name} className="border-b last:border-0">
                  <th scope="row" className={`${td} text-left font-normal`}>
                    <span className="flex items-center gap-2">
                      <Link to="/streams/$stream/consumers/$consumer" params={{ stream, consumer: c.name }} className="font-mono hover:underline">
                        {c.name}
                      </Link>
                      {c.natter && <NatterBadge />}
                    </span>
                  </th>
                  <td className={`${td} max-w-48 truncate font-mono text-muted-foreground`} title={c.filter.join(", ")}>
                    {c.filter.join(", ") || "all"}
                  </td>
                  <td className={td}>{c.ackPolicy}</td>
                  <td className={td}>
                    <LagBar pending={c.pending} total={s?.msgs ?? 0} />
                  </td>
                  <td className={`${td} tabular-nums`}>{count(c.ackPending)}</td>
                  <td className={`${td} tabular-nums ${c.redelivered > 0 ? "text-warning" : ""}`}>{count(c.redelivered)}</td>
                  <td className={`${td} tabular-nums`}>{count(c.waiting)}</td>
                  <td className={td}>
                    <PausedCell c={c} />
                  </td>
                  <td className={`${td} text-muted-foreground`}>
                    <Ago time={c.lastActive} now={now} />
                  </td>
                </tr>
              ))}
              {offline.map(([name, reason]) => (
                <tr key={name} className="border-b last:border-0">
                  <th scope="row" className={`${td} text-left font-mono font-normal`}>
                    {name}
                  </th>
                  <td colSpan={8} className={`${td} text-destructive`}>
                    Offline: {reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

function PausedCell({ c }: { c: ConsumerSummary }) {
  if (!c.paused) return <span className="text-muted-foreground">No</span>
  return (
    <Badge tone="warning" title={c.pauseUntil ? `Resumes at ${new Date(c.pauseUntil).toLocaleString()}` : undefined}>
      Paused
    </Badge>
  )
}

const pauseFor = [
  { label: "5 minutes", seconds: 300 },
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86400 },
]

// Config fields the server sends in nanoseconds.
const durations = new Set(["ack_wait", "idle_heartbeat", "inactive_threshold", "max_expires"])

function configValue(key: string, v: unknown) {
  if (durations.has(key) && typeof v === "number") return v === 0 ? "0 (none)" : `${v / 1e9}s`
  if (key === "backoff" && Array.isArray(v)) return v.map((n) => `${n / 1e9}s`).join(", ")
  return typeof v === "string" ? v : JSON.stringify(v)
}

export function ConsumerDetail() {
  const { stream, consumer } = useParams({ from: "/streams/$stream/consumers/$consumer" })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const blocked = useBlockedReason()
  const [seconds, setSeconds] = useState(3600)
  const [confirming, setConfirming] = useState(false)
  const { data: d, error } = useQuery({
    queryKey: ["streams", "consumer", stream, consumer],
    queryFn: ({ signal }) => api.consumer(stream, consumer, signal),
    refetchInterval: useRefresh(),
  })
  const done = () => qc.invalidateQueries({ queryKey: ["streams"] })
  const pause = useMutation({ mutationFn: () => api.pauseConsumer(stream, consumer, seconds), onSuccess: done })
  const resume = useMutation({ mutationFn: () => api.resumeConsumer(stream, consumer), onSuccess: done })
  const remove = useMutation({
    mutationFn: () => api.deleteConsumer(stream, consumer),
    onSuccess: async () => {
      setConfirming(false)
      await navigate({ to: "/streams/$stream/consumers", params: { stream } })
      done()
    },
  })
  if (error) return <p className="text-destructive">{error.message}</p>
  if (!d) return <p className="text-muted-foreground">Loading consumer…</p>
  const now = Date.now() / 1000
  const failure = pause.error ?? resume.error ?? remove.error
  const items: [string, React.ReactNode][] = [
    ["Pending (lag)", count(d.pending)],
    ["Ack pending", count(d.ackPending)],
    ["Redelivered", count(d.redelivered)],
    ["Waiting", count(d.waiting)],
    ["Delivered (stream seq)", d.delivered.stream.toLocaleString()],
    ["Ack floor (stream seq)", d.ackFloor.stream.toLocaleString()],
    ["Last active", <Ago time={d.lastActive} now={now} />],
    ["Created", <Ago time={d.created} now={now} />],
  ]
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/streams/$stream/consumers" params={{ stream }} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          All consumers
        </Link>
        <span className="font-mono text-sm">{d.name}</span>
        {d.natter && <NatterBadge />}
        {d.paused && <PausedCell c={d} />}
        {!d.durable && <Badge title="The server removes it after its inactive threshold.">Ephemeral</Badge>}
        {d.push && <Badge>Push</Badge>}
        <span className="flex-1" />
        <CopyCli cmd={`nats consumer info ${stream} ${d.name}`} />
      </div>
      {d.paused && d.pauseUntil && <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">Paused until {new Date(d.pauseUntil).toLocaleString()}. It delivers nothing until then.</p>}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k} className="bg-card px-3 py-2.5">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <section aria-label="Actions" className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3">
        {d.paused ? (
          <BlockedButton reason={blocked} variant="outline" disabled={resume.isPending} onClick={() => resume.mutate()}>
            Resume
          </BlockedButton>
        ) : (
          <>
            <label htmlFor="pause-for" className="text-xs text-muted-foreground">
              Pause for
            </label>
            <select id="pause-for" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="h-8 rounded-md border bg-background px-2 text-xs">
              {pauseFor.map((p) => (
                <option key={p.seconds} value={p.seconds}>
                  {p.label}
                </option>
              ))}
            </select>
            <BlockedButton reason={blocked} variant="outline" disabled={pause.isPending} onClick={() => pause.mutate()}>
              Pause
            </BlockedButton>
          </>
        )}
        <span className="flex-1" />
        <BlockedButton reason={blocked} variant="destructive" onClick={() => setConfirming(true)}>
          Delete…
        </BlockedButton>
        {failure && <p className="w-full text-xs text-destructive">{failure.message}</p>}
      </section>
      <dl className="divide-y overflow-hidden rounded-xl border bg-card text-xs">
        {Object.entries(d.config).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[14rem_1fr] gap-4 px-4 py-2">
            <dt className="font-mono text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words font-mono">{configValue(k, v)}</dd>
          </div>
        ))}
      </dl>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete consumer {d.name}?</DialogTitle>
            <DialogDescription>
              {d.pending > 0 || d.ackPending > 0
                ? `It still has ${count(d.pending)} pending and ${count(d.ackPending)} awaiting ack. Deleting it forgets its position and every client using it loses it. `
                : "Every client using it loses it. "}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete consumer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
