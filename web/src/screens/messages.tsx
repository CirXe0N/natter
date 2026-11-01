// The Messages tab of a stream (ADR-0003). Rows are metadata only, read in
// pages of 100 by one Browsing view: a server-side ordered consumer that reads
// forward from an anchor. Each page carries the list index of its first row,
// worked out from NumPending, so the loaded window sits at its real place on
// the scaled scrollbar. Scrolling outside the window re-anchors near the view.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { keepPreviousData, useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"

import { api } from "@/api"
import { CopyCli } from "@/components/copy-cli"
import { shellQuote } from "@/stream-config"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { MessagePage, MsgMeta } from "@/gen/api"
import { follow, scrollTopFor, trackHeight, type Scroll } from "@/scaled-scroll"
import { bytes } from "@/screens/overview"
import { useStream } from "@/screens/stream"
import { MessageDrawer } from "@/screens/message"

const ROW = 32
const PAGE = 100
const MAX_PAGES = 50 // 5,000 rows of metadata held at once
const cols = "grid grid-cols-[6rem_13rem_minmax(8rem,16rem)_5rem_3rem_minmax(0,1fr)] items-center gap-3 px-4"

// Anchor is where the view's consumer starts. A jump pins its first row to the
// top of the view; a re-anchor from scrolling only makes sure the view is covered.
type Anchor = { seq?: number; time?: string; pin?: boolean }
type Param = { seq?: number; time?: string; index?: number }
type Page = MessagePage & { index: number }
// Seek finds the message before or after seq `from` for the drawer's Prev and
// Next. back is how far below `from` its own anchor started, when it set one.
type Seek = { from: number; dir: 1 | -1; back?: number; anchored?: boolean; orClose?: boolean }

export function StreamMessages() {
  const { stream } = useParams({ from: "/streams/$stream" })
  return <MessageTable key={stream} stream={stream} />
}

