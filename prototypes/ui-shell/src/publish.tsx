// PROTOTYPE: publish / request workbench with a library of example messages.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Import, Check, BookOpen, ChevronDown, ChevronRight, Copy, FolderPlus, Plus, Save, Search, Send, Trash, Wand2, X, Lock, Eye, Dices, Braces, CircleCheck, CircleAlert, Clock } from "lucide-react";
import { Badge, Button, CopyCli, HeadersTable, PayloadView, cx, useApp } from "./kit";
import { cliFor, fmtBytes, type Example, type Message } from "./data";

type Result = { id: number; at: string; mode: "pub" | "req"; subject: string; status: "ok" | "error" | "no-responders" | "timeout" | "published"; ms?: number; count?: number; reply?: Message; sent?: Example; last?: Example };

const MAX_PAYLOAD = 1024 * 1024; // from the server's max_payload (INFO / VARZ)
// Placeholders use natscli's template functions verbatim, so "copy as nats command" works unchanged.
// See natscli cli/pub_command.go (pubHelp). {{Count}} starts at 1, like `nats pub --count`.
export const PLACEHOLDERS: { name: string; insert: string; help: string }[] = [
  { name: "Count", insert: "{{Count}}", help: "message number in this run, from 1" },
  { name: "ID", insert: "{{ID}}", help: "a unique ID" },
  { name: "TimeStamp", insert: "{{TimeStamp}}", help: "current time, RFC 3339" },
  { name: "Unix", insert: "{{Unix}}", help: "seconds since 1970, UTC" },
  { name: "UnixNano", insert: "{{UnixNano}}", help: "nanoseconds since 1970, UTC" },
  { name: "Time", insert: "{{Time}}", help: "current time" },
  { name: "Random", insert: "{{Random 10 20}}", help: "random string, min to max characters" },
];
const PH = /\{\{\s*(\w+)((?:\s+\d+)*)\s*\}\}/g;
const nuidChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const rnd = (n: number) => Array.from({ length: n }, () => nuidChars[Math.floor(Math.random() * nuidChars.length)]).join("");

/** Unknown names, so we can refuse to send instead of publishing a literal "{{Foo}}". */
export function unknownPlaceholders(...texts: string[]) {
  const known = new Set(PLACEHOLDERS.map((p) => p.name));
  return [...new Set(texts.flatMap((t) => [...t.matchAll(PH)].map((m) => m[1]).filter((n) => !known.has(n))))];
}

export function render(t: string, count: number, now = new Date()) {
  return t.replace(PH, (whole, name: string, args: string) => {
    const [a, b] = args.trim().split(/\s+/).map(Number);
    switch (name) {
      case "Count": return String(count);
      case "ID": return rnd(22);
      case "TimeStamp": return now.toISOString().replace(/\.\d+Z$/, "Z");
      case "Unix": return String(Math.floor(now.getTime() / 1000));
      case "UnixNano": return `${now.getTime()}000000`;
      case "Time": return now.toISOString().replace("T", " ").replace("Z", " +0000 UTC");
      case "Random": { const min = a || 0, max = Math.max(min, b || min); return rnd(min + Math.floor(Math.random() * (max - min + 1))); }
      default: return whole;
    }
  });
}

const renderExample = (e: Example, count: number): Example => ({ ...e, subject: render(e.subject, count), payload: render(e.payload, count), headers: e.headers.map(([k, v]) => [k, render(v, count)]) });
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const blank: Example = { id: "", context: "", folder: "unsorted", name: "Untitled", mode: "pub", subject: "", headers: [], payload: "" };

