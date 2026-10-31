// PROTOTYPE: Overview page. Stacked sections with tinted borders (Variant C style), a sticky section bar
// with live status, capped tables, and a "more below" pill so it's obvious the page continues.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, ArrowDown, ArrowRight, Boxes, ChevronDown, ChevronRight, Layers, Server } from "lucide-react";
import { Badge, cx, useApp } from "./kit";
import { ConsumersTable, KpiRow, ServersTable, StreamsTable } from "./panels";
import { consumers, servers, streams, type Consumer, type Stream } from "./data";
import type { Screen } from "./commands";

type Sec = { id: string; label: string; icon: ReactNode; status?: ReactNode };

export function OverviewSections({ go, onConsumer }: { go: (s: Screen, a?: string) => void; onConsumer: (c: Consumer) => void }) {
  const { active } = useApp();
  const sys = active.hasSystemCreds;
  const unhealthy = servers.filter((s) => !s.healthy).length;
  const lagging = consumers.filter((c) => c.pending > 500);
  const critical = consumers.filter((c) => c.pending > 10_000);
  const worst = [...consumers].sort((a, b) => b.pending - a.pending)[0];
  const realStreams = streams.filter((s) => s.kind === "stream");
  const busiest = [...realStreams].sort((a, b) => b.messages - a.messages)[0];
  const [showAllConsumers, setShowAllConsumers] = useState(false);

  const sections: Sec[] = [
    { id: "health", label: "Health", icon: <Activity size={13} />, status: sys ? <Dot tone="warn" text="1 slow consumer" /> : <Dot tone="muted" text="limited" /> },
    { id: "servers", label: "Servers", icon: <Server size={13} />, status: sys ? (unhealthy ? <Dot tone="bad" text={`${unhealthy} unhealthy`} /> : <Dot tone="ok" text="all ok" />) : <Dot tone="muted" text="no access" /> },
    { id: "streams", label: "Busiest streams", icon: <Layers size={13} />, status: <span className="text-faint">{realStreams.length}</span> },
    { id: "consumers", label: "Consumers with lag", icon: <Boxes size={13} />, status: critical.length ? <Dot tone="bad" text={`${lagging.length} lagging`} /> : <Dot tone="ok" text="none" /> },
  ];

  // Scroll spy + "what's still below the fold". IntersectionObserver respects the scroll container's clipping.
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [below, setBelow] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      setVisible((v) => { const n = { ...v }; entries.forEach((e) => (n[(e.target as HTMLElement).dataset.sec!] = e.isIntersecting)); return n; });
      setBelow((b) => { const n = { ...b }; entries.forEach((e) => (n[(e.target as HTMLElement).dataset.sec!] = !e.isIntersecting && e.boundingClientRect.top > 0)); return n; });
    }, { threshold: 0, rootMargin: "0px 0px -80px 0px" });
    Object.values(refs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  // How far the page still scrolls, so a section that is only partly visible also counts as "more below".
  const barRef = useRef<HTMLDivElement>(null);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const sc = barRef.current?.closest(".overflow-auto") as HTMLElement | null;
    if (!sc) return;
    const upd = () => setRemaining(sc.scrollHeight - sc.scrollTop - sc.clientHeight);
    upd();
    sc.addEventListener("scroll", upd);
    const ro = new ResizeObserver(upd);
    ro.observe(sc);
    return () => { sc.removeEventListener("scroll", upd); ro.disconnect(); };
  }, []);
  const current = sections.find((s) => visible[s.id])?.id;
  const whollyBelow = sections.filter((s) => below[s.id]);
  // Last section that starts on screen but runs past the bottom edge.
  const cutOff = [...sections].reverse().find((s) => visible[s.id] && (refs.current[s.id]?.getBoundingClientRect().bottom ?? 0) > window.innerHeight);
  const hidden = remaining > 40 ? (whollyBelow.length ? whollyBelow : cutOff ? [cutOff] : []) : [];
  const jump = (id: string) => refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });

  const Section = ({ s, summary, action, children }: { s: Sec; summary?: ReactNode; action?: ReactNode; children: ReactNode }) => (
    <section ref={(el) => { refs.current[s.id] = el; }} data-sec={s.id} className="scroll-mt-16 overflow-hidden rounded-xl border border-accent/20 bg-panel shadow-[0_0_0_1px_rgba(45,212,191,0.02),0_8px_30px_-12px_rgba(45,212,191,0.08)]">
      <header className="flex items-center gap-3 border-b border-accent/10 bg-gradient-to-r from-accent/[0.05] to-transparent px-4 py-2.5">
        <ChevronRight size={14} className="text-accent" />
        <span className="text-accent/80">{s.icon}</span>
        <h2 className="font-mono text-[13px] font-medium">{s.label}</h2>
        {summary && <div className="flex items-center gap-2 text-xs text-muted">{summary}</div>}
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </header>
      {children}
    </section>
  );

  const viewAll = (label: string, onClick: () => void) => (
    <button onClick={onClick} className="flex items-center gap-1 text-xs text-muted hover:text-accent">{label}<ArrowRight size={12} /></button>
  );

  return (
    <>
      {/* Sticky section bar */}
      <div ref={barRef} className="sticky top-0 z-10 -mx-8 mb-5 border-b border-line bg-bg/85 px-8 py-2 backdrop-blur">
        <div className="flex items-center gap-1">
          {sections.map((s) => (
            <button key={s.id} onClick={() => jump(s.id)} className={cx("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition", current === s.id ? "bg-accent/10 text-fg ring-1 ring-accent/25" : "text-muted hover:bg-white/[0.04] hover:text-fg")}>
              <span className={current === s.id ? "text-accent" : "text-faint"}>{s.icon}</span>
              {s.label}
              {s.status && <span className="text-[11px]">{s.status}</span>}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-faint">{sections.length} sections · updated live</span>
        </div>
      </div>

      <div className="space-y-5 pb-28">
        <Section s={sections[0]} summary={sys ? <>366 connections · 18.4k msg/s in</> : <>JetStream usage only, no System credentials</>}>
          <div className="p-4"><KpiRow /></div>
        </Section>

        <Section
          s={sections[1]}
          summary={sys && <>{servers.length} servers · cluster eu-west {unhealthy > 0 && <Badge tone="bad">stg-3 JetStream catching up</Badge>}</>}
        >
          <ServersTable />
        </Section>

        <Section
          s={sections[2]}
          summary={<>busiest: <span className="font-mono text-fg">{busiest.name}</span> · {(busiest.messages / 1e6).toFixed(1)}M msgs</>}
          action={viewAll(`All ${realStreams.length} streams`, () => go("streams"))}
        >
          <StreamsTable onOpen={(x: Stream) => go("stream", x.name)} limit={5} busiestFirst />
        </Section>

        <Section
          s={sections[3]}
          summary={critical.length > 0 && <>worst: <span className="font-mono text-fg">{worst.stream} › {worst.name}</span> <span className="text-bad">{(worst.pending / 1000).toFixed(1)}k pending</span></>}
          action={viewAll(`All ${consumers.length} consumers`, () => go("consumers"))}
        >
          <ConsumersTable onOpen={onConsumer} limit={showAllConsumers ? undefined : 5} mostLagFirst />
          {consumers.length > 5 && (
            <button onClick={() => setShowAllConsumers(!showAllConsumers)} className="flex w-full items-center justify-center gap-1.5 border-t border-line-soft py-2 text-xs text-muted hover:bg-white/[0.02] hover:text-fg">
              <ChevronDown size={13} className={cx("transition", showAllConsumers && "rotate-180")} />
              {showAllConsumers ? "Show top 5" : `Show ${consumers.length - 5} more`}
            </button>
          )}
        </Section>
      </div>

      {/* Bottom fade + "more below" pill: only while something is still below the fold */}
      {hidden.length > 0 && (
        <>
          <div className="pointer-events-none fixed bottom-0 left-[232px] right-0 z-10 h-28 bg-gradient-to-t from-bg via-bg/70 to-transparent" />
          <button onClick={() => jump(hidden[0].id)} className="fixed bottom-6 left-[calc(50%+116px)] z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent/30 bg-raised/95 px-4 py-2 text-xs shadow-xl shadow-black/50 backdrop-blur hover:border-accent/60">
            <ArrowDown size={13} className="animate-bounce text-accent" />
            <span className="text-muted">{whollyBelow.length ? "More below:" : "Continues below:"}</span>
            {hidden.map((s, i) => (
              <span key={s.id} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-faint">·</span>}
                <span className="text-fg">{s.label}</span>
                {s.status && <span className="text-[11px]">{s.status}</span>}
              </span>
            ))}
          </button>
        </>
      )}
    </>
  );
}

function Dot({ tone, text }: { tone: "ok" | "warn" | "bad" | "muted"; text: string }) {
  const c = { ok: "bg-ok text-ok", warn: "bg-warn text-warn", bad: "bg-bad text-bad", muted: "bg-faint text-faint" }[tone];
  return (
    <span className={cx("inline-flex items-center gap-1", c.split(" ")[1])}>
      <span className={cx("h-1.5 w-1.5 rounded-full", c.split(" ")[0])} />{text}
    </span>
  );
}
