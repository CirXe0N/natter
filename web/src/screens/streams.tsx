// Streams: every stream in the active Context's account, filterable by
// subject. Shared pieces for the stream detail screen live here too.
import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { CopyCli } from "@/components/copy-cli"
import { ScreenHeader } from "@/components/screen-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { StreamHealth, StreamKind, StreamSummary } from "@/gen/api"
import { usePaused } from "@/live"
import { bytes, count, uptime } from "@/screens/overview"

// Stream stats move, so lists and details refresh every 5 s unless paused.
export function useRefresh() {
  return usePaused() ? false : 5000
}

export function StreamsScreen() {
  const { subject = "" } = useSearch({ from: "/streams" })
  const list = useQuery({
    queryKey: ["streams", "list", subject],
    queryFn: ({ signal }) => api.streams(subject, signal),
    refetchInterval: useRefresh(),
    placeholderData: keepPreviousData,
  })
  const offline = Object.entries(list.data?.offline ?? {})

  return (
    <>
      <ScreenHeader title="Streams">
        <CopyCli cmd={`nats stream ls -a${subject ? ` --subject '${subject}'` : ""}`} />
      </ScreenHeader>
      <div className="space-y-4 px-8 pb-8">
        <SubjectFilter key={subject} value={subject} />
        {list.isError ? (
          <p className="text-destructive">{list.error.message}</p>
        ) : !list.data ? (
          <p className="text-muted-foreground">Loading streams…</p>
        ) : list.data.streams.length + offline.length === 0 ? (
          <p className="text-muted-foreground">{subject ? `No stream holds subjects matching ${subject}.` : "This account has no streams."}</p>
        ) : (
          <StreamsTable streams={list.data.streams} offline={offline} />
        )}
      </div>
    </>
  )
}

function SubjectFilter({ value }: { value: string }) {
  const navigate = useNavigate({ from: "/streams" })
  const [draft, setDraft] = useState(value)
  const apply = (subject: string) => void navigate({ search: subject ? { subject } : {}, replace: true })
  return (
    <form
      role="search"
      className="flex max-w-lg items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        apply(draft.trim())
      }}
    >
      <label htmlFor="stream-subject" className="shrink-0 text-xs text-muted-foreground">
        Subject
      </label>
      <Input id="stream-subject" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="orders.> or orders.*.new" className="font-mono" />
      <Button type="submit" variant="outline">
        Filter
      </Button>
      {value && (
        <Button type="button" variant="ghost" onClick={() => apply("")}>
          Clear
        </Button>
      )}
    </form>
  )
}

const th = "px-3 py-2 text-left text-[11px] font-medium text-muted-foreground"
const td = "h-(--row-h) px-3"

function StreamsTable({ streams, offline }: { streams: StreamSummary[]; offline: [string, string][] }) {
  const now = Date.now() / 1000
  return (
    <section aria-label="Streams" className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th scope="col" className={th}>
              <span className="sr-only">Health</span>
            </th>
            {["Name", "Subjects", "Storage", "Replicas", "Messages", "Size", "First", "Last", "Consumers", "Leader"].map((h) => (
              <th key={h} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {streams.map((s) => (
            <tr key={s.name} className="border-b last:border-0 hover:bg-accent">
              <td className={`${td} w-6`}>
                <HealthDot health={s.health} problem={s.problem} />
              </td>
              <th scope="row" className={`${td} text-left font-normal`}>
                <span className="flex items-center gap-2">
                  <Link to="/streams/$stream" params={{ stream: s.name }} className="font-mono text-foreground hover:underline">
                    {s.name}
                  </Link>
                  <KindBadge kind={s.kind} />
                </span>
              </th>
              <td className={`${td} max-w-64 truncate font-mono text-muted-foreground`} title={s.subjects.join(", ")}>
                {s.subjects.join(", ") || "–"}
              </td>
              <td className={`${td} text-muted-foreground`}>{s.storage}</td>
              <td className={`${td} tabular-nums`}>R{s.replicas}</td>
              <td className={`${td} tabular-nums`}>{count(s.msgs)}</td>
              <td className={`${td} tabular-nums`}>{bytes(s.bytes)}</td>
              <td className={`${td} text-muted-foreground`}>
                <Ago time={s.firstTime} now={now} />
              </td>
              <td className={`${td} text-muted-foreground`}>
                <Ago time={s.lastTime} now={now} />
              </td>
              <td className={`${td} tabular-nums`}>{s.consumers}</td>
              <td className={`${td} max-w-40 truncate font-mono text-muted-foreground`} title={s.leader}>
                {s.leader || "–"}
              </td>
            </tr>
          ))}
          {offline.map(([name, reason]) => (
            <tr key={name} className="border-b last:border-0">
              <td className={`${td} w-6`}>
                <HealthDot health="error" problem={reason} />
              </td>
              <th scope="row" className={`${td} text-left font-mono font-normal`}>
                {name}
              </th>
              <td colSpan={10} className={`${td} text-destructive`}>
                Offline: {reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

const dot: Record<StreamHealth, string> = { ok: "bg-success", warning: "bg-warning", error: "bg-destructive" }

export function HealthDot({ health, problem }: { health: StreamHealth; problem?: string }) {
  const label = problem || "Healthy"
  return <span role="img" aria-label={label} title={label} className={`inline-block size-2 rounded-full ${dot[health]}`} />
}

export function KindBadge({ kind }: { kind: StreamKind }) {
  if (kind === "kv") return <Badge tone="info">KV bucket</Badge>
  if (kind === "object") return <Badge tone="primary">Object Store</Badge>
  return null
}

// A past time as "3m 20s ago", with the exact time on hover.
export function Ago({ time, now }: { time?: string; now: number }) {
  if (!time) return <>–</>
  return (
    <time dateTime={time} title={new Date(time).toLocaleString()}>
      {uptime(time, now)} ago
    </time>
  )
}