function fakeSend(e: Example, count: number): Result {
  const at = new Date().toLocaleTimeString();
  const id = Date.now() + Math.random();
  if (e.mode === "pub") return { id, at, mode: "pub", subject: e.subject, status: "published", count };
  if (e.subject.startsWith("svc.inventory")) {
    let sku = "";
    try { sku = JSON.parse(e.payload).sku; } catch { /* not JSON */ }
    if (sku === "DOES-NOT-EXIST") {
      const p = JSON.stringify({ error: "unknown sku", sku });
      return { id, at, mode: "req", subject: e.subject, status: "error", ms: 2.1, reply: { seq: 0, subject: "_INBOX.k3Jd9", time: at, size: p.length, headers: { "Nats-Service-Error": "not found", "Nats-Service-Error-Code": "404" }, payload: p, kind: "json" } };
    }
    const p = JSON.stringify({ sku, in_stock: 412, warehouses: ["AMS-1", "FRA-2"] });
    return { id, at, mode: "req", subject: e.subject, status: "ok", ms: 3.2, reply: { seq: 0, subject: "_INBOX.aG9zd", time: at, size: p.length, headers: {}, payload: p, kind: "json" } };
  }
  if (e.subject === "$SRV.PING") {
    const p = JSON.stringify({ name: "inventory", id: "Dk3xV2", version: "1.4.0", type: "io.nats.micro.v1.ping_response" });
    return { id, at, mode: "req", subject: e.subject, status: "ok", ms: 0.8, reply: { seq: 0, subject: "_INBOX.p0Q1", time: at, size: p.length, headers: {}, payload: p, kind: "json" } };
  }
  if (e.subject.startsWith("svc.pricing")) return { id, at, mode: "req", subject: e.subject, status: "timeout", ms: e.timeoutMs ?? 2000 };
  return { id, at, mode: "req", subject: e.subject, status: "no-responders", ms: 0.4 };
}

