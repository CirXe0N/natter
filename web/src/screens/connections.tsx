// Connections: who is connected and who is slow. A sortable, filterable table
// of every server's Connections (open, or recently closed with their reasons),
// a side panel with one Connection's subscriptions, and Kick with System
// credentials behind a confirmation.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowDown, ArrowUp, Funnel, X } from "lucide-react"

import { api } from "@/api"
import { BlockedButton } from "@/components/blocked-button"
import { FilterField } from "@/components/filter-field"
import { NotAvailable, sourceLabel } from "@/components/not-available"
import { ScreenHeader } from "@/components/screen-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useActiveContext, useBlockedReason } from "@/contexts"
import type { Connection, ConnectionState } from "@/gen/api"
import { shellQuote } from "@/stream-config"
import { useRefresh } from "@/screens/streams"
import { bytes, count } from "@/screens/overview"

// Highlight thresholds: an RTT over 100 ms, or over 1 MiB waiting to be sent to
// the client, is a slow Connection.
const slowRttMs = 100
const slowPendingBytes = 1 << 20

const label = (c: Connection) => c.name || `cid ${c.cid}`
const same = (c: Connection, s: { server?: string; cid?: number }) => c.server === s.server && c.cid === s.cid

type Col = { key: string; title: string; text?: boolean; value: (c: Connection) => string | number }
const cols: Col[] = [
  { key: "name", title: "Name", text: true, value: (c) => label(c).toLowerCase() },
  { key: "account", title: "Account", text: true, value: (c) => c.account ?? "" },
  { key: "user", title: "User", text: true, value: (c) => c.user ?? "" },
  { key: "server", title: "Server", text: true, value: (c) => c.serverName },
  { key: "rtt", title: "RTT", value: (c) => c.rttMs },
  { key: "pending", title: "Pending", value: (c) => c.pendingBytes },
  { key: "in", title: "Msgs in", value: (c) => c.inMsgs },
  { key: "out", title: "Msgs out", value: (c) => c.outMsgs },
  { key: "subs", title: "Subs", value: (c) => c.subs.length },
]
const closedCols: Col[] = [
  ...cols.slice(0, 4),
  { key: "reason", title: "Reason", text: true, value: (c) => c.reason ?? "" },
  { key: "stop", title: "Closed", value: (c) => c.stop ?? "" },
]

type Sort = { key: string; desc: boolean }

// Filters on account, user, name and subject at once: a Connection stays when
// the text is part of any of them.
// shortcut: plain substring on subjects, no NATS wildcard matching; add it if people filter by "orders.*".
function matches(c: Connection, q: string) {
  q = q.trim().toLowerCase()
  return !q || [c.account, c.user, c.name, ...c.subs].some((f) => f?.toLowerCase().includes(q))
}

export function ConnectionsScreen() {
  const [state, setState] = useState<ConnectionState>("open")
  const [filter, setFilter] = useState("")
  const [sort, setSort] = useState<Sort>({ key: "rtt", desc: true })
  const selected = useSearch({ from: "/connections" })
  const { data, error } = useQuery({
    queryKey: ["connections", state],
    queryFn: ({ signal }) => api.connections(state, signal),
    refetchInterval: useRefresh(),
  })

  const columns = state === "open" ? cols : closedCols
  const col = columns.find((c) => c.key === sort.key) ?? columns[0]
  const rows = (data?.connections ?? [])
    .filter((c) => matches(c, filter))
    .sort((a, b) => {
      const [x, y] = [col.value(a), col.value(b)]
      return (x < y ? -1 : x > y ? 1 : a.cid - b.cid) * (sort.desc ? -1 : 1)
    })
  const current = data?.connections.find((c) => same(c, selected))

  return (
    <>
      <ScreenHeader title="Connections">
        {data && data.source !== "none" && <span className="text-xs text-muted-foreground">{sourceLabel[data.source]}</span>}
      </ScreenHeader>
      <div className="flex items-start gap-4 px-8 pb-8">
        <div className="min-w-0 flex-1 space-y-3">
          {error ? (
            <p className="text-destructive">{error.message}</p>
          ) : !data ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : data.source === "none" ? (
            <NotAvailable title="Connections are not available" problem={data.problem} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div role="group" aria-label="Show" className="flex gap-1">
                  {(["open", "closed"] as const).map((s) => (
                    <Button key={s} size="sm" variant={state === s ? "secondary" : "outline"} aria-pressed={state === s} onClick={() => {
                        setState(s)
                        setSort({ key: s === "open" ? "rtt" : "stop", desc: true })
                      }}>
                      {s === "open" ? "Open" : "Recently closed"}
                    </Button>
                  ))}
                </div>
                <FilterField label="Filter by account, user, name or subject" icon={Funnel} placeholder="Filter by account, user, name or subject" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-80" />
                <span role="status" className="text-xs text-muted-foreground">
                  {rows.length === data.connections.length ? `${rows.length} Connections` : `${rows.length} of ${data.connections.length} Connections`}
                </span>
              </div>
              {data.problem && <p className="text-xs text-warning">{data.problem}</p>}
              {data.truncated && <p className="text-xs text-warning">Only the first {count(data.connections.length)} Connections are listed. Filter to narrow them.</p>}
              <Table columns={columns} sort={sort} onSort={setSort} rows={rows} selected={selected} closed={state === "closed"} />
            </>
          )}
        </div>
        {selected.server && (
          <Panel c={current} closed={state === "closed"} />
        )}
      </div>
    </>
  )
}