function MessageTable({ stream }: { stream: string }) {
  const { data: s } = useStream()
  const [view] = useState(newView)
  const [filter, setFilter] = useState("")
  const [anchor, setAnchor] = useState<Anchor>({})
  const known = useRef(0) // the latest message count, which places a jump's first page

  useEffect(() => {
    const close = () => api.closeBrowsing(view)
    addEventListener("pagehide", close)
    return () => {
      removeEventListener("pagehide", close)
      close()
    }
  }, [view])

  const queryKey = ["streams", "messages", stream, filter, anchor]
  const q = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }): Promise<Page> => {
      const p = await api.browse(stream, { view, filter: filter || undefined, seq: pageParam.seq, time: pageParam.time }, signal)
      // A jump's first page lies as many rows before the end as it has messages after it.
      const index = pageParam.index ?? (anchor.seq || anchor.time ? Math.max(0, known.current - p.messages.length - p.pending) : 0)
      return { ...p, index }
    },
    initialPageParam: { seq: anchor.seq, time: anchor.time } as Param,
    getNextPageParam: (last): Param | undefined =>
      last.pending && last.messages.length ? { seq: last.messages[last.messages.length - 1].seq + 1, index: last.index + last.messages.length } : undefined,
    maxPages: MAX_PAGES,
    placeholderData: keepPreviousData,
    staleTime: Infinity, // a refetch would rewind the consumer
    gcTime: 0,
    retry: false,
  })

  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.messages) ?? [], [q.data])
  const pages = q.data?.pages ?? []
  const start = pages[0]?.index ?? 0
  const end = start + rows.length
  const lastPage = pages.at(-1)
  const count = lastPage ? lastPage.index + lastPage.messages.length + lastPage.pending : 0
  useEffect(() => {
    if (lastPage) known.current = count
  })

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
  const show = (t: number) => {
    t = Math.max(0, Math.min(t, height - vh))
    const el = box.current!
    el.scrollTop = scrollTopFor(t, vh, height)
    at.current = { scrollTop: el.scrollTop, top: t } // read back: the browser rounds it
    setTop(t)
  }
  const first = Math.floor(top / ROW)
  const visible = Math.ceil(vh / ROW) + 1
  const last = Math.min(count, first + visible)

  // seqAt estimates the sequence at list index t, between the stream's first
  // and last sequence and the ends of the loaded window.
  const seqAt = (t: number) => {
    const points: [number, number][] = [[0, s?.firstSeq ?? 0]]
    if (rows.length) points.push([start, rows[0].seq], [end - 1, rows[rows.length - 1].seq])
    points.push([Math.max(0, count - 1), s?.lastSeq ?? 0])
    for (let k = 1; k < points.length; k++) {
      const [i0, s0] = points[k - 1]
      const [i1, s1] = points[k]
      if (t <= i1) return Math.floor(i1 > i0 ? s0 + ((t - i0) / (i1 - i0)) * (s1 - s0) : s0)
    }
    return s?.lastSeq ?? 0
  }

  // Read on while the view nears the window's end; re-anchor once scrolling
  // settles outside it, a page above the view's bottom so both ways are covered.
  useEffect(() => {
    if (!q.data || q.isFetching || !s) return
    if (first >= start && first <= end) {
      if (last > end - PAGE / 2 && q.hasNextPage) void q.fetchNextPage({ cancelRefetch: false })
      return
    }
    const t = setTimeout(() => setAnchor({ seq: Math.max(1, seqAt(Math.max(0, last - PAGE))) }), 150)
    return () => clearTimeout(t)
  })

  // When a new anchor's first page lands, show it: at the top for a jump, or
  // the nearest covered rows when the estimate missed the view.
  const landed = useRef<Anchor>(anchor)
  useEffect(() => {
    if (!q.data || q.isPlaceholderData || landed.current === anchor) return
    landed.current = anchor
    if (anchor.pin) show(start * ROW)
    else if (first < start || first > end) show((first < start ? start : Math.max(start, end - visible + 1)) * ROW)
  })

  // The drawer's message, and Prev and Next across pages. Next reads on, or
  // anchors at from + 1. Prev anchors below `from`, doubling the distance
  // while nothing matches there.
  const qc = useQueryClient()
  const [open, setOpen] = useState<number>()
  const [seek, setSeek] = useState<Seek>()
  const reveal = (i: number) => {
    const t = at.current.top // not `first`: a landing jump may have just moved the view
    if (i * ROW < t) show(i * ROW)
    else if ((i + 1) * ROW > t + vh) show((i + 1) * ROW - vh)
  }
  useEffect(() => {
    if (!seek || !q.data || q.isFetching || q.isPlaceholderData) return
    const { from, dir } = seek
    const lo = rows[0]?.seq ?? Infinity
    const hi = rows.at(-1)?.seq ?? 0
    const land = (k: number) => {
      setOpen(rows[k].seq)
      setSeek(undefined)
      reveal(start + k)
    }
    const none = () => {
      setSeek(undefined)
      if (seek.orClose) setOpen(undefined)
    }
    if (dir === 1) {
      const k = rows.findIndex((r) => r.seq > from)
      if (seek.anchored) return k >= 0 ? land(k) : none()
      if (lo <= from && from <= hi) {
        if (k >= 0) return land(k)
        if (q.hasNextPage) return void q.fetchNextPage({ cancelRefetch: false })
        return none()
      }
      setSeek({ ...seek, anchored: true })
      return setAnchor({ seq: from + 1, pin: true })
    }
    const k = rows.findLastIndex((r) => r.seq < from)
    if (k >= 0 && (hi >= from || !q.hasNextPage)) return land(k)
    if (k >= 0 && seek.back) return void q.fetchNextPage({ cancelRefetch: false }) // shortcut: pages up to `from`, fine unless a long empty stretch doubled back far
    const firstSeq = s?.firstSeq ?? 1
    if (seek.back && from - seek.back <= firstSeq) return none()
    const back = seek.back ? seek.back * 2 : PAGE
    setSeek({ ...seek, back })
    setAnchor({ seq: Math.max(1, from - back), pin: true })
  })
  const openAt = open === undefined ? -1 : rows.findIndex((r) => r.seq === open)
  const step = (dir: 1 | -1) => () => open !== undefined && setSeek({ from: open, dir })
  // Drop a deleted row from the cached pages: invalidating would refetch every page and rewind the consumer.
  const dropRow = (seq: number) => {
    qc.setQueryData<InfiniteData<Page, Param>>(queryKey, (d) => {
      if (!d) return d
      let shift = 0
      const pages = d.pages.map((p) => {
        const i = p.messages.findIndex((m) => m.seq === seq)
        const page = { ...p, index: p.index - shift, messages: i < 0 ? p.messages : p.messages.toSpliced(i, 1) }
        if (i >= 0) shift = 1
        return page
      })
      return { ...d, pages }
    })
    void qc.invalidateQueries({ queryKey: ["streams", "detail", stream] })
    setSeek({ from: seq, dir: 1, orClose: true })
  }

  const inView = []
  for (let i = first; i < last; i++) {
    const m = i >= start && i < end ? rows[i - start] : undefined
    inView.push(<Row key={i} index={i} m={m} selected={m !== undefined && m.seq === open} onOpen={setOpen} />)
  }
  const topRow = first >= start && first < end ? rows[first - start] : undefined

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <SubjectFilter
          value={filter}
          onApply={(f) => {
            setFilter(f)
            setAnchor({ pin: true })
          }}
        />
        <JumpTo onJump={(a) => setAnchor({ ...a, pin: true })} />
        <CopyCli cmd={`nats stream view ${stream}${topRow && topRow.seq > 1 ? ` --id ${topRow.seq}` : ""}${filter ? ` --subject ${shellQuote(filter)}` : ""}`} />
      </div>
      {q.error && <p className="text-destructive">{q.error.message}</p>}
      <div role="table" aria-label="Messages" aria-rowcount={count + 1} className="overflow-hidden rounded-xl border bg-card">
        <div role="rowgroup">
          <div role="row" aria-rowindex={1} className={`${cols} border-b py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase`}>
            <span role="columnheader">Seq</span>
            <span role="columnheader">Time (UTC)</span>
            <span role="columnheader">Subject</span>
            <span role="columnheader" className="text-right">
              Size
            </span>
            <span role="columnheader" className="text-center" title="Headers">
              Hdrs
            </span>
            <span role="columnheader">Payload preview</span>
          </div>
        </div>
        <div
          ref={box}
          role="rowgroup"
          tabIndex={0}
          aria-label="Message rows"
          className="h-[min(65vh,44rem)] overflow-y-auto"
          onScroll={(e) => {
            const scrollTop = e.currentTarget.scrollTop
            const t = follow(at.current, scrollTop, vh, height)
            at.current = { scrollTop, top: t }
            setTop(t)
          }}
        >
          <div style={{ height: trackHeight(height) }}>
            <div className="sticky top-0 overflow-hidden" style={{ height: vh }}>
              {q.data && count === 0 ? (
                <p className="px-4 py-8 text-center text-muted-foreground">{filter ? `No messages match ${filter}.` : "This stream holds no messages."}</p>
              ) : (
                <div style={{ transform: `translateY(${-(top % ROW)}px)` }}>{inView}</div>
              )}
            </div>
          </div>
        </div>
        <p className="border-t px-4 py-1.5 text-[11px] text-muted-foreground tabular-nums" role="status">
          {count ? `Rows ${first + 1}–${last} of ${count}${filter ? ` matching ${filter}` : ""}` : q.isFetching ? "Loading messages…" : ""}
        </p>
      </div>
      <MessageDrawer
        stream={stream}
        seq={open}
        prev={openAt >= 0 && start + openAt === 0 ? undefined : step(-1)}
        next={openAt >= 0 && start + openAt === count - 1 ? undefined : step(1)}
        onClose={() => setOpen(undefined)}
        onDeleted={dropRow}
      />
    </>
  )
}

