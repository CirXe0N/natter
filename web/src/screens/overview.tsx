// The Overview: "is this system healthy right now?". Stacked sections (Health,
// Servers, Busiest streams, Consumers with lag) under a sticky section bar that
// jumps between them and says what is still below the fold. KPI tiles and the
// servers table are fed by the overview topic on the live socket.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Activity, ArrowDown, ArrowRight, Boxes, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Layers, Server, TriangleAlert } from "lucide-react"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { NotAvailable, sourceLabel } from "@/components/not-available"
import { ScreenHeader } from "@/components/screen-header"
import { SecretBadge, useActiveContext } from "@/contexts"
import { TopicOverview, type ConsumerSummary, type Health, type Overview, type Series, type ServerSummary, type StreamSummary } from "@/gen/api"
import { announce, subscribe } from "@/live"
import { Ago, useRefresh } from "@/screens/streams"
import { Ring } from "@/ring"

const allSeries: Series[] = ["connections", "msgsIn", "msgsOut", "bytesIn", "bytesOut", "slowConsumers"]

type Tone = "ok" | "warn" | "bad" | "muted"
type Sec = { id: string; label: string; Icon: typeof Activity; status?: ReactNode }

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

  const active = useActiveContext().data
  const noJs = active?.status === "connected" && !active.capabilities.jetStream
  const refresh = useRefresh()
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: ({ signal }) => api.health(signal), refetchInterval: refresh })
  const list = useQuery({ queryKey: ["streams", "list", ""], queryFn: ({ signal }) => api.streams("", signal), refetchInterval: refresh, enabled: !noJs })
  const streams = (list.data?.streams ?? []).filter((s) => s.kind === "stream").sort((a, b) => b.msgs - a.msgs)
  const consumers = useAllConsumers(list.data?.streams ?? [], refresh)
  const lagging = consumers.filter((c) => c.pending > 0)
  const worst = lagging[0]

  const slow = ov?.points.slowConsumers ?? 0
  const bad = health?.servers.filter((s) => !s.healthy) ?? []
  const total = health?.servers.length ?? 0
  useEffect(() => {
    if (total) announce(bad.length ? `${bad.length} of ${total} servers unhealthy` : "All servers healthy")
  }, [bad.length, total])
  const sections: Sec[] = [
    {
      id: "health",
      label: "Health",
      Icon: Activity,
      status: !ov ? <Dot tone="muted" text="waiting" /> : ov.source === "none" ? <Dot tone="muted" text="no access" /> : slow > 0 ? <Dot tone="warn" text={`${count(slow)} slow ${slow === 1 ? "consumer" : "consumers"}`} /> : <Dot tone="ok" text="ok" />,
    },
    {
      id: "servers",
      label: "Servers",
      Icon: Server,
      status: !health?.servers.length ? <Dot tone="muted" text="no access" /> : bad.length ? <Dot tone="bad" text={`${bad.length} unhealthy`} /> : <Dot tone="ok" text="all ok" />,
    },
    { id: "streams", label: "Busiest streams", Icon: Layers, status: noJs ? <Dot tone="muted" text="no JetStream" /> : list.data && <span className="text-fg-faint">{streams.length}</span> },
    {
      id: "consumers",
      label: "Consumers with lag",
      Icon: Boxes,
      status: noJs ? <Dot tone="muted" text="no JetStream" /> : list.data && (lagging.length ? <Dot tone={worst.pending > 10_000 ? "bad" : "warn"} text={`${lagging.length} lagging`} /> : <Dot tone="ok" text="none" />),
    },
  ]
  const nav = useSectionNav(sections)

  return (
    <>
      <ScreenHeader title="Overview">{active?.context && <SecretBadge secret={active.context.secret} />}</ScreenHeader>
      <div className="px-8">
        <div ref={nav.barRef} className="sticky top-0 z-10 -mx-8 mb-5 border-b bg-background/85 px-8 py-2 backdrop-blur">
          <div className="flex items-center gap-1">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => nav.jump(s.id)}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition ${nav.current === s.id ? "bg-primary/10 text-foreground ring-1 ring-primary/25" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
              >
                <s.Icon size={13} aria-hidden className={nav.current === s.id ? "text-primary" : "text-fg-faint"} />
                {s.label}
                {s.status && <span className="text-[11px]">{s.status}</span>}
              </button>
            ))}
            <span className="ml-auto">
              <Freshness ov={ov} />
            </span>
          </div>
        </div>

        <div className="space-y-5 pb-28">
          <Section s={sections[0]} nav={nav} summary={ov && ov.source !== "none" && <>{count(ov.points.connections)} connections · {count(ov.points.msgsIn)} msg/s in</>}>
            <div className="space-y-3 p-4">
              {!ov ? (
                <p className="text-muted-foreground">Waiting for the first sample…</p>
              ) : ov.source === "none" ? (
                <NotAvailable title="Server stats are not available" problem={ov.problem} />
              ) : (
                <>
                  {ov.problem && <Warning>{ov.problem}</Warning>}
                  {versions(ov.servers).length > 1 && <Warning>Servers run different versions: {versions(ov.servers).join(", ")}.</Warning>}
                  <Kpis ov={ov} rings={rings} />
                </>
              )}
            </div>
          </Section>

          <Section
            s={sections[1]}
            nav={nav}
            summary={ov && ov.source !== "none" && <ServersSummary servers={ov.servers} bad={bad.map((b) => b.name)} />}
          >
            {!ov ? (
              <p className="p-4 text-muted-foreground">Waiting for the first sample…</p>
            ) : ov.source === "none" ? (
              <p className="p-4 text-xs text-muted-foreground">Needs System credentials or a Monitoring URL.</p>
            ) : (
              <ServersTable ov={ov} health={health} />
            )}
          </Section>

          <Section
            s={sections[2]}
            nav={nav}
            summary={streams[0] && <>busiest: <span className="font-mono text-foreground">{streams[0].name}</span> · {count(streams[0].msgs)} msgs</>}
            action={list.data && <ViewAll to="/streams">All {streams.length} streams</ViewAll>}
          >
            {noJs ? (
              <NoJetStream />
            ) : list.isError ? (
              <p className="p-4 text-destructive">{list.error.message}</p>
            ) : !list.data ? (
              <p className="p-4 text-muted-foreground">Loading streams…</p>
            ) : streams.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">This account has no streams.</p>
            ) : (
              <BusiestStreams streams={streams.slice(0, 5)} />
            )}
          </Section>

          <Section
            s={sections[3]}
            nav={nav}
            summary={
              worst && (
                <>
                  worst: <span className="font-mono text-foreground">{worst.stream} › {worst.name}</span>{" "}
                  <span className={worst.pending > 10_000 ? "text-destructive" : "text-warning"}>{count(worst.pending)} pending</span>
                </>
              )
            }
          >
            {noJs ? (
              <NoJetStream />
            ) : list.isError ? (
              <p className="p-4 text-destructive">{list.error.message}</p>
            ) : !list.data ? (
              <p className="p-4 text-muted-foreground">Loading consumers…</p>
            ) : consumers.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No stream has consumers.</p>
            ) : (
              <ConsumersWithLag consumers={consumers} />
            )}
          </Section>
        </div>
      </div>
      <MoreBelow nav={nav} />
    </>
  )
}

