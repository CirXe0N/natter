// PROTOTYPE: screen bodies shared by the variants. They fill whatever box the variant gives them.
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Trash, Plus, RotateCcw, Unplug, Send, Funnel, Clock, Eye, Server as ServerIcon, CircleCheck, CircleAlert } from "lucide-react";
import {
  Badge, Button, CopyCli, DangerAction, HeadersTable, NeedsSystemAccess, PayloadView, ReadOnlyBadge, SecretBadge, Sparkline, Writable, cx, fmt, useApp, useLiveSeries,
} from "./kit";
import { cliFor, connections, consumers, kvBuckets, kvEntries, kvHistory, messages, nextTailMessage, servers, streams, type Consumer, type KvEntry, type Message, type Stream } from "./data";

const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-faint";
const td = "px-3 py-2 whitespace-nowrap";
const row = "border-b border-line-soft hover:bg-white/[0.025] cursor-pointer";

// ---------- Overview ----------
export function KpiRow({ dense }: { dense?: boolean }) {
  const { active } = useApp();
  const msgsIn = useLiveSeries(18400, 2400);
  const msgsOut = useLiveSeries(52100, 6000);
  const bytesIn = useLiveSeries(42, 8);
  const conns = useLiveSeries(366, 6);
  const sys = active.hasSystemCreds;
  const tiles = [
    { label: "Msgs in /s", v: fmt(msgsIn.at(-1)!), s: msgsIn, needs: true },
    { label: "Msgs out /s", v: fmt(msgsOut.at(-1)!), s: msgsOut, needs: true },
    { label: "Bytes in /s", v: `${bytesIn.at(-1)!.toFixed(1)} MiB`, s: bytesIn, needs: true },
    { label: "Connections", v: fmt(conns.at(-1)!), s: conns, needs: true },
    { label: "Slow consumers", v: "1", s: [0, 0, 0, 1, 1, 1, 1], needs: true, tone: "warn" },
    { label: "JetStream storage", v: "2.6 / 50 GiB", bar: 5.2, needs: false },
  ];
  return (
    <div className={cx("grid gap-px overflow-hidden rounded-xl border border-line bg-line", dense ? "grid-cols-6" : "grid-cols-3 xl:grid-cols-6")}>
      {tiles.map((t) => (
        <div key={t.label} className="bg-panel p-3.5">
          <div className="text-[11px] text-muted">{t.label}</div>
          {t.needs && !sys ? (
            <div className="mt-2 text-xs text-faint">needs system access</div>
          ) : (
            <>
              <div className={cx("mt-1 text-xl font-semibold tabular", t.tone === "warn" && "text-warn")}>{t.v}</div>
              <div className="mt-1.5">
                {t.s ? <Sparkline data={t.s} height={26} color={t.tone === "warn" ? "var(--color-warn)" : undefined} /> : (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-accent" style={{ width: `${t.bar}%` }} /></div>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function ServersTable() {
  const { active } = useApp();
  if (!active.hasSystemCreds) return <NeedsSystemAccess what="Server health" />;
  return (
    <table className="w-full text-xs">
      <thead><tr className="border-b border-line"><th className={th}>Server</th><th className={th}>Health</th><th className={th}>Version</th><th className={th}>Cluster</th><th className={th}>Conns</th><th className={th}>CPU</th><th className={th}>Mem</th><th className={th}>Uptime</th></tr></thead>
      <tbody>
        {servers.map((s) => (
          <tr key={s.name} className="border-b border-line-soft last:border-0">
            <td className={td}><span className="inline-flex items-center gap-2 font-mono"><ServerIcon size={13} className="text-faint" />{s.name}{s.jsLeader && <Badge tone="accent">JS leader</Badge>}</span></td>
            <td className={td}>{s.healthy ? <Badge tone="ok"><CircleCheck size={11} />ok</Badge> : <Badge tone="bad"><CircleAlert size={11} />JetStream catching up</Badge>}</td>
            <td className={cx(td, "font-mono", s.version !== "2.15.2" && "text-warn")}>{s.version}</td>
            <td className={cx(td, "text-muted")}>{s.cluster}</td>
            <td className={cx(td, "tabular")}>{s.conns}</td>
            <td className={cx(td, "tabular")}>{s.cpu}%</td>
            <td className={cx(td, "tabular")}>{s.mem}</td>
            <td className={cx(td, "text-muted")}>{s.uptime}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Connections ----------
export function ConnectionsTable({ onSelect, selected }: { onSelect?: (cid: number) => void; selected?: number }) {
  const { active } = useApp();
  const [q, setQ] = useState("");
  if (!active.hasSystemCreds) return <NeedsSystemAccess what="The Connections list" />;
  const list = connections.filter((c) => `${c.name} ${c.ip} ${c.account} ${c.lang}`.includes(q));
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Funnel size={13} className="text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, IP, account, language…" className="flex-1 bg-transparent text-xs outline-none placeholder:text-faint" />
        <Badge>{list.length} open</Badge>
        <Badge tone="warn">1 slow</Badge>
        <CopyCli cmd={cliFor.connz()} compact />
      </div>
      <div className="min-h-0 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel"><tr className="border-b border-line"><th className={th}>CID</th><th className={th}>Name</th><th className={th}>Account</th><th className={th}>Lang</th><th className={th}>IP</th><th className={th}>RTT</th><th className={th}>Subs</th><th className={th}>Pending</th><th className={th}>In / Out</th><th className={th}>Server</th><th className={th}></th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.cid} onClick={() => onSelect?.(c.cid)} className={cx(row, selected === c.cid && "bg-accent/5")}>
                <td className={cx(td, "font-mono text-muted")}>{c.cid}</td>
                <td className={cx(td, "font-medium")}>{c.name} {c.slow && <Badge tone="warn">slow consumer</Badge>}</td>
                <td className={td}><Badge>{c.account}</Badge></td>
                <td className={cx(td, "text-muted")}>{c.lang} <span className="text-faint">{c.version}</span></td>
                <td className={cx(td, "font-mono text-muted")}>{c.ip}</td>
                <td className={cx(td, "tabular")}>{c.rtt}</td>
                <td className={cx(td, "tabular")}>{c.subs}</td>
                <td className={cx(td, "tabular", c.pending > 10000 && "text-warn")}>{fmt(c.pending)}</td>
                <td className={cx(td, "tabular text-muted")}>{fmt(c.inMsgs)} / {fmt(c.outMsgs)}</td>
                <td className={cx(td, "font-mono text-muted")}>{c.server}</td>
                <td className={cx(td, "text-right")} onClick={(e) => e.stopPropagation()}>
                  <DangerAction label="Kick" icon={<Unplug size={12} />} title={`Disconnect ${c.name}`} body={<>Disconnect Connection <span className="font-mono text-fg">{c.cid}</span>? The client will usually reconnect on its own.</>} cli={cliFor.kick(c.cid)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Streams ----------
export function StreamsTable({ onOpen, kinds = ["stream"], selected, limit, busiestFirst }: { onOpen: (s: Stream) => void; kinds?: Stream["kind"][]; selected?: string; limit?: number; busiestFirst?: boolean }) {
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-panel"><tr className="border-b border-line"><th className={th}>Name</th><th className={th}>Subjects</th><th className={th}>Storage</th><th className={th}>Retention</th><th className={th}>Messages</th><th className={th}>Size</th><th className={th}>Consumers</th><th className={th}>Activity</th></tr></thead>
      <tbody>
        {streams.filter((s) => kinds.includes(s.kind)).sort((a, b) => (busiestFirst ? b.messages - a.messages : 0)).slice(0, limit).map((s) => (
          <tr key={s.name} onClick={() => onOpen(s)} className={cx(row, selected === s.name && "bg-accent/5")}>
            <td className={cx(td, "font-mono font-medium")}>{s.name}</td>
            <td className={td}><div className="flex flex-wrap gap-1">{s.subjects.map((x) => <Badge key={x} className="font-mono">{x}</Badge>)}</div></td>
            <td className={cx(td, "text-muted")}>{s.storage} · R{s.replicas}</td>
            <td className={cx(td, "text-muted")}>{s.retention}</td>
            <td className={cx(td, "tabular")}>{fmt(s.messages)}</td>
            <td className={cx(td, "tabular")}>{s.bytes}</td>
            <td className={cx(td, "tabular")}>{s.consumers}</td>
            <td className={cx(td, s.lastActivity === "now" ? "text-ok" : "text-muted")}>{s.lastActivity}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StreamStats({ s }: { s: Stream }) {
  const rate = useLiveSeries(s.name === "ORDERS" ? 820 : 120, 160);
  const items = [
    ["Messages", fmt(s.messages)], ["Size", s.bytes], ["First seq", fmt(s.firstSeq)], ["Last seq", fmt(s.lastSeq)],
    ["Storage", `${s.storage} · R${s.replicas}`], ["Retention", s.retention], ["Max age", s.maxAge], ["Consumers", String(s.consumers)],
  ];
  return (
    <div className="grid grid-cols-[1fr_260px] gap-4">
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-line bg-line">
        {items.map(([k, v]) => (
          <div key={k} className="bg-panel px-3 py-2.5"><div className="text-[11px] text-muted">{k}</div><div className="mt-0.5 font-medium tabular">{v}</div></div>
        ))}
      </div>
      <div className="rounded-xl border border-line bg-panel p-3">
        <div className="flex justify-between text-[11px] text-muted"><span>Ingest msgs/s</span><span className="tabular text-fg">{fmt(rate.at(-1)!)}</span></div>
        <div className="mt-3"><Sparkline data={rate} height={48} /></div>
      </div>
    </div>
  );
}

export function StreamActions({ s }: { s: Stream }) {
  return (
    <div className="flex items-center gap-2">
      <CopyCli cmd={cliFor.streamInfo(s.name)} />
      <Writable><Button variant="outline">Edit config</Button></Writable>
      <DangerAction label="Purge" title={`Purge ${s.name}`} typeToConfirm={s.name} body={<>Remove all {fmt(s.messages)} messages from <span className="font-mono text-fg">{s.name}</span>. The stream and its consumers stay. This cannot be undone.</>} cli={cliFor.streamPurge(s.name)} />
      <DangerAction label="Delete" icon={<Trash size={12} />} title={`Delete ${s.name}`} typeToConfirm={s.name} body={<>Delete stream <span className="font-mono text-fg">{s.name}</span>, its {s.consumers} consumers and all its data. This cannot be undone.</>} cli={cliFor.streamDelete(s.name)} />
    </div>
  );
}

export function StreamConfigEditor({ s }: { s: Stream }) {
  const [tab, setTab] = useState<"form" | "json">("form");
  const field = (label: string, value: string, locked?: boolean) => (
    <label className="block">
      <span className="flex items-center gap-1.5 text-[11px] text-muted">{label}{locked && <Badge>fixed after create</Badge>}</span>
      <input defaultValue={value} disabled={locked} className="mt-1 w-full rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent/60 disabled:opacity-50" />
    </label>
  );
  return (
    <div>
      <div className="mb-3 flex gap-1">
        {(["form", "json"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cx("rounded-md px-2.5 py-1 text-xs", tab === t ? "bg-white/10" : "text-muted")}>{t === "form" ? "Form" : "Advanced (JSON)"}</button>)}
      </div>
      {tab === "form" ? (
        <div className="grid grid-cols-2 gap-3">
          {field("Name", s.name, true)}
          {field("Subjects", s.subjects.join(", "))}
          {field("Storage", s.storage, true)}
          {field("Replicas", String(s.replicas))}
          {field("Retention", s.retention, true)}
          {field("Max age", s.maxAge)}
        </div>
      ) : (
        <pre className="rounded-lg border border-line-soft bg-black/30 p-3 font-mono text-[12px] text-muted">{JSON.stringify({ name: s.name, subjects: s.subjects, retention: s.retention, storage: s.storage, num_replicas: s.replicas, max_age: s.maxAge, discard: "old", duplicate_window: "2m", allow_direct: true }, null, 2)}</pre>
      )}
      <Writable><div className="mt-3 flex justify-end"><Button variant="solid">Review diff…</Button></div></Writable>
    </div>
  );
}

// ---------- Consumers ----------
export function ConsumersTable({ stream, onOpen, selected, limit, mostLagFirst }: { stream?: string; onOpen?: (c: Consumer) => void; selected?: string; limit?: number; mostLagFirst?: boolean }) {
  const list = consumers.filter((c) => !stream || c.stream === stream).sort((a, b) => (mostLagFirst ? b.pending - a.pending : 0)).slice(0, limit);
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-panel"><tr className="border-b border-line">{!stream && <th className={th}>Stream</th>}<th className={th}>Consumer</th><th className={th}>Filter</th><th className={th}>Ack</th><th className={th}>Pending</th><th className={th}>Ack pending</th><th className={th}>Redelivered</th><th className={th}>Waiting</th><th className={th}>Last active</th></tr></thead>
      <tbody>
        {list.map((c) => (
          <tr key={c.stream + c.name} onClick={() => onOpen?.(c)} className={cx(row, selected === c.name && "bg-accent/5")}>
            {!stream && <td className={cx(td, "font-mono text-muted")}>{c.stream}</td>}
            <td className={cx(td, "font-mono font-medium")}>{c.name} {c.paused && <Badge tone="info">paused</Badge>}</td>
            <td className={td}><Badge className="font-mono">{c.filter}</Badge></td>
            <td className={cx(td, "text-muted")}>{c.ackPolicy}</td>
            <td className={cx(td, "tabular")}><LagBar n={c.pending} /></td>
            <td className={cx(td, "tabular", c.ackPending > 100 && "text-warn")}>{fmt(c.ackPending)}</td>
            <td className={cx(td, "tabular", c.redelivered > 0 && "text-warn")}>{c.redelivered}</td>
            <td className={cx(td, "tabular")}>{c.waiting}</td>
            <td className={cx(td, c.lastActive === "now" ? "text-ok" : "text-muted")}>{c.lastActive}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LagBar({ n }: { n: number }) {
  const pct = Math.min(100, (Math.log10(n + 1) / 5) * 100);
  const tone = n > 10000 ? "bg-bad" : n > 500 ? "bg-warn" : "bg-ok";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5"><div className={cx("h-full rounded-full", tone)} style={{ width: `${pct}%` }} /></div>
      <span className={n > 10000 ? "text-bad" : ""}>{fmt(n)}</span>
    </div>
  );
}

export function ConsumerDetail({ c }: { c: Consumer }) {
  const lag = useLiveSeries(c.pending || 5, Math.max(4, c.pending / 20));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-sm font-semibold">{c.stream} › {c.name}</div>
          <div className="mt-0.5 text-xs text-muted">{c.durable ? "Durable" : "Ephemeral"} · ack {c.ackPolicy} · filter <span className="font-mono">{c.filter}</span></div>
        </div>
        <div className="flex gap-2">
          <CopyCli cmd={cliFor.consumerInfo(c.stream, c.name)} compact />
          <Writable><Button variant="outline">{c.paused ? "Resume" : "Pause"}</Button></Writable>
          <DangerAction label="Delete" icon={<Trash size={12} />} title={`Delete consumer ${c.name}`} typeToConfirm={c.name} body={<>Delete consumer <span className="font-mono text-fg">{c.name}</span> on {c.stream}. Its position is lost.</>} cli={`nats consumer rm ${c.stream} ${c.name} -f`} />
        </div>
      </div>
      <div className="rounded-xl border border-line bg-panel p-3">
        <div className="flex justify-between text-[11px] text-muted"><span>Pending (lag), last 60s</span><span className="tabular text-fg">{fmt(lag.at(-1)!)}</span></div>
        <div className="mt-2"><Sparkline data={lag} height={56} color={c.pending > 10000 ? "var(--color-bad)" : undefined} /></div>
      </div>
    </div>
  );
}

// ---------- Messages ----------

export function MessageDetail({ m, stream = "ORDERS" }: { m: Message; stream?: string }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm text-accent">{m.subject}</div>
          <div className="mt-0.5 text-xs text-muted">seq {m.seq.toLocaleString()} · {m.time} · {m.size.toLocaleString()} bytes</div>
        </div>
        <div className="flex gap-2">
          <CopyCli cmd={cliFor.msgGet(stream, m.seq)} compact />
          <DangerAction label="Delete" icon={<Trash size={12} />} title="Delete message" body={<>Delete message <span className="font-mono text-fg">#{m.seq}</span> from {stream}?</>} cli={`nats stream rmm ${stream} ${m.seq} -f`} />
        </div>
      </div>
      <div><div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Headers</div><HeadersTable h={m.headers} /></div>
      <div><div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Payload</div><PayloadView m={m} maxHeight={420} /></div>
    </div>
  );
}





// ---------- Live tail ----------
export function LiveTail({ compact }: { compact?: boolean }) {
  const [filter, setFilter] = useState(">");
  const [paused, setPaused] = useState(false);
  const [shown, setShown] = useState<Message[]>([]);
  const [buffered, setBuffered] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [sel, setSel] = useState<Message | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    const t = setInterval(() => {
      const batch = Array.from({ length: 3 + Math.floor(Math.random() * 4) }, nextTailMessage).filter((m) => filter === ">" || m.subject.startsWith(filter.replace(/\.?>$/, "").replace("*", "")));
      setDropped((d) => d + Math.floor(Math.random() * 40));
      if (pausedRef.current) setBuffered((b) => b + batch.length);
      else setShown((s) => [...batch.reverse(), ...s].slice(0, 400));
    }, 250);
    return () => clearInterval(t);
  }, [filter]);
  return (
    <div className={cx("flex h-full min-h-0", !compact && "gap-4")}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs">
          <span className={cx("h-2 w-2 rounded-full", paused ? "bg-warn" : "animate-pulse bg-ok")} />
          <input value={filter} onChange={(e) => { setFilter(e.target.value || ">"); setShown([]); }} className="w-48 rounded-md border border-line bg-bg px-2 py-1 font-mono outline-none focus:border-accent/60" />
          <Button variant="outline" onClick={() => { setPaused(!paused); if (paused) setBuffered(0); }}>{paused ? <><Play size={12} />Resume ({buffered} buffered)</> : <><Pause size={12} />Pause</>}</Button>
          <Button onClick={() => setShown([])}>Clear</Button>
          <div className="flex-1" />
          <span className="text-faint">cap 1,000/s · keeps 10,000</span>
          <Badge tone={dropped ? "warn" : "muted"}>dropped {fmt(dropped)}</Badge>
          <CopyCli cmd={cliFor.sub(filter)} compact />
        </div>
        <div className="min-h-0 flex-1 overflow-auto font-mono text-[11.5px]">
          {shown.map((m) => (
            <div key={m.seq} onClick={() => setSel(m)} className={cx("grid cursor-pointer grid-cols-[80px_150px_1fr] gap-3 px-3 py-[3px] hover:bg-white/[0.03]", sel?.seq === m.seq && "bg-accent/5")}>
              <span className="text-faint">{m.time}</span>
              <span className="truncate text-accent">{m.subject}</span>
              <span className="truncate text-muted">{m.payload}</span>
            </div>
          ))}
        </div>
      </div>
      {!compact && sel && (
        <div className="w-[380px] shrink-0 overflow-auto rounded-xl border border-line bg-panel p-4">
          <MessageDetail m={sel} stream="(core)" />
        </div>
      )}
    </div>
  );
}

// ---------- Contexts ----------
export function ContextCards({ onPick }: { onPick?: () => void }) {
  const { contexts, active, setActive, confirm, toast } = useApp();
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {contexts.map((c) => (
        <div key={c.name} onClick={() => { setActive(c.name); onPick?.(); }} className={cx("cursor-pointer rounded-xl border bg-panel p-4 transition hover:border-faint", active.name === c.name ? "border-accent/50" : "border-line")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{c.name}</span>
              {active.name === c.name && <Badge tone="accent">active in this tab</Badge>}
            </div>
            <ReadOnlyBadge c={c} toggle />
          </div>
          <div className="mt-1 text-xs text-muted">{c.description}</div>
          <div className="mt-3 truncate font-mono text-[11px] text-faint">{c.urls}</div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Badge>user {c.user}</Badge>
            <Badge>{c.mode === "jwt" ? "JWT / operator" : "static config"}</Badge>
            <SecretBadge c={c} />
            {c.hasSystemCreds ? <Badge tone="ok">System credentials</Badge> : c.monitoringUrl ? <Badge tone="info">Monitoring URL</Badge> : <Badge tone="warn">no system access</Badge>}
            <Badge>{c.source === "cli" ? "nats CLI context" : "app context"}</Badge>
          </div>
          {c.secret === "plaintext" && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-[11px] text-warn" onClick={(e) => e.stopPropagation()}>
              Password stored in plain text in the CLI context file.
              <button className="font-medium underline-offset-2 hover:underline" onClick={() => confirm({ title: "Move secret to Vault", body: <>Create a Vault-backed copy of <span className="font-mono text-fg">{c.name}</span> in the app's directory. You'll then be asked whether to strip the password from the CLI file.</>, onConfirm: () => toast("Secret moved to Vault (mock)") })}>Move secret to Vault</button>
            </div>
          )}
        </div>
      ))}
      <button className="grid min-h-[140px] place-items-center rounded-xl border border-dashed border-line text-xs text-muted hover:border-faint hover:text-fg">
        <span className="flex items-center gap-1.5"><Plus size={14} />Add Context</span>
      </button>
    </div>
  );
}
