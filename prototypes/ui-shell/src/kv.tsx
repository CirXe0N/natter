// PROTOTYPE: Key-Value page without side panels. Bucket picker + stats in a header bar, a full-width
// keys table, and key details in a drawer that only opens when you click a key (same pattern as messages).
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Database, Funnel, Pencil, Plus, RotateCcw, Trash, X, Check } from "lucide-react";
import { Badge, Button, CopyCli, DangerAction, Kbd, PayloadView, Writable, cx, fmt, useApp } from "./kit";
import { cliFor, kvBuckets, kvEntries, kvHistory, type KvEntry, type Message } from "./data";

const NOW = Date.UTC(2026, 9, 31, 15, 0, 0);
/** Mock: turn "3m ago" into an absolute UTC timestamp for the table. */
function absTime(rel: string) {
  const m = rel.match(/(\d+)([mhd])/);
  const ms = m ? +m[1] * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2] as "m" | "h" | "d"] : 0;
  return new Date(NOW - ms).toISOString().replace("T", " ").slice(0, 19);
}

type Row = KvEntry & { deleted?: boolean };

function entriesFor(bucket: string): Row[] {
  if (bucket === "config") return [...kvEntries, { key: "app.legacy.mode", value: "", revision: 112, updated: "9d ago", deleted: true }];
  if (bucket === "sessions")
    return Array.from({ length: 24 }, (_, i) => ({ key: `sess.${(0x9f3a2 + i * 7919).toString(16)}`, value: JSON.stringify({ user: `usr_${1200 + i}`, ip: `10.2.0.${i + 4}`, cart: i % 3 }), revision: 91_004 - i * 13, updated: `${i + 1}m ago` }));
  return ["checkout.v2", "search.semantic", "banner.weekend", "payments.adyen_fallback", "notifier.sms", "orders.split_shipping"].map((k, i) => ({ key: k, value: String(i % 3 !== 1), revision: 40 + i, updated: `${i + 2}d ago` }));
}

