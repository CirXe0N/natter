// Example messages: saved sends on the current Context, in folders. Save the form as one, load one into the form, resend it, copy or import across Contexts.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/api"
import { BlockedButton } from "@/components/blocked-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useBlockedReason, useContexts } from "@/contexts"
import { conflicts } from "@/examples"
import type { ConflictChoice, Example, SendRequest } from "@/gen/api"

// The form fields an Example holds. Placeholders stay as typed.
export type Draft = Pick<Example, "mode" | "subject" | "headers" | "payload" | "timeoutMs">

const key = ["examples"] as const
const label = "text-xs font-medium text-muted-foreground"
const select = "h-8 rounded-md border bg-background px-2 text-xs"

export function ExamplesPanel({ context, draft, onLoad, onSend }: { context: string; draft: Draft; onLoad: (e: Example) => void; onSend: (r: SendRequest) => void }) {
  const qc = useQueryClient()
  const blocked = useBlockedReason()
  const contexts = useContexts()
  const all = useQuery({ queryKey: key, queryFn: ({ signal }) => api.examples(signal) }).data ?? []
  const mine = all.filter((e) => e.context === context)
  const folders = [...new Set(mine.map((e) => e.folder))].sort()
  const others = (contexts.data ?? []).map((c) => c.name).filter((n, i, l) => n !== context && l.indexOf(n) === i)

  const [name, setName] = useState("")
  const [folder, setFolder] = useState("")
  const [editing, setEditing] = useState<Example>()
  const [pending, setPending] = useState<{ ids: string[]; to: string }>() // a copy waiting for conflict choices
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({})

  const done = () => qc.invalidateQueries({ queryKey: key })
  const save = useMutation({ mutationFn: () => api.createExample({ ...draft, context, name: name.trim(), folder: folder.trim() }), onSuccess: () => (setName(""), done()) })
  const update = useMutation({ mutationFn: (e: Example) => api.updateExample(e), onSuccess: () => (setEditing(undefined), done()) })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteExample(id), onSuccess: done })
  const copy = useMutation({
    mutationFn: (c: { ids: string[]; to: string }) => api.copyExamples({ ids: c.ids, context: c.to, choices }),
    onSuccess: () => (setPending(undefined), setChoices({}), done()),
  })
  const startCopy = (ids: string[], to: string) => {
    if (conflicts(all, ids, to).length) setPending({ ids, to })
    else copy.mutate({ ids, to })
  }
  const clashes = pending ? conflicts(all, pending.ids, pending.to) : []
  const error = [save, update, remove, copy].find((m) => m.error)?.error?.message

  return (
    <section aria-label="Example messages" className="flex flex-col gap-3">
      <h2 className={label}>Example messages on {context || "no Context"}</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <label className="flex min-w-24 flex-1 flex-col gap-1">
          <span className={label}>Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex min-w-24 flex-1 flex-col gap-1">
          <span className={label}>Folder</span>
          <Input value={folder} onChange={(e) => setFolder(e.target.value)} list="example-folders" placeholder="(none)" />
          <datalist id="example-folders">{folders.filter(Boolean).map((f) => <option key={f} value={f} />)}</datalist>
        </label>
        <Button type="submit" variant="outline" size="sm" disabled={!name.trim() || !draft.subject.trim() || !context}>
          Save as Example
        </Button>
      </form>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      {folders.length === 0 && <p className="text-xs text-muted-foreground">No Example messages saved on this Context yet.</p>}
      {folders.map((f) => (
        <div key={f} role="group" aria-label={f || "No folder"}>
          <h3 className={`${label} mb-1`}>{f || "No folder"}</h3>
          <ul className="flex flex-col rounded-xl border bg-card text-xs">
            {mine.filter((e) => e.folder === f).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 border-b px-3 py-2 last:border-0">
                {editing?.id === e.id ? (
                  <>
                    <Input aria-label="Name" className="h-8 w-32" value={editing.name} onChange={(ev) => setEditing({ ...editing, name: ev.target.value })} />
                    <Input aria-label="Folder" className="h-8 w-32" value={editing.folder} onChange={(ev) => setEditing({ ...editing, folder: ev.target.value })} list="example-folders" />
                    <Button size="sm" onClick={() => update.mutate(editing)}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(undefined)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onLoad(e)} aria-label={`Load ${e.name}`}>
                      <span className="text-muted-foreground">{e.mode} </span>
                      {e.name}
                      <span className="ml-2 font-mono text-muted-foreground">{e.subject}</span>
                    </button>
                    <BlockedButton size="sm" variant="outline" reason={blocked} aria-label={`Resend ${e.name}`} onClick={() => onSend({ mode: e.mode, subject: e.subject, headers: e.headers, payload: e.payload, timeoutMs: e.timeoutMs ?? 0, count: 1 })}>
                      Resend
                    </BlockedButton>
                    <Button size="sm" variant="ghost" aria-label={`Rename or move ${e.name}`} onClick={() => setEditing(e)}>Edit</Button>
                    <select aria-label={`Copy ${e.name} to`} className={select} value="" disabled={!others.length} onChange={(ev) => ev.target.value && startCopy([e.id], ev.target.value)}>
                      <option value="">Copy to…</option>
                      {others.map((n) => <option key={n}>{n}</option>)}
                    </select>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${e.name}`} onClick={() => remove.mutate(e.id)}>Delete</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <label className="flex items-center gap-2 text-xs">
        <span className={label}>Import from</span>
        <select aria-label="Import from" className={select} value="" onChange={(ev) => {
          const ids = all.filter((e) => e.context === ev.target.value).map((e) => e.id)
          if (ids.length) startCopy(ids, context)
        }}>
          <option value="">Pick a Context…</option>
          {[...new Set(all.map((e) => e.context))].filter((n) => n !== context).map((n) => <option key={n}>{n}</option>)}
        </select>
      </label>

      {pending && (
        <div role="group" aria-label="Name conflicts" className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-xs">
          <p>These names already exist on {pending.to}. Choose what happens to each.</p>
          {clashes.map((e) => (
            <label key={e.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{e.folder ? `${e.folder}/` : ""}{e.name}</span>
              <select aria-label={`Conflict: ${e.name}`} className={select} value={choices[e.id] ?? ""} onChange={(ev) => setChoices({ ...choices, [e.id]: ev.target.value as ConflictChoice })}>
                <option value="">Choose…</option>
                <option value="keep">Keep both</option>
                <option value="replace">Replace</option>
                <option value="skip">Skip</option>
              </select>
            </label>
          ))}
          <div className="flex gap-2">
            <Button size="sm" disabled={clashes.some((e) => !choices[e.id])} onClick={() => copy.mutate(pending)}>Copy</Button>
            <Button size="sm" variant="ghost" onClick={() => (setPending(undefined), setChoices({}))}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  )
}
