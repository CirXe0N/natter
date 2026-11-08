// Example messages on the Publish / Request screen: the picker that loads one,
// and the dialog that copies them to other Contexts or imports them from one.
// Examples are stored by Natter, not on the NATS server, so Read-only mode does not apply.
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Popover } from "@base-ui/react/popover"
import { ArrowLeftRight, BookOpen, Check, ChevronDown, ChevronRight, Import, Plus, Search } from "lucide-react"

import { api } from "@/api"
import { Badge } from "@/components/badge"
import { FilterField } from "@/components/filter-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useContexts } from "@/contexts"
import { conflicts } from "@/examples"
import type { ConflictChoice, Example, SendMode } from "@/gen/api"

export const examplesKey = ["examples"] as const

export function ModeTag({ mode, small }: { mode: SendMode; small?: boolean }) {
  return (
    <span className={`shrink-0 rounded text-center font-bold ${small ? "px-1 text-[9px]" : "w-8 px-1 py-0.5 text-[9px]"} ${mode === "pub" ? "bg-success/10 text-success" : "bg-info/10 text-info"}`}>
      {mode === "pub" ? "PUB" : "REQ"}
    </span>
  )
}

const folderName = (f: string) => f || "No folder"

export function ExamplesPicker({ context, examples, selected, onPick, onNew, onImport }: { context: string; examples: Example[]; selected?: string; onPick: (e: Example) => void; onNew: () => void; onImport: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const folders = new Map<string, Example[]>()
  for (const e of examples.filter((e) => `${e.name} ${e.subject} ${e.folder}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name)))
    folders.set(e.folder, [...(folders.get(e.folder) ?? []), e])
  const close = (then: () => void) => () => {
    setOpen(false)
    then()
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger render={<Button variant="outline" size="sm" />}>
        <BookOpen aria-hidden />
        Examples
        <span className="text-fg-faint">{examples.length}</span>
        <ChevronDown aria-hidden className="text-fg-faint" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-50">
          <Popover.Popup aria-label="Example messages" className="flex max-h-115 w-110 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <FilterField autoFocus label="Search examples" icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search examples by name, subject or folder" className="flex-1" />
            </div>
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {[...folders].map(([folder, items]) => (
                <div key={folder} role="group" aria-label={folderName(folder)}>
                  <button
                    type="button"
                    aria-expanded={!closed[folder]}
                    onClick={() => setClosed((c) => ({ ...c, [folder]: !c[folder] }))}
                    className="flex w-full items-center gap-1 px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-fg-faint uppercase hover:text-muted-foreground"
                  >
                    {closed[folder] ? <ChevronRight size={11} aria-hidden /> : <ChevronDown size={11} aria-hidden />}
                    {folderName(folder)}
                    <span className="ml-auto font-normal">{items.length}</span>
                  </button>
                  {!closed[folder] &&
                    items.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        aria-label={`Load ${e.name}`}
                        aria-current={selected === e.id || undefined}
                        onClick={close(() => onPick(e))}
                        className="mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent aria-[current]:bg-accent"
                      >
                        <ModeTag mode={e.mode} />
                        <span className="min-w-0 flex-1 truncate text-xs">{e.name}</span>
                        <span className="max-w-40 truncate font-mono text-[11px] text-fg-faint">{e.subject}</span>
                      </button>
                    ))}
                </div>
              ))}
              {folders.size === 0 && (
                <p className="px-4 py-6 text-center text-xs text-fg-faint">
                  {q ? "No matches" : <>No examples in <span className="font-mono">{context}</span> yet</>}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-fg-faint">
              <span className="min-w-0 flex-1 truncate">
                in <span className="font-mono text-muted-foreground">{context}</span>
              </span>
              <button type="button" onClick={close(onImport)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <Import size={11} aria-hidden />
                Import from Context…
              </button>
              <button type="button" onClick={close(onNew)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <Plus size={11} aria-hidden />
                New
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

const choiceLabels: [ConflictChoice, string][] = [
  ["keep", "Keep both"],
  ["replace", "Replace"],
  ["skip", "Skip"],
]

// Copy examples from the active Context to others, or import them from another Context into the active one.
export function TransferDialog({ mode, context, all, preselected, onClose }: { mode: "copy" | "import"; context: string; all: Example[]; preselected: string[]; onClose: () => void }) {
  const qc = useQueryClient()
  const contexts = useContexts()
  const others = [...new Set([...(contexts.data ?? []).map((c) => c.name), ...all.map((e) => e.context)])].filter((n) => n !== context)
  const countIn = (ctx: string) => all.filter((e) => e.context === ctx).length
  const [source, setSource] = useState(mode === "copy" ? context : (others.find((c) => countIn(c) > 0) ?? others[0] ?? ""))
  const [targets, setTargets] = useState<string[]>(mode === "import" ? [context] : [])
  const [sel, setSel] = useState<string[]>(preselected)
  const [choice, setChoice] = useState<ConflictChoice>("keep")
  const list = all.filter((e) => e.context === source)
  const picked = sel.filter((id) => list.some((e) => e.id === id))
  const clashes = targets.flatMap((t) => conflicts(all, picked, t).map((e) => ({ e, t })))
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  const run = useMutation({
    mutationFn: async () => {
      for (const t of targets) await api.copyExamples({ ids: picked, context: t, choices: Object.fromEntries(conflicts(all, picked, t).map((e) => [e.id, choice])) })
    },
    onSuccess: onClose,
    onSettled: () => qc.invalidateQueries({ queryKey: examplesKey }),
  })

  const heading = "mb-1.5 text-[11px] font-medium tracking-wide text-fg-faint uppercase"
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-140">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "copy" ? <ArrowLeftRight size={15} aria-hidden className="text-primary" /> : <Import size={15} aria-hidden className="text-primary" />}
            {mode === "copy" ? "Copy examples from" : "Import examples into"} <span className="font-mono">{context}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-auto">
          <div role="group" aria-label={mode === "copy" ? "To Context" : "From Context"}>
            <div className={heading}>{mode === "copy" ? "To Context" : "From Context"}</div>
            <div className="flex flex-wrap gap-1.5">
              {others.length === 0 && <p className="text-xs text-fg-faint">There is no other Context.</p>}
              {others.map((c) => {
                const on = mode === "copy" ? targets.includes(c) : source === c
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() => (mode === "copy" ? setTargets(toggle(targets, c)) : (setSource(c), setSel([])))}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs ${on ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {mode === "copy" && (
                      <span aria-hidden className={`grid size-3.5 place-items-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-fg-faint"}`}>
                        {on && <Check size={10} />}
                      </span>
                    )}
                    {c}
                    <span className="font-sans text-[10px] text-fg-faint">{countIn(c)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className={`${heading} flex items-center justify-between`}>
              <span>
                Examples in <span className="font-mono normal-case">{source || "…"}</span>
              </span>
              {list.length > 0 && (
                <button type="button" onClick={() => setSel(picked.length === list.length ? [] : list.map((e) => e.id))} className="tracking-normal text-muted-foreground normal-case hover:text-foreground">
                  {picked.length === list.length ? "Select none" : "Select all"}
                </button>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border">
              {list.length === 0 && <p className="px-3 py-5 text-center text-xs text-fg-faint">No examples in {source || "that Context"}</p>}
              {list.map((e) => {
                const hits = targets.filter((t) => conflicts(all, [e.id], t).length)
                return (
                  <label key={e.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-xs last:border-0 hover:bg-accent/40">
                    <input type="checkbox" checked={sel.includes(e.id)} onChange={() => setSel(toggle(sel, e.id))} className="accent-primary" />
                    <ModeTag mode={e.mode} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-fg-faint">{folderName(e.folder)} / </span>
                      {e.name}
                    </span>
                    {hits.length > 0 && <Badge tone="warning">exists in {hits.join(", ")}</Badge>}
                    <span className="max-w-40 truncate font-mono text-[11px] text-fg-faint">{e.subject}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {clashes.length > 0 && (
            <div role="group" aria-label="Name conflicts" className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-xs">
              <p className="text-warning">
                {clashes.length} {clashes.length === 1 ? "example already exists" : "examples already exist"} with the same folder and name
              </p>
              <div className="mt-2 flex gap-1.5">
                {choiceLabels.map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={choice === k} onClick={() => setChoice(k)} className={`rounded-md border px-2.5 py-1 ${choice === k ? "border-warning/50 bg-warning/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    {l}
                  </button>
                ))}
              </div>
              {choice === "keep" && <p className="mt-1.5 text-muted-foreground">The copy is named "… (copy)".</p>}
            </div>
          )}
          {run.isError && (
            <p role="alert" className="text-xs text-destructive">
              {run.error.message}
            </p>
          )}
        </div>

        <DialogFooter className="items-center">
          <span className="flex-1 text-[11px] text-fg-faint">Examples are stored by Natter, not on the NATS server, so Read-only mode doesn't apply.</span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!picked.length || !targets.length || run.isPending} onClick={() => run.mutate()}>
            {mode === "copy" ? `Copy ${picked.length || ""} to ${targets.length > 1 ? `${targets.length} Contexts` : (targets[0] ?? "…")}` : `Import ${picked.length || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