export function KvPage({ initialBucket = "config" }: { initialBucket?: string }) {
  const [bucket, setBucket] = useState(initialBucket);
  const [picker, setPicker] = useState(false);
  const [q, setQ] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [open, setOpen] = useState<number | null>(null); // index into `rows`, or -1 for "put new key"
  const [flash, setFlash] = useState<string | null>(null);
  const b = kvBuckets.find((x) => x.name === bucket)!;
  const rows = useMemo(() => entriesFor(bucket).filter((e) => (showDeleted || !e.deleted) && e.key.toLowerCase().includes(q.toLowerCase())), [bucket, q, showDeleted]);

  useEffect(() => {
    const t = setInterval(() => { const r = entriesFor(bucket); setFlash(r[Math.floor(Math.random() * r.length)].key); }, 4000);
    return () => clearInterval(t);
  }, [bucket]);
  useEffect(() => setOpen(null), [bucket]);

  const stat = (label: string, value: string) => (
    <div className="px-4 py-2.5"><div className="text-[11px] text-muted">{label}</div><div className="mt-0.5 font-medium tabular">{value}</div></div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Bucket bar */}
      <div className="shrink-0 rounded-xl border border-line bg-panel">
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5">
          <div className="relative">
            <button onClick={() => setPicker(!picker)} className="flex h-9 items-center gap-2.5 rounded-lg border border-line bg-raised px-3 hover:border-faint">
              <Database size={14} className="text-accent" />
              <span className="font-mono text-sm font-semibold">{b.name}</span>
              <ChevronDown size={13} className="text-faint" />
            </button>
            {picker && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setPicker(false)} />
                <div className="absolute left-0 top-11 z-30 w-[360px] overflow-hidden rounded-xl border border-line bg-raised p-1 shadow-2xl shadow-black/60">
                  {kvBuckets.map((x) => (
                    <button key={x.name} onClick={() => { setBucket(x.name); setPicker(false); }} className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/5", x.name === bucket && "bg-white/[0.06]")}>
                      <span className="flex-1">
                        <span className="block font-mono text-xs font-medium">{x.name}</span>
                        <span className="block text-[11px] text-faint">{x.storage} · R{x.replicas} · history {x.history} · ttl {x.ttl}</span>
                      </span>
                      <span className="text-xs text-muted tabular">{fmt(x.keys)} keys</span>
                      {x.name === bucket && <Check size={13} className="text-accent" />}
                    </button>
                  ))}
                  <Writable>
                    <div className="my-1 border-t border-line" />
                    <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted hover:bg-white/5 hover:text-fg"><Plus size={13} />New bucket…</button>
                  </Writable>
                </div>
              </>
            )}
          </div>
          <Badge tone="ok"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />watching</Badge>
          <div className="flex-1" />
          <CopyCli cmd={`nats kv info ${b.name}`} compact />
          <Writable><Button variant="outline"><Pencil size={12} />Edit bucket</Button></Writable>
          <DangerAction label="Delete bucket" icon={<Trash size={12} />} title={`Delete bucket ${b.name}`} typeToConfirm={b.name} body={<>Delete KV bucket <span className="font-mono text-fg">{b.name}</span> with all {fmt(b.keys)} keys and their history. This cannot be undone.</>} cli={`nats kv del ${b.name} -f`} />
        </div>
        <div className="grid grid-cols-6 divide-x divide-line-soft">
          {stat("Keys", fmt(b.keys))}
          {stat("History per key", String(b.history))}
          {stat("TTL", b.ttl)}
          {stat("Storage", `${b.storage} · R${b.replicas}`)}
          {stat("Size", b.size)}
          {stat("Backing stream", `KV_${b.name}`)}
        </div>
      </div>

      {/* Keys */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-xs">
          <Funnel size={13} className="text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter keys in ${b.name}, e.g. app.checkout`} className="flex-1 bg-transparent font-mono outline-none placeholder:font-sans placeholder:text-faint" />
          <label className="flex cursor-pointer items-center gap-1.5 text-muted">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} className="accent-[var(--color-accent)]" />Show deleted
          </label>
          <span className="text-muted tabular">{rows.length} shown</span>
          <Writable><Button variant="solid" onClick={() => setOpen(-1)}><Plus size={12} />Put key</Button></Writable>
        </div>
        <div className="grid grid-cols-[minmax(220px,1.2fr)_minmax(0,2fr)_80px_240px] gap-4 border-b border-line px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">
          <span>Key</span><span>Value</span><span className="text-right">Revision</span><span>Updated (UTC)</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {rows.map((e, i) => (
            <div
              key={e.key + (flash === e.key ? "*" : "")}
              onClick={() => setOpen(i)}
              className={cx("grid cursor-pointer grid-cols-[minmax(220px,1.2fr)_minmax(0,2fr)_80px_240px] items-center gap-4 border-b border-line-soft px-4 py-2 text-xs hover:bg-white/[0.03]", open === i && "bg-accent/[0.07]", flash === e.key && "flash")}
            >
              <span className={cx("truncate font-mono", e.deleted && "text-faint line-through")}>{e.key}</span>
              <span className="truncate font-mono text-muted">{e.deleted ? <Badge tone="bad">deleted</Badge> : e.value}</span>
              <span className="text-right font-mono text-faint tabular">r{e.revision}</span>
              <span className="whitespace-nowrap font-mono text-muted tabular">{absTime(e.updated)} <span className="text-faint">· {e.updated}</span></span>
            </div>
          ))}
          {rows.length === 0 && <div className="p-8 text-center text-xs text-faint">No keys match</div>}
        </div>
      </div>

      {open !== null && open >= 0 && rows[open] && (
        <KeyDrawer bucket={b.name} e={rows[open]} onClose={() => setOpen(null)} onPrev={() => setOpen(Math.max(0, open - 1))} onNext={() => setOpen(Math.min(rows.length - 1, open + 1))} />
      )}
      {open === -1 && <PutKeyDrawer bucket={b.name} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DrawerShell({ title, subtitle, onClose, onPrev, onNext, actions, children }: { title: React.ReactNode; subtitle: React.ReactNode; onClose: () => void; onPrev?: () => void; onNext?: () => void; actions?: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) { if (e.key === "Escape") el.blur(); return; }
      if (e.key === "Escape") onClose();
      if (onPrev && (e.key === "ArrowUp" || e.key === "k")) { e.preventDefault(); onPrev(); }
      if (onNext && (e.key === "ArrowDown" || e.key === "j")) { e.preventDefault(); onNext(); }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose, onPrev, onNext]);
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <aside onClick={(e) => e.stopPropagation()} className="absolute bottom-0 right-0 top-0 flex w-[600px] flex-col border-l border-line bg-panel shadow-[-24px_0_60px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm font-semibold">{title}</div>
            <div className="mt-0.5 text-xs text-muted">{subtitle}</div>
          </div>
          {onPrev && <button onClick={onPrev} title="Previous (↑ / k)" className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-fg"><ChevronUp size={16} /></button>}
          {onNext && <button onClick={onNext} title="Next (↓ / j)" className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-fg"><ChevronDown size={16} /></button>}
          <button onClick={onClose} title="Close (Esc)" className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-fg"><X size={16} /></button>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-5 py-2.5">{actions}</div>}
        <div className="min-h-0 flex-1 space-y-5 overflow-auto px-5 py-4">{children}</div>
        <div className="flex items-center gap-3 border-t border-line px-5 py-2 text-[11px] text-faint">
          {onPrev && <><Kbd>↑</Kbd><Kbd>↓</Kbd> previous / next</>} <Kbd>esc</Kbd> close
        </div>
      </aside>
    </div>
  );
}

