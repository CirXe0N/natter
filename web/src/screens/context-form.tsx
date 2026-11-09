// The New Context and Edit Context pages share one form. A Vault secret keeps a
// Context in Natter's own directory; a Secret reference or no secret may also
// go in the nats CLI directory. Monitoring URL and Read-only are Natter's own
// Settings, saved with a second request after the Context file.
import { type ReactNode, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ArrowLeft, KeyRound, Lock, LockOpen } from "lucide-react"
import { cn } from "cn"

import { api } from "@/api"
import { BlockedButton } from "@/components/blocked-button"
import { ScreenHeader } from "@/components/screen-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, Section, Segmented, Switch } from "@/components/form"
import { contextKeys, SecretBadge, useBlockedReason, useContexts } from "@/contexts"
import type { Context, SecretKind, SecretStorage, Source } from "@/gen/api"
import { useVault, vaultKey } from "@/vault"

const kinds: { value: SecretKind | ""; label: string }[] = [
  { value: "", label: "None" },
  { value: "password", label: "Password" },
  { value: "token", label: "Token" },
  { value: "creds", label: "Creds file" },
  { value: "nkey", label: "NKey seed" },
]
const kindLabel = (k: SecretKind | "") => kinds.find((x) => x.value === k)!.label

// Where a secret lives. The Vault holds the value; the others store a Secret reference natscli also reads.
const storages = [
  { value: "vault", label: "Vault" },
  { value: "env://", label: "env://", placeholder: "env://NATS_PASSWORD" },
  { value: "op://", label: "1Password", placeholder: "op://vault/item/field" },
  { value: "nsc://", label: "nsc", placeholder: "nsc://operator/account/user" },
] as const
type Storage = (typeof storages)[number]["value"]
const storageOf: Partial<Record<SecretStorage, Storage>> = { vault: "vault", env: "env://", op: "op://", nsc: "nsc://" }

const dirs: Record<Source, string> = { app: "~/.config/natter/nats/context", cli: "~/.config/nats/context" }

export function NewContextScreen() {
  return <ContextForm />
}

export function EditContextScreen() {
  const { source, name } = useParams({ strict: false }) as { source: Source; name: string }
  const contexts = useContexts()
  const c = contexts.data?.find((x) => x.source === source && x.name === name)
  if (contexts.isPending) return <p className="px-8 pt-7 text-sm text-muted-foreground">Loading…</p>
  if (contexts.isError) return <p className="px-8 pt-7 text-sm text-destructive">{contexts.error.message}</p>
  if (!c)
    return (
      <>
        <ScreenHeader title="Edit Context" />
        <p className="px-8 text-sm text-muted-foreground">
          There is no Context named <span className="font-mono text-foreground">{name}</span>.{" "}
          <Link to="/contexts" className="text-primary hover:underline">
            Back to Contexts
          </Link>
        </p>
      </>
    )
  return <ContextForm key={`${source}/${name}`} existing={c} />
}

