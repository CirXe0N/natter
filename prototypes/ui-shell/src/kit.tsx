// PROTOTYPE: small shared widgets. Layout lives in each variant, not here.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Lock, LockOpen, ShieldAlert, TriangleAlert, Vault, KeyRound, Search, CornerDownLeft } from "lucide-react";
import { contexts as initialContexts, initialExamples, randomWalk, secretLabel, type Context, type Example, type Message } from "./data";

export const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(" ");

// ---------- App state (in memory) ----------
type Toast = { id: number; text: string };
type Confirm = { title: string; body: ReactNode; typeToConfirm?: string; cli?: string; danger?: boolean; onConfirm: () => void };
type State = {
  contexts: Context[];
  active: Context;
  setActive: (name: string) => void;
  toggleReadOnly: (name: string) => void;
  toast: (t: string) => void;
  confirm: (c: Confirm) => void;
  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;
  examples: Example[];
  setExamples: (f: (e: Example[]) => Example[]) => void;
  /** A message handed to the publish page, e.g. from "Replay" in the message drawer. */
  draft: Example | null;
  setDraft: (e: Example | null) => void;
};
const Ctx = createContext<State>(null!);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ctxs, setCtxs] = useState(initialContexts);
  const [activeName, setActiveName] = useState(() => new URLSearchParams(location.search).get("ctx") ?? "staging");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [examples, setExamples] = useState(initialExamples);
  const [draft, setDraft] = useState<Example | null>(null);
  const active = ctxs.find((c) => c.name === activeName) ?? ctxs[0];

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    p.set("ctx", active.name);
    history.replaceState(null, "", `?${p}`);
  }, [active.name]);

  const value: State = {
    contexts: ctxs,
    active,
    setActive: setActiveName,
    toggleReadOnly: (n) => setCtxs((cs) => cs.map((c) => (c.name === n ? { ...c, readOnly: !c.readOnly } : c))),
    toast: (text) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
    },
    confirm: setConfirm,
    paletteOpen,
    setPaletteOpen,
    examples,
    setExamples,
    draft,
    setDraft,
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      {confirm && <ConfirmDialog c={confirm} onClose={() => setConfirm(null)} />}
      <div className="fixed right-4 top-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl shadow-black/40">
            <Check size={14} className="text-ok" /> {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

// ---------- Primitives ----------
export function Badge({ tone = "muted", children, className }: { tone?: "muted" | "ok" | "warn" | "bad" | "info" | "accent"; children: ReactNode; className?: string }) {
  const tones = {
    muted: "bg-white/5 text-muted border-white/5",
    ok: "bg-ok/10 text-ok border-ok/20",
    warn: "bg-warn/10 text-warn border-warn/20",
    bad: "bg-bad/10 text-bad border-bad/20",
    info: "bg-info/10 text-info border-info/20",
    accent: "bg-accent/10 text-accent border-accent/20",
  };
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)}>{children}</span>;
}

export function Button({ children, onClick, variant = "ghost", disabled, title, className }: { children: ReactNode; onClick?: () => void; variant?: "ghost" | "solid" | "danger" | "outline"; disabled?: boolean; title?: string; className?: string }) {
  const v = {
    ghost: "text-muted hover:text-fg hover:bg-white/5",
    outline: "border border-line text-fg hover:bg-white/5",
    solid: "bg-accent text-black font-medium hover:brightness-110",
    danger: "border border-bad/30 text-bad hover:bg-bad/10",
  };
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={cx("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40", v[variant], className)}>
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function CopyCli({ cmd, compact }: { cmd: string; compact?: boolean }) {
  const { toast } = useApp();
  return (
    <button
      title={`Copy as: ${cmd}`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(cmd);
        toast(`Copied: ${cmd}`);
      }}
      className="group inline-flex items-center gap-1.5 rounded-md border border-line-soft bg-black/20 px-2 py-1 font-mono text-[11px] text-faint hover:border-line hover:text-muted"
    >
      <Copy size={11} />
      {!compact && <span className="max-w-[340px] truncate">{cmd}</span>}
    </button>
  );
}