function Row({ index, m, selected, onOpen }: { index: number; m?: MsgMeta; selected: boolean; onOpen: (seq: number) => void }) {
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      className={`${cols} border-b text-xs ${m ? "cursor-pointer hover:bg-muted/50" : ""} ${selected ? "bg-primary/10" : ""}`}
      style={{ height: ROW }}
      onClick={m && (() => onOpen(m.seq))}
    >
      {m ? (
        <>
          <span role="cell" className="font-mono text-muted-foreground tabular-nums">
            <button type="button" title="Open message" className="hover:text-foreground hover:underline">
              #{m.seq}
            </button>
          </span>
          <span role="cell" className="font-mono text-muted-foreground tabular-nums">
            {new Date(m.time).toISOString().replace("T", " ").slice(0, 23)}
          </span>
          <span role="cell" className="truncate font-mono">
            {m.subject}
          </span>
          <span role="cell" className="text-right tabular-nums">
            {bytes(m.size)}
          </span>
          <span role="cell" className="text-center text-muted-foreground tabular-nums">
            {m.headers}
          </span>
          <span role="cell" className="truncate font-mono text-muted-foreground">
            {m.preview !== undefined ? m.preview || <i className="font-sans">empty</i> : <i className="font-sans">{m.kind === "binary" ? "binary" : "not loaded until opened"}</i>}
          </span>
        </>
      ) : (
        <span role="cell" aria-label="Loading" className="col-span-6 h-2.5 w-2/3 animate-pulse rounded bg-muted" />
      )}
    </div>
  )
}

