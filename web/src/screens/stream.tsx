// One stream: a header and tabs around an Outlet. Each tab is a child route
// of /streams/$stream in router.tsx plus one entry in `tabs` below.
import { useState, type ReactNode } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link, Outlet, useParams } from "@tanstack/react-router"
import { ChevronDown, ChevronRight, Funnel } from "lucide-react"

import { api } from "@/api"
import { FilterForm } from "@/components/filter-field"
import { ScreenHeader } from "@/components/screen-header"
import type { StreamDetail } from "@/gen/api"
import { bytes, count } from "@/screens/overview"
import { Ago, HealthDot, KindBadge, useRefresh } from "@/screens/streams"
import { StreamActions } from "@/screens/stream-actions"
import { subjectTree, type SubjectNode } from "@/subject-tree"

const tabs = [
  { to: "/streams/$stream", label: "Overview", exact: true },
  { to: "/streams/$stream/config", label: "Config", exact: false },
  { to: "/streams/$stream/consumers", label: "Consumers", exact: false },
  { to: "/streams/$stream/messages", label: "Messages", exact: false },
] as const

// useStream is the detail every tab shares, fetched once per stream.
export function useStream() {
  const { stream } = useParams({ from: "/streams/$stream" })
  return useStreamDetail(stream)
}

// useStreamDetail is one stream's detail by name, for screens outside /streams/$stream.
export function useStreamDetail(stream: string) {
  return useQuery({ queryKey: ["streams", "detail", stream], queryFn: ({ signal }) => api.stream(stream, signal), refetchInterval: useRefresh() })
}

export function StreamScreen() {
  const { stream } = useParams({ from: "/streams/$stream" })
  const { data: s } = useStream()
  return (
    <>
      <ScreenHeader
        title={
          <span className="flex items-center gap-2.5">
            {s && <HealthDot health={s.health} problem={s.problem} />}
            <span className="font-mono">{stream}</span>
            {s && <KindBadge kind={s.kind} />}
          </span>
        }
      >
        <Link to="/streams" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          All streams
        </Link>
        <StreamActions name={stream} />
      </ScreenHeader>
      <nav aria-label="Stream sections" className="flex gap-5 border-b px-8">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            params={{ stream }}
            activeOptions={{ exact: t.exact }}
            className="-mb-px border-b-2 border-transparent pb-2.5 text-[13px] text-muted-foreground hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-5 px-8 py-6">
        <Outlet />
      </div>
    </>
  )
}

// Loaded renders a tab's body once the shared detail has arrived.
function Loaded({ children }: { children: (s: StreamDetail) => ReactNode }) {
  const { data: s, error } = useStream()
  if (error) return <p className="text-destructive">{error.message}</p>
  if (!s) return <p className="text-muted-foreground">Loading stream…</p>
  return <>{children(s)}</>
}

