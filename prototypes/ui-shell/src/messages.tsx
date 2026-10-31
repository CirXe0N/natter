// PROTOTYPE: virtualised message table + detail drawer for streams with very many (and very large) messages.
//
// How the real app would keep this cheap (see the note in the footer of the table):
// - Rows are metadata only. The backend lists them with an ephemeral headers_only consumer, which sends
//   headers plus Nats-Msg-Size but no payload. A 4 MB message costs ~200 bytes in the table.
// - Only the rows in view (plus a page either side) are fetched, in pages of 100. Far-away pages are evicted.
// - Payload previews come only for small messages; large ones show their size instead.
// - The full payload is fetched with a Direct Get only when you open a message, and big payloads are
//   rendered progressively (first 64 KB, then "load full" or download).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Download, Eye, FileStack, Funnel, Hash, Repeat, Save, Trash, X } from "lucide-react";
import { Badge, Button, CopyCli, DangerAction, HeadersTable, Kbd, PayloadView, Writable, cx, fmt, useApp } from "./kit";
import { cliFor, fmtBytes, messageAt, metaAt, subjectAt, type Stream } from "./data";

const ROW = 34;
const PAGE = 100;
const MAX_SCROLL = 4_000_000; // browsers cap element height (~33M px), so long lists scroll on a scaled track
const MAX_PAGES = 40;
const cols = "grid grid-cols-[96px_190px_200px_86px_52px_minmax(0,1fr)] items-center gap-3";

function matches(filter: string, subject: string) {
  if (!filter) return true;
  const f = filter.split(".");
  const s = subject.split(".");
  for (let i = 0; i < f.length; i++) {
    if (f[i] === ">") return s.length > i;
    if (i >= s.length || (f[i] !== "*" && f[i] !== s[i])) return false;
  }
  return f.length === s.length;
}

/** Index -> sequence, newest first. With a filter we scan once, like a server-side filtered consumer would. */
function useSeqIndex(s: Stream, filter: string) {
  return useMemo(() => {
    if (!filter) return { total: s.messages, seqAt: (i: number) => s.lastSeq - i };
    const out: number[] = [];
    for (let seq = s.lastSeq; seq > s.lastSeq - s.messages; seq--) if (matches(filter, subjectAt(seq))) out.push(seq);
    const arr = Int32Array.from(out);
    return { total: arr.length, seqAt: (i: number) => arr[i] };
  }, [s, filter]);
}