// Scroll spy for the section bar, and what is still below the fold for the "more below" pill.
function useSectionNav(sections: Sec[]) {
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const barRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [below, setBelow] = useState<Record<string, boolean>>({})
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const id = (e: IntersectionObserverEntry) => (e.target as HTMLElement).dataset.sec!
        setVisible((v) => ({ ...v, ...Object.fromEntries(entries.map((e) => [id(e), e.isIntersecting])) }))
        setBelow((b) => ({ ...b, ...Object.fromEntries(entries.map((e) => [id(e), !e.isIntersecting && e.boundingClientRect.top > 0])) }))
      },
      { rootMargin: "0px 0px -80px 0px" },
    )
    Object.values(refs.current).forEach((el) => el && io.observe(el))
    // How far the page still scrolls, so a section only partly on screen also counts.
    const sc = barRef.current?.closest("main")
    if (!sc) return () => io.disconnect()
    const upd = () => setRemaining(sc.scrollHeight - sc.scrollTop - sc.clientHeight)
    upd()
    sc.addEventListener("scroll", upd)
    const ro = new ResizeObserver(upd)
    ro.observe(sc)
    if (sc.firstElementChild) ro.observe(sc.firstElementChild)
    return () => {
      io.disconnect()
      sc.removeEventListener("scroll", upd)
      ro.disconnect()
    }
  }, [])
  const whollyBelow = sections.filter((s) => below[s.id])
  const cutOff = [...sections].reverse().find((s) => visible[s.id] && (refs.current[s.id]?.getBoundingClientRect().bottom ?? 0) > window.innerHeight)
  return {
    refs,
    barRef,
    current: sections.find((s) => visible[s.id])?.id,
    whollyBelow: whollyBelow.length > 0,
    hidden: remaining > 40 ? (whollyBelow.length ? whollyBelow : cutOff ? [cutOff] : []) : [],
    jump: (id: string) => refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }),
  }
}
type SectionNav = ReturnType<typeof useSectionNav>

