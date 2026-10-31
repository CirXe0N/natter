// PROTOTYPE: app shell ("Sidebar console"). Left nav, one page at a time, details as tabbed pages.
import { useState, type ReactNode } from "react";
import { Activity, Cable, ChevronDown, ChevronRight, Database, KeyRound, Layers, Lock, LockOpen, Radio, Search, Send, Boxes } from "lucide-react";
import { Badge, Button, CommandPalette, Kbd, ReadOnlyBadge, SecretBadge, cx, useApp } from "./kit";
import { ConnectionsTable, ConsumerDetail, ConsumersTable, ContextCards, KpiRow, LiveTail, ServersTable, StreamActions, StreamConfigEditor, StreamStats, StreamsTable } from "./panels";
import { buildCommands, screenLabels, type Screen } from "./commands";
import { MessageDrawer, MessageTable } from "./messages";
import { PublishWorkbench } from "./publish";
import { KvPage } from "./kv";
import { OverviewSections } from "./overview";
import { consumers, messageAt, streams, type Consumer } from "./data";


const nav: { group: string; items: { s: Screen; icon: ReactNode }[] }[] = [
  { group: "", items: [{ s: "overview", icon: <Activity size={15} /> }] },
  { group: "Core", items: [{ s: "connections", icon: <Cable size={15} /> }, { s: "publish", icon: <Send size={15} /> }, { s: "tail", icon: <Radio size={15} /> }] },
  { group: "JetStream", items: [{ s: "streams", icon: <Layers size={15} /> }, { s: "consumers", icon: <Boxes size={15} /> }, { s: "messages", icon: <Database size={15} /> }, { s: "kv", icon: <KeyRound size={15} /> }] },
];