export function MessageTable({ s, openSeq, onOpen }: { s: Stream; openSeq?: number; onOpen: (seq: number, seqAt: (i: number) => number, index: number) => void }) {
  const [filter, setFilter] = useState("");
  const [draftFilter, setDraftFilter] = useState("");
  const [jump, setJump] = useState("");
  const { total, seqAt } = useSeqIndex(s, filter);
  const scroller = useRef<HTMLDivElement>(null);
  const [vh, setVh] = useState(500);
  const [scrollTop, setScrollTop] = useState(0);
  const [pages, setPages] = useState<Map<number, number>>(new Map()); // page -> last used
  const pending = useRef(new Set<number>());

  useLayoutEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => setVh(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setPages(new Map()); scroller.current?.scrollTo({ top: 0 }); }, [filter]);

  const visible = Math.ceil(vh / ROW) + 1;
  const fullH = total * ROW;
  const trackH = Math.min(fullH, MAX_SCROLL);
  const maxStart = Math.max(0, total - visible + 1);
  const ratio = trackH - vh > 0 ? Math.min(1, scrollTop / (trackH - vh)) : 0;
  const startF = ratio * maxStart;
  const start = Math.floor(startF);
  const offset = -(startF - start) * ROW;

  // Fetch pages in view (+1 either side), evict the least recently used beyond MAX_PAGES.
  const firstPage = Math.max(0, Math.floor(start / PAGE) - 1);
  const lastPage = Math.floor((start + visible) / PAGE) + 1;
  useEffect(() => {
    const want: number[] = [];
    for (let p = firstPage; p <= lastPage && p * PAGE < total; p++) want.push(p);
    const now = Date.now();
    setPages((m) => {
      const n = new Map(m);
      want.forEach((p) => n.has(p) && n.set(p, now));
      return n;
    });
    const missing = want.filter((p) => !pages.has(p) && !pending.current.has(p));
    if (!missing.length) return;
    missing.forEach((p) => pending.current.add(p));
    const t = setTimeout(() => {
      setPages((m) => {
        const n = new Map(m);
        missing.forEach((p) => { n.set(p, Date.now()); pending.current.delete(p); });
        if (n.size > MAX_PAGES) [...n.entries()].sort((a, b) => a[1] - b[1]).slice(0, n.size - MAX_PAGES).forEach(([p]) => n.delete(p));
        return n;
      });
    }, 220);
    return () => { clearTimeout(t); missing.forEach((p) => pending.current.delete(p)); };
  }, [firstPage, lastPage, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToIndex = useCallback((i: number) => {
    const el = scroller.current!;
    const r = maxStart ? Math.min(1, Math.max(0, i - 2) / maxStart) : 0;
    el.scrollTop = r * (trackH - vh);
  }, [maxStart, trackH, vh]);

  const doJump = () => {
    const n = Number(jump.replace(/[,_\s]/g, ""));
    if (!Number.isFinite(n)) return;
    // newest first: index = lastSeq - seq (approximate when filtered; the real app asks the server)
    const idx = filter ? 0 : Math.min(total - 1, Math.max(0, s.lastSeq - n));
    scrollToIndex(idx);
  };

  const rows = [];
  for (let i = start; i < Math.min(total, start + visible + 1); i++) {
    const loaded = pages.has(Math.floor(i / PAGE));
    const seq = seqAt(i);
    if (!loaded) {
      rows.push(
        <div key={i} className={cx(cols, "border-b border-line-soft px-4")} style={{ height: ROW }}>
          <span className="font-mono text-faint tabular">#{fmt(seq)}</span>
          {[70, 60, 40, 20, 90].map((w, k) => <span key={k} className="h-2.5 animate-pulse rounded bg-white/[0.05]" style={{ width: `${w}%` }} />)}
        </div>,
      );
      continue;
    }
    const m = metaAt(seq);
    const large = m.size >= 1024 * 1024;
    rows.push(
      <div key={i} onClick={() => onOpen(seq, seqAt, i)} className={cx(cols, "cursor-pointer border-b border-line-soft px-4 text-xs hover:bg-white/[0.03]", openSeq === seq && "bg-accent/[0.07]")} style={{ height: ROW }}>
        <span className="font-mono text-faint tabular">#{seq.toLocaleString()}</span>
        <span className="font-mono text-muted tabular">{m.time}</span>
        <span className="truncate font-mono text-accent">{m.subject}</span>
        <span className={cx("text-right tabular", large ? "font-medium text-warn" : "text-muted")}>{fmtBytes(m.size)}</span>
        <span className="text-center text-faint tabular">{m.headers}</span>
        <span className="truncate font-mono text-muted">
          {m.preview ? m.preview : <span className="italic text-faint">{m.kind === "binary" ? "binary" : "large payload"} · not loaded until opened</span>}
        </span>
      </div>,
    );
  }

  const cachedRows = pages.size * PAGE;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs">
        <Funnel size={13} className="text-faint" />
        <input
          value={draftFilter}
          onChange={(e) => setDraftFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setFilter(draftFilter.trim())}
          onBlur={() => setFilter(draftFilter.trim())}
          placeholder="Subject filter, e.g. orders.paid, orders.*, orders.export.>"
          className="w-[340px] bg-transparent font-mono outline-none placeholder:font-sans placeholder:text-faint"
        />
        <div className="ml-2 flex items-center gap-1.5 rounded-md border border-line px-2">
          <Hash size={12} className="text-faint" />
          <input value={jump} onChange={(e) => setJump(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doJump()} placeholder="Jump to seq" className="h-7 w-28 bg-transparent font-mono outline-none placeholder:font-sans placeholder:text-faint" />
        </div>
        <Button variant="outline">Jump to time…</Button>
        <div className="flex-1" />
        <Badge><Eye size={11} />Browsing · no side effects</Badge>
        <span className="tabular text-muted"><span className="text-fg">{total.toLocaleString()}</span> messages{filter && <> matching <span className="font-mono text-accent">{filter}</span></>}</span>
      </div>
      <div className={cx(cols, "border-b border-line bg-panel px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-faint")}>
        <span>Seq</span><span>Received (UTC)</span><span>Subject</span><span className="text-right">Size</span><span className="text-center">Hdrs</span><span>Payload preview</span>
      </div>
      <div ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: Math.max(trackH, 1) }}>
          <div className="sticky top-0 overflow-hidden" style={{ height: vh }}>
            <div style={{ transform: `translateY(${offset}px)` }}>{rows}</div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 border-t border-line px-4 py-1.5 text-[11px] text-faint">
        <span className="tabular">rows {(start + 1).toLocaleString()}–{Math.min(total, start + visible).toLocaleString()} of {total.toLocaleString()}</span>
        <span>·</span>
        <span className="tabular">{pages.size} pages ({cachedRows.toLocaleString()} rows) of metadata in memory ≈ {fmtBytes(cachedRows * 220)}</span>
        <span>·</span>
        <span>payloads fetched only when a message is opened</span>
        {fullH > MAX_SCROLL && <Badge className="ml-auto">scaled scrollbar</Badge>}
      </div>
    </div>
  );
}