function Section({ s, nav, summary, action, children }: { s: Sec; nav: SectionNav; summary?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section
      ref={(el) => {
        nav.refs.current[s.id] = el
      }}
      data-sec={s.id}
      aria-labelledby={`sec-${s.id}`}
      className="scroll-mt-16 overflow-hidden rounded-xl border border-primary/20 bg-card shadow-[0_8px_30px_-12px_color-mix(in_oklab,var(--primary)_8%,transparent)]"
    >
      <header className="flex items-center gap-3 border-b border-primary/10 bg-linear-to-r from-primary/5 to-transparent px-4 py-2.5">
        <ChevronRight size={14} aria-hidden className="text-primary" />
        <s.Icon size={13} aria-hidden className="text-primary/80" />
        <h2 id={`sec-${s.id}`} className="font-mono text-[13px] font-medium">
          {s.label}
        </h2>
        {summary && <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{summary}</div>}
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </header>
      {children}
    </section>
  )
}

// A bottom fade and a pill naming what is still below the fold. Shown only while something is.
function MoreBelow({ nav }: { nav: SectionNav }) {
  if (!nav.hidden.length) return null
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed right-0 bottom-0 left-58 z-10 h-28 bg-linear-to-t from-background via-background/70 to-transparent" />
      <button
        type="button"
        onClick={() => nav.jump(nav.hidden[0].id)}
        className="fixed bottom-6 left-[calc(50%+7.25rem)] z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-primary/30 bg-popover/95 px-4 py-2 text-xs shadow-xl backdrop-blur hover:border-primary/60"
      >
        <ArrowDown size={13} aria-hidden className="text-primary motion-safe:animate-bounce" />
        <span className="text-muted-foreground">{nav.whollyBelow ? "More below:" : "Continues below:"}</span>
        {nav.hidden.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-fg-faint">·</span>}
            <span className="text-foreground">{s.label}</span>
            {s.status && <span className="text-[11px]">{s.status}</span>}
          </span>
        ))}
      </button>
    </>
  )
}

function NoJetStream() {
  return <p className="p-4 text-xs text-muted-foreground">JetStream is not enabled for this account.</p>
}

const dotTone: Record<Tone, [string, string]> = {
  ok: ["bg-success", "text-success"],
  warn: ["bg-warning", "text-warning"],
  bad: ["bg-destructive", "text-destructive"],
  muted: ["bg-fg-faint", "text-fg-faint"],
}

