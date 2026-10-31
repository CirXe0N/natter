import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { ScreenHeader } from "@/components/screen-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CapabilityBadges, contextKeys, refKey, SecretBadge, useActivateContext, useActiveContext, useContexts } from "@/contexts"
import type { Active, Context } from "@/gen/api"

export function ContextsScreen() {
  const contexts = useContexts()
  const { data: active } = useActiveContext()
  return (
    <>
      <ScreenHeader title="Contexts">
        <Badge>~/.config/nats/context</Badge>
      </ScreenHeader>
      <div className="px-8 pb-10">
        {contexts.isPending && <p className="text-muted-foreground">Loading Contexts…</p>}
        {contexts.isError && <p className="text-destructive">{contexts.error.message}</p>}
        {contexts.data?.length === 0 && (
          <p className="text-muted-foreground">
            No natscli Contexts found in ~/.config/nats/context/. Create one with <code className="font-mono text-foreground">nats context add</code>.
          </p>
        )}
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {contexts.data?.map((c) => (
            <ContextCard key={refKey(c)} c={c} active={active?.context && refKey(active.context) === refKey(c) ? active : undefined} />
          ))}
        </ul>
      </div>
    </>
  )
}

function ContextCard({ c, active }: { c: Context; active?: Active }) {
  const activate = useActivateContext()
  return (
    <li aria-label={c.name} className={`rounded-xl border bg-card p-4 ${active ? "border-primary/50" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-mono text-sm font-semibold">
          {c.name}
          {active && <Badge tone="primary">Active</Badge>}
        </h2>
        <Button size="sm" variant={active ? "outline" : "default"} disabled={activate.isPending} onClick={() => activate.mutate(c)}>
          {activate.isPending ? "Connecting…" : active ? "Reconnect" : "Connect"}
        </Button>
      </div>
      {c.description && <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>}
      <p className="mt-3 truncate font-mono text-[11px] text-fg-faint">{c.urls}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {c.user && <Badge>user {c.user}</Badge>}
        <Badge>{c.mode === "jwt" ? "JWT / operator" : "static config"}</Badge>
        <SecretBadge secret={c.secret} />
        <Badge>nats CLI context</Badge>
      </div>
      {c.secret === "plaintext" && (
        <p className="mt-3 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          This Context's file holds a Plaintext secret: anyone who can read the file can use it.
        </p>
      )}
      {active?.status === "connected" && (
        <div className="mt-3">
          <CapabilityBadges active={active} />
        </div>
      )}
      {active?.status === "failed" && <p className="mt-3 text-xs text-destructive">Could not connect: {active.error}</p>}
      {activate.isError && <p role="alert" className="mt-3 text-xs text-destructive">{activate.error.message}</p>}
      <MonitoringURL c={c} />
    </li>
  )
}

// Natter keeps the Monitoring URL in its own directory: natscli Context files have no field for it.
function MonitoringURL({ c }: { c: Context }) {
  const qc = useQueryClient()
  const [value, setValue] = useState(c.monitoringUrl ?? "")
  const save = useMutation({
    mutationFn: () => api.setContextSettings(c, { monitoringUrl: value.trim() || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: contextKeys.all }),
  })
  const id = `monitoring-${refKey(c)}`
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        Monitoring URL: <span className="font-mono">{c.monitoringUrl ?? "not set"}</span>
      </summary>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <label htmlFor={id} className="sr-only">
          Monitoring URL for {c.name}
        </label>
        <Input id={id} type="url" placeholder="http://127.0.0.1:8222" value={value} onChange={(e) => setValue(e.target.value)} className="h-7 font-mono text-xs" />
        <Button type="submit" size="sm" variant="outline" disabled={save.isPending}>
          Save
        </Button>
      </form>
      {save.isError && <p role="alert" className="mt-1.5 text-destructive">{save.error.message}</p>}
    </details>
  )
}