export function PublishWorkbench() {
  const { examples: all, setExamples, draft, setDraft, active, toast, confirm, toggleReadOnly } = useApp();
  // Examples belong to a Context: this page only ever shows the active Context's examples.
  const examples = useMemo(() => all.filter((e) => e.context === active.name), [all, active.name]);
  const [selId, setSelId] = useState<string | null>(examples[0]?.id ?? null);
  const [edit, setEdit] = useState<Example>(examples[0] ?? { ...blank, context: active.name });
  const [transfer, setTransfer] = useState<{ mode: "copy" | "import"; ids: string[] } | null>(null);

  // Switching Context switches the library.
  const [ctxSeen, setCtxSeen] = useState(active.name);
  if (ctxSeen !== active.name) {
    setCtxSeen(active.name);
    setSelId(examples[0]?.id ?? null);
    setEdit(examples[0] ?? { ...blank, context: active.name });
  }
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [count, setCount] = useState(1);
  const [interval, setIntervalMs] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [shown, setShown] = useState<Result | null>(null);

  // A message handed over from the message drawer ("Replay…") opens as an unsaved draft.
  useEffect(() => {
    if (!draft) return;
    setSelId(null);
    setEdit(draft);
    setDraft(null);
  }, [draft, setDraft]);

  const saved = examples.find((e) => e.id === selId);
  const dirty = !saved || JSON.stringify(saved) !== JSON.stringify(edit);
  const folders = useMemo(() => {
    const m = new Map<string, Example[]>();
    examples.filter((e) => `${e.name} ${e.subject} ${e.folder}`.toLowerCase().includes(q.toLowerCase())).forEach((e) => m.set(e.folder, [...(m.get(e.folder) ?? []), e]));
    return [...m.entries()];
  }, [examples, q]);

  const unknown = useMemo(() => unknownPlaceholders(edit.subject, edit.payload, ...edit.headers.map((h) => h[1])), [edit]);
  const usesPlaceholders = /\{\{/.test(edit.subject + edit.payload + edit.headers.map((h) => h[1]).join(""));
  const [previewSeed, setPreviewSeed] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ta.current;
    const at = el ? el.selectionStart : edit.payload.length;
    const end = el ? el.selectionEnd : at;
    setPreviewing(false);
    setEdit({ ...edit, payload: edit.payload.slice(0, at) + token + edit.payload.slice(end) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
  };
  const preview = useMemo(() => renderExample(edit, 1), [edit, previewSeed]); // eslint-disable-line react-hooks/exhaustive-deps
  const jsonState = useMemo(() => {
    if (unknown.length) return { ok: false, msg: `Unknown placeholder ${unknown.map((u) => `{{${u}}}`).join(", ")}` };
    const p = preview.payload;
    if (!p.trim()) return { ok: true, msg: "Empty payload" };
    if (!/^\s*[[{"]/.test(p)) return { ok: true, msg: "Text" };
    try { JSON.parse(p); return { ok: true, msg: usesPlaceholders ? "Valid JSON after placeholders" : "Valid JSON" }; } catch (err) { return { ok: false, msg: (err as Error).message.replace(/^JSON\.parse: /, "") }; }
  }, [preview.payload, unknown, usesPlaceholders]);
  const size = new TextEncoder().encode(preview.payload).length;

  const pick = (e: Example) => {
    const go = () => { setSelId(e.id); setEdit(e); };
    if (dirty && saved) confirm({ title: "Discard changes", body: <>You have unsaved changes to <span className="text-fg">{saved.name}</span>.</>, onConfirm: go });
    else go();
  };
  const save = () => {
    if (saved) setExamples((ex) => ex.map((x) => (x.id === saved.id ? edit : x)));
    else { const id = `e${Date.now()}`; const e = { ...edit, id, context: active.name }; setExamples((ex) => [...ex, e]); setSelId(id); setEdit(e); }
    toast(`Example saved in ${active.name}`);
  };
  const saveAsNew = () => {
    const id = `e${Date.now()}`;
    const copy = { ...edit, id, context: active.name, name: `${edit.name} (copy)` };
    setExamples((ex) => [...ex, copy]);
    setSelId(id);
    setEdit(copy);
    toast("Saved as new example");
  };
  const send = () => {
    const n = edit.mode === "pub" ? count : 1;
    const first = renderExample(edit, 1);
    const r = { ...fakeSend(first, n), sent: first, last: n > 1 ? renderExample(edit, n) : undefined };
    setResults((rs) => [r, ...rs].slice(0, 50));
    setShown(r);
  };
  const setHeader = (i: number, k: 0 | 1, v: string) => setEdit((e) => ({ ...e, headers: e.headers.map((h, j) => (j === i ? (k === 0 ? [v, h[1]] : [h[0], v]) : h)) }));

  const blocked = active.readOnly;
  const field = "rounded-md border border-line bg-bg px-2.5 font-mono text-xs outline-none focus:border-accent/60";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tab, setTab] = useState<"payload" | "headers" | "options">("payload");
  const [resTab, setResTab] = useState<"result" | "history">("result");
  const [recent, setRecent] = useState<string[]>([]);

  const choose = (e: Example) => { pick(e); setPickerOpen(false); setRecent((r) => [e.id, ...r.filter((x) => x !== e.id)].slice(0, 5)); };
  const doSend = () => { if (blocked || !edit.subject || unknown.length) return; send(); setResTab("result"); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); doSend(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const compact = edit.payload.replace(/\n\s*/g, " ");
  const hdrFlags = edit.headers.filter(([k]) => k).map(([k, v]) => ` -H ${shellQuote(`${k}:${v}`)}`).join("");
  const cliCommand = edit.mode === "req"
    ? `nats req ${edit.subject || "<subject>"} ${shellQuote(compact)}${hdrFlags} --timeout ${(edit.timeoutMs ?? 2000) / 1000}s`
    : `nats pub ${edit.subject || "<subject>"} ${shellQuote(compact)}${hdrFlags}${count > 1 ? ` --count ${count}` : ""}`;
  const tabBtn = (active: boolean) => cx("-mb-px border-b-2 px-1 pb-2.5 pt-3 text-[13px]", active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg");
  const recentExamples = recent.map((id) => examples.find((e) => e.id === id)).filter(Boolean) as Example[]; // other Contexts' recents drop out

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Request bar */}
      <div className="shrink-0 rounded-xl border border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
          <div className="relative">
            <Button variant="outline" onClick={() => setPickerOpen(!pickerOpen)}>
              <BookOpen size={13} />Examples<span className="text-faint">{examples.length}</span><ChevronDown size={12} className="text-faint" />
            </Button>
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setPickerOpen(false)} />
                <div className="absolute left-0 top-9 z-30 flex max-h-[460px] w-[440px] flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-2xl shadow-black/60">
                  <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                    <Search size={13} className="text-faint" />
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search examples by name, subject or folder" className="flex-1 bg-transparent text-xs outline-none placeholder:text-faint" />
                    <button title="New folder" className="rounded p-1 text-faint hover:bg-white/5 hover:text-fg"><FolderPlus size={13} /></button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto py-1">
                    {folders.map(([folder, items]) => (
                      <div key={folder}>
                        <button onClick={() => setClosed((c) => ({ ...c, [folder]: !c[folder] }))} className="flex w-full items-center gap-1 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint hover:text-muted">
                          {closed[folder] ? <ChevronRight size={11} /> : <ChevronDown size={11} />}{folder}<span className="ml-auto font-normal">{items.length}</span>
                        </button>
                        {!closed[folder] && items.map((e) => (
                          <button key={e.id} onClick={() => choose(e)} className={cx("mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left", selId === e.id ? "bg-white/[0.07]" : "hover:bg-white/[0.04]")}>
                            <ModeTag mode={e.mode} />
                            <span className="min-w-0 flex-1 truncate text-xs">{e.name}</span>
                            <span className="truncate font-mono text-[10.5px] text-faint">{e.subject}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                  {folders.length === 0 && <div className="px-4 py-6 text-center text-xs text-faint">{q ? "No matches" : <>No examples in <span className="font-mono">{active.name}</span> yet</>}</div>}
                  <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[11px] text-faint">
                    <span className="flex-1">in <span className="font-mono text-muted">{active.name}</span></span>
                    <button onClick={() => { setTransfer({ mode: "import", ids: [] }); setPickerOpen(false); }} className="flex items-center gap-1 text-muted hover:text-fg"><Import size={11} />Import from Context…</button>
                    <button onClick={() => { setSelId(null); setEdit({ ...blank, context: active.name }); setPickerOpen(false); }} className="flex items-center gap-1 text-muted hover:text-fg"><Plus size={11} />New</button>
                  </div>
                </div>
              </>
            )}
          </div>
          <span className="text-faint">/</span>
          <input value={edit.folder} onChange={(e) => setEdit({ ...edit, folder: e.target.value })} title="Folder" className="w-24 bg-transparent text-xs text-muted outline-none" />
          <span className="text-faint">/</span>
          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none" />
          {dirty && <span className="flex items-center gap-1 text-[11px] text-warn"><span className="h-1.5 w-1.5 rounded-full bg-warn" />{saved ? "unsaved changes" : "not saved yet"}</span>}
          <Button variant="outline" onClick={save} disabled={!dirty}><Save size={12} />Save</Button>
          <Button onClick={saveAsNew} title="Save as new example"><Copy size={12} /></Button>
          <Button onClick={() => setTransfer({ mode: "copy", ids: saved ? [saved.id] : [] })} title="Copy to another Context"><ArrowLeftRight size={12} />Copy to…</Button>
          {saved && <Button title="Delete example" onClick={() => confirm({ title: "Delete example", body: <>Delete <span className="text-fg">{saved.name}</span> from your examples?</>, onConfirm: () => { setExamples((ex) => ex.filter((x) => x.id !== saved.id)); setSelId(null); setEdit({ ...blank, context: active.name }); } })}><Trash size={12} /></Button>}
          <Button title="New example" onClick={() => { setSelId(null); setEdit({ ...blank, context: active.name }); }}><Plus size={12} /></Button>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-10 rounded-lg border border-line p-0.5">
            {(["pub", "req"] as const).map((m) => <button key={m} onClick={() => setEdit({ ...edit, mode: m })} className={cx("rounded-md px-3.5 text-xs font-medium", edit.mode === m ? (m === "pub" ? "bg-ok/15 text-ok" : "bg-info/15 text-info") : "text-muted hover:text-fg")}>{m === "req" ? "Request" : "Publish"}</button>)}
          </div>
          <input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} placeholder="subject, e.g. orders.created" className="h-10 flex-1 rounded-lg border border-line bg-bg px-3.5 font-mono text-sm outline-none focus:border-accent/60" />
          <CopyCli cmd={cliCommand} compact />
          <button onClick={doSend} disabled={blocked || !edit.subject || unknown.length > 0} title={blocked ? `${active.name} is in Read-only mode` : unknown.length ? "Fix unknown placeholders first" : "Ctrl/⌘ + Enter"} className="flex h-10 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
            <Send size={14} />{edit.mode === "req" ? "Send" : count > 1 ? `Publish ×${count}` : "Publish"}
          </button>
        </div>

        {blocked && (
          <div className="flex items-center gap-2 border-t border-warn/20 bg-warn/[0.05] px-4 py-2 text-xs text-warn">
            <Lock size={12} />
            <span><span className="font-mono">{active.name}</span> is in Read-only mode, so nothing is sent: publishes and requests are both blocked, because a request can change data in whichever service answers it.</span>
            <button onClick={() => toggleReadOnly(active.name)} className="ml-auto whitespace-nowrap rounded-md border border-warn/30 px-2 py-0.5 hover:bg-warn/10">Switch to Writable</button>
          </div>
        )}
        {recentExamples.length > 0 && (
          <div className="flex items-center gap-1.5 border-t border-line-soft px-4 py-2 text-[11px]">
            <span className="mr-1 text-faint">Recent</span>
            {recentExamples.map((e) => (
              <button key={e.id} onClick={() => choose(e)} className={cx("flex items-center gap-1.5 rounded-md border px-2 py-0.5", selId === e.id ? "border-accent/40 text-fg" : "border-line-soft text-muted hover:text-fg")}>
                <ModeTag mode={e.mode} small />{e.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="flex min-h-0 flex-[3] flex-col overflow-hidden rounded-xl border border-line bg-panel">
        <div className="flex items-center gap-5 border-b border-line px-4">
          <button onClick={() => setTab("payload")} className={tabBtn(tab === "payload")}>Payload</button>
          <button onClick={() => setTab("headers")} className={tabBtn(tab === "headers")}>Headers {edit.headers.length > 0 && <span className="ml-1 rounded bg-white/10 px-1.5 text-[10px]">{edit.headers.length}</span>}</button>
          <button onClick={() => setTab("options")} className={tabBtn(tab === "options")}>{edit.mode === "pub" ? "Repeat" : "Timeout"} <span className="ml-1 text-[11px] text-faint">{edit.mode === "pub" ? `×${count}` : `${edit.timeoutMs ?? 2000}ms`}</span></button>
          {tab === "payload" && (
            <span className="ml-auto flex items-center gap-4 text-[11px]">
              <span className={jsonState.ok ? "text-ok" : "text-bad"}>{jsonState.msg}</span>
              <span className="flex items-center gap-2 text-faint tabular">
                {fmtBytes(size)} / {fmtBytes(MAX_PAYLOAD)}
                <span className="h-1 w-16 overflow-hidden rounded-full bg-white/5"><span className="block h-full bg-accent" style={{ width: `${Math.min(100, (size / MAX_PAYLOAD) * 100)}%` }} /></span>
              </span>
              <button onClick={() => { try { setEdit({ ...edit, payload: JSON.stringify(JSON.parse(edit.payload), null, 2) }); } catch { /* invalid */ } }} className="flex items-center gap-1 text-muted hover:text-fg"><Wand2 size={11} />Prettify</button>
            </span>
          )}
          {tab === "headers" && <button onClick={() => setEdit({ ...edit, headers: [...edit.headers, ["", ""]] })} className="ml-auto flex items-center gap-1 text-[11px] text-muted hover:text-fg"><Plus size={11} />Add header</button>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === "payload" && (
            <div className="flex h-full flex-col">
              {previewing ? (
                <div className="relative min-h-0 flex-1 overflow-auto bg-accent/[0.03]">
                  <div className="sticky top-0 flex items-center gap-2 border-b border-accent/15 bg-panel/90 px-4 py-1.5 text-[11px] text-accent backdrop-blur">
                    <Eye size={12} />Preview of message 1{edit.mode === "pub" && count > 1 ? ` of ${count}` : ""}. Every send renders fresh values.
                    <button onClick={() => setPreviewSeed((n) => n + 1)} className="ml-auto flex items-center gap-1 text-muted hover:text-fg"><Dices size={12} />Re-roll</button>
                  </div>
                  <pre className="whitespace-pre-wrap p-4 font-mono text-[12.5px] leading-relaxed">{preview.payload || <span className="text-faint">(empty)</span>}</pre>
                </div>
              ) : (
                <textarea ref={ta} value={edit.payload} onChange={(e) => setEdit({ ...edit, payload: e.target.value })} spellCheck={false} placeholder="Payload (empty is allowed). Use {{Count}}, {{ID}}, {{TimeStamp}} … for values that change per send." className="min-h-0 w-full flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed outline-none placeholder:text-faint" />
              )}
              <div className="flex flex-wrap items-center gap-1.5 border-t border-line-soft px-4 py-2 text-[11px]">
                <Braces size={12} className="text-faint" />
                <span className="mr-1 text-faint">Insert</span>
                {PLACEHOLDERS.map((p) => (
                  <button key={p.name} onClick={() => insert(p.insert)} title={p.help} className="rounded-md border border-line-soft px-1.5 py-0.5 font-mono text-muted hover:border-accent/40 hover:text-accent">{p.insert}</button>
                ))}
                <button onClick={() => setPreviewing(!previewing)} className={cx("ml-auto flex items-center gap-1 rounded-md px-2 py-0.5", previewing ? "bg-accent/15 text-accent" : "text-muted hover:text-fg")}>
                  <Eye size={12} />{previewing ? "Back to editing" : "Preview next send"}
                </button>
              </div>
            </div>
          )}
          {tab === "headers" && (
            <div className="p-4">
              {edit.headers.length === 0 && <div className="rounded-md border border-dashed border-line-soft px-3 py-6 text-center text-xs text-faint">No headers. <button onClick={() => setEdit({ ...edit, headers: [["", ""]] })} className="text-muted underline-offset-2 hover:underline">Add one</button></div>}
              {edit.headers.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-line-soft">
                  <div className="grid grid-cols-[40%_1fr_36px] border-b border-line-soft bg-white/[0.02] px-3 py-1.5 text-[11px] uppercase tracking-wide text-faint"><span>Name</span><span>Value</span><span /></div>
                  {edit.headers.map((h, i) => (
                    <div key={i} className="grid grid-cols-[40%_1fr_36px] items-center border-b border-line-soft last:border-0">
                      <input value={h[0]} onChange={(e) => setHeader(i, 0, e.target.value)} placeholder="Name" className="h-9 border-r border-line-soft bg-transparent px-3 font-mono text-xs outline-none focus:bg-white/[0.02]" />
                      <input value={h[1]} onChange={(e) => setHeader(i, 1, e.target.value)} placeholder="Value" className="h-9 bg-transparent px-3 font-mono text-xs outline-none focus:bg-white/[0.02]" />
                      <button onClick={() => setEdit({ ...edit, headers: edit.headers.filter((_, j) => j !== i) })} className="grid place-items-center text-faint hover:text-bad"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {tab === "options" && (
            <div className="flex items-center gap-2 p-4 text-xs text-muted">
              {edit.mode === "pub" ? (
                <>Send<input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, +e.target.value))} className={cx(field, "h-8 w-20")} />times, every<input type="number" min={0} value={interval} onChange={(e) => setIntervalMs(Math.max(0, +e.target.value))} className={cx(field, "h-8 w-20")} />ms</>
              ) : (
                <>Wait up to<input type="number" value={edit.timeoutMs ?? 2000} onChange={(e) => setEdit({ ...edit, timeoutMs: +e.target.value })} className={cx(field, "h-8 w-24")} />ms for a reply</>
              )}
            </div>
          )}
        </div>
      </div>

      {transfer && <TransferDialog mode={transfer.mode} preselected={transfer.ids} onClose={() => setTransfer(null)} />}

      {/* Response */}
      <div className="flex min-h-0 flex-[2] flex-col overflow-hidden rounded-xl border border-line bg-panel">
        <div className="flex items-center gap-5 border-b border-line px-4">
          <button onClick={() => setResTab("result")} className={tabBtn(resTab === "result")}>Response</button>
          <button onClick={() => setResTab("history")} className={tabBtn(resTab === "history")}>History {results.length > 0 && <span className="ml-1 rounded bg-white/10 px-1.5 text-[10px]">{results.length}</span>}</button>
          <span className="ml-auto text-[11px] text-faint">{resTab === "history" ? `this session · ${active.name}` : shown ? `${shown.at} · ${shown.subject}` : ""}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {resTab === "result" && (shown ? <div className="p-4"><ResultView r={shown} /></div> : <div className="grid h-full place-items-center text-xs text-faint"><span>Send something to see the response · <span className="font-mono">Ctrl/⌘ + Enter</span></span></div>)}
          {resTab === "history" && (
            <>
              {results.length === 0 && <div className="p-4 text-xs text-faint">Nothing sent yet</div>}
              {results.map((r) => (
                <button key={r.id} onClick={() => { setShown(r); setResTab("result"); }} className="grid w-full grid-cols-[16px_90px_1fr_120px_90px] items-center gap-3 border-b border-line-soft px-4 py-2 text-left text-xs hover:bg-white/[0.03]">
                  <StatusDot r={r} />
                  <span className="text-faint tabular">{r.at}</span>
                  <span className="truncate font-mono">{r.subject}</span>
                  <span className="text-muted">{{ ok: "reply", published: "published", error: "service error", "no-responders": "no responders", timeout: "timeout" }[r.status]}</span>
                  <span className="text-right text-faint tabular">{r.ms !== undefined ? `${r.ms}ms` : r.count && r.count > 1 ? `×${r.count}` : ""}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeTag({ mode, small }: { mode: "pub" | "req"; small?: boolean }) {
  return <span className={cx("shrink-0 rounded text-center font-bold", small ? "px-1 text-[8.5px]" : "w-8 px-1 py-0.5 text-[9px]", mode === "pub" ? "bg-ok/10 text-ok" : "bg-info/10 text-info")}>{mode === "pub" ? "PUB" : "REQ"}</span>;
}

function StatusDot({ r }: { r: Result }) {
  const c = { ok: "bg-ok", published: "bg-ok", error: "bg-bad", "no-responders": "bg-warn", timeout: "bg-warn" }[r.status];
  return <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", c)} />;
}

function ResultView({ r }: { r: Result }) {
  if (r.status === "published")
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs"><CircleCheck size={14} className="text-ok" />Published {r.count && r.count > 1 ? `${r.count} messages` : "1 message"} to <span className="font-mono text-accent">{r.subject}</span><span className="text-faint">at {r.at}</span></div>
        {r.sent && <SentView label={r.last ? "Message 1 as sent" : "As sent"} e={r.sent} />}
        {r.last && <SentView label={`Message ${r.count} as sent`} e={r.last} />}
      </div>
    );
  if (r.status === "no-responders")
    return <div className="space-y-2 text-xs"><div className="flex items-center gap-2 text-warn"><CircleAlert size={14} />No responders</div><p className="text-muted">Nothing is subscribed to <span className="font-mono text-fg">{r.subject}</span> on this Context, so the server replied immediately with 503.</p></div>;
  if (r.status === "timeout")
    return <div className="space-y-2 text-xs"><div className="flex items-center gap-2 text-warn"><Clock size={14} />Timed out after {r.ms}ms</div><p className="text-muted">A responder exists but didn't answer in time.</p></div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs">
        {r.status === "ok" ? <Badge tone="ok">reply · {r.ms}ms</Badge> : <Badge tone="bad">service error · {r.ms}ms</Badge>}
        <span className="font-mono text-faint">{r.reply!.subject}</span>
      </div>
      <div><div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Headers</div><HeadersTable h={r.reply!.headers} /></div>
      <div><div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Payload</div><PayloadView m={r.reply!} maxHeight={300} /></div>
    </div>
  );
}

type Conflict = "keep" | "replace" | "skip";

/** Copy examples from the active Context to others, or import them from another Context into the active one. */
function TransferDialog({ mode, preselected, onClose }: { mode: "copy" | "import"; preselected: string[]; onClose: () => void }) {
  const { examples, setExamples, contexts, active, toast } = useApp();
  const others = contexts.filter((c) => c.name !== active.name);
  const countIn = (ctx: string) => examples.filter((e) => e.context === ctx).length;
  const [source, setSource] = useState(mode === "copy" ? active.name : (others.find((c) => countIn(c.name) > 0) ?? others[0]).name);
  const [targets, setTargets] = useState<string[]>(mode === "import" ? [active.name] : []);
  const [sel, setSel] = useState<string[]>(preselected);
  const [conflict, setConflict] = useState<Conflict>("keep");
  const list = examples.filter((e) => e.context === source);
  const clash = (e: Example, ctx: string) => examples.find((x) => x.context === ctx && x.folder === e.folder && x.name === e.name);
  const clashes = list.filter((e) => sel.includes(e.id)).flatMap((e) => targets.filter((t) => clash(e, t)).map((t) => `${e.name} → ${t}`));
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const apply = () => {
    setExamples((ex) => {
      let next = [...ex];
      for (const t of targets)
        for (const e of list.filter((x) => sel.includes(x.id))) {
          const existing = next.find((x) => x.context === t && x.folder === e.folder && x.name === e.name);
          if (existing && conflict === "skip") continue;
          if (existing && conflict === "replace") next = next.filter((x) => x.id !== existing.id);
          const name = existing && conflict === "keep" ? `${e.name} (from ${source})` : e.name;
          next.push({ ...e, id: `e${Date.now()}${Math.random().toString(36).slice(2, 6)}`, context: t, name });
        }
      return next;
    });
    toast(mode === "copy" ? `Copied to ${targets.join(", ")}` : `Imported from ${source} into ${active.name}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[80vh] w-[560px] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5 text-sm font-semibold">
          {mode === "copy" ? <ArrowLeftRight size={15} className="text-accent" /> : <Import size={15} className="text-accent" />}
          {mode === "copy" ? <>Copy examples from <span className="font-mono">{active.name}</span></> : <>Import examples into <span className="font-mono">{active.name}</span></>}
          <button onClick={onClose} className="ml-auto text-faint hover:text-fg"><X size={15} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{mode === "copy" ? "To Context" : "From Context"}</div>
            <div className="flex flex-wrap gap-1.5">
              {others.map((c) => {
                const on = mode === "copy" ? targets.includes(c.name) : source === c.name;
                return (
                  <button key={c.name} onClick={() => (mode === "copy" ? setTargets(toggle(targets, c.name)) : (setSource(c.name), setSel([])))} className={cx("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs", on ? "border-accent/50 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg")}>
                    {mode === "copy" && <span className={cx("grid h-3.5 w-3.5 place-items-center rounded border", on ? "border-accent bg-accent text-black" : "border-faint")}>{on && <Check size={10} />}</span>}
                    {c.name}<span className="font-sans text-[10px] text-faint">{countIn(c.name)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-faint">
              <span>Examples in <span className="font-mono normal-case">{source}</span></span>
              {list.length > 0 && <button onClick={() => setSel(sel.length === list.length ? [] : list.map((e) => e.id))} className="normal-case tracking-normal text-muted hover:text-fg">{sel.length === list.length ? "Select none" : "Select all"}</button>}
            </div>
            <div className="overflow-hidden rounded-lg border border-line-soft">
              {list.length === 0 && <div className="px-3 py-5 text-center text-xs text-faint">No examples in {source}</div>}
              {list.map((e) => {
                const on = sel.includes(e.id);
                const hits = targets.filter((t) => clash(e, t));
                return (
                  <label key={e.id} className="flex cursor-pointer items-center gap-3 border-b border-line-soft px-3 py-2 text-xs last:border-0 hover:bg-white/[0.02]">
                    <input type="checkbox" checked={on} onChange={() => setSel(toggle(sel, e.id))} className="accent-[var(--color-accent)]" />
                    <span className={cx("w-8 shrink-0 rounded px-1 py-0.5 text-center text-[9px] font-bold", e.mode === "pub" ? "bg-ok/10 text-ok" : "bg-info/10 text-info")}>{e.mode === "pub" ? "PUB" : "REQ"}</span>
                    <span className="min-w-0 flex-1"><span className="text-faint">{e.folder} / </span>{e.name}</span>
                    {hits.length > 0 && <Badge tone="warn">exists in {hits.join(", ")}</Badge>}
                    <span className="truncate font-mono text-[10.5px] text-faint">{e.subject}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {clashes.length > 0 && (
            <div className="rounded-lg border border-warn/20 bg-warn/[0.05] p-3 text-xs">
              <div className="text-warn">{clashes.length} example{clashes.length > 1 ? "s" : ""} already exist{clashes.length === 1 ? "s" : ""} with the same folder and name</div>
              <div className="mt-2 flex gap-1.5">
                {([["keep", "Keep both"], ["replace", "Replace"], ["skip", "Skip"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setConflict(k)} className={cx("rounded-md border px-2.5 py-1", conflict === k ? "border-warn/50 bg-warn/10 text-fg" : "border-line text-muted hover:text-fg")}>{l}</button>
                ))}
              </div>
              {conflict === "keep" && <div className="mt-1.5 text-muted">The copy is named "… (from {source})".</div>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-5 py-3">
          <span className="flex-1 text-[11px] text-faint">Examples are stored by the app, not on the NATS server, so Read-only mode doesn't apply.</span>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="solid" disabled={!sel.length || !targets.length} onClick={apply}>
            {mode === "copy" ? `Copy ${sel.length || ""} to ${targets.length > 1 ? `${targets.length} Contexts` : targets[0] ?? "…"}` : `Import ${sel.length || ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SentView({ label, e }: { label: string; e: Example }) {
  const m: Message = { seq: 0, subject: e.subject, time: "", size: e.payload.length, headers: Object.fromEntries(e.headers), payload: e.payload, kind: /^\s*[[{]/.test(e.payload) ? "json" : "text" };
  let kind = m.kind;
  try { if (kind === "json") JSON.parse(e.payload); } catch { kind = "text"; }
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
      {e.headers.length > 0 && <div className="mb-2"><HeadersTable h={m.headers} /></div>}
      <PayloadView m={{ ...m, kind }} maxHeight={200} />
    </div>
  );
}
