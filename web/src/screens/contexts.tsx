import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { api } from "@/api"

import { Badge } from "@/components/badge"
import { ScreenHeader } from "@/components/screen-header"
import { BlockedButton } from "@/components/blocked-button"
import { Button } from "@/components/ui/button"
import { Lock } from "lucide-react"
import { Input } from "@/components/ui/input"
import { CapabilityBadges, contextKeys, refKey, SecretBadge, useActivateContext, useActiveContext, useBlockedReason, useContexts, useSetSettings } from "@/contexts"
import type { Active, Context } from "@/gen/api"
import { NewContextForm } from "@/screens/new-context"
import { VaultPanel } from "@/vault"

export function ContextsScreen() {
  const contexts = useContexts()
  const { data: active } = useActiveContext()
  return (
    <>
      <ScreenHeader title="Contexts">
        <Badge>~/.config/nats/context</Badge>
        <Badge>~/.config/natter/nats/context</Badge>
      </ScreenHeader>
      <div className="px-8 pb-10">
        <VaultPanel />
        <NewContextForm />
        {contexts.isPending && <p className="text-muted-foreground">Loading Contexts…</p>}
        {contexts.isError && <p className="text-destructive">{contexts.error.message}</p>}
        {contexts.data?.length === 0 && (
          <p className="text-muted-foreground">
            No Contexts found in ~/.config/nats/context/. Create one above, or with <code className="font-mono text-foreground">nats context add</code>.
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
        <Badge>{c.source === "cli" ? "nats CLI Context" : "Natter Context"}</Badge>
      </div>
      {c.secret === "plaintext" && (
        <p className="mt-3 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          This Context's file holds a Plaintext secret: anyone who can read the file can use it.
        </p>
      )}
      {c.source === "cli" && c.secret === "plaintext" && <MoveIntoVault c={c} />}
      {active?.status === "connected" && (
        <div className="mt-3">
          <CapabilityBadges active={active} />
        </div>
      )}
      {active?.status === "failed" && <p className="mt-3 text-xs text-destructive">Could not connect: {active.error}</p>}
      {active?.status === "locked" && <p className="mt-3 text-xs text-warning">This Context's secret is in the Vault. Unlock the Vault above to connect.</p>}
      {activate.isError && <p role="alert" className="mt-3 text-xs text-destructive">{activate.error.message}</p>}
      <ReadOnlyToggle c={c} />
      <MonitoringURL c={c} />
    </li>
  )
}

function ReadOnlyToggle({ c }: { c: Context }) {
  const set = useSetSettings()
  return (
    <div className="mt-3 flex items-center gap-2 text-xs">
      <Button
        size="sm"
        variant="outline"
        aria-pressed={!!c.readOnly}
        disabled={set.isPending}
        title="While a Context is in Read-only mode, Natter refuses every change to the server and every send, requests included. Browsing still works."
        onClick={() => set.mutate({ c, settings: { monitoringUrl: c.monitoringUrl, readOnly: !c.readOnly } })}
      >
        <Lock size={12} aria-hidden />
        Read-only: {c.readOnly ? "on" : "off"}
      </Button>
      {set.isError && <span role="alert" className="text-destructive">{set.error.message}</span>}
    </div>
  )
}

// Natter keeps the Monitoring URL in its own directory: natscli Context files have no field for it.
function MonitoringURL({ c }: { c: Context }) {
  const [value, setValue] = useState(c.monitoringUrl ?? "")
  const save = useSetSettings()
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
          save.mutate({ c, settings: { monitoringUrl: value.trim() || undefined, readOnly: c.readOnly } })
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

// Moving copies the Context into Natter's directory with its secret in the Vault.
// Removing the CLI file is a second step with its own confirmation.
function MoveIntoVault({ c }: { c: Context }) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: contextKeys.all })
  const move = useMutation({ mutationFn: () => api.moveIntoVault(c), onSuccess: refresh })
  const remove = useMutation({ mutationFn: () => api.removeContext(c), onSuccess: refresh })
  const [confirming, setConfirming] = useState(false)
  const blocked = useBlockedReason()
  return (
    <div className="mt-3 text-xs">
      {!move.isSuccess ? (
        <Button size="sm" variant="outline" disabled={move.isPending} onClick={() => move.mutate()}>
          Move into Vault
        </Button>
      ) : (
        <div role="status" className="grid gap-2">
          <p>
            Copied to the Natter Context <span className="font-mono">{move.data.name}</span> with its secret in the Vault. The nats CLI file is unchanged and still holds the Plaintext secret.
          </p>
          {!confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <BlockedButton reason={blocked} size="sm" variant="outline" onClick={() => setConfirming(true)}>
                Delete the nats CLI file…
              </BlockedButton>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span>Delete ~/.config/nats/context/{c.name}.json? natscli will lose this Context.</span>
              <BlockedButton reason={blocked} size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                Delete file
              </BlockedButton>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </div>
          )}
        </div>
      )}
      {(move.isError || remove.isError) && <p role="alert" className="mt-1.5 text-destructive">{(move.error ?? remove.error)?.message}</p>}
    </div>
  )
}
