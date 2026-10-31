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

const empty: NewContext = { name: "", description: "", urls: "", user: "" }

// Creates a Context in Natter's own directory. Its secret goes into the Vault.
export function NewContextForm() {
  const qc = useQueryClient()
  const vault = useVault()
  const [form, setForm] = useState(empty)
  const [kind, setKind] = useState<SecretKind | "">("")
  const [secret, setSecret] = useState("")
  const create = useMutation({
    mutationFn: () => api.createContext({ ...form, ...(kind && { secretKind: kind, secret }) }),
    onSuccess: () => {
      setForm(empty)
      setKind("")
      setSecret("")
      qc.invalidateQueries({ queryKey: contextKeys.all })
    },
  })
  const field = (key: keyof typeof empty, label: string, props: ComponentProps<"input"> = {}) => (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="h-7 text-xs" {...props} />
    </label>
  )
  const vaultLocked = kind !== "" && vault.data?.state !== "unlocked"
  const multiline = kind === "creds" || kind === "nkey"
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
          Secret, stored in the Vault
          <select value={kind} onChange={(e) => setKind(e.target.value as SecretKind | "")} className="h-7 rounded-lg border border-input bg-input/30 px-2 text-xs text-foreground">
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {kind !== "" && (
          <label className="grid gap-1 text-xs text-muted-foreground">
            {kinds.find((k) => k.value === kind)?.label}
            {multiline ? (
              <textarea required rows={3} spellCheck={false} autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} className="rounded-lg border border-input bg-input/30 px-2.5 py-1 font-mono text-xs text-foreground" />
            ) : (
              <Input type="password" required autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} className="h-7 text-xs" />
            )}
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