function SubjectFilter({ value, onApply }: { value: string; onApply: (filter: string) => void }) {
  const [draft, setDraft] = useState(value)
  return (
    <form
      role="search"
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onApply(draft.trim())
      }}
    >
      <label htmlFor="messages-subject" className="shrink-0 text-xs text-muted-foreground">
        Subject
      </label>
      <Input id="messages-subject" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="orders.> or orders.*.new" className="w-64 font-mono" />
      <Button type="submit" variant="outline">
        Filter
      </Button>
      {value && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setDraft("")
            onApply("")
          }}
        >
          Clear
        </Button>
      )}
    </form>
  )
}

function JumpTo({ onJump }: { onJump: (to: { seq?: number; time?: string }) => void }) {
  const [seq, setSeq] = useState("")
  const [time, setTime] = useState("")
  return (
    <>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (Number(seq) >= 1) onJump({ seq: Math.floor(Number(seq)) })
        }}
      >
        <label htmlFor="jump-seq" className="shrink-0 text-xs text-muted-foreground">
          Sequence
        </label>
        <Input id="jump-seq" type="number" min={1} value={seq} onChange={(e) => setSeq(e.target.value)} className="w-28 font-mono" />
        <Button type="submit" variant="outline" aria-label="Jump to sequence">
          Jump
        </Button>
      </form>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (time) onJump({ time: new Date(`${time}Z`).toISOString() })
        }}
      >
        <label htmlFor="jump-time" className="shrink-0 text-xs text-muted-foreground">
          Time (UTC)
        </label>
        <Input id="jump-time" type="datetime-local" step={1} value={time} onChange={(e) => setTime(e.target.value)} className="w-52 font-mono" />
        <Button type="submit" variant="outline" aria-label="Jump to time">
          Jump
        </Button>
      </form>
    </>
  )
}

// newView names this table's Browsing view. Not crypto.randomUUID: that needs
// a secure context, which a non-loopback http bind is not.
function newView() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")
}
