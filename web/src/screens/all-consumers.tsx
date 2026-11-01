// The Consumers screen: every consumer of every stream in one table, most lag
// first, so "is anything falling behind?" has one answer. Each row opens the
// consumer under its stream, where it is paused, edited or deleted.
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { Plus, Search } from "lucide-react"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { BlockedButton } from "@/components/blocked-button"
import { ScreenHeader } from "@/components/screen-header"
import { Input } from "@/components/ui/input"
import { useActiveContext, useBlockedReason } from "@/contexts"
import { count, LagBar, useAllConsumers } from "@/screens/overview"
import { Ago, useRefresh } from "@/screens/streams"

const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-fg-faint"
const td = "h-(--row-h) whitespace-nowrap px-3"
const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? "" : "s"}`

export function ConsumersScreen() {
  const { data: active } = useActiveContext()
  const noJs = active?.status === "connected" && !active.capabilities.jetStream
  const refresh = useRefresh()
  const list = useQuery({ queryKey: ["streams", "list", ""], queryFn: ({ signal }) => api.streams("", signal), refetchInterval: refresh, enabled: !noJs })
  const [natter, setNatter] = useState(false)
  const [q, setQ] = useState("")
  const streams = list.data?.streams ?? []
  const all = useAllConsumers(streams, refresh, natter)
  const needle = q.trim().toLowerCase()
  const rows = needle ? all.filter((c) => c.name.toLowerCase().includes(needle) || c.stream.toLowerCase().includes(needle) || c.filter.some((f) => f.toLowerCase().includes(needle))) : all
  const expected = streams.reduce((n, s) => n + s.consumers, 0)
  const lagging = all.filter((c) => c.pending > 0).length
  const now = Date.now() / 1000

  return (
    <>
      <ScreenHeader title="Consumers">
        {all.length > 0 && <Badge tone={lagging ? "warning" : "success"}>{lagging ? `${lagging} lagging` : "none lagging"}</Badge>}
        <NewConsumer streams={streams.map((s) => s.name)} />
      </ScreenHeader>
      <div className="space-y-3 px-8 pb-10">
        {noJs ? (
          <p className="text-sm text-muted-foreground">This Context has no JetStream, so it has no consumers.</p>
        ) : list.isError ? (
          <p className="text-destructive">{list.error.message}</p>
        ) : list.isPending || (expected > 0 && all.length === 0 && !natter) ? (
          <p className="text-muted-foreground">Loading consumers…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-72">
                <Search size={13} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-faint" />
                <Input aria-label="Filter consumers" placeholder="Filter by stream, consumer or subject" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 pl-8 text-xs md:text-xs" />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={natter} onChange={(e) => setNatter(e.target.checked)} />
                Show Natter's browsing consumers
              </label>
              <span className="ml-auto text-xs text-fg-faint">
                {rows.length === all.length ? plural(all.length, "consumer") : `${count(rows.length)} of ${count(all.length)}`} across {plural(new Set(all.map((c) => c.stream)).size, "stream")}
              </span>
            </div>
            {all.length === 0 ? (
              <div className="grid place-items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center text-xs text-muted-foreground">
                No consumers on any stream yet.
                {streams.length > 0 && <span>Use New consumer to add one.</span>}
              </div>
            ) : (
              <section aria-label="Consumers" className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      {["Consumer", "Stream", "Filter", "Ack", "Pending (lag)", "Ack pending", "Redelivered", "Waiting", "Last active"].map((h) => (
                        <th key={h} scope="col" className={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={`${c.stream}/${c.name}`} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                        <th scope="row" className={`${td} text-left font-normal`}>
                          <span className="flex items-center gap-2">
                            <Link to="/consumers/$stream/$consumer" params={{ stream: c.stream, consumer: c.name }} className="font-mono font-medium hover:underline">
                              {c.name}
                            </Link>
                            {c.paused && <Badge tone="warning">paused</Badge>}
                            {c.natter && <Badge tone="info">Natter browsing</Badge>}
                            {!c.durable && !c.natter && <Badge>ephemeral</Badge>}
                            {c.push && <Badge>push</Badge>}
                          </span>
                        </th>
                        <td className={`${td} font-mono text-muted-foreground`}>
                          <Link to="/streams/$stream/consumers" params={{ stream: c.stream }} className="hover:text-foreground hover:underline">
                            {c.stream}
                          </Link>
                        </td>
                        <td className={`${td} max-w-48 truncate font-mono text-muted-foreground`} title={c.filter.join(", ")}>
                          {c.filter.join(", ") || "all"}
                        </td>
                        <td className={`${td} text-muted-foreground`}>{c.ackPolicy}</td>
                        <td className={td}>
                          <LagBar n={c.pending} />
                        </td>
                        <td className={`${td} tabular-nums`}>{count(c.ackPending)}</td>
                        <td className={`${td} tabular-nums ${c.redelivered > 0 ? "text-warning" : ""}`}>{count(c.redelivered)}</td>
                        <td className={`${td} tabular-nums`}>{count(c.waiting)}</td>
                        <td className={`${td} text-muted-foreground`}>
                          <Ago time={c.lastActive} now={now} />
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                          No consumer matches “{q.trim()}”.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
      </div>
    </>
  )
}

// New consumer opens the form, which asks for the stream.
function NewConsumer({ streams }: { streams: string[] }) {
  const navigate = useNavigate()
  const blocked = useBlockedReason()
  return (
    <BlockedButton reason={blocked ?? (streams.length === 0 ? "Create a stream first." : undefined)} size="sm" onClick={() => void navigate({ to: "/consumers/new" })}>
      <Plus aria-hidden />
      New consumer
    </BlockedButton>
  )
}
