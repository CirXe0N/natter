// The Overview: "is this system healthy right now?". KPI tiles with 1-second
// sparklines and a servers table, fed by the overview topic on the live socket.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { TriangleAlert } from "lucide-react"

import { NotAvailable, sourceLabel } from "@/components/not-available"
import { ScreenHeader } from "@/components/screen-header"
import { TopicOverview, type Overview, type Series, type ServerSummary } from "@/gen/api"
import { announce, subscribe, usePaused } from "@/live"
import { unhealthy, useHealth } from "@/screens/health"
import { Ring } from "@/ring"

const allSeries: Series[] = ["connections", "msgsIn", "msgsOut", "bytesIn", "bytesOut", "slowConsumers"]

export function OverviewScreen() {
  const [rings] = useState(() => Object.fromEntries(allSeries.map((s) => [s, new Ring()])) as Record<Series, Ring>)
  const [ov, setOv] = useState<Overview>()
  useEffect(
    () =>
      subscribe(TopicOverview, ({ overview: o }) => {
        if (!o) return
        for (const s of allSeries) {
          if (o.history) rings[s].load(o.time, o.history[s])
          else rings[s].put(o.time, o.points[s])
        }
        setOv(o)
      }),
    [rings],
  )
  useThresholdAnnouncements(ov)

  return (
    <>
      <ScreenHeader title="Overview">
        <HealthIndicator />
        <Freshness ov={ov} />
      </ScreenHeader>
      <div className="space-y-5 px-8 pb-8">
        {!ov ? (
          <p className="text-muted-foreground">Waiting for the first sample…</p>
        ) : ov.source === "none" ? (
          <NotAvailable title="Server stats are not available" problem={ov.problem} />
        ) : (
          <>
            {ov.problem && <Warning>{ov.problem}</Warning>}
            {versions(ov.servers).length > 1 && <Warning>Servers run different versions: {versions(ov.servers).join(", ")}.</Warning>}
            <Kpis ov={ov} rings={rings} />
            <ServersTable ov={ov} />
          </>
        )}
      </div>
    </>
  )
}

function HealthIndicator() {
  const { data: h } = useHealth()
  if (!h?.servers.length) return null
  const bad = unhealthy(h).length
  return (
    <Link to="/health" className={`text-xs hover:underline ${bad ? "text-destructive" : "text-success"}`}>
      {bad ? `${bad} of ${h.servers.length} servers unhealthy` : "All servers healthy"}
    </Link>
  )
}

function Freshness({ ov }: { ov?: Overview }) {
  const paused = usePaused()
  if (!ov) return null
  const from = sourceLabel[ov.source]
  return (
    <p className="text-xs text-muted-foreground">
      {paused ? <span className="text-warning">Paused</span> : "Live"}
      {from && ` · ${from}`} · as of <time dateTime={new Date(ov.time * 1000).toISOString()}>{new Date(ov.time * 1000).toLocaleTimeString()}</time>
    </p>
  )
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
      <TriangleAlert size={13} aria-hidden />
      {children}
    </p>
  )
}

function Kpis({ ov, rings }: { ov: Overview; rings: Record<Series, Ring> }) {
  const p = ov.points
  const js = ov.jetStream
  const slow = p.slowConsumers ?? 0
  const tiles = [
    { label: "Servers", value: String(ov.servers.length), sub: ov.source === "monitoring" ? "the one behind the Monitoring URL" : undefined },
    { label: "Connections", value: count(p.connections), series: "connections" as const },
    { label: "Msgs in/s", value: count(p.msgsIn), series: "msgsIn" as const, sub: `out ${count(p.msgsOut)}/s` },
    { label: "Bytes in/s", value: bytes(p.bytesIn), series: "bytesIn" as const, sub: `out ${bytes(p.bytesOut)}/s` },
    { label: "Slow consumers", value: count(p.slowConsumers), series: "slowConsumers" as const, warn: slow > 0, sub: "since server start" },
    js
      ? { label: "JetStream storage", value: `${bytes(js.store)} of ${bytes(js.maxStore)}`, bar: pct(js.store, js.maxStore), sub: `memory ${bytes(js.memory)} of ${bytes(js.maxMemory)}` }
      : { label: "JetStream storage", value: "Not enabled" },
  ]
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border xl:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="bg-card p-3.5">
          <dt className="text-[11px] text-muted-foreground">{t.label}</dt>
          <dd className={`mt-1 text-xl font-semibold tabular-nums ${"warn" in t && t.warn ? "text-warning" : ""}`}>{t.value}</dd>
          {"series" in t && t.series && (
            <dd>
              <Sparkline ring={rings[t.series]} end={ov.time} warn={"warn" in t && t.warn} />
            </dd>
          )}
          {"bar" in t && t.bar !== undefined && (
            <dd className="mt-3 h-1.5 overflow-hidden rounded-full bg-accent" aria-hidden>
              <div className={`h-full rounded-full ${t.bar >= 90 ? "bg-warning" : "bg-primary"}`} style={{ width: `${t.bar}%` }} />
            </dd>
          )}
          {t.sub && <dd className="mt-1 text-[11px] text-fg-faint">{t.sub}</dd>}
        </div>
      ))}
    </dl>
  )
}

