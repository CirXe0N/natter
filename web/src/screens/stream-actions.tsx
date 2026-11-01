// The stream header's Edit, Purge and Delete buttons, and the New stream
// button on the list. Purge and delete ask for the stream name before they run.
import { useId, useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { api } from "@/api"
import { BlockedButton } from "@/components/blocked-button"
import { CopyCli } from "@/components/copy-cli"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useBlockedReason } from "@/contexts"
import { purgeCli } from "@/stream-config"

export function NewStreamButton() {
  const navigate = useNavigate()
  const blocked = useBlockedReason()
  return (
    <BlockedButton reason={blocked} onClick={() => void navigate({ to: "/streams/new" })}>
      New stream
    </BlockedButton>
  )
}

export function StreamActions({ name }: { name: string }) {
  const navigate = useNavigate()
  const blocked = useBlockedReason()
  const reason = useId()
  const [open, setOpen] = useState<"purge" | "delete">()
  const block = { disabled: !!blocked, focusableWhenDisabled: true, "aria-describedby": blocked ? reason : undefined } as const
  return (
    <>
      <Button variant="outline" {...block} onClick={() => void navigate({ to: "/streams/$stream/edit", params: { stream: name } })}>
        Edit
      </Button>
      <Button variant="outline" {...block} onClick={() => setOpen("purge")}>
        Purge…
      </Button>
      <Button variant="destructive" {...block} onClick={() => setOpen("delete")}>
        Delete…
      </Button>
      {blocked && (
        <span id={reason} className="text-xs text-muted-foreground">
          {blocked}
        </span>
      )}
      <Dialog open={open === "purge"} onOpenChange={(o) => !o && setOpen(undefined)}>
        <DialogContent className="sm:max-w-md">
          <PurgeForm name={name} done={() => setOpen(undefined)} />
        </DialogContent>
      </Dialog>
      <Dialog open={open === "delete"} onOpenChange={(o) => !o && setOpen(undefined)}>
        <DialogContent className="sm:max-w-md">
          <DeleteForm name={name} />
        </DialogContent>
      </Dialog>
    </>
  )
}

// Confirm disables its action until the stream name is typed in full.
function Confirm({ name, verb, danger, onConfirm, pending, error, children }: { name: string; verb: string; danger: string; onConfirm: () => void; pending: boolean; error?: string; children?: ReactNode }) {
  const [typed, setTyped] = useState("")
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (typed === name) onConfirm()
      }}
    >
      {children}
      <p className="text-xs text-muted-foreground">{danger}</p>
      <label className="grid gap-1.5 text-xs">
        <span>
          Type <span className="font-mono font-medium">{name}</span> to confirm
        </span>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} className="font-mono" autoComplete="off" />
      </label>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" variant="destructive" disabled={typed !== name || pending}>
          {verb}
        </Button>
      </DialogFooter>
    </form>
  )
}

type Mode = "all" | "subject" | "keep" | "seq"

function PurgeForm({ name, done }: { name: string; done: () => void }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<Mode>("all")
  const [value, setValue] = useState("")
  const n = Number(value)
  const p = mode === "subject" ? { subject: value.trim() } : mode === "keep" ? { keep: n } : mode === "seq" ? { sequence: n } : {}
  const bad = (mode === "subject" && !value.trim()) || ((mode === "keep" || mode === "seq") && !(Number.isInteger(n) && n > 0))
  const purge = useMutation({
    mutationFn: () => api.purgeStream(name, { ...p, confirm: name }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["streams"] })
      setResult(r.purged)
    },
  })
  const [result, setResult] = useState<number>()
  if (result !== undefined)
    return (
      <>
        <DialogTitle>Purged</DialogTitle>
        <p role="status">
          {result.toLocaleString()} messages removed from <span className="font-mono">{name}</span>.
        </p>
        <DialogFooter>
          <Button onClick={done}>Close</Button>
        </DialogFooter>
      </>
    )
  return (
    <>
      <DialogHeader>
        <DialogTitle>Purge {name}</DialogTitle>
        <DialogDescription>Removes messages from the stream. The stream and its consumers stay.</DialogDescription>
      </DialogHeader>
      <Confirm
        name={name}
        verb="Purge"
        danger="Purged messages cannot be recovered."
        pending={purge.isPending}
        error={purge.error?.message}
        onConfirm={() => !bad && purge.mutate()}
      >
        <fieldset className="grid gap-2 text-xs">
          <legend className="mb-1">What to purge</legend>
          {(
            [
              ["all", "Every message"],
              ["subject", "Messages on a subject"],
              ["keep", "Everything except the newest N"],
              ["seq", "Everything before a sequence"],
            ] as const
          ).map(([m, label]) => (
            <label key={m} className="flex items-center gap-2">
              <input type="radio" name="purge-mode" checked={mode === m} onChange={() => { setMode(m); setValue("") }} />
              {label}
            </label>
          ))}
          {mode !== "all" && (
            <Input
              aria-label={mode === "subject" ? "Subject" : mode === "keep" ? "Messages to keep" : "Sequence"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={mode === "subject" ? "orders.eu.*" : mode === "keep" ? "100" : "1000"}
              className="font-mono"
            />
          )}
        </fieldset>
        <CopyCli cmd={purgeCli(name, p)} />
      </Confirm>
    </>
  )
}

function DeleteForm({ name }: { name: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const del = useMutation({
    mutationFn: () => api.deleteStream(name),
    onSuccess: async () => {
      // Leave first: refetching this stream's own queries would retry 404s before navigating.
      await navigate({ to: "/streams" })
      qc.removeQueries({ queryKey: ["streams", "detail", name] })
      await qc.invalidateQueries({ queryKey: ["streams"] })
    },
  })
  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete {name}</DialogTitle>
        <DialogDescription>Deletes the stream, its messages and its consumers.</DialogDescription>
      </DialogHeader>
      <Confirm name={name} verb="Delete stream" danger="This cannot be undone." pending={del.isPending} error={del.error?.message} onConfirm={() => del.mutate()}>
        <CopyCli cmd={`nats stream rm ${name} --force`} />
      </Confirm>
    </>
  )
}
