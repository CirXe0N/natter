// The Vault: Natter's encrypted store for the secrets of Contexts created in Natter.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Lock, LockOpen, TriangleAlert } from "lucide-react"

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
  const [changing, setChanging] = useState(false)
  const [withPassphrase, setWithPassphrase] = useState(false)
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

  // Only the keyring holds the key of a Vault Natter created on first use, until the user adds a passphrase.
  const keyringOnly = state === "unlocked" && !vault.data.hasPassphrase && vault.data.keyring === "on"
  if (state === "unlocked")
    return (
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge tone="success">
            <LockOpen size={11} aria-hidden />
            Vault unlocked
          </Badge>
          Secrets of Contexts created in Natter are encrypted in ~/.config/natter/vault.age.
          {vault.data.keyring !== "unavailable" && <KeyringToggle on={vault.data.keyring === "on"} />}
          {!keyringOnly && (
            <Button size="sm" variant="outline" aria-expanded={changing} onClick={() => setChanging(!changing)}>
              {vault.data.hasPassphrase ? "Change passphrase" : "Add a passphrase"}
            </Button>
          )}
        </div>
        {keyringOnly && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-warning">
            <TriangleAlert size={14} aria-hidden className="shrink-0" />
            <span className="min-w-0 flex-1">The Vault key is only in your OS keyring. If the keyring loses it, the secrets in the Vault cannot be recovered.</span>
            <Button size="sm" variant="outline" aria-expanded={changing} onClick={() => setChanging(!changing)}>
              Add a backup passphrase
            </Button>
          </div>
        )}
        {changing && <PassphraseForm hasPassphrase={vault.data.hasPassphrase} onDone={() => setChanging(false)} />}
      </div>
    )

  // With a keyring, the first secret stored creates the Vault (see ensureVault in the backend).
  if (state === "none" && vault.data.keyring !== "unavailable" && !withPassphrase)
    return (
      <section aria-label="Vault" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
        <KeyRound size={14} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1">No Vault yet. Natter creates one the first time you store a secret in it, and keeps its key in your OS keyring.</span>
        <Button size="sm" variant="outline" onClick={() => setWithPassphrase(true)}>
          Create it now with a passphrase
        </Button>
      </section>
    )

  if (state === "locked" && !vault.data.hasPassphrase)
    return (
      <section aria-label="Vault" className="mb-4 rounded-xl border border-warning/25 bg-warning/5 p-4 text-xs text-warning">
        The Vault is locked and has no passphrase. Its key is in the OS keyring, which did not answer when natter started or no longer holds it, or in a key file: restart natter with <code className="font-mono">-vault-key &lt;key file&gt;</code>.
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
          ? `The Vault keeps the secrets of Contexts you create in Natter, encrypted in ~/.config/natter/. Choose a passphrase to unlock it after a restart, or start natter with -vault-key <key file> instead.${vault.data.keyring === "unavailable" ? "" : " The OS keyring also gets the Vault key, so the Vault unlocks at startup."}`
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

// Moves only the Vault key into or out of the OS keyring; the secrets stay in vault.age.
function KeyringToggle({ on }: { on: boolean }) {
  const qc = useQueryClient()
  const set = useMutation({ mutationFn: () => api.setKeyring(!on), onSuccess: (v) => qc.setQueryData(vaultKey, v) })
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        aria-pressed={on}
        disabled={set.isPending}
        title={
          on
            ? "The OS keyring holds the Vault key, so the Vault unlocks at startup. Turned off, the Vault waits for the passphrase or -vault-key."
            : "Keep the Vault key in the OS keyring, so the Vault unlocks at startup. The passphrase still works."
        }
        onClick={() => set.mutate()}
      >
        <KeyRound size={12} aria-hidden />
        OS keyring: {on ? "on" : "off"}
      </Button>
      {set.isError && <span role="alert" className="text-destructive">{set.error.message}</span>}
    </>
  )
}

// Sets the passphrase that unlocks the Vault after a restart. Only the wrapped
// key in vault.key.age changes, never the secrets in vault.age.
function PassphraseForm({ hasPassphrase, onDone }: { hasPassphrase: boolean; onDone: () => void }) {
  const qc = useQueryClient()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const save = useMutation({
    mutationFn: () => api.setPassphrase({ ...(hasPassphrase && { current }), new: next }),
    onSuccess: (v) => {
      qc.setQueryData(vaultKey, v)
      onDone()
    },
  })
  const mismatch = confirm !== next
  return (
    <form
      aria-label="Vault passphrase"
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!mismatch) save.mutate()
      }}
    >
      {hasPassphrase && (
        <label className="grid gap-1 text-xs text-muted-foreground">
          Current passphrase
          <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className="h-7 w-56 text-xs" />
        </label>
      )}
      <label className="grid gap-1 text-xs text-muted-foreground">
        New passphrase
        <Input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} className="h-7 w-56 text-xs" />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Repeat new passphrase
        <Input type="password" autoComplete="new-password" required aria-invalid={mismatch && confirm !== "" ? true : undefined} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-7 w-56 text-xs" />
      </label>
      <Button type="submit" size="sm" disabled={save.isPending || mismatch}>
        {save.isPending ? "Saving…" : "Save passphrase"}
      </Button>
      {mismatch && confirm !== "" && <p className="basis-full text-xs text-muted-foreground">The passphrases do not match.</p>}
      {save.isError && <p role="alert" className="basis-full text-xs text-destructive">{save.error.message}</p>}
    </form>
  )
}
