// The drawer that opens a message from the Messages tab: its headers, its
// payload, Prev and Next, Copy as CLI, and Delete.
import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronUp } from "lucide-react"

import { api } from "@/api"
import { BlockedButton } from "@/components/blocked-button"
import { CopyCli } from "@/components/copy-cli"
import { PayloadViewer } from "@/components/payload-viewer"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useBlockedReason } from "@/contexts"
import { bytes } from "@/screens/overview"

type Props = { stream: string; seq?: number; prev?: () => void; next?: () => void; onClose: () => void; onDeleted: (seq: number) => void }

export function MessageDrawer({ seq, onClose, ...props }: Props) {
  return (
    <Dialog open={seq !== undefined} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-0 right-0 left-auto flex h-dvh max-w-full translate-x-0 translate-y-0 flex-col rounded-none sm:max-w-3xl">
        {seq !== undefined && <Message key={seq} seq={seq} {...props} />}
      </DialogContent>
    </Dialog>
  )
}

function Message({ stream, seq, prev, next, onDeleted }: Omit<Props, "onClose"> & { seq: number }) {
  const q = useQuery({ queryKey: ["streams", "message", stream, seq], queryFn: ({ signal }) => api.message(stream, seq, signal), gcTime: 0, retry: false })
  const m = q.data
  const blocked = useBlockedReason()
  const [confirm, setConfirm] = useState(false)
  const headers = m ? Object.entries(m.headers).flatMap(([k, vs]) => vs.map((v) => [k, v])) : []
  return (
    <>
      <DialogHeader className="pr-8">
        <div className="flex items-center gap-2">
          <DialogTitle className="font-mono">Message #{seq}</DialogTitle>
          <Button variant="outline" size="icon-sm" aria-label="Previous message" disabled={!prev} onClick={prev}>
            <ChevronUp />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next message" disabled={!next} onClick={next}>
            <ChevronDown />
          </Button>
        </div>
        <DialogDescription className="font-mono text-xs">
          {m ? `${m.subject} · ${new Date(m.time).toISOString().replace("T", " ").slice(0, 23)} UTC · ${bytes(m.size)}` : q.isFetching ? "Loading…" : ""}
        </DialogDescription>
      </DialogHeader>
      {q.error && <p className="text-xs text-destructive">{q.error.message}</p>}
      {m && (
        <>
          <section aria-label="Headers" className="max-h-40 shrink-0 overflow-y-auto text-xs">
            {headers.length ? (
              <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-0.5 font-mono">
                {headers.map(([k, v], i) => (
                  <div key={i} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-all">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted-foreground">No headers.</p>
            )}
          </section>
          <PayloadViewer url={api.payloadUrl(stream, seq)} size={m.size} />
        </>
      )}
      <DialogFooter className="items-center sm:justify-between">
        <CopyCli cmd={`nats stream get ${stream} ${seq}`} />
        <span className="flex items-center gap-2">
          <BlockedButton variant="destructive" reason={blocked} disabled={!m} onClick={() => setConfirm(true)}>
            Delete…
          </BlockedButton>
        </span>
      </DialogFooter>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DeleteMessage stream={stream} seq={seq} onDeleted={() => onDeleted(seq)} />
        </DialogContent>
      </Dialog>
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
      {erase && <CopyCli cmd={`nats stream rmm ${stream} ${seq} --force`} />}
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