function Table({ columns, sort, onSort, rows, selected, closed }: { columns: Col[]; sort: Sort; onSort: (s: Sort) => void; rows: Connection[]; selected: { server?: string; cid?: number }; closed: boolean }) {
  const th = "px-3 py-2 text-left text-[11px] font-medium text-muted-foreground"
  const td = "h-(--row-h) px-3 tabular-nums"
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-xs">
        <caption className="sr-only">{closed ? "Recently closed Connections" : "Open Connections"}</caption>
        <thead>
          <tr className="border-b">
            {columns.map((c) => {
              const on = sort.key === c.key
              return (
                <th key={c.key} scope="col" className={th} aria-sort={on ? (sort.desc ? "descending" : "ascending") : undefined}>
                  <button type="button" className="inline-flex items-center gap-1 rounded-sm hover:text-foreground" onClick={() => onSort({ key: c.key, desc: on ? !sort.desc : !c.text })}>
                    {c.title}
                    {on && (sort.desc ? <ArrowDown size={11} aria-hidden /> : <ArrowUp size={11} aria-hidden />)}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={`${c.server}/${c.cid}`} className={`border-b last:border-0 ${same(c, selected) ? "bg-accent" : ""}`}>
              {columns.map((k) => (
                <Cell key={k.key} k={k.key} c={c} td={td} />
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">
                No Connections.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ k, c, td }: { k: string; c: Connection; td: string }) {
  const flag = <span className="sr-only"> (high)</span>
  switch (k) {
    case "name":
      return (
        <th scope="row" className={`${td} text-left font-normal`}>
          <Link to="/connections" search={{ server: c.server, cid: c.cid }} className="font-mono text-primary hover:underline">
            {label(c)}
          </Link>
        </th>
      )
    case "rtt":
      return (
        <td className={`${td} ${c.rttMs > slowRttMs ? "font-medium text-warning" : ""}`}>
          {c.rttMs ? `${c.rttMs.toFixed(c.rttMs < 10 ? 2 : 0)} ms` : "–"}
          {c.rttMs > slowRttMs && flag}
        </td>
      )
    case "pending":
      return (
        <td className={`${td} ${c.pendingBytes > slowPendingBytes ? "font-medium text-warning" : ""}`}>
          {bytes(c.pendingBytes)}
          {c.pendingBytes > slowPendingBytes && flag}
        </td>
      )
    case "account":
      return <td className={`${td} font-mono`}>{c.account || "–"}</td>
    case "user":
      return <td className={`${td} font-mono`}>{c.user || "–"}</td>
    case "server":
      return <td className={`${td} text-muted-foreground`}>{c.serverName}</td>
    case "in":
      return <td className={td}>{count(c.inMsgs)}</td>
    case "out":
      return <td className={td}>{count(c.outMsgs)}</td>
    case "subs":
      return <td className={td}>{c.subs.length}</td>
    case "reason":
      return <td className={td}>{c.reason || "–"}</td>
    default:
      return <td className={`${td} text-muted-foreground`}>{new Date(c.stop ?? "").toLocaleTimeString()}</td>
  }
}

function Panel({ c, closed }: { c?: Connection; closed: boolean }) {
  const navigate = useNavigate()
  const close = () => void navigate({ to: "/connections", search: {} })
  return (
    <aside aria-label="Connection details" className="sticky top-0 w-80 shrink-0 space-y-3 rounded-xl border bg-card p-4 text-xs">
      <div className="flex items-start justify-between gap-2">
        <h2 className="break-all font-mono text-sm font-medium">{c ? label(c) : "Connection"}</h2>
        <Button size="icon-sm" variant="ghost" onClick={close}>
          <X aria-hidden />
          <span className="sr-only">Close details</span>
        </Button>
      </div>
      {!c ? (
        <p className="text-muted-foreground">This Connection is not in the {closed ? "closed" : "open"} list. It may have disconnected.</p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {(
              [
                ["Client ID", `${c.cid} on ${c.serverName}`],
                ["Address", c.ip],
                ["Client", [c.lang, c.version].filter(Boolean).join(" ") || "–"],
                ["Account", c.account || "–"],
                ["User", c.user || "–"],
                ["Connected", new Date(c.start).toLocaleString()],
                ["Last activity", new Date(c.lastActivity).toLocaleString()],
                ...(c.reason ? [["Closed because", c.reason]] : []),
                ["Msgs in / out", `${c.inMsgs} / ${c.outMsgs}`],
                ["Bytes in / out", `${bytes(c.inBytes)} / ${bytes(c.outBytes)}`],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
          <section aria-labelledby="subs-heading">
            <h3 id="subs-heading" className="mb-1 font-medium">
              Subscriptions ({c.subs.length})
            </h3>
            {c.subs.length === 0 ? (
              <p className="text-muted-foreground">None.</p>
            ) : (
              <ul className="max-h-64 divide-y overflow-auto rounded-md border font-mono">
                {c.subs.map((s, i) => (
                  <li key={i} className="px-2 py-1 break-all">
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {!closed && <KickAction c={c} />}
        </>
      )}
    </aside>
  )
}

// Why Kick is blocked, or undefined. Read-only mode comes first: turning it off
// is the first thing to do; then the missing System credentials.
function useKickBlocked() {
  const { data: active } = useActiveContext()
  const readOnly = useBlockedReason()
  if (readOnly) return readOnly
  if (active && !active.capabilities.system) return "Kick needs System credentials. This Context has none."
}

function KickAction({ c }: { c: Connection }) {
  const [open, setOpen] = useState(false)
  const { data: active } = useActiveContext()
  const blocked = useKickBlocked()
  const qc = useQueryClient()
  const kick = useMutation({
    mutationFn: () => api.kick({ server: c.server, cid: c.cid }),
    onSuccess: () => {
      setOpen(false)
      return qc.invalidateQueries({ queryKey: ["connections"] })
    },
  })
  const ctx = active?.context?.source === "cli" ? ` --context ${shellQuote(active.context.name)}` : ""
  const cli = `nats${ctx} request ${shellQuote(`$SYS.REQ.SERVER.${c.server}.KICK`)} ${shellQuote(JSON.stringify({ cid: c.cid }))}`
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <BlockedButton reason={blocked} size="sm" variant="destructive" onClick={() => setOpen(true)}>
        Kick…
      </BlockedButton>
      <Dialog open={open} onOpenChange={(o) => !kick.isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kick {label(c)}?</DialogTitle>
            <DialogDescription>
              The server closes this Connection (cid {c.cid} on {c.serverName}). The client can connect again, and Kick does not ban it.
            </DialogDescription>
          </DialogHeader>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">The same with the nats CLI, using System credentials:</p>
            <pre className="overflow-x-auto rounded-md border bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">{cli}</pre>
          </div>
          {kick.isError && <p role="alert" className="text-xs text-destructive">{kick.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={kick.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={kick.isPending} onClick={() => kick.mutate()}>
              Kick
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
