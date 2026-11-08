// The drawer that opens a message from the message browser: its subject and
// headers, its payload, newer and older with the arrow keys, Save
// as example, and Delete.
import { useLayoutEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronUp, Save, Trash2, X } from "lucide-react"

import { api } from "@/api"
import { BlockedButton } from "@/components/blocked-button"
import { examplesKey } from "@/components/examples-picker"
import { PayloadViewer } from "@/components/payload-viewer"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useActiveContext, useBlockedReason } from "@/contexts"
import type { Msg } from "@/gen/api"
import { bytes } from "@/screens/overview"

type Props = { stream: string; seq?: number; prev?: () => void; next?: () => void; onClose: () => void; onDeleted: (seq: number) => void }

// An example is sent as JSON in one request, which the server caps at 1 MiB.
const MAX_EXAMPLE = 512 << 10

export function MessageDrawer({ seq, onClose, ...props }: Props) {
  return (
    <Dialog open={seq !== undefined} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className="top-0 right-0 left-auto flex h-dvh max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-160">
        {seq !== undefined && <Message key={seq} seq={seq} onClose={onClose} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

const kbd = "rounded border bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"

function Message({ stream, seq, prev, next, onClose, onDeleted }: Props & { seq: number }) {
  const q = useQuery({ queryKey: ["streams", "message", stream, seq], queryFn: ({ signal }) => api.message(stream, seq, signal), gcTime: 0, retry: false })
  const m = q.data
  const blocked = useBlockedReason()
  const [confirm, setConfirm] = useState(false)
  const headers = m ? Object.entries(m.headers).flatMap(([k, vs]) => vs.map((v) => [k, v] as [string, string])) : []

  // ↑ / k and ↓ / j step through the list; Esc closes through the Dialog.
  // Capture phase: the dialog stops arrow keys on its buttons from bubbling.
  // A layout effect, so a key pressed as soon as the drawer paints is not lost.
  useLayoutEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (confirm || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
      const go = e.key === "ArrowUp" || e.key === "k" ? prev : e.key === "ArrowDown" || e.key === "j" ? next : undefined
      if (!go) return
      e.preventDefault()
      go()
    }
    addEventListener("keydown", key, true)
    return () => removeEventListener("keydown", key, true)
  }, [prev, next, confirm])

  const time = m && new Date(m.time).toISOString().replace("T", " ").slice(0, 23)
  return (
    <>
      <DialogHeader className="flex-row items-start gap-2 border-b px-5 py-3">
        <div className="min-w-0 flex-1">
          <DialogTitle className="sr-only">Message #{seq}</DialogTitle>
          <p aria-hidden className="truncate font-mono text-sm text-primary">
            {m ? m.subject : q.isFetching ? "Loading…" : `#${seq}`}
          </p>
          <DialogDescription className="mt-0.5 text-xs tabular-nums">
            {stream} · seq {seq.toLocaleString()}
            {m && ` · ${time} UTC · ${bytes(m.size)}`}
          </DialogDescription>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Previous message" title="Previous (↑ / k)" disabled={!prev} onClick={prev}>
          <ChevronUp />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next message" title="Next (↓ / j)" disabled={!next} onClick={next}>
          <ChevronDown />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <X />
        </Button>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5">
        <span className="flex-1" />
        {m && <SaveAsExample stream={stream} m={m} headers={headers} />}
        <BlockedButton variant="outline" size="sm" reason={blocked} disabled={!m} onClick={() => setConfirm(true)} className="border-destructive/30 text-destructive hover:bg-destructive/10">
          <Trash2 aria-hidden />
          Delete…
        </BlockedButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 px-5 py-4">
        {q.error && <p className="text-xs text-destructive">{q.error.message}</p>}
        {m && (
          <>
            <section aria-label="Headers" className="max-h-44 shrink-0 overflow-y-auto text-xs">
              <p className="mb-1.5 text-[11px] font-medium tracking-wide text-fg-faint uppercase">Headers</p>
              {headers.length ? (
                <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] font-mono">
                  {headers.map(([k, v], i) => (
                    <div key={i} className="contents">
                      <dt className="border-b border-border/60 py-1 pr-3 text-muted-foreground">{k}</dt>
                      <dd className="border-b border-border/60 py-1 break-all">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-fg-faint">No headers</p>
              )}
            </section>
            <section aria-label="Payload" className="flex min-h-0 flex-col">
              <p className="mb-1.5 flex items-center justify-between text-[11px] font-medium tracking-wide text-fg-faint uppercase">
                Payload <span className="tracking-normal normal-case">{bytes(m.size)}</span>
              </p>
              <PayloadViewer url={api.payloadUrl(stream, seq)} />
            </section>
          </>
        )}
      </div>
      <div aria-hidden className="flex items-center gap-2 border-t px-5 py-2 text-[11px] text-fg-faint">
        <kbd className={kbd}>↑</kbd>
        <kbd className={kbd}>↓</kbd> previous / next
        <kbd className={`${kbd} ml-2`}>esc</kbd> close
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DeleteMessage stream={stream} seq={seq} onDeleted={() => onDeleted(seq)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

// SaveAsExample stores the message as a Publish example of the active Context,
// in the folder "from messages". Only a text payload small enough to send can be one.
function SaveAsExample({ stream, m, headers }: { stream: string; m: Msg; headers: [string, string][] }) {
  const qc = useQueryClient()
  const context = useActiveContext().data?.context?.name ?? ""
  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.payloadUrl(stream, m.seq))
      if (!res.ok) throw new Error((await res.text()) || res.statusText)
      let payload: string
      try {
        payload = new TextDecoder("utf-8", { fatal: true }).decode(await res.arrayBuffer())
      } catch {
        throw new Error("This payload is not text, so it cannot be an example.")
      }
      return api.createExample({ context, folder: "from messages", name: `${m.subject} #${m.seq}`, mode: "pub", subject: m.subject, headers, payload })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: examplesKey }),
  })
  const tooBig = m.size > MAX_EXAMPLE
  return (
    <>
      {save.isSuccess && (
        <span role="status" className="text-xs text-success">
          Saved to Publish examples
        </span>
      )}
      {save.isError && (
        <span role="alert" className="text-xs text-destructive">
          {save.error.message}
        </span>
      )}
      <Button variant="outline" size="sm" disabled={tooBig || save.isPending || save.isSuccess} title={tooBig ? `Examples hold up to ${bytes(MAX_EXAMPLE)}` : "Save as a Publish / Request example in the folder “from messages”"} onClick={() => save.mutate()}>
        <Save aria-hidden />
        Save as example
      </Button>
    </>
  )
}

function DeleteMessage({ stream, seq, onDeleted }: { stream: string; seq: number; onDeleted: () => void }) {
  const [erase, setErase] = useState(false)
  const del = useMutation({ mutationFn: () => api.deleteMessage(stream, seq, erase), onSuccess: onDeleted })
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        del.mutate()
      }}
    >
      <DialogHeader>
        <DialogTitle>Delete message #{seq}</DialogTitle>
        <DialogDescription>Removes the message from {stream}. This cannot be undone.</DialogDescription>
      </DialogHeader>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} className="mt-0.5" />
        <span>
          Erase: also overwrite the message's data on disk. Slower, for data that must not be recoverable.
        </span>
      </label>
      {del.error && (
        <p role="alert" className="text-xs text-destructive">
          {del.error.message}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" variant="destructive" disabled={del.isPending}>
          Delete message
        </Button>
      </DialogFooter>
    </form>
  )
}
