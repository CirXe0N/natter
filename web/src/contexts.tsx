// The active Context: queries, the switch, and the pieces of chrome that show it.
// Other screens read the active Context with useActiveContext and switch with useActivateContext.
import type { ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { ChevronDown, KeyRound, Lock, LockOpen, TriangleAlert } from "lucide-react"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { Active, Context, Ref, SecretStorage, Settings } from "@/gen/api"

export const contextKeys = { all: ["contexts"] as const, active: ["contexts", "active"] as const }

export const refKey = (r: Ref) => `${r.source}/${r.name}`

export function useContexts() {
  return useQuery({ queryKey: contextKeys.all, queryFn: ({ signal }) => api.contexts(signal) })
}

export function useActiveContext() {
  return useQuery({
    queryKey: contextKeys.active,
    queryFn: ({ signal }) => api.activeContext(signal),
    // Natter reconnects on its own after a restart and nats.go after a drop; follow along until it settles.
    refetchInterval: (q) => (q.state.data?.status === "connecting" || q.state.data?.status === "reconnecting" ? 1000 : false),
  })
}

// Switching resolves once the backend has connected or failed. Every cached
// query belonged to the previous Context, so all of them refetch.
export function useActivateContext() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (c: Context) => api.activateContext(c),
    onMutate: (c) => qc.setQueryData<Active>(contextKeys.active, { context: c, status: "connecting", capabilities: { account: "", system: false, jetStream: false, monitoring: false } }),
    onSuccess: (active) => qc.setQueryData(contextKeys.active, active),
    onSettled: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "contexts" || q.queryKey[1] !== "active" }),
    onError: () => qc.invalidateQueries({ queryKey: contextKeys.active }),
  })
}

// Natter's own per-Context settings. The backend replaces the whole object, so always send every field.
export function useSetSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ c, settings }: { c: Context; settings: Settings }) => api.setContextSettings(c, settings),
    onSuccess: () => qc.invalidateQueries({ queryKey: contextKeys.all }),
  })
}

// Why an action that changes the server is disabled, or undefined when it is allowed.
// Pass it as the `reason` of a BlockedButton: the control stays visible, disabled, with the reason shown.
export function useBlockedReason() {
  const { data: active } = useActiveContext()
  return active?.context?.readOnly ? "Read-only mode is on for this Context. Turn it off on the Contexts screen first." : undefined
}