function KeyDrawer({ bucket, e, onClose, onPrev, onNext }: { bucket: string; e: Row; onClose: () => void; onPrev: () => void; onNext: () => void }) {
  const { confirm, toast, active } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(e.value);
  useEffect(() => { setEditing(false); setDraft(e.value); }, [e.key, e.value]);
  const msg: Message = { seq: e.revision, subject: `$KV.${bucket}.${e.key}`, time: e.updated, size: e.value.length, headers: {}, payload: e.value, kind: e.value.startsWith("{") ? "json" : "text" };
  const history = bucket === "config" && e.key === "app.checkout.timeout_ms" ? kvHistory : [{ ...e, op: e.deleted ? ("DEL" as const) : ("PUT" as const) }];

  return (
    <DrawerShell
      title={e.key}
      subtitle={<>{bucket} · revision {e.revision} · {absTime(e.updated)} UTC</>}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      actions={
        <>
          <CopyCli cmd={cliFor.kvGet(bucket, e.key)} />
          <div className="flex-1" />
          {!editing && !e.deleted && <Writable><Button variant="outline" onClick={() => setEditing(true)}><Pencil size={12} />Edit value</Button></Writable>}
          {!e.deleted && <DangerAction label="Delete" icon={<Trash size={12} />} title={`Delete key ${e.key}`} body={<>Write a delete marker for <span className="font-mono text-fg">{e.key}</span>. Its history is kept.</>} cli={`nats kv del ${bucket} ${e.key} -f`} />}
        </>
      }
    >
      <section>
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Value</div>
        {e.deleted ? (
          <div className="rounded-lg border border-bad/20 bg-bad/5 px-3 py-2 text-xs text-bad">Deleted at revision {e.revision}. Restore an earlier revision from the history below.</div>
        ) : editing ? (
          <div className="space-y-2">
            <textarea autoFocus value={draft} onChange={(ev) => setDraft(ev.target.value)} spellCheck={false} className="h-40 w-full resize-y rounded-lg border border-line bg-bg p-3 font-mono text-xs outline-none focus:border-accent/60" />
            <div className="flex items-center justify-between">
              <CopyCli cmd={cliFor.kvPut(bucket, e.key, draft)} />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setEditing(false); setDraft(e.value); }}>Cancel</Button>
                <Button variant="solid" onClick={() => { toast(`Put ${e.key} → revision ${e.revision + 1} (mock)`); setEditing(false); }}>Save as revision {e.revision + 1}</Button>
              </div>
            </div>
          </div>
        ) : (
          <PayloadView m={msg} maxHeight={260} />
        )}
      </section>
      <section>
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">History</div>
        <div className="overflow-hidden rounded-lg border border-line-soft">
          {history.map((h, i) => (
            <div key={h.revision} className="flex items-center gap-3 border-b border-line-soft px-3 py-2 text-xs last:border-0">
              <span className="w-12 font-mono text-faint">r{h.revision}</span>
              <Badge tone={h.op === "DEL" ? "bad" : "muted"}>{h.op}</Badge>
              <span className="flex-1 truncate font-mono">{h.value || <span className="text-faint">—</span>}</span>
              <span className="font-mono text-faint tabular">{absTime(h.updated)}</span>
              {i > 0 && h.op === "PUT" && !active.readOnly && (
                <Button onClick={() => confirm({ title: `Restore r${h.revision}`, body: <>Put <span className="font-mono text-fg">{h.value}</span> as a new revision of {e.key}.</>, cli: cliFor.kvPut(bucket, e.key, h.value), onConfirm: () => toast(`Restored r${h.revision} (mock)`) })}>
                  <RotateCcw size={12} />Restore
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
    </DrawerShell>
  );
}

function PutKeyDrawer({ bucket, onClose }: { bucket: string; onClose: () => void }) {
  const { toast } = useApp();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  return (
    <DrawerShell title="Put key" subtitle={<>into {bucket}</>} onClose={onClose}>
      <label className="block text-xs text-muted">Key
        <input autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. app.checkout.timeout_ms" className="mt-1.5 h-9 w-full rounded-lg border border-line bg-bg px-3 font-mono text-xs outline-none focus:border-accent/60" />
      </label>
      <label className="block text-xs text-muted">Value
        <textarea value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} className="mt-1.5 h-56 w-full resize-y rounded-lg border border-line bg-bg p-3 font-mono text-xs outline-none focus:border-accent/60" />
      </label>
      <div className="flex items-center justify-between">
        <CopyCli cmd={cliFor.kvPut(bucket, key || "<key>", value)} />
        <Button variant="solid" disabled={!key} onClick={() => { toast(`Put ${key} (mock)`); onClose(); }}>Put</Button>
      </div>
    </DrawerShell>
  );
}