// The last WINDOW seconds of a ring as a line, broken where points are missing.
const WINDOW = 120
const H = 26

function Sparkline({ ring, end, warn }: { ring: Ring; end: number; warn?: boolean }) {
  const first = end - WINDOW + 1
  let max = 0
  for (let s = first; s <= end; s++) max = Math.max(max, ring.at(s) || 0)
  max = max * 1.1 || 1
  let d = ""
  let pen = false
  for (let i = 0; i < WINDOW; i++) {
    const v = ring.at(first + i)
    if (Number.isNaN(v)) {
      pen = false
      continue
    }
    d += `${pen ? "L" : "M"}${i} ${(H - (v / max) * H).toFixed(1)}`
    pen = true
  }
  return (
    <svg aria-hidden viewBox={`0 0 ${WINDOW - 1} ${H}`} preserveAspectRatio="none" className="mt-1.5 h-6.5 w-full">
      <path d={d} fill="none" stroke={warn ? "var(--warning)" : "var(--primary)"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function ServersTable({ ov }: { ov: Overview }) {
  const vs = versions(ov.servers)
  const usual = vs.length > 1 ? mostCommonVersion(ov.servers) : undefined
  const th = "px-3 py-2 text-left text-[11px] font-medium text-muted-foreground"
  const td = "h-(--row-h) px-3"
  return (
    <section aria-labelledby="servers-heading" className="overflow-hidden rounded-xl border bg-card">
      <h2 id="servers-heading" className="border-b px-4 py-2.5 text-[13px] font-medium">
        Servers
      </h2>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            {["Server", "Version", "Cluster", "Connections", "CPU", "Memory", "Uptime"].map((h) => (
              <th key={h} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ov.servers.map((s) => (
            <tr key={s.id} className="border-b last:border-0">
              <th scope="row" className={`${td} text-left font-mono font-normal`}>
                {s.name}
              </th>
              <td className={`${td} font-mono ${usual && s.version !== usual ? "text-warning" : ""}`}>{s.version}</td>
              <td className={`${td} text-muted-foreground`}>{s.cluster || "–"}</td>
              <td className={`${td} tabular-nums`}>{count(s.connections)}</td>
              <td className={`${td} tabular-nums`}>{s.cpu.toFixed(1)}%</td>
              <td className={`${td} tabular-nums`}>{bytes(s.mem)}</td>
              <td className={`${td} text-muted-foreground`}>{uptime(s.start, ov.time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// Threshold crossings for the status region. Each rule describes the current
// state in words, or "" when there is nothing to say; a new description is
// announced. Per-second counters never are.
const rules: ((o: Overview) => string)[] = [
  (o) => o.problem ?? "Server stats are available",
  (o) => `${o.servers.length} ${o.servers.length === 1 ? "server" : "servers"} answering`,
  (o) => (versions(o.servers).length > 1 ? `Servers run different versions: ${versions(o.servers).join(", ")}` : ""),
  (o) => ((o.points.slowConsumers ?? 0) > 0 ? `Slow consumers since server start: ${count(o.points.slowConsumers)}` : ""),
  (o) => (o.jetStream && pct(o.jetStream.store, o.jetStream.maxStore) >= 90 ? "JetStream storage is above 90% of its limit" : ""),
]

function useThresholdAnnouncements(ov?: Overview) {
  const said = useRef<string[]>(undefined)
  useEffect(() => {
    if (!ov) return
    const now = rules.map((r) => r(ov))
    if (said.current) now.forEach((m, i) => m && m !== said.current![i] && announce(m))
    said.current = now
  }, [ov])
}

function versions(servers: ServerSummary[]) {
  return [...new Set(servers.map((s) => s.version))].sort()
}

function mostCommonVersion(servers: ServerSummary[]) {
  const n = new Map<string, number>()
  for (const s of servers) n.set(s.version, (n.get(s.version) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1])[0][0]
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })

function count(v: number | null) {
  return v === null ? "–" : compact.format(v)
}

function bytes(v: number | null) {
  if (v === null) return "–"
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

function pct(used: number, max: number) {
  return max > 0 ? Math.min(100, (used / max) * 100) : 0
}

function uptime(start: string, now: number) {
  let s = Math.max(0, now - Math.floor(Date.parse(start) / 1000))
  const parts: string[] = []
  for (const [unit, size] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]] as const) {
    if (s >= size || unit === "s") parts.push(`${Math.floor(s / size)}${unit}`)
    s %= size
  }
  return parts.slice(0, 2).join(" ")
}