function ContextForm({ existing }: { existing?: Context }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const vault = useVault()
  const blocked = useBlockedReason()
  const [form, setForm] = useState({ name: existing?.name ?? "", description: existing?.description ?? "", urls: existing?.urls ?? "", user: existing?.user ?? "" })
  const hadSecret = !!existing && existing.secret !== "none"
  const [keep, setKeep] = useState(hadSecret)
  const [kind, setKind] = useState<SecretKind | "">(existing?.secretKind ?? "")
  const [storage, setStorage] = useState<Storage>(storageOf[existing?.secret ?? "none"] ?? (existing?.source === "cli" ? "env://" : "vault"))
  const [secret, setSecret] = useState("")
  const [target, setTarget] = useState<Source>(existing?.source ?? "app")
  const [monitoringUrl, setMonitoringUrl] = useState(existing?.monitoringUrl ?? "")
  const [readOnly, setReadOnly] = useState(!!existing?.readOnly)

  const changing = !keep && kind !== ""
  const inVault = changing && storage === "vault"
  // With a keyring, saving creates the Vault (see ensureVault in the backend).
  const vaultOnSave = inVault && vault.data?.state === "none" && vault.data.keyring !== "unavailable"
  const vaultLocked = inVault && vault.data?.state !== "unlocked" && !vaultOnSave
  const noUser = kind === "creds" || kind === "nkey"
  const cliBlocked = inVault ? "natscli cannot read the Vault: pick a Secret reference to save it here." : blocked
  const source = existing?.source ?? (cliBlocked ? "app" : target)
  // natscli cannot read a Vault reference, so a CLI Context never offers it.
  const options = storages.filter((o) => (o.value !== "vault" || source === "app" || !existing) && (o.value !== "nsc://" || kind === "creds"))
  const saveBlocked = existing?.source === "cli" ? blocked : undefined

  const save = useMutation({
    mutationFn: async () => {
      const user = noUser ? "" : form.user
      const secretFields = changing ? { secretKind: kind as SecretKind, ...(storage === "vault" ? { secret } : { secretRef: secret }) } : {}
      const saved = existing
        ? await api.updateContext(existing, { description: form.description, urls: form.urls, user, keepSecret: keep, ...secretFields })
        : await api.createContext({ ...form, user, ...secretFields, ...(source === "cli" && { source: "cli" as const }) })
      const settings = { monitoringUrl: monitoringUrl.trim() || undefined, readOnly }
      if (settings.monitoringUrl !== saved.monitoringUrl || settings.readOnly !== !!saved.readOnly) await api.setContextSettings(saved, settings)
      return saved
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contextKeys.all })
      qc.invalidateQueries({ queryKey: vaultKey }) // saving may have created it
      navigate({ to: "/contexts" })
    },
    // A new Context saved before its Settings failed is still listed.
    onError: () => qc.invalidateQueries({ queryKey: contextKeys.all }),
  })

  const text = (key: keyof typeof form, label: string, props: React.ComponentProps<"input"> & { hint?: ReactNode } = {}) => {
    const { hint, className, ...rest } = props
    return (
      <Field label={label} hint={hint}>
        {(id, hintId) => <Input id={id} aria-describedby={hintId} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className={cn("h-8 text-xs md:text-xs", className)} {...rest} />}
      </Field>
    )
  }

  return (
    <>
      <ScreenHeader
        title={
          existing ? (
            <>
              Edit <span className="font-mono">{existing.name}</span>
            </>
          ) : (
            "New Context"
          )
        }
      >
        <Link to="/contexts" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft aria-hidden />
          All Contexts
        </Link>
      </ScreenHeader>
      <form
        aria-label={existing ? `Edit ${existing.name}` : "New Context"}
        className="px-8 pb-10"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="divide-y rounded-xl border bg-card">
          <Section title="Connection" description="Where the servers are, and what to call this Context.">
            <div className="grid gap-4 sm:grid-cols-2">
              {text("name", "Name", {
                required: true,
                readOnly: !!existing,
                autoFocus: !existing,
                spellCheck: false,
                className: "font-mono read-only:text-muted-foreground",
                hint: existing ? "Fixed after create." : "Letters, digits, - and _.",
              })}
              {text("description", "Description", { placeholder: "Staging cluster, EU" })}
              <div className="sm:col-span-2">{text("urls", "Server URLs", { required: true, spellCheck: false, placeholder: "nats://127.0.0.1:4222", className: "font-mono", hint: "Separate several with commas." })}</div>
            </div>
          </Section>

          <Section title="Authentication" description="How this Context proves who it is. A secret in the Vault is encrypted; a reference is resolved each time Natter connects.">
            <div className="grid gap-4">
              {keep ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-background/40 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-xs">
                    <KeyRound size={14} aria-hidden className="text-muted-foreground" />
                    <span className="font-medium">{existing?.secretKind ? kindLabel(existing.secretKind) : "Secret"}</span>
                    <SecretBadge secret={existing!.secret} />
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setKeep(false)}>
                    Change secret
                  </Button>
                </div>
              ) : (
                <>
                  <Segmented label="Secret" value={kind} options={kinds} onChange={(k) => {
                    setKind(k)
                    if (k !== "creds" && storage === "nsc://") setStorage(options[0].value)
                  }} />
                  {kind !== "" && <Segmented label="Stored in" value={storage} options={options} onChange={setStorage} />}
                  {kind !== "" && (
                    <SecretInput kind={kind} storage={storage} value={secret} onChange={setSecret} />
                  )}
                  {vaultOnSave && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <KeyRound size={12} aria-hidden />
                      Saving creates the Vault, with its key in your OS keyring.
                    </p>
                  )}
                  {vaultLocked && (
                    <p className="text-xs text-warning">
                      {vault.data?.state === "none" ? "Create the Vault" : "Unlock the Vault"} on the{" "}
                      <Link to="/contexts" className="underline underline-offset-2">
                        Contexts page
                      </Link>{" "}
                      first to store a secret in it.
                    </p>
                  )}
                  {hadSecret && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {kind === "" && <span className="text-warning">Saving removes the current secret.</span>}
                      <button type="button" onClick={() => setKeep(true)} className="rounded text-primary hover:underline">
                        Keep the current secret
                      </button>
                    </div>
                  )}
                </>
              )}
              {!noUser && (
                <div className="sm:w-1/2 sm:pr-2">
                  {text("user", "User", { autoComplete: "off", spellCheck: false, required: kind === "password", hint: kind === "password" ? "A password needs a user." : undefined })}
                </div>
              )}
            </div>
          </Section>

          <Section title="Natter settings" description="Kept in Natter's own directory for every Context: natscli files have no field for them.">
            <div className="grid gap-4">
              <div className="sm:w-1/2 sm:pr-2">
                <Field label="Monitoring URL" hint="Server-wide data without System credentials. Read-only, over HTTP.">
                  {(id, hintId) => <Input id={id} aria-describedby={hintId} type="url" spellCheck={false} placeholder="http://127.0.0.1:8222" value={monitoringUrl} onChange={(e) => setMonitoringUrl(e.target.value)} className="h-8 font-mono text-xs md:text-xs" />}
                </Field>
              </div>
              <Switch
                checked={readOnly}
                onChange={setReadOnly}
                tone="warning"
                icon={readOnly ? <Lock size={12} aria-hidden className="text-warning" /> : <LockOpen size={12} aria-hidden className="text-muted-foreground" />}
                label="Read-only"
                description="Refuse every change to the server and every send while this Context is active. Browsing still works."
              />
            </div>
          </Section>

          {!existing && (
            <Section title="Save in" description="Natter reads both directories. Only the nats CLI directory is shared with natscli.">
              <div role="radiogroup" aria-label="Save in" className="grid gap-3 sm:grid-cols-2">
                <Choice name="target" checked={source === "app"} onChange={() => setTarget("app")} title="Natter" path={dirs.app}>
                  Only Natter sees it. Its secret can live in the Vault.
                </Choice>
                <Choice name="target" checked={source === "cli"} onChange={() => setTarget("cli")} title="nats CLI" path={dirs.cli} disabledReason={cliBlocked}>
                  natscli sees it too.
                </Choice>
              </div>
            </Section>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {save.isError && (
            <p role="alert" className="mr-auto text-xs text-destructive">
              {save.error.message}
            </p>
          )}
          {existing && <span className="mr-auto text-[11px] text-fg-faint">{dirs[existing.source]}/{existing.name}.json</span>}
          <Link to="/contexts" className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
          <BlockedButton reason={saveBlocked} type="submit" disabled={save.isPending || vaultLocked}>
            {save.isPending ? "Saving…" : existing ? "Save changes" : "Create Context"}
          </BlockedButton>
        </div>
      </form>
    </>
  )
}




