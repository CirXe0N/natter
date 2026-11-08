import { useId, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Lock, LockOpen, Pencil, Plus, Trash2 } from "lucide-react"
import { cn } from "cn"

import { api } from "@/api"

import { Badge } from "@/components/badge"
import { ScreenHeader } from "@/components/screen-header"
import { BlockedButton } from "@/components/blocked-button"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CapabilityBadges, contextKeys, refKey, SecretBadge, useActivateContext, useActiveContext, useBlockedReason, useContexts, useSetSettings } from "@/contexts"
import type { Active, Context } from "@/gen/api"
import { VaultPanel, vaultKey } from "@/vault"

const dirs = { app: "~/.config/natter/nats/context", cli: "~/.config/nats/context" }

export function ContextsScreen() {
  const contexts = useContexts()
  const { data: active } = useActiveContext()
  return (
    <>
      <ScreenHeader title="Contexts">
        <Badge>{dirs.cli}</Badge>
        <Badge>{dirs.app}</Badge>
        <Link to="/contexts/new" className={buttonVariants({ size: "sm" })}>
          <Plus aria-hidden />
          New Context
        </Link>
      </ScreenHeader>
      <div className="px-8 pb-10">
        <VaultPanel />
        {contexts.isPending && <p className="text-muted-foreground">Loading Contexts…</p>}
        {contexts.isError && <p className="text-destructive">{contexts.error.message}</p>}
        {contexts.data?.length === 0 && (
          <p className="mb-3 text-sm text-muted-foreground">
            No Contexts yet. Add one here.
          </p>
        )}
        {contexts.data && (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {contexts.data.map((c) => (
              <ContextCard key={refKey(c)} c={c} active={active?.context && refKey(active.context) === refKey(c) ? active : undefined} />
            ))}
            <li>
              <Link
                to="/contexts/new"
                className="grid h-full min-h-40 place-items-center rounded-xl border border-dashed text-xs text-muted-foreground transition-colors hover:border-fg-faint hover:text-foreground"
              >
                <span className="flex items-center gap-1.5">
                  <Plus size={14} aria-hidden />
                  Add Context
                </span>
              </Link>
            </li>
          </ul>
        )}
      </div>
    </>
  )
}

function ContextCard({ c, active }: { c: Context; active?: Active }) {
  const activate = useActivateContext()
  return (
    <li aria-label={c.name} className={cn("flex flex-col rounded-xl border bg-card p-4 transition-colors", active ? "border-primary/50" : "hover:border-fg-faint/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-mono text-sm font-semibold">
            <span className="truncate">{c.name}</span>
            {active && <Badge tone="primary">Active</Badge>}
          </h2>
          {c.description && <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>}
        </div>
        <ReadOnlyToggle c={c} />
      </div>
      <p className="mt-3 truncate font-mono text-[11px] text-fg-faint">{c.urls}</p>
      {c.monitoringUrl && <p className="mt-0.5 truncate font-mono text-[11px] text-fg-faint">monitoring {c.monitoringUrl}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {c.user && <Badge>user {c.user}</Badge>}
        <Badge>{c.mode === "jwt" ? "JWT / operator" : "static config"}</Badge>
        <SecretBadge secret={c.secret} />
        <Badge>{c.source === "cli" ? "nats CLI Context" : "Natter Context"}</Badge>
      </div>
      {active?.status === "connected" && (
        <div className="mt-2">
          <CapabilityBadges active={active} />
        </div>
      )}
      {c.secret === "plaintext" && (
        <p className="mt-3 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          This Context's file holds a Plaintext secret: anyone who can read the file can use it.
        </p>
      )}
      {c.source === "cli" && c.secret === "plaintext" && <MoveIntoVault c={c} />}
      {active?.status === "failed" && <p className="mt-3 text-xs text-destructive">Could not connect: {active.error}</p>}
      {active?.status === "locked" && <p className="mt-3 text-xs text-warning">This Context's secret is in the Vault. Unlock the Vault above to connect.</p>}
      {activate.isError && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {activate.error.message}
        </p>
      )}
      <div className="mt-auto flex items-center gap-1 pt-4">
        <Button size="sm" variant={active ? "outline" : "default"} disabled={activate.isPending} onClick={() => activate.mutate(c)}>
          {activate.isPending ? "Connecting…" : active ? "Reconnect" : "Connect"}
        </Button>
        <Link to="/contexts/$source/$name/edit" params={{ source: c.source, name: c.name }} className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "ml-auto text-muted-foreground")}>
          <Pencil aria-hidden />
          Edit
        </Link>
        <RemoveContext c={c} active={!!active} />
      </div>
    </li>
  )
}

// The prototype's Read-only chip: amber "Read-only" or muted "Writable"; a click flips it.
function ReadOnlyToggle({ c }: { c: Context }) {
  const set = useSetSettings()
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        disabled={set.isPending}
        title={c.readOnly ? "Turn Read-only mode off" : "Turn Read-only mode on: Natter then refuses every change to the server and every send. Browsing still works."}
        onClick={() => set.mutate({ c, settings: { monitoringUrl: c.monitoringUrl, readOnly: !c.readOnly } })}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors",
          c.readOnly ? "border-warning/25 bg-warning/10 text-warning hover:bg-warning/15" : "border-border bg-accent text-muted-foreground hover:text-foreground",
        )}
      >
        {c.readOnly ? <Lock size={11} aria-hidden /> : <LockOpen size={11} aria-hidden />}
        {c.readOnly ? "Read-only" : "Writable"}
      </button>
      {set.isError && (
        <span role="alert" className="text-[11px] text-destructive">
          {set.error.message}
        </span>
      )}
    </div>
  )
}

// Removing deletes the Context's file; a Natter Context's Vault secret goes with it.
// The active Context cannot be removed, and a CLI file is natscli's state, which Read-only protects.
function RemoveContext({ c, active }: { c: Context; active: boolean }) {
  const qc = useQueryClient()
  const blocked = useBlockedReason()
  const [open, setOpen] = useState(false)
  const remove = useMutation({
    mutationFn: () => api.removeContext(c),
    onSuccess: () => {
      setOpen(false)
      qc.invalidateQueries({ queryKey: contextKeys.all })
    },
  })
  const reason = active ? "Connect to another Context to remove this one." : c.source === "cli" ? blocked : undefined
  const reasonId = useId()
  return (
    <>
      {reason && (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Remove"
        aria-describedby={reason ? reasonId : undefined}
        title={reason ?? "Remove"}
        disabled={!!reason}
        focusableWhenDisabled
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={(o) => !remove.isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {c.name}?</DialogTitle>
            <DialogDescription>
              Deletes <span className="font-mono text-foreground">{dirs[c.source]}/{c.name}.json</span>
              {c.source === "cli" ? ". natscli loses this Context too." : c.secret === "vault" ? " and its secret in the Vault." : "."} This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {remove.isError && (
            <p role="alert" className="text-xs text-destructive">
              {remove.error.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Remove Context
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Moving copies the Context into Natter's directory with its secret in the Vault.
// Removing the CLI file is a second step with its own confirmation.
function MoveIntoVault({ c }: { c: Context }) {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: contextKeys.all })
    qc.invalidateQueries({ queryKey: vaultKey }) // the first move creates the Vault
  }
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
