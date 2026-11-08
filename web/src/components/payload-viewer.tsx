// Shows a message payload or KV value as text, a JSON tree or hex (ADR-0003).
// url serves the raw bytes: it answers Range requests, and with ?download it
// adds Content-Disposition. The first request asks for 64 KB and learns the
// full size from the answer; a larger payload loads in full on request. Every
// view is virtualised, and nothing renders in an iframe.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { hexRow, jsonRows, parse, PREVIEW, totalSize, type JsonRow } from "@/payload"
import { follow, trackHeight, type Scroll } from "@/scaled-scroll"
import { bytes as fmtBytes } from "@/screens/overview"

type Mode = "text" | "json" | "hex"
const ROW = 20

export function PayloadViewer({ url }: { url: string }) {
  const [whole, setWhole] = useState(false)
  const [picked, setPicked] = useState<Mode>()
  const q = useQuery({
    queryKey: ["payload", url, whole],
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal, headers: whole ? undefined : { Range: `bytes=0-${PREVIEW - 1}` } })
      if (!res.ok) throw new Error((await res.text()).trim() || res.statusText)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const total = totalSize(res.headers.get("Content-Range"), bytes.length)
      return { ...parse(bytes, bytes.length === total), size: total ?? bytes.length }
    },
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  })
  const p = q.data
  // Text first; JSON once the whole payload has arrived and parses; hex for binary.
  const mode: Mode = picked ?? (p?.binary ? "hex" : p?.json ? "json" : "text")
  const download = `${url}${url.includes("?") ? "&" : "?"}download`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <ToggleGroup aria-label="View payload as" value={[mode]} onValueChange={(v: string[]) => v[0] && setPicked(v[0] as Mode)}>
          <ToggleGroupItem value="text" className="h-7 px-2 text-xs aria-pressed:bg-primary/15 aria-pressed:text-primary">
            Text
          </ToggleGroupItem>
          <ToggleGroupItem
            value="json"
            disabled={!p?.json}
            title={p?.json ? undefined : p?.whole ? "This payload is not JSON." : "Load the full payload to see it as JSON."}
            className="h-7 px-2 text-xs aria-pressed:bg-primary/15 aria-pressed:text-primary"
          >
            JSON
          </ToggleGroupItem>
          <ToggleGroupItem value="hex" className="h-7 px-2 text-xs aria-pressed:bg-primary/15 aria-pressed:text-primary">
            Hex
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="text-muted-foreground tabular-nums" role="status">
          {q.isFetching ? "Loading payload…" : p && !p.whole ? `Showing the first ${fmtBytes(PREVIEW)} of ${fmtBytes(p.size)}.${p.binary ? "" : " Load it in full for the JSON tree."}` : p && fmtBytes(p.size)}
        </span>
        {p && !p.whole && !whole && (
          <Button variant="outline" size="sm" onClick={() => setWhole(true)}>
            Load full
          </Button>
        )}
        <a href={download} download className={buttonVariants({ variant: "outline", size: "sm" })}>
          Download
        </a>
      </div>
      {q.error && <p className="text-xs text-destructive">{q.error.message}</p>}
      {p && p.size === 0 ? (
        <p className="text-xs text-muted-foreground">The payload is empty.</p>
      ) : (
        p && (
          <div className="min-h-0 flex-1 rounded-md border bg-muted/30 font-mono text-[11px]">
            {mode === "json" && p.json ? (
              <JsonTree value={p.json.value} />
            ) : mode === "hex" ? (
              <VirtualRows key="hex" label="Payload as hex" count={Math.ceil(p.bytes.length / 16)} row={(r) => <HexLine r={hexRow(p.bytes, r)} />} />
            ) : (
              <VirtualRows key="text" label="Payload as text" count={p.rows.length} row={(r) => p.rows[r] || " "} />
            )}
          </div>
        )
      )}
    </div>
  )
}

function HexLine({ r: [offset, hex, ascii] }: { r: [string, string, string] }) {
  return (
    <>
      <span className="text-muted-foreground">{offset}</span>
      {"  "}
      {hex.padEnd(49)}
      {"  "}
      <span className="text-muted-foreground">{ascii}</span>
    </>
  )
}

function JsonTree({ value }: { value: unknown }) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const rows = useMemo(() => jsonRows(value, closed), [value, closed])
  const toggle = (r: JsonRow) =>
    setClosed((c) => {
      const next = new Set(c)
      if (!next.delete(r.path)) next.add(r.path)
      return next
    })
  return <VirtualRows label="Payload as JSON" count={rows.length} row={(i) => <JsonLine r={rows[i]} toggle={toggle} />} />
}

function JsonLine({ r, toggle }: { r: JsonRow; toggle: (r: JsonRow) => void }) {
  const v = r.value
  const n = Array.isArray(v) ? v.length : v !== null && typeof v === "object" ? Object.keys(v).length : 0
  const summary = Array.isArray(v) ? (r.open ? `[${n}]` : `[…] ${n} items`) : v !== null && typeof v === "object" ? (r.open ? `{${n}}` : `{…} ${n} keys`) : typeof v === "string" ? JSON.stringify(v.length > 500 ? `${v.slice(0, 500)}…` : v) : String(v)
  return (
    <span style={{ paddingLeft: r.depth * 14 }} className="inline-flex items-center gap-1">
      {r.open === undefined ? (
        <span className="w-3.5" />
      ) : (
        <button type="button" aria-expanded={r.open} aria-label={`${r.open ? "Collapse" : "Expand"} ${r.key ?? "root"}`} onClick={() => toggle(r)} className="text-muted-foreground hover:text-foreground">
          {r.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      )}
      {r.key !== undefined && <span className="text-primary">{r.key}: </span>}
      <span className={typeof v === "string" ? "text-success" : r.open !== undefined ? "text-muted-foreground" : ""}>{summary}</span>
    </span>
  )
}

// VirtualRows draws only the visible rows of a fixed-height list, on the same
// capped scroll track as the message table, so millions of rows stay cheap.
function VirtualRows({ count, row, label }: { count: number; row: (i: number) => ReactNode; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [vh, setVh] = useState(0)
  const [top, setTop] = useState(0)
  const at = useRef<Scroll>({ scrollTop: 0, top: 0 })
  const height = count * ROW
  useLayoutEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setVh(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const first = Math.min(Math.floor(top / ROW), Math.max(0, count - 1))
  const lines = []
  for (let i = first; i < Math.min(count, first + Math.ceil(vh / ROW) + 1); i++)
    lines.push(
      <div key={i} role="listitem" className="px-2 whitespace-pre" style={{ height: ROW, lineHeight: `${ROW}px` }}>
        {row(i)}
      </div>,
    )
  return (
    <div
      ref={box}
      tabIndex={0}
      role="list"
      aria-label={label}
      className="h-full overflow-y-auto"
      onScroll={(e) => {
        const { scrollTop, clientHeight } = e.currentTarget
        // clientHeight, not vh: a scroll can land before the ResizeObserver first sets vh.
        const t = follow(at.current, scrollTop, clientHeight, height)
        at.current = { scrollTop, top: t }
        setTop(t)
      }}
    >
      <div style={{ height: trackHeight(height) }}>
        <div className="sticky top-0 overflow-hidden" style={{ height: vh }}>
          <div style={{ transform: `translateY(${-(top % ROW)}px)` }}>{lines}</div>
        </div>
      </div>
    </div>
  )
}