function SecretInput({ kind, storage, value, onChange }: { kind: SecretKind; storage: Storage; value: string; onChange: (v: string) => void }) {
  const ref = storage !== "vault"
  const multiline = !ref && (kind === "creds" || kind === "nkey")
  const placeholder = storages.find((s) => s.value === storage)
  return (
    <Field label={ref ? "Reference" : kindLabel(kind)} hint={ref ? "Stored as written. Natter resolves it on connect." : "Encrypted in the Vault. The Context file holds only a reference to it."}>
      {(id, hintId) =>
        multiline ? (
          <textarea
            id={id}
            aria-describedby={hintId}
            required
            rows={4}
            spellCheck={false}
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={kind === "creds" ? "-----BEGIN NATS USER JWT-----" : "SU…"}
            className="rounded-lg border border-input bg-input/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground"
          />
        ) : (
          <Input
            id={id}
            aria-describedby={hintId}
            required
            spellCheck={false}
            type={ref ? "text" : "password"}
            autoComplete={ref ? "off" : "new-password"}
            placeholder={placeholder && "placeholder" in placeholder ? placeholder.placeholder : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 font-mono text-xs md:text-xs"
          />
        )
      }
    </Field>
  )
}


function Choice({ name, checked, onChange, title, path, disabledReason, children }: { name: string; checked: boolean; onChange: () => void; title: string; path: string; disabledReason?: string; children: ReactNode }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
        checked ? "border-primary/50 bg-primary/5" : "hover:border-fg-faint/50",
        disabledReason && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name={name} checked={checked} disabled={!!disabledReason} onChange={onChange} className="mt-0.5 accent-(--primary)" />
      <span className="grid gap-1 text-xs">
        <span className="font-medium">{title}</span>
        <span className="font-mono text-[11px] text-fg-faint">{path}</span>
        <span className="text-muted-foreground">{disabledReason ?? children}</span>
      </span>
    </label>
  )
}