// The Read-only toggle in the top bar: "Read-only" unlocks, "Writable" locks. 28 px tall.
export function ReadOnlyBadge() {
  const { data: active } = useActiveContext()
  const set = useSetSettings()
  const c = active?.context
  if (!c) return null
  const ro = c.readOnly
  return (
    <button
      type="button"
      disabled={set.isPending}
      title={ro ? "Read-only mode: changes and sends are blocked. Click to turn it off." : "Click to switch on Read-only mode"}
      onClick={() => set.mutate({ c, settings: { monitoringUrl: c.monitoringUrl, readOnly: !ro } })}
      className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium ${ro ? "border-warning/25 bg-warning/10 text-warning" : "border-border bg-accent text-muted-foreground hover:text-foreground"}`}
    >
      {ro ? <Lock size={11} aria-hidden /> : <LockOpen size={11} aria-hidden />}
      {ro ? "Read-only" : "Writable"}
    </button>
  )
}

const secretLabel: Record<SecretStorage, string> = {
  none: "No secret",
  plaintext: "Plaintext secret",
  "unknown-reference": "Unknown Secret reference",
  env: "Env (env://)",
  op: "1Password (op://)",
  nsc: "nsc (nsc://)",
  vault: "Vault",
}

export function SecretBadge({ secret }: { secret: SecretStorage }) {
  if (secret === "plaintext")
    return (
      <Badge tone="warning" title="Anyone who can read this Context's file can use its secret">
        <TriangleAlert size={11} aria-hidden />
        Plaintext secret
      </Badge>
    )
  if (secret === "unknown-reference")
    return (
      <Badge tone="destructive" title="A creds, nkey or TLS key value starts with a scheme:// natscli cannot read, so this Context cannot connect">
        <TriangleAlert size={11} aria-hidden />
        {secretLabel[secret]}
      </Badge>
    )
  return (
    <Badge>
      <KeyRound size={11} aria-hidden />
      {secretLabel[secret]}
    </Badge>
  )
}

// What the connection to the active Context may do, as detected on connect.
export function CapabilityBadges({ active }: { active: Active }) {
  const caps = active.capabilities
  const monitoringSet = !!active.context?.monitoringUrl
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {caps.system && <Badge tone="success" title={`User in the system account ${caps.account}`}>System credentials</Badge>}
      {caps.jetStream ? <Badge tone="success">JetStream</Badge> : <Badge title="$JS.API.INFO did not answer for this account">No JetStream</Badge>}
      {caps.monitoring && <Badge tone="info">Monitoring URL</Badge>}
      {monitoringSet && !caps.monitoring && <Badge tone="warning" title={`${active.context?.monitoringUrl}/varz did not answer`}>Monitoring URL unreachable</Badge>}
      {!caps.system && !caps.monitoring && <Badge tone="warning" title="Server-wide data needs System credentials or a Monitoring URL">No system access</Badge>}
    </span>
  )
}

// The connection to the active Context, for the top bar.
export function ConnectionStatus() {
  const { data: active, error } = useActiveContext()
  if (error) return <span className="text-destructive">{error.message}</span>
  if (!active || active.status === "none") return null
  const name = <span className="font-mono">{active.context?.name}</span>
  switch (active.status) {
    case "connecting":
      return <Status dot="bg-fg-faint animate-pulse">Connecting to {name}…</Status>
    case "reconnecting":
      return <Status dot="bg-warning animate-pulse">Reconnecting to {name}…</Status>
    case "failed":
      return (
        <span role="alert" className="flex min-w-0 items-center gap-1.5 text-destructive" title={active.error}>
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-destructive" />
          <span className="truncate">Could not connect to {name}: {active.error}</span>
        </span>
      )
    case "locked":
      return (
        <Status dot="bg-warning">
          <Lock size={12} aria-hidden className="text-warning" />
          <Link to="/contexts" className="text-warning underline underline-offset-2">
            Unlock the Vault
          </Link>
          to connect to {name}
        </Status>
      )
    case "connected":
      return (
        <Status dot="bg-success" ping>
          connected <span className="font-mono text-fg-faint">{active.server?.replace(/^\w+:\/\//, "")}</span>
        </Status>
      )
  }
}

function Status({ dot, ping, children }: { dot: string; ping?: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
      <span aria-hidden className="relative flex size-2">
        {ping && <span className={`absolute inline-flex size-full rounded-full opacity-40 motion-safe:animate-ping ${dot}`} />}
        <span className={`relative inline-flex size-2 rounded-full ${dot}`} />
      </span>
      {children}
    </span>
  )
}

// The Context card at the top of the sidebar: shows the active Context and switches to another.
export function ContextSwitcher() {
  const navigate = useNavigate()
  const { data: active } = useActiveContext()
  const contexts = useContexts()
  const activate = useActivateContext()
  const current = active?.context
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Context: ${current?.name ?? "none"}. Switch Context`}
        className="flex w-full items-center gap-2.5 rounded-lg border bg-popover px-2.5 py-2 text-left hover:border-input"
      >
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/15 font-mono text-xs font-bold text-primary">
          {current?.name[0]?.toUpperCase() ?? "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs font-semibold">{current?.name ?? "No Context"}</span>
          <span className="block truncate text-[11px] text-fg-faint">{current?.urls ?? "Choose a Context"}</span>
        </span>
        <ChevronDown aria-hidden size={14} className="text-fg-faint" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--anchor-width)">
        {contexts.isError && <p className="px-1.5 py-1 text-xs text-destructive">{contexts.error.message}</p>}
        <DropdownMenuRadioGroup
          value={current ? refKey(current) : ""}
          onValueChange={(key) => {
            const c = contexts.data?.find((c) => refKey(c) === key)
            if (c) activate.mutate(c)
          }}
        >
          {contexts.data?.map((c) => (
            <DropdownMenuRadioItem key={refKey(c)} value={refKey(c)} closeOnClick className="font-mono text-xs">
              {c.name}
              {c.secret === "plaintext" && <TriangleAlert size={11} className="ml-auto text-warning" aria-label="Plaintext secret" />}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs text-muted-foreground" onClick={() => navigate({ to: "/contexts" })}>
          Manage Contexts…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {activate.isError && <p role="alert" className="mt-1.5 text-[11px] text-destructive">{activate.error.message}</p>}
    </>
  )
}