export function MessageDrawer({ stream, seq, onClose, onPrev, onNext, onReplay }: { stream: string; seq: number; onClose: () => void; onPrev?: () => void; onNext?: () => void; onReplay: () => void }) {
  const { toast, setExamples, active } = useApp();
  const m = useMemo(() => messageAt(seq), [seq]);
  const [full, setFull] = useState<"no" | "loading" | "yes">("no");
  const [progress, setProgress] = useState(0);
  useEffect(() => { setFull("no"); setProgress(0); }, [seq]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); e.stopPropagation(); onPrev?.(); }
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); e.stopPropagation(); onNext?.(); }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose, onPrev, onNext]);
  const loadFull = () => {
    setFull("loading");
    let p = 0;
    const t = setInterval(() => {
      p += 17;
      setProgress(Math.min(100, p));
      if (p >= 100) { clearInterval(t); setFull("yes"); }
    }, 120);
  };
  const saveAsExample = () => {
    if (m.truncatedAt) { toast("Too large to save as an example in this mock"); return; }
    setExamples((ex) => [...ex, { id: `e${Date.now()}`, context: active.name, folder: "from messages", name: `${m.subject} #${m.seq}`, mode: "pub", subject: m.subject, headers: Object.entries(m.headers), payload: m.kind === "json" ? JSON.stringify(JSON.parse(m.payload), null, 2) : m.payload }]);
    toast(`Saved as example in ${active.name}`);
  };

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <aside onClick={(e) => e.stopPropagation()} className="absolute bottom-0 right-0 top-0 flex w-[640px] flex-col border-l border-line bg-panel shadow-[-24px_0_60px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm text-accent">{m.subject}</div>
            <div className="mt-0.5 text-xs text-muted tabular">{stream} · seq {m.seq.toLocaleString()} · {m.time} UTC · {fmtBytes(m.size)}</div>
          </div>
          <button onClick={onPrev} title="Newer (↑ / k)" className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-fg"><ChevronUp size={16} /></button>
          <button onClick={onNext} title="Older (↓ / j)" className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-fg"><ChevronDown size={16} /></button>
          <button onClick={onClose} title="Close (Esc)" className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-fg"><X size={16} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-5 py-2.5">
          <CopyCli cmd={cliFor.msgGet(stream, m.seq)} />
          <div className="flex-1" />
          <Button variant="outline" onClick={saveAsExample}><Save size={12} />Save as example</Button>
          <Writable><Button variant="outline" onClick={onReplay}><Repeat size={12} />Replay…</Button></Writable>
          <DangerAction label="Delete" icon={<Trash size={12} />} title="Delete message" body={<>Delete message <span className="font-mono text-fg">#{m.seq}</span> from {stream}?</>} cli={`nats stream rmm ${stream} ${m.seq} -f`} />
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-auto px-5 py-4">
          <section>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Headers</div>
            <HeadersTable h={m.headers} />
          </section>
          <section>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-faint">
              Payload <span className="normal-case tracking-normal">{fmtBytes(m.size)}</span>
            </div>
            {m.truncatedAt && full !== "yes" && (
              <div className="mb-3 rounded-lg border border-warn/20 bg-warn/[0.05] p-3 text-xs">
                <div className="flex items-center gap-2 text-warn"><FileStack size={14} />Showing the first {fmtBytes(m.truncatedAt)} of {fmtBytes(m.size)}</div>
                <p className="mt-1 text-muted">Large payloads are streamed and rendered in pieces so the page stays responsive.</p>
                <div className="mt-2.5 flex items-center gap-2">
                  {full === "loading" ? (
                    <div className="flex flex-1 items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-warn transition-all" style={{ width: `${progress}%` }} /></div>
                      <span className="tabular text-muted">{progress}%</span>
                    </div>
                  ) : (
                    <Button variant="outline" onClick={loadFull}>Load full {fmtBytes(m.size)}</Button>
                  )}
                  <Button variant="outline" onClick={() => toast("Download started (mock)")}><Download size={12} />Download</Button>
                </div>
              </div>
            )}
            {m.truncatedAt && full === "yes" && <div className="mb-3 text-[11px] text-ok">Full payload loaded · JSON tree folds lazily, only open nodes render</div>}
            <PayloadView m={m} maxHeight={520} />
          </section>
        </div>
        <div className="flex items-center gap-3 border-t border-line px-5 py-2 text-[11px] text-faint">
          <Kbd>↑</Kbd><Kbd>↓</Kbd> newer / older <Kbd>esc</Kbd> close
        </div>
      </aside>
    </div>
  );
}
