import { type ComponentProps, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { api } from "@/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { contextKeys } from "@/contexts"
import type { NewContext, SecretKind } from "@/gen/api"
import { useVault } from "@/vault"

const kinds: { value: SecretKind | ""; label: string }[] = [
  { value: "", label: "None" },
  { value: "password", label: "Password" },
  { value: "token", label: "Token" },
  { value: "creds", label: "Creds file" },
  { value: "nkey", label: "NKey seed" },
]

// Where a secret lives. The Vault holds the value; the others store a Secret reference natscli also reads.
const storages = [
  { value: "vault", label: "Vault" },
  { value: "env://", label: "Environment variable (env://)" },
  { value: "op://", label: "1Password (op://)" },
  { value: "nsc://", label: "nsc (nsc://)" },
] as const
type Storage = (typeof storages)[number]["value"]

const empty: NewContext = { name: "", description: "", urls: "", user: "" }

// Creates a Context. A Vault secret keeps it in Natter's own directory; a reference
// or no secret lets the user also write it to the nats CLI directory.
export function NewContextForm() {
  const qc = useQueryClient()
  const vault = useVault()
  const [form, setForm] = useState(empty)
  const [kind, setKind] = useState<SecretKind | "">("")
  const [secret, setSecret] = useState("")
  const [storage, setStorage] = useState<Storage>("vault")
  const [forCLI, setForCLI] = useState(false)
  const create = useMutation({
    mutationFn: () => {
      const secretField = storage === "vault" ? { secret } : { secretRef: secret }
      return api.createContext({ ...form, ...(kind && { secretKind: kind, ...secretField }), ...(cliOK && forCLI && { source: "cli" as const }) })
    },
    onSuccess: () => {
      setForm(empty)
      setKind("")
      setSecret("")
      setStorage("vault")
      setForCLI(false)
      qc.invalidateQueries({ queryKey: contextKeys.all })
    },
  })
  const field = (key: keyof typeof empty, label: string, props: ComponentProps<"input"> = {}) => (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="h-7 text-xs" {...props} />
    </label>
  )
  const inVault = kind !== "" && storage === "vault"
  const vaultLocked = inVault && vault.data?.state !== "unlocked"
  const multiline = inVault && (kind === "creds" || kind === "nkey")
  const cliOK = !inVault // natscli cannot read a Vault reference
  const options = storages.filter((o) => o.value !== "nsc://" || kind === "creds") // nsc gives a creds file
  return (
    <details className="mb-4 rounded-xl border bg-card p-4">
      <summary className="cursor-pointer text-sm font-semibold">New Context</summary>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        {field("name", "Name", { required: true, className: "h-7 font-mono text-xs" })}
        {field("urls", "Server URLs", { required: true, placeholder: "nats://127.0.0.1:4222", className: "h-7 font-mono text-xs" })}
        {field("description", "Description")}
        {field("user", "User", { autoComplete: "off" })}
        <label className="grid gap-1 text-xs text-muted-foreground">
          Secret
          <select value={kind} onChange={(e) => { setKind(e.target.value as SecretKind | ""); if (e.target.value !== "creds" && storage === "nsc://") setStorage("vault") }} className="h-7 rounded-lg border border-input bg-input/30 px-2 text-xs text-foreground">
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {kind !== "" && (
          <label className="grid gap-1 text-xs text-muted-foreground">
            Stored in
            <select value={storage} onChange={(e) => setStorage(e.target.value as Storage)} className="h-7 rounded-lg border border-input bg-input/30 px-2 text-xs text-foreground">
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind !== "" && (
          <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
            {storage === "vault" ? kinds.find((k) => k.value === kind)?.label : "Reference"}
            {!inVault ? (
              <Input required spellCheck={false} autoComplete="off" value={secret} placeholder={storage === "env://" ? "env://NATS_PASSWORD" : storage === "op://" ? "op://vault/item/field" : "nsc://operator/account/user"} onChange={(e) => setSecret(e.target.value)} className="h-7 font-mono text-xs" />
            ) : multiline ? (
              <textarea required rows={3} spellCheck={false} autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} className="rounded-lg border border-input bg-input/30 px-2.5 py-1 font-mono text-xs text-foreground" />
            ) : (
              <Input type="password" required autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} className="h-7 text-xs" />
            )}
          </label>
        )}
        {cliOK && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
            <input type="checkbox" checked={forCLI} onChange={(e) => setForCLI(e.target.checked)} />
            Also usable by the nats CLI: save it in ~/.config/nats/context instead of Natter's directory
          </label>
        )}
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" disabled={create.isPending || vaultLocked}>
            Create Context
          </Button>
          {vaultLocked && <span className="text-xs text-muted-foreground">{vault.data?.state === "none" ? "Create the Vault first to store a secret." : "Unlock the Vault first to store a secret."}</span>}
        </div>
      </form>
      {create.isError && <p role="alert" className="mt-2 text-xs text-destructive">{create.error.message}</p>}
    </details>
  )
}
