// Key-Value: the buckets of the active Context, then one bucket's keys. The
// key list is live over the socket (topic "kv:<bucket>") and carries no
// values; a key's value and history are fetched when it is opened.
import { useEffect, useMemo, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { X } from "lucide-react"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { CopyCli } from "@/components/copy-cli"
import { PayloadViewer } from "@/components/payload-viewer"
import { ScreenHeader } from "@/components/screen-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TopicKV, type KVEntry, type KVOp } from "@/gen/api"
import { subscribe, usePaused } from "@/live"
import { bytes, count } from "@/screens/overview"
import { Ago, useRefresh } from "@/screens/streams"
import { KeyActions, PutKey } from "@/screens/kv-actions"
import { shellQuote } from "@/stream-config"

const th = "px-3 py-2 text-left text-[11px] font-medium text-muted-foreground"
const td = "h-(--row-h) px-3"
// shortcut: rows past this are not rendered, virtualise the table when people need to scroll a huge bucket.
const SHOWN = 1000

export function KVScreen() {
  const list = useQuery({ queryKey: ["kv", "buckets"], queryFn: ({ signal }) => api.kvBuckets(signal), refetchInterval: useRefresh(), placeholderData: keepPreviousData })
  return (
    <>
      <ScreenHeader title="Key-Value">
        <CopyCli cmd="nats kv ls" />
      </ScreenHeader>
      <div className="px-8 pb-8">
        {list.isError ? (
          <p className="text-destructive">{list.error.message}</p>
        ) : !list.data ? (
          <p className="text-muted-foreground">Loading buckets…</p>
        ) : list.data.length === 0 ? (
          <p className="text-muted-foreground">This account has no KV buckets.</p>
        ) : (
          <section aria-label="Buckets" className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  {["Bucket", "Values", "History", "TTL", "Storage", "Size"].map((h) => (
                    <th key={h} scope="col" className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.map((b) => (
                  <tr key={b.bucket} className="border-b last:border-0 hover:bg-accent">
                    <th scope="row" className={`${td} text-left font-normal`}>
                      <Link to="/kv/$bucket" params={{ bucket: b.bucket }} className="font-mono text-foreground hover:underline">
                        {b.bucket}
                      </Link>
                    </th>
                    <td className={`${td} tabular-nums`}>{count(b.values)}</td>
                    <td className={`${td} tabular-nums`}>{b.history}</td>
                    <td className={`${td} tabular-nums`}>{b.ttl ? `${count(b.ttl)} s` : "forever"}</td>
                    <td className={`${td} text-muted-foreground`}>
                      {b.storage} · R{b.replicas}
                    </td>
                    <td className={`${td} tabular-nums`}>{bytes(b.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  )
}

export function BucketScreen() {
  const { bucket } = useParams({ from: "/kv/$bucket" })
  return <Bucket key={bucket} bucket={bucket} />
}

type Keys = { keys: Map<string, KVEntry>; loaded: boolean; problem?: string }

// useKeys follows the bucket's live key list. A full frame replaces it; any
// other frame upserts puts and removes deletes and purges.
function useKeys(bucket: string): Keys {
  const [state, setState] = useState<Keys>({ keys: new Map(), loaded: false })
  useEffect(() => {
    let keys = new Map<string, KVEntry>()
    let rev = 0
    return subscribe(TopicKV + bucket, (f) => {
      if (f.error) return setState({ keys, loaded: true, problem: f.error })
      const kv = f.kv
      if (!kv || (!kv.full && kv.rev < rev)) return // stale: a newer full frame already covers it
      keys = new Map(kv.full ? [] : keys)
      for (const e of kv.keys) {
        if (e.op === "put") keys.set(e.key, e)
        else keys.delete(e.key)
      }
      rev = kv.rev
      setState({ keys, loaded: true, problem: kv.problem })
    })
  }, [bucket])
  return state
}

function Bucket({ bucket }: { bucket: string }) {
  const { keys, loaded, problem } = useKeys(bucket)
  const paused = usePaused()
  const [prefix, setPrefix] = useState("")
  const [open, setOpen] = useState<string>()
  const rows = useMemo(() => [...keys.values()].filter((e) => e.key.startsWith(prefix)).sort((a, b) => (a.key < b.key ? -1 : 1)), [keys, prefix])
  const now = Date.now() / 1000

  return (
    <>
      <ScreenHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="font-mono">{bucket}</span>
            <Badge tone={paused ? "muted" : "success"}>{paused ? "Paused" : "Watching"}</Badge>
          </span>
        }
      >
        <Link to="/kv" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          All buckets
        </Link>
        <PutKey bucket={bucket} />
        <CopyCli cmd={`nats kv watch ${shellQuote(bucket)}${prefix ? ` ${shellQuote(`${prefix}>`)}` : ""}`} />
      </ScreenHeader>
      <div className={`grid gap-5 px-8 pb-8 ${open ? "grid-cols-[minmax(0,1fr)_minmax(22rem,32rem)]" : ""}`}>
        <div className="min-w-0 space-y-4">
          <form role="search" className="flex max-w-lg items-center gap-2" onSubmit={(e) => e.preventDefault()}>
            <label htmlFor="kv-prefix" className="shrink-0 text-xs text-muted-foreground">
              Key prefix
            </label>
            <Input id="kv-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="app.checkout." className="font-mono" />
          </form>
          {problem ? (
            <p className="text-destructive">{problem}</p>
          ) : !loaded ? (
            <p className="text-muted-foreground">Loading keys…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground">{prefix ? `No key starts with ${prefix}.` : "This bucket has no keys."}</p>
          ) : (
            <section aria-label="Keys" className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    {["Key", "Revision", "Updated"].map((h) => (
                      <th key={h} scope="col" className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, SHOWN).map((e) => (
                    <tr key={e.key} className={`border-b last:border-0 hover:bg-accent ${open === e.key ? "bg-accent" : ""}`}>
                      <th scope="row" className={`${td} text-left font-normal`}>
                        <button type="button" aria-current={open === e.key || undefined} onClick={() => setOpen(e.key)} className="max-w-full truncate font-mono text-foreground hover:underline">
                          {e.key}
                        </button>
                      </th>
                      <td className={`${td} tabular-nums text-muted-foreground`}>{e.revision}</td>
                      <td className={`${td} text-muted-foreground`}>
                        <Ago time={e.created} now={now} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
                {rows.length > SHOWN ? `Showing the first ${count(SHOWN)} of ${count(rows.length)} keys. Narrow them with a prefix.` : `${count(rows.length)} keys`}
              </p>
            </section>
          )}
        </div>
        {open && <KeyDetail key={open} bucket={bucket} name={open} entry={keys.get(open)} onClose={() => setOpen(undefined)} />}
      </div>
    </>
  )
}

const opTone: Record<KVOp, "muted" | "destructive"> = { put: "muted", delete: "destructive", purge: "destructive" }

// KeyDetail shows one key's value and history. entry is the key's live row,
// absent once the key is deleted; a new revision refetches the history.
function KeyDetail({ bucket, name, entry, onClose }: { bucket: string; name: string; entry?: KVEntry; onClose: () => void }) {
  const [picked, setPicked] = useState<number>()
  const history = useQuery({ queryKey: ["kv", "history", bucket, name, entry?.revision], queryFn: ({ signal }) => api.kvHistory(bucket, name, signal) })
  const shown = picked ?? entry?.revision

  return (
    <section aria-label={`Key ${name}`} className="min-w-0 space-y-4 self-start rounded-xl border bg-card p-4">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 break-all font-mono text-sm font-semibold">{name}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close key">
          <X aria-hidden />
        </Button>
      </div>
      {entry && (
        <div className="flex flex-wrap items-center gap-2">
          <PutKey bucket={bucket} name={name} />
          <KeyActions bucket={bucket} name={name} />
        </div>
      )}
      {shown !== undefined && <CopyCli cmd={`nats kv get ${shellQuote(bucket)} ${shellQuote(name)}${picked ? ` --revision ${picked}` : ""}`} />}
      <div className="space-y-1.5">
        <h3 className="text-[11px] font-medium text-muted-foreground">
          {shown === undefined ? "Value" : `Value at revision ${shown}`}
        </h3>
        {shown === undefined ? (
          <p className="text-xs text-muted-foreground">This key has been deleted. Its history is below.</p>
        ) : (
          <div className="flex max-h-96 flex-col">
            <PayloadViewer key={shown} url={api.kvValueUrl(bucket, name, shown)} />
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <h3 className="text-[11px] font-medium text-muted-foreground">History</h3>
        {history.isError ? (
          <p className="text-xs text-destructive">{history.error.message}</p>
        ) : !history.data ? (
          <p className="text-xs text-muted-foreground">Loading history…</p>
        ) : (
          <ol aria-label="Revisions" className="divide-y rounded-lg border text-xs">
            {history.data.toReversed().map((h) => (
              <li key={h.revision} className="flex items-center gap-3 px-3 py-1.5">
                {h.op === "put" ? (
                  <button type="button" aria-current={h.revision === shown || undefined} onClick={() => setPicked(h.revision)} className="w-16 text-left font-mono tabular-nums hover:underline aria-[current]:font-semibold">
                    r{h.revision}
                  </button>
                ) : (
                  <span className="w-16 font-mono tabular-nums text-muted-foreground">r{h.revision}</span>
                )}
                <Badge tone={opTone[h.op]}>{h.op}</Badge>
                <span className="flex-1" />
                <time dateTime={h.created} className="tabular-nums text-muted-foreground">
                  {new Date(h.created).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
