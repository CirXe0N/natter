// Live updates: one WebSocket per tab to /ws, multiplexed by topic, plus the
// global pause control and the one status region that announces changes.
import { useSyncExternalStore } from "react"
import { Pause, Play } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ClientFrame, ServerFrame, Topic } from "@/gen/api"

type Listener = (f: ServerFrame) => void

const listeners = new Map<Topic, Set<Listener>>()
let socket: WebSocket | null = null
let paused = false
const pauseWatchers = new Set<() => void>()

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`)
  ws.onopen = () => {
    if (!paused) for (const topic of listeners.keys()) send({ op: "sub", topic })
  }
  ws.onmessage = (e) => {
    const f = JSON.parse(e.data as string) as ServerFrame
    if (!paused) listeners.get(f.topic)?.forEach((l) => l(f))
  }
  ws.onclose = () => {
    socket = null
    if (listeners.size) setTimeout(() => socket ?? (socket = connect()), 2000) // backend restarted or the tab slept
  }
  return ws
}

function send(f: ClientFrame) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(f))
}

// subscribe delivers a topic's frames to l until the returned function is called.
export function subscribe(topic: Topic, l: Listener) {
  let set = listeners.get(topic)
  if (!set) {
    set = new Set()
    listeners.set(topic, set)
    if (!paused) send({ op: "sub", topic })
  }
  set.add(l)
  socket ??= connect()
  return () => {
    set.delete(l)
    if (set.size) return
    listeners.delete(topic)
    send({ op: "unsub", topic })
  }
}

// Pausing unsubscribes every topic, so nothing updates and the backend stops
// sampling. Resuming subscribes again; the first frame back holds the whole
// current state, so views jump to current values (WCAG SC 2.2.2).
function setPaused(p: boolean) {
  paused = p
  for (const topic of listeners.keys()) send({ op: p ? "unsub" : "sub", topic })
  pauseWatchers.forEach((w) => w())
}

export function usePaused() {
  return useSyncExternalStore(
    (w) => {
      pauseWatchers.add(w)
      return () => pauseWatchers.delete(w)
    },
    () => paused,
  )
}

export function PauseLive() {
  const isPaused = usePaused()
  return (
    <Button variant="ghost" size="sm" onClick={() => setPaused(!isPaused)}>
      {isPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
      {isPaused ? "Resume live updates" : "Pause live updates"}
    </Button>
  )
}

// announce queues a message for the status region. Messages are coalesced:
// the region changes at most once per COALESCE_MS, so a screen reader hears a
// summary of what crossed a threshold, never a stream of counters.
const COALESCE_MS = 5000
let queued: string[] = []
let message = ""
let timer = 0
const messageWatchers = new Set<() => void>()

export function announce(m: string) {
  queued.push(m)
  if (!timer) timer = window.setTimeout(flush) // after this frame's other messages
}

function flush() {
  timer = 0
  if (!queued.length) return
  message = queued.join(". ")
  queued = []
  messageWatchers.forEach((w) => w())
  timer = window.setTimeout(flush, COALESCE_MS)
}

// LiveRegion renders once in the shell, from first render, so assistive tech
// is already watching it when the first message arrives.
export function LiveRegion() {
  const text = useSyncExternalStore(
    (w) => {
      messageWatchers.add(w)
      return () => messageWatchers.delete(w)
    },
    () => message,
  )
  return (
    <div role="status" className="sr-only">
      {text}
    </div>
  )
}