function Dot({ tone, text }: { tone: Tone; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${dotTone[tone][1]}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${dotTone[tone][0]}`} />
      {text}
    </span>
  )
}

function ViewAll({ to, children }: { to: "/streams"; children: ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
      {children}
      <ArrowRight size={12} aria-hidden />
    </Link>
  )
}

function ServersSummary({ servers, bad }: { servers: ServerSummary[]; bad: string[] }) {
  const clusters = [...new Set(servers.map((s) => s.cluster).filter(Boolean))]
  return (
    <>
      {servers.length} {servers.length === 1 ? "server" : "servers"}
      {clusters.length === 1 && ` · cluster ${clusters[0]}`}
      {bad.length > 0 && <Badge tone="destructive">{bad.join(", ")} unhealthy</Badge>}
    </>
  )
}

function Freshness({ ov }: { ov?: Overview }) {
  if (!ov) return null
  const from = sourceLabel[ov.source]
  return (
    <p className="text-[11px] text-fg-faint">
      Live{from && ` · ${from}`} · as of <time dateTime={new Date(ov.time * 1000).toISOString()}>{new Date(ov.time * 1000).toLocaleTimeString()}</time>
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
    { label: "Msgs in/s", value: count(p.msgsIn), series: "msgsIn" as const },
    { label: "Msgs out/s", value: count(p.msgsOut), series: "msgsOut" as const },
    { label: "Bytes in/s", value: bytes(p.bytesIn), series: "bytesIn" as const, sub: `out ${bytes(p.bytesOut)}/s` },
    { label: "Connections", value: count(p.connections), series: "connections" as const },
    { label: "Slow consumers", value: count(p.slowConsumers), series: "slowConsumers" as const, warn: slow > 0, sub: "since server start" },
    js
      ? { label: "JetStream storage", value: `${bytes(js.store)} / ${bytes(js.maxStore)}`, bar: pct(js.store, js.maxStore), sub: `memory ${bytes(js.memory)} / ${bytes(js.maxMemory)}` }
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

const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-fg-faint"
const td = "h-(--row-h) whitespace-nowrap px-3"
const tr = "border-b border-border/60 last:border-0"

function Head({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b">
        {cols.map((h) => (
          <th key={h} scope="col" className={th}>
            {h}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function ServersTable({ ov, health }: { ov: Overview; health?: Health }) {
  const vs = versions(ov.servers)
  const usual = vs.length > 1 ? mostCommonVersion(ov.servers) : undefined
  const healthOf = new Map(health?.servers.map((h) => [h.id, h]))
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <Head cols={["Server", "Health", "Version", "Cluster", "Conns", "CPU", "Mem", "Uptime"]} />
        <tbody>
          {ov.servers.map((s) => {
            const h = healthOf.get(s.id)
            return (
              <tr key={s.id} className={tr}>
                <th scope="row" className={`${td} text-left font-normal`}>
                  <span className="inline-flex items-center gap-2 font-mono">
                    <Server size={13} aria-hidden className="text-fg-faint" />
                    {s.name}
                  </span>
                </th>
                <td className={td}>
                  {!h ? (
                    <span className="text-fg-faint">–</span>
                  ) : h.healthy ? (
                    <Badge tone="success">
                      <CircleCheck size={11} aria-hidden />
                      ok
                    </Badge>
                  ) : (
                    <Badge tone="destructive" title={h.errors.map((e) => e.error).join("\n")}>
                      <CircleAlert size={11} aria-hidden />
                      {h.errors[0]?.error ?? "unhealthy"}
                    </Badge>
                  )}
                </td>
                <td className={`${td} font-mono ${usual && s.version !== usual ? "text-warning" : ""}`}>{s.version}</td>
                <td className={`${td} text-muted-foreground`}>{s.cluster || "–"}</td>
                <td className={`${td} tabular-nums`}>{count(s.connections)}</td>
                <td className={`${td} tabular-nums`}>{s.cpu.toFixed(1)}%</td>
                <td className={`${td} tabular-nums`}>{bytes(s.mem)}</td>
                <td className={`${td} text-muted-foreground`}>{uptime(s.start, ov.time)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BusiestStreams({ streams }: { streams: StreamSummary[] }) {
  const now = Date.now() / 1000
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <Head cols={["Name", "Subjects", "Storage", "Messages", "Size", "Consumers", "Activity"]} />
        <tbody>
          {streams.map((s) => (
            <tr key={s.name} className={`${tr} hover:bg-accent/40`}>
              <th scope="row" className={`${td} text-left font-normal`}>
                <Link to="/streams/$stream" params={{ stream: s.name }} className="font-mono font-medium text-foreground hover:underline">
                  {s.name}
                </Link>
              </th>
              <td className={td}>
                <span className="flex flex-wrap gap-1">
                  {s.subjects.slice(0, 3).map((x) => (
                    <span key={x} className="rounded-md border bg-accent px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {x}
                    </span>
                  ))}
                  {s.subjects.length > 3 && <span className="text-fg-faint">+{s.subjects.length - 3}</span>}
                </span>
              </td>
              <td className={`${td} text-muted-foreground`}>
                {s.storage} · R{s.replicas}
              </td>
              <td className={`${td} tabular-nums`}>{count(s.msgs)}</td>
              <td className={`${td} tabular-nums`}>{bytes(s.bytes)}</td>
              <td className={`${td} tabular-nums`}>{s.consumers}</td>
              <td className={`${td} ${s.lastTime && now - Date.parse(s.lastTime) / 1000 < 5 ? "text-success" : "text-muted-foreground"}`}>
                <Ago time={s.lastTime} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export type StreamConsumer = ConsumerSummary & { stream: string }

// Every consumer of every stream that has any, most lag first. Natter's own
// browsing consumers are left out unless `natter` asks for them.
export function useAllConsumers(streams: StreamSummary[], refetchInterval: number | false, natter = false): StreamConsumer[] {
  const names = streams.filter((s) => s.consumers > 0).map((s) => s.name)
  return useQueries({
    queries: names.map((n) => ({ queryKey: ["streams", "consumers", n], queryFn: ({ signal }: { signal: AbortSignal }) => api.consumers(n, signal), refetchInterval })),
    combine: (results) =>
      results
        .flatMap((r, i) => (r.data?.consumers ?? []).map((c) => ({ ...c, stream: names[i] })))
        .filter((c) => natter || !c.natter)
        .sort((a, b) => b.pending - a.pending),
  })
}

function ConsumersWithLag({ consumers }: { consumers: StreamConsumer[] }) {
  const [all, setAll] = useState(false)
  const now = Date.now() / 1000
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <Head cols={["Stream", "Consumer", "Filter", "Ack", "Pending", "Ack pending", "Redelivered", "Waiting", "Last active"]} />
          <tbody>
            {(all ? consumers : consumers.slice(0, 5)).map((c) => (
              <tr key={`${c.stream}/${c.name}`} className={`${tr} hover:bg-accent/40`}>
                <td className={`${td} font-mono text-muted-foreground`}>{c.stream}</td>
                <th scope="row" className={`${td} text-left font-normal`}>
                  <span className="flex items-center gap-2">
                    <Link to="/consumers/$stream/$consumer" params={{ stream: c.stream, consumer: c.name }} className="font-mono font-medium hover:underline">
                      {c.name}
                    </Link>
                    {c.paused && <Badge tone="info">paused</Badge>}
                  </span>
                </th>
                <td className={`${td} max-w-48 truncate`} title={c.filter.join(", ")}>
                  <span className="rounded-md border bg-accent px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{c.filter.join(", ") || "all"}</span>
                </td>
                <td className={`${td} text-muted-foreground`}>{c.ackPolicy}</td>
                <td className={td}>
                  <LagBar n={c.pending} />
                </td>
                <td className={`${td} tabular-nums ${c.ackPending > 100 ? "text-warning" : ""}`}>{count(c.ackPending)}</td>
                <td className={`${td} tabular-nums ${c.redelivered > 0 ? "text-warning" : ""}`}>{count(c.redelivered)}</td>
                <td className={`${td} tabular-nums`}>{count(c.waiting)}</td>
                <td className={`${td} text-muted-foreground`}>
                  <Ago time={c.lastActive} now={now} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {consumers.length > 5 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="flex w-full items-center justify-center gap-1.5 border-t py-2 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        >
          <ChevronDown size={13} aria-hidden className={`transition ${all ? "rotate-180" : ""}`} />
          {all ? "Show top 5" : `Show ${consumers.length - 5} more`}
        </button>
      )}
    </>
  )
}

// Lag on a log scale: over 10k is bad, over 500 a warning.
export function LagBar({ n }: { n: number }) {
  const pct = Math.min(100, (Math.log10(n + 1) / 5) * 100)
  const tone = n > 10_000 ? "bg-destructive" : n > 500 ? "bg-warning" : "bg-success"
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-accent">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`tabular-nums ${n > 10_000 ? "text-destructive" : n === 0 ? "text-muted-foreground" : ""}`}>{count(n)}</span>
    </span>
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

export function count(v: number | null) {
  return v === null ? "–" : compact.format(v)
}

export function bytes(v: number | null) {
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

export function uptime(start: string, now: number) {
  let s = Math.max(0, now - Math.floor(Date.parse(start) / 1000))
  const parts: string[] = []
  for (const [unit, size] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]] as const) {
    if (s >= size || unit === "s") parts.push(`${Math.floor(s / size)}${unit}`)
    s %= size
  }
  return parts.slice(0, 2).join(" ")
}
