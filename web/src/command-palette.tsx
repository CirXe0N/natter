// The command palette: ⌘K or Ctrl+K jumps to a screen, switches Context, opens a
// stream or KV bucket, or starts an action. Entries come from the live Context
// list and the active Context's streams and buckets. Add a source by pushing to
// the list in useCommands.
import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { Search } from "lucide-react"

import { api } from "@/api"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { refKey, useActivateContext, useContexts } from "@/contexts"

export type PaletteCommand = { id: string; label: string; group: string; hint?: string; cli?: string; run: () => void }

const screens = ["/overview", "/health", "/connections", "/streams", "/consumers", "/messages", "/kv", "/publish", "/tail", "/contexts"] as const

function useCommands(): PaletteCommand[] {
  const navigate = useNavigate()
  const { routesByPath } = useRouter()
  const contexts = useContexts()
  const activate = useActivateContext()
  const names = useQuery({ queryKey: ["jetstream", "names"], queryFn: ({ signal }) => api.jetStreamNames(signal) })

  const go = (to: (typeof screens)[number]) => () => void navigate({ to })
  const title = (to: (typeof screens)[number]) => routesByPath[to].options.staticData?.title ?? to
  return [
    ...screens.map((to) => ({ id: `go-${to}`, group: "Go to", label: title(to), run: go(to) })),
    ...(names.data?.streams ?? []).map((n) => ({ id: `stream-${n}`, group: "Streams", label: `Open stream ${n}`, cli: `nats stream info ${n}`, run: () => void navigate({ to: "/streams/$stream", params: { stream: n } }) })),
    ...(names.data?.buckets ?? []).map((n) => ({ id: `kv-${n}`, group: "Key-Value", label: `Open bucket ${n}`, cli: `nats kv status ${n}`, run: () => void navigate({ to: "/kv/$bucket", params: { bucket: n } }) })),
    ...(contexts.data ?? []).map((c) => ({
      id: `ctx-${refKey(c)}`,
      group: "Switch Context",
      label: `Use ${c.name}`,
      hint: c.description,
      cli: c.source === "cli" ? `nats context select ${c.name}` : undefined, // natscli cannot see Natter's own Contexts
      run: () => activate.mutate(c),
    })),
    { id: "a-stream", group: "Actions", label: "Create stream…", cli: "nats stream add", run: go("/streams") },
    { id: "a-bucket", group: "Actions", label: "Create bucket…", cli: "nats kv add", run: go("/kv") },
    { id: "a-publish", group: "Actions", label: "Publish a message…", cli: "nats pub", run: go("/publish") },
    { id: "a-tail", group: "Actions", label: "Tail a subject…", cli: "nats sub", run: go("/tail") },
  ]
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const commands = useCommands()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const groups = new Map<string, PaletteCommand[]>()
  for (const c of commands) groups.set(c.group, [...(groups.get(c.group) ?? []), c])
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-72 items-center gap-2 rounded-lg border bg-background px-3 text-xs text-muted-foreground hover:text-foreground"
      >
        <Search size={14} aria-hidden />
        <span className="flex-1 text-left">Search or run a command…</span>
        <kbd className="font-mono text-[11px]">⌘K</kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Jump to a screen, switch Context, open a stream or bucket, or run an action." className="sm:max-w-xl">
        <Command key={String(open)}>
          <CommandInput placeholder="Jump to a screen, stream, bucket, Context, or run an action…" />
          <CommandList>
            <CommandEmpty>No matches</CommandEmpty>
            {[...groups].map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`${c.group} ${c.label} ${c.cli ?? ""}`}
                    onSelect={() => {
                      setOpen(false)
                      c.run()
                    }}
                  >
                    <span className="flex-1 truncate">
                      {c.label}
                      {c.hint && <span className="ml-2 text-xs text-muted-foreground">{c.hint}</span>}
                    </span>
                    {c.cli && <span className="truncate font-mono text-[11px] text-muted-foreground">{c.cli}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