export function StreamOverview() {
  return (
    <Loaded>
      {(s) => (
        <>
          {s.problem && <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">{s.problem}</p>}
          {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
          <Stats s={s} />
          <Replicas s={s} />
          <Sources s={s} />
          <Subjects s={s} />
        </>
      )}
    </Loaded>
  )
}

// maxMessage is the largest message the stream accepts: its own limit, or the
// server's max_payload when the stream sets none or a larger one.
function maxMessage(s: StreamDetail) {
  const own = Number(s.config.max_msg_size ?? -1)
  return own > 0 && own < s.maxPayload ? own : s.maxPayload
}

function Stats({ s }: { s: StreamDetail }) {
  const now = Date.now() / 1000
  const items: [string, ReactNode][] = [
    ["Messages", count(s.msgs)],
    ["Size", bytes(s.bytes)],
    ["First seq", s.firstSeq.toLocaleString()],
    ["Last seq", s.lastSeq.toLocaleString()],
    ["First message", <Ago time={s.firstTime} now={now} />],
    ["Last message", <Ago time={s.lastTime} now={now} />],
    ["Deleted", count(s.numDeleted)],
    ["Subjects", count(s.numSubjects)],
    ["Consumers", String(s.consumers)],
    ["Storage", `${s.storage} · R${s.replicas}`],
    ["Largest message", bytes(maxMessage(s))],
    ["Created", <Ago time={s.created} now={now} />],
  ]
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4 xl:grid-cols-6">
      {items.map(([k, v]) => (
        <div key={k} className="bg-card px-3 py-2.5">
          <dt className="text-[11px] text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const th = "px-3 py-2 text-left text-[11px] font-medium text-muted-foreground"
const td = "h-(--row-h) px-3"

// seconds turns the server's nanoseconds into "1.2s"; -1 means never.
function seconds(ns: number) {
  return ns < 0 ? "never" : `${(ns / 1e9).toFixed(1)}s`
}

function Section({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-xl border bg-card">
      <h2 id={id} className="flex items-center gap-3 border-b px-4 py-2.5 text-[13px] font-medium">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Replicas({ s }: { s: StreamDetail }) {
  return (
    <Section id="replicas-heading" title={<>Replicas{s.cluster && <span className="text-xs font-normal text-muted-foreground">cluster {s.cluster}</span>}</>}>
      {s.replicaState.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">The server reported no replica state.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              {["Server", "Role", "State", "Lag", "Last seen"].map((h) => (
                <th key={h} scope="col" className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.replicaState.map((r) => (
              <tr key={r.name} className="border-b last:border-0">
                <th scope="row" className={`${td} text-left font-mono font-normal`}>
                  {r.name}
                </th>
                <td className={td}>{r.leader ? "Leader" : "Follower"}</td>
                <td className={`${td} ${r.offline ? "text-destructive" : r.current ? "text-success" : "text-warning"}`}>
                  {r.offline ? "Offline" : r.current ? "Current" : "Behind"}
                </td>
                <td className={`${td} tabular-nums`}>{r.leader ? "–" : `${count(r.lag)} ops`}</td>
                <td className={`${td} text-muted-foreground`}>{r.leader ? "–" : `${seconds(r.active)} ago`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

function Sources({ s }: { s: StreamDetail }) {
  const rows = [...(s.mirror ? [{ ...s.mirror, role: "Mirror of" }] : []), ...s.sources.map((x) => ({ ...x, role: "Source" }))]
  if (rows.length === 0) return null
  return (
    <Section id="sources-heading" title={s.mirror ? "Mirror" : "Sources"}>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            {["Stream", "Role", "Filter", "Lag", "Last contact", "Error"].map((h) => (
              <th key={h} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.role}-${r.name}`} className="border-b last:border-0">
              <th scope="row" className={`${td} text-left font-normal`}>
                <Link to="/streams/$stream" params={{ stream: r.name }} className="font-mono hover:underline">
                  {r.name}
                </Link>
              </th>
              <td className={`${td} text-muted-foreground`}>{r.role}</td>
              <td className={`${td} font-mono text-muted-foreground`}>{r.filter || "–"}</td>
              <td className={`${td} tabular-nums ${r.lag > 0 ? "text-warning" : ""}`}>{count(r.lag)} msgs</td>
              <td className={`${td} text-muted-foreground`}>{r.active < 0 ? "never" : `${seconds(r.active)} ago`}</td>
              <td className={`${td} text-destructive`}>{r.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

function Subjects({ s }: { s: StreamDetail }) {
  const [filter, setFilter] = useState(">")
  const subs = useQuery({
    queryKey: ["streams", "subjects", s.name, filter],
    queryFn: ({ signal }) => api.streamSubjects(s.name, filter, signal),
    placeholderData: keepPreviousData,
  })
  const tree = subs.data ? subjectTree(subs.data.subjects) : []
  return (
    <Section id="subjects-heading" title="Subjects">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
        <FilterForm
          debounce
          value={filter === ">" ? "" : filter}
          onApply={(f) => setFilter(f || ">")}
          label="Filter"
          icon={Funnel}
          mono
          placeholder="Filter by subject, e.g. orders.>"
          autoComplete="off"
          spellCheck={false}
          className="w-64"
        />
      </div>
      {subs.isError ? (
        <p className="px-4 py-3 text-xs text-destructive">{subs.error.message}</p>
      ) : !subs.data ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">Loading subjects…</p>
      ) : tree.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">No messages on subjects matching {filter}.</p>
      ) : (
        <>
          {subs.data.truncated && (
            <p className="px-4 pt-3 text-xs text-warning">Showing the first {count(Object.keys(subs.data.subjects).length)} subjects. Narrow the filter to see the rest.</p>
          )}
          <ul className="px-2 py-2 text-xs">
            {tree.map((n) => (
              <SubjectRow key={n.subject} n={n} depth={0} />
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}

// Children render only when a node is open, and at most this many at once.
const shownChildren = 500

function SubjectRow({ n, depth }: { n: SubjectNode; depth: number }) {
  const [open, setOpen] = useState(false)
  const pad = { paddingLeft: `${depth * 16 + 8}px` }
  const label = (
    <>
      <span className="flex-1 truncate font-mono">{n.children.length ? `${n.token}.` : n.token}</span>
      <span className="tabular-nums text-muted-foreground">{n.total.toLocaleString()}</span>
    </>
  )
  return (
    <li>
      {n.children.length ? (
        <button type="button" aria-expanded={open} title={n.subject} onClick={() => setOpen(!open)} style={pad} className="flex h-(--row-h) w-full items-center gap-1.5 rounded-md pr-2 text-left hover:bg-accent">
          {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
          {label}
        </button>
      ) : (
        <div title={n.subject} style={pad} className="flex h-(--row-h) items-center gap-1.5 pr-2">
          <span className="w-3" />
          {label}
        </div>
      )}
      {open && (
        <ul>
          {n.own > 0 && (
            <li style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }} className="flex h-(--row-h) items-center gap-1.5 pr-2">
              <span className="w-3" />
              <span className="flex-1 font-mono text-muted-foreground">{n.subject} itself</span>
              <span className="tabular-nums text-muted-foreground">{n.own.toLocaleString()}</span>
            </li>
          )}
          {n.children.slice(0, shownChildren).map((c) => (
            <SubjectRow key={c.subject} n={c} depth={depth + 1} />
          ))}
          {n.children.length > shownChildren && (
            <li style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }} className="py-1 text-muted-foreground">
              {(n.children.length - shownChildren).toLocaleString()} more. Narrow the filter to see them.
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

// Config fields the server sends in nanoseconds.
const durations = new Set(["max_age", "duplicate_window", "subject_delete_marker_ttl", "inactive_threshold"])

export function StreamConfig() {
  return (
    <Loaded>
      {(s) => (
        <>
          <dl className="divide-y overflow-hidden rounded-xl border bg-card text-xs">
            {Object.entries(s.config).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[14rem_1fr] gap-4 px-4 py-2">
                <dt className="font-mono text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-words font-mono">{k === "max_msg_size" ? <MaxMsgSize own={Number(v)} max={s.maxPayload} /> : configValue(k, v)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Loaded>
  )
}

function configValue(key: string, v: unknown) {
  if (durations.has(key) && typeof v === "number") return v === 0 ? "0 (unlimited)" : `${v / 1e9}s`
  if (typeof v === "number" && v === -1) return "-1 (unlimited)"
  return typeof v === "string" ? v : JSON.stringify(v)
}

function MaxMsgSize({ own, max }: { own: number; max: number }) {
  if (own > 0 && own <= max) return <>{bytes(own)}</>
  return (
    <>
      {own > 0 ? bytes(own) : "-1 (unlimited)"}
      <span className="ml-2 font-sans text-muted-foreground">The server's max_payload of {bytes(max)} applies.</span>
    </>
  )
}
