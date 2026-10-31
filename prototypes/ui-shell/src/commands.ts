// PROTOTYPE: palette commands. Each variant supplies its own `go` so navigation stays variant-specific.
import { cliFor, contexts, kvBuckets, streams } from "./data";
import type { Command } from "./kit";

export type Screen = "contexts" | "overview" | "connections" | "streams" | "stream" | "consumers" | "messages" | "kv" | "publish" | "tail";

export const screenLabels: Record<Screen, string> = {
  contexts: "Contexts",
  overview: "Overview",
  connections: "Connections",
  streams: "Streams",
  stream: "Stream",
  consumers: "Consumers",
  messages: "Message browser",
  kv: "Key-Value",
  publish: "Publish / request",
  tail: "Live tail",
};

export function buildCommands(go: (s: Screen, arg?: string) => void, setActive: (c: string) => void): Command[] {
  const nav = (["overview", "connections", "streams", "consumers", "messages", "kv", "publish", "tail", "contexts"] as Screen[]).map((s) => ({
    id: `go-${s}`, group: "Go to", label: screenLabels[s], run: () => go(s),
  }));
  const st = streams.filter((s) => s.kind === "stream").map((s) => ({
    id: `stream-${s.name}`, group: "Streams", label: `Open stream ${s.name}`, cli: cliFor.streamInfo(s.name), run: () => go("stream", s.name),
  }));
  const kv = kvBuckets.map((b) => ({ id: `kv-${b.name}`, group: "Key-Value", label: `Open bucket ${b.name}`, cli: `nats kv ls ${b.name}`, run: () => go("kv", b.name) }));
  const ctx = contexts.map((c) => ({ id: `ctx-${c.name}`, group: "Switch Context", label: `Use ${c.name}`, hint: c.description, cli: cliFor.ctx(c.name), run: () => setActive(c.name) }));
  const actions = [
    { id: "a-tail", group: "Actions", label: "Tail orders.>", cli: cliFor.sub("orders.>"), run: () => go("tail") },
    { id: "a-req", group: "Actions", label: "Send a request…", cli: cliFor.req("svc.inventory.lookup"), run: () => go("publish") },
    { id: "a-new-stream", group: "Actions", label: "Create stream…", cli: "nats stream add", run: () => go("streams") },
  ];
  return [...nav, ...st, ...kv, ...ctx, ...actions];
}
