// The Consumers tab of a stream (a read-only table), and one consumer's
// page under /consumers, where it is paused, resumed, edited and deleted.
import { useId, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { CopyCli } from "@/components/copy-cli"
import { Pause, Pencil, Play, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useBlockedReason } from "@/contexts"
import type { ConsumerSummary } from "@/gen/api"
import { count } from "@/screens/overview"
import { useStream } from "@/screens/stream"
import { ScreenHeader } from "@/components/screen-header"
import { Ago, useRefresh } from "@/screens/streams"
import { Confirm } from "@/screens/stream-actions"

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
                      <Link to="/consumers/$stream/$consumer" params={{ stream, consumer: c.name }} className="font-mono hover:underline">
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
  const { stream, consumer } = useParams({ from: "/consumers/$stream/$consumer" })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const blocked = useBlockedReason()
  const [seconds, setSeconds] = useState(3600)
  const [confirming, setConfirming] = useState(false)
  const reason = useId()
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
      await navigate({ to: "/consumers" })
      done()
    },
  })
  const header = (
    <ScreenHeader title={<span className="font-mono">{consumer}</span>}>
      <Link to="/consumers" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
        All consumers
      </Link>
    </ScreenHeader>
  )
  if (error || !d)
    return (
      <>
        {header}
        <p className={`px-8 ${error ? "text-destructive" : "text-muted-foreground"}`}>{error ? error.message : "Loading consumer…"}</p>
      </>
    )
  const now = Date.now() / 1000
  const failure = pause.error ?? resume.error
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
  const block = { disabled: !!blocked, focusableWhenDisabled: true, "aria-describedby": blocked ? reason : undefined } as const
  const summary = [d.durable ? "Durable" : "Ephemeral", d.push ? "push" : "pull", `ack ${d.ackPolicy}`, d.filter.length ? `filter ${d.filter.join(", ")}` : "all subjects"]
  return (
    <>
      {header}
      <div className="space-y-5 px-8 pb-10">
        <section aria-label="Consumer" className="space-y-4 rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 font-mono text-sm font-semibold">
                <Link to="/streams/$stream" params={{ stream }} className="text-muted-foreground hover:text-foreground hover:underline">
                  {stream}
                </Link>
                <span className="text-muted-foreground">›</span> {d.name}
                {d.natter && <NatterBadge />}
                {d.paused && <PausedCell c={d} />}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{summary.join(" · ")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CopyCli cmd={`nats consumer info ${stream} ${d.name}`} compact />
              {d.paused ? (
                <Button variant="outline" size="sm" {...block} disabled={block.disabled || resume.isPending} onClick={() => resume.mutate()}>
                  <Play aria-hidden />
                  Resume
                </Button>
              ) : (
                <span className="flex items-center gap-1.5">
                  <label htmlFor="pause-for" className="sr-only">
                    Pause for
                  </label>
                  <select id="pause-for" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="h-7 rounded-md border bg-background px-2 text-xs">
                    {pauseFor.map((p) => (
                      <option key={p.seconds} value={p.seconds}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <Button variant="outline" size="sm" {...block} disabled={block.disabled || pause.isPending} onClick={() => pause.mutate()}>
                    <Pause aria-hidden />
                    Pause
                  </Button>
                </span>
              )}
              <Button variant="outline" size="sm" {...block} onClick={() => void navigate({ to: "/consumers/$stream/$consumer/edit", params: { stream, consumer: d.name } })}>
                <Pencil aria-hidden />
                Edit
              </Button>
              <Button variant="outline" size="sm" {...block} onClick={() => setConfirming(true)} className="border-destructive/30 text-destructive hover:bg-destructive/10">
                <Trash2 aria-hidden />
                Delete…
              </Button>
            </div>
          </div>
          {blocked && (
            <p id={reason} className="text-xs text-muted-foreground">
              {blocked}
            </p>
          )}
          {failure && (
            <p role="alert" className="text-xs text-destructive">
              {failure.message}
            </p>
          )}
          {d.paused && d.pauseUntil && <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">Paused until {new Date(d.pauseUntil).toLocaleString()}. It delivers nothing until then.</p>}
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
            {items.map(([k, v]) => (
              <div key={k} className="bg-card px-3 py-2.5">
                <dt className="text-[11px] text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
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
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete consumer {d.name}</DialogTitle>
              <DialogDescription>
                {d.pending > 0 || d.ackPending > 0
                  ? `It still has ${count(d.pending)} pending and ${count(d.ackPending)} awaiting ack. Deleting it forgets its position, and every client using it loses it.`
                  : "Every client using it loses it."}
              </DialogDescription>
            </DialogHeader>
            <Confirm name={d.name} verb="Delete consumer" danger="This cannot be undone." pending={remove.isPending} error={remove.error?.message} onConfirm={() => remove.mutate()}>
              <CopyCli cmd={`nats consumer rm ${stream} ${d.name} --force`} />
            </Confirm>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
}