/** A destructive action button that respects Read-only mode and the two confirm levels. */
export function DangerAction({ label, title, body, typeToConfirm, cli, onDone, icon }: { label: string; title: string; body: ReactNode; typeToConfirm?: string; cli: string; onDone?: () => void; icon?: ReactNode }) {
  const { active, confirm, toast } = useApp();
  if (active.readOnly) return null;
  return (
    <Button variant="danger" onClick={() => confirm({ title, body, typeToConfirm, cli, danger: true, onConfirm: () => { toast(`${title}: done (mock)`); onDone?.(); } })}>
      {icon}
      {label}
    </Button>
  );
}

/** Wraps write actions: hidden when the active Context is in Read-only mode. */
export function Writable({ children }: { children: ReactNode }) {
  const { active } = useApp();
  return active.readOnly ? null : <>{children}</>;
}

function ConfirmDialog({ c, onClose }: { c: Confirm; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const ok = !c.typeToConfirm || typed === c.typeToConfirm;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[440px] rounded-xl border border-line bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          {c.danger && <TriangleAlert size={16} className="text-bad" />} {c.title}
        </div>
        <div className="mt-2 text-xs leading-relaxed text-muted">{c.body}</div>
        {c.cli && (
          <div className="mt-3 rounded-md border border-line-soft bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-faint">
            <span className="text-accent">$</span> {c.cli}
          </div>
        )}
        {c.typeToConfirm && (
          <label className="mt-4 block text-xs text-muted">
            Type <span className="font-mono text-fg">{c.typeToConfirm}</span> to confirm
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1.5 w-full rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-xs outline-none focus:border-bad/60" />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <button
            disabled={!ok}
            onClick={() => { c.onConfirm(); onClose(); }}
            className="h-7 rounded-md bg-bad px-3 text-xs font-medium text-black disabled:opacity-30"
          >
            {c.title}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Context status ----------
export function SecretBadge({ c }: { c: Context }) {
  if (c.secret === "plaintext")
    return <Badge tone="warn"><TriangleAlert size={11} />Plaintext secret</Badge>;
  return <Badge tone="muted">{c.secret === "vault" ? <Vault size={11} /> : <KeyRound size={11} />}{secretLabel[c.secret]}</Badge>;
}

export function ReadOnlyBadge({ c, toggle }: { c: Context; toggle?: boolean }) {
  const { toggleReadOnly } = useApp();
  const el = c.readOnly ? (
    <Badge tone="warn"><Lock size={11} />Read-only</Badge>
  ) : (
    <Badge tone="muted"><LockOpen size={11} />Writable</Badge>
  );
  if (!toggle) return el;
  return <button title="Toggle Read-only mode" onClick={(e) => { e.stopPropagation(); toggleReadOnly(c.name); }}>{el}</button>;
}

export function NeedsSystemAccess({ what }: { what: string }) {
  const { active } = useApp();
  return (
    <div className="grid h-full min-h-[240px] place-items-center p-8">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-warn/10 text-warn"><ShieldAlert size={18} /></div>
        <div className="text-sm font-medium">{what} needs system access</div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          The Context <span className="font-mono text-fg">{active.name}</span> uses user <span className="font-mono text-fg">{active.user}</span>, which can't read server-wide data.
          {active.monitoringUrl ? <> The real app would fall back to the Monitoring URL <span className="font-mono">{active.monitoringUrl}</span>, read-only.</> : <> Add System credentials or a Monitoring URL to this Context.</>}
        </p>
        <Button variant="outline" className="mt-4">Add System credentials</Button>
      </div>
    </div>
  );
}

// ---------- Charts ----------
export function useLiveSeries(start: number, jitter: number, n = 60) {
  const [s, setS] = useState(() => randomWalk(n, start, jitter));
  useEffect(() => {
    const t = setInterval(() => setS((p) => [...p.slice(1), Math.max(0, p[p.length - 1] + (Math.random() - 0.5) * jitter)]), 1000);
    return () => clearInterval(t);
  }, [jitter]);
  return s;
}

export function Sparkline({ data, color = "var(--color-accent)", height = 32, fill = true }: { data: number[]; color?: string; height?: number; fill?: boolean }) {
  const w = 120;
  const max = Math.max(...data) * 1.1 || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - (v / max) * height}`).join(" ");
  const id = useMemo(() => `g${Math.random().toString(36).slice(2)}`, []);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <polygon points={`0,${height} ${pts} ${w},${height}`} fill={`url(#${id})`} />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function fmt(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return Math.round(n).toLocaleString();
}

// ---------- Payload viewer ----------
export function PayloadView({ m, maxHeight }: { m: Message; maxHeight?: number }) {
  const [view, setView] = useState<"auto" | "text" | "hex">("auto");
  const effective = view === "auto" ? (m.kind === "binary" ? "hex" : m.kind === "json" ? "json" : "text") : view;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-1">
        {(["auto", "text", "hex"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={cx("rounded px-2 py-0.5 text-[11px]", view === v ? "bg-white/10 text-fg" : "text-faint hover:text-muted")}>
            {v === "auto" ? `Auto · ${m.kind}` : v}
          </button>
        ))}
      </div>
      <pre className="overflow-auto rounded-lg border border-line-soft bg-black/30 p-3 font-mono text-[12px] leading-relaxed" style={{ maxHeight }}>
        {effective === "json" ? <JsonTree value={JSON.parse(m.payload)} /> : effective === "hex" ? hexDump(m.payload) : m.payload}
      </pre>
    </div>
  );
}

function hexDump(s: string) {
  const bytes = s.match(/.{1,2}/g) ?? [];
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) rows.push(`${i.toString(16).padStart(8, "0")}  ${bytes.slice(i, i + 16).join(" ")}`);
  return rows.join("\n");
}

function JsonTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  if (value === null || typeof value !== "object") {
    const color = typeof value === "string" ? "text-ok" : typeof value === "number" ? "text-info" : "text-warn";
    return <span className={color}>{JSON.stringify(value)}</span>;
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const [l, r] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  if (!open) return <button onClick={() => setOpen(true)} className="text-faint hover:text-muted">{l} … {entries.length} {r}</button>;
  return (
    <span>
      <button onClick={() => setOpen(false)} className="text-faint hover:text-muted">{l}</button>
      {entries.map(([k, v], i) => (
        <div key={k} style={{ paddingLeft: 16 }}>
          {!Array.isArray(value) && <span className="text-accent">"{k}"</span>}
          {!Array.isArray(value) && <span className="text-faint">: </span>}
          <JsonTree value={v} depth={depth + 1} />
          {i < entries.length - 1 && <span className="text-faint">,</span>}
        </div>
      ))}
      <span className="text-faint">{r}</span>
    </span>
  );
}

export function HeadersTable({ h }: { h: Record<string, string> }) {
  const e = Object.entries(h);
  if (!e.length) return <div className="text-xs text-faint">No headers</div>;
  return (
    <table className="w-full text-xs">
      <tbody>
        {e.map(([k, v]) => (
          <tr key={k} className="border-b border-line-soft last:border-0">
            <td className="py-1 pr-3 font-mono text-muted">{k}</td>
            <td className="py-1 font-mono">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Command palette ----------
export type Command = { id: string; label: string; group: string; hint?: string; cli?: string; run: () => void };

export function CommandPalette({ commands }: { commands: Command[] }) {
  const { paletteOpen, setPaletteOpen } = useApp();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(!paletteOpen); }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);
  useEffect(() => { if (paletteOpen) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus()); } }, [paletteOpen]);
  const list = commands.filter((c) => `${c.group} ${c.label} ${c.cli ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 14);
  if (!paletteOpen) return null;
  const run = (c?: Command) => { if (!c) return; c.run(); setPaletteOpen(false); };
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 bg-black/50 pt-[12vh] backdrop-blur-[2px]" onClick={() => setPaletteOpen(false)}>
      <div className="mx-auto w-[620px] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/60" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={15} className="text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") run(list[sel]);
            }}
            placeholder="Jump to a screen, stream, bucket, Context, or run an action…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="max-h-[420px] overflow-auto py-1.5">
          {list.length === 0 && <div className="px-4 py-6 text-center text-xs text-faint">No matches</div>}
          {list.map((c, i) => {
            const header = c.group !== lastGroup ? (lastGroup = c.group) : null;
            return (
              <div key={c.id}>
                {header && <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{header}</div>}
                <div
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(c)}
                  className={cx("mx-1.5 flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2", sel === i && "bg-white/[0.06]")}
                >
                  <span className="flex-1 text-[13px]">{c.label}</span>
                  {c.cli && <span className="truncate font-mono text-[11px] text-faint">{c.cli}</span>}
                  {sel === i && <CornerDownLeft size={12} className="text-faint" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
