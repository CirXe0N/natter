// The Vault: Natter's encrypted store for the secrets of Contexts created in Natter.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Lock, LockOpen } from "lucide-react"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export const vaultKey = ["vault"] as const

export function useVault() {
  return useQuery({ queryKey: vaultKey, queryFn: ({ signal }) => api.vault(signal) })
}

// Create or unlock the Vault. Unlocking reconnects a Context that was waiting
// for it, so every query refetches.
export function VaultPanel() {
  const qc = useQueryClient()
  const vault = useVault()
  const [passphrase, setPassphrase] = useState("")
  const [confirm, setConfirm] = useState("")
  const state = vault.data?.state
  const submit = useMutation({
    mutationFn: () => (state === "none" ? api.createVault(passphrase) : api.unlockVault(passphrase)),
    onSuccess: (v) => {
      setPassphrase("")
      setConfirm("")
      qc.setQueryData(vaultKey, v)
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== vaultKey[0] })
    },
  })
  if (vault.isError) return <p className="mb-4 text-xs text-destructive">{vault.error.message}</p>
  if (!vault.data) return null

  if (state === "unlocked")
    return (
      <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Badge tone="success">
          <LockOpen size={11} aria-hidden />
          Vault unlocked
        </Badge>
        Secrets of Contexts created in Natter are encrypted in ~/.config/natter/vault.age.
      </p>
    )

  if (state === "locked" && !vault.data.hasPassphrase)
    return (
      <section aria-label="Vault" className="mb-4 rounded-xl border border-warning/25 bg-warning/5 p-4 text-xs text-warning">
        The Vault is locked and has no passphrase. Restart natter with <code className="font-mono">-vault-key &lt;key file&gt;</code> to unlock it.
      </section>
    )

  const creating = state === "none"
  const mismatch = creating && confirm !== passphrase
  return (
    <section aria-label="Vault" className="mb-4 rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Lock size={14} aria-hidden className="text-muted-foreground" />
        {creating ? "Create the Vault" : "The Vault is locked"}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {creating
          ? "The Vault keeps the secrets of Contexts you create in Natter, encrypted in ~/.config/natter/. Choose a passphrase to unlock it after a restart, or start natter with -vault-key <key file> instead."
          : "Enter the passphrase to unlock it. Contexts whose secret is in the Vault cannot connect until then."}
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!mismatch) submit.mutate()
        }}
      >
        <label className="grid gap-1 text-xs text-muted-foreground">
          Passphrase
          <Input type="password" autoComplete={creating ? "new-password" : "current-password"} required value={passphrase} onChange={(e) => setPassphrase(e.target.value)} className="h-7 w-56 text-xs" />
        </label>
        {creating && (
          <label className="grid gap-1 text-xs text-muted-foreground">
            Repeat passphrase
            <Input type="password" autoComplete="new-password" required aria-invalid={mismatch && confirm !== "" ? true : undefined} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-7 w-56 text-xs" />
          </label>
        )}
        <Button type="submit" size="sm" disabled={submit.isPending || mismatch}>
          {submit.isPending ? (creating ? "Creating…" : "Unlocking…") : creating ? "Create Vault" : "Unlock"}
        </Button>
      </form>
      {mismatch && confirm !== "" && <p className="mt-1.5 text-xs text-muted-foreground">The passphrases do not match.</p>}
      {submit.isError && <p role="alert" className="mt-1.5 text-xs text-destructive">{submit.error.message}</p>}
    </section>
  )
}