export function App() {
  const app = useApp();
  const [screen, setScreen] = useState<Screen>(() => (new URLSearchParams(location.search).get("screen") as Screen) ?? "overview");
  const [arg, setArg] = useState<string | undefined>();
  const [ctxOpen, setCtxOpen] = useState(false);
  const go = (s: Screen, a?: string) => { setScreen(s); setArg(a); };
  const activeNav = screen === "stream" ? "streams" : screen;

  return (
    <div className="flex h-full">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="relative p-3">
          <button onClick={() => setCtxOpen(!ctxOpen)} className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-raised px-2.5 py-2 text-left hover:border-faint">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 font-mono text-xs font-bold text-accent">{app.active.name[0].toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs font-semibold">{app.active.name}</div>
              <div className="truncate text-[11px] text-faint">{app.active.urls}</div>
            </div>
            <ChevronDown size={14} className="text-faint" />
          </button>
          {ctxOpen && (
            <div className="absolute left-3 right-3 top-[58px] z-20 rounded-lg border border-line bg-raised p-1 shadow-2xl shadow-black/50">
              {app.contexts.map((c) => (
                <button key={c.name} onClick={() => { app.setActive(c.name); setCtxOpen(false); }} className={cx("flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-white/5", c.name === app.active.name && "text-accent")}>
                  <span className="font-mono">{c.name}</span>
                  {c.readOnly && <Lock size={11} className="text-warn" />}
                </button>
              ))}
              <div className="my-1 border-t border-line" />
              <button onClick={() => { go("contexts"); setCtxOpen(false); }} className="w-full rounded-md px-2.5 py-1.5 text-left text-xs text-muted hover:bg-white/5">Manage Contexts…</button>
            </div>
          )}
        </div>
        <nav className="flex-1 space-y-4 px-2 pt-1">
          {nav.map((g) => (
            <div key={g.group}>
              {g.group && <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{g.group}</div>}
              {g.items.map((i) => (
                <button key={i.s} onClick={() => go(i.s)} className={cx("flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]", activeNav === i.s ? "bg-white/[0.07] text-fg" : "text-muted hover:bg-white/[0.03] hover:text-fg")}>
                  <span className={activeNav === i.s ? "text-accent" : ""}>{i.icon}</span>
                  {screenLabels[i.s]}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar screen={screen} arg={arg} go={go} />
        <div className="min-h-0 flex-1 overflow-auto">
          <Page key={`${screen}:${arg}`} screen={screen} arg={arg} go={go} />
        </div>
      </main>
      <CommandPalette commands={buildCommands(go, app.setActive)} />
    </div>
  );
}

function TopBar({ screen, arg, go }: { screen: Screen; arg?: string; go: (s: Screen, a?: string) => void }) {
  const { active, setPaletteOpen, toggleReadOnly } = useApp();
  const ro = active.readOnly;
  const section: Screen = screen === "stream" ? "streams" : screen;
  return (
    <div className={cx("flex h-12 shrink-0 items-center gap-4 border-b px-6", ro ? "border-warn/25 bg-warn/[0.04]" : "border-line bg-panel/40")}>
      <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
        <button onClick={() => go("contexts")} className="rounded px-1 font-mono text-muted hover:text-fg">{active.name}</button>
        <ChevronRight size={12} className="text-faint" />
        <button onClick={() => go(section)} className={cx("rounded px-1", arg ? "text-muted hover:text-fg" : "text-fg")}>{screenLabels[section]}</button>
        {screen === "stream" && arg && (<><ChevronRight size={12} className="text-faint" /><span className="truncate font-mono text-fg">{arg}</span></>)}
      </nav>
      <button onClick={() => setPaletteOpen(true)} className="group flex h-8 w-[460px] shrink-0 items-center gap-2.5 rounded-lg border border-line bg-bg/80 px-3 text-xs text-faint shadow-inner shadow-black/20 transition hover:border-accent/40 hover:text-muted">
        <Search size={14} className="text-faint group-hover:text-accent" />
        <span className="flex-1 text-left">Search streams, keys, subjects, or run a command…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="flex flex-1 items-center justify-end gap-3 text-xs">
        <span className="flex items-center gap-1.5 text-muted" title="Connection to the active Context">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-40" /><span className="relative inline-flex h-2 w-2 rounded-full bg-ok" /></span>
          connected <span className="font-mono text-faint">{active.urls.split(",")[0].replace(/^\w+:\/\//, "")}</span>
        </span>
        <button onClick={() => toggleReadOnly(active.name)} title={ro ? `Actions that change ${active.name} are hidden. Click to allow writes.` : "Click to switch on Read-only mode"}>
          {ro ? <Badge tone="warn"><Lock size={11} />Read-only</Badge> : <Badge><LockOpen size={11} />Writable</Badge>}
        </button>
      </div>
    </div>
  );
}

function Header({ title, crumb, children }: { title: ReactNode; crumb?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 px-8 pb-5 pt-7">
      <div>
        {crumb && <div className="mb-1 text-xs text-faint">{crumb}</div>}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

const Card = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cx("overflow-hidden rounded-xl border border-line bg-panel", className)}>{children}</div>;

function Page({ screen, arg, go }: { screen: Screen; arg?: string; go: (s: Screen, a?: string) => void }) {
  const { active, setDraft } = useApp();
  const [open, setOpen] = useState<{ seq: number; i: number; seqAt: (i: number) => number } | null>(() => {
    const o = Number(new URLSearchParams(location.search).get("open"));
    return o ? { seq: o, i: 1_696_332 - o, seqAt: (i: number) => 1_696_332 - i } : null;
  });
  const [consumer, setConsumer] = useState<Consumer>(consumers[1]);
  const bucket = arg ?? "config";
  const [tab, setTab] = useState<"overview" | "consumers" | "messages" | "config">("overview");
  const [browse, setBrowse] = useState("ORDERS");

  const drawer = (stream: string) =>
    open && (
      <MessageDrawer
        stream={stream}
        seq={open.seq}
        onClose={() => setOpen(null)}
        onPrev={() => open.i > 0 && setOpen({ ...open, i: open.i - 1, seq: open.seqAt(open.i - 1) })}
        onNext={() => setOpen({ ...open, i: open.i + 1, seq: open.seqAt(open.i + 1) })}
        onReplay={() => {
          const m = messageAt(open.seq);
          setDraft({ id: "", context: active.name, folder: "from messages", name: `Replay of ${m.subject} #${m.seq}`, mode: "pub", subject: m.subject, headers: Object.entries(m.headers), payload: m.kind === "json" && !m.truncatedAt ? JSON.stringify(JSON.parse(m.payload), null, 2) : m.payload });
          setOpen(null);
          go("publish");
        }}
      />
    );
  const onOpen = (seq: number, seqAt: (i: number) => number, i: number) => setOpen({ seq, seqAt, i });

  switch (screen) {
    case "overview":
      return (
        <>
          <Header title="Overview"><SecretBadge c={active} /></Header>
          <div className="px-8">
            <OverviewSections go={go} onConsumer={(c) => { setConsumer(c); go("consumers"); }} />
          </div>
        </>
      );
    case "connections":
      return (<><Header title="Connections" /><div className="px-8 pb-10"><Card><ConnectionsTable /></Card></div></>);
    case "streams":
      return (
        <>
          <Header title="Streams"><Button variant="solid">Create stream</Button></Header>
          <div className="px-8 pb-10"><Card><StreamsTable onOpen={(s) => { setTab("overview"); go("stream", s.name); }} /></Card></div>
        </>
      );
    case "stream": {
      const s = streams.find((x) => x.name === arg) ?? streams[0];
      return (
        <>
          <Header title={<span className="font-mono">{s.name}</span>} ><StreamActions s={s} /></Header>
          <div className="flex gap-5 border-b border-line px-8">
            {(["overview", "consumers", "messages", "config"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cx("-mb-px border-b-2 pb-2.5 text-[13px] capitalize", tab === t ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>{t}</button>
            ))}
          </div>
          <div className="px-8 py-6">
            {tab === "overview" && <StreamStats s={s} />}
            {tab === "consumers" && <Card><ConsumersTable stream={s.name} onOpen={(c) => { setConsumer(c); go("consumers"); }} /></Card>}
            {tab === "messages" && (
              <Card className="h-[calc(100vh-250px)] min-h-[420px]"><MessageTable s={s} openSeq={open?.seq} onOpen={onOpen} /></Card>
            )}
            {drawer(s.name)}
            {tab === "config" && <Card className="p-5"><StreamConfigEditor s={s} /></Card>}
          </div>
        </>
      );
    }
    case "consumers":
      return (
        <>
          <Header title="Consumers" />
          <div className="space-y-5 px-8 pb-10">
            <Card className="p-5"><ConsumerDetail c={consumer} /></Card>
            <Card><ConsumersTable onOpen={setConsumer} selected={consumer.name} /></Card>
          </div>
        </>
      );
    case "messages":
      return (
        <>
          <Header title="Message browser">
            <select value={browse} onChange={(e) => { setBrowse(e.target.value); setOpen(null); }} className="h-7 rounded-md border border-line bg-raised px-2 font-mono text-xs outline-none">
              {streams.filter((x) => x.kind === "stream").map((x) => <option key={x.name}>{x.name}</option>)}
            </select>
          </Header>
          <div className="h-[calc(100vh-130px)] px-8 pb-8">
            <Card className="h-full"><MessageTable key={browse} s={streams.find((x) => x.name === browse)!} openSeq={open?.seq} onOpen={onOpen} /></Card>
          </div>
          {drawer(browse)}
        </>
      );
    case "kv":
      return (
        <>
          <Header title="Key-Value" />
          <div className="h-[calc(100vh-130px)] px-8 pb-8"><KvPage initialBucket={bucket} /></div>
        </>
      );
    case "publish":
      return (<><Header title="Publish / request" /><div className="h-[calc(100vh-130px)] px-8 pb-8"><PublishWorkbench /></div></>);
    case "tail":
      return (<><Header title="Live tail" /><div className="h-[calc(100vh-130px)] px-8 pb-8"><Card className="h-full"><LiveTail /></Card></div></>);
    case "contexts":
      return (<><Header title="Contexts"><Badge>~/.config/nats/context + app Vault</Badge></Header><div className="px-8 pb-10"><ContextCards /></div></>);
  }
}
