// Health: every server's HEALTHZ answer, with the failing accounts, streams
// and consumers listed for the unhealthy ones.
import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { CircleCheck, CircleAlert, ShieldAlert } from "lucide-react"

import { api } from "@/api"
import { ScreenHeader } from "@/components/screen-header"
import type { Health, ServerHealth } from "@/gen/api"
import { announce, usePaused } from "@/live"

// useHealth polls every 5 s while the tab is visible and live updates are not
// paused. Shared by the Overview's indicator.
export function useHealth() {
  const paused = usePaused()
  return useQuery({ queryKey: ["health"], queryFn: ({ signal }) => api.health(signal), refetchInterval: paused ? false : 5000 })
}

export function unhealthy(h?: Health) {
  return h?.servers.filter((s) => !s.healthy) ?? []
}

export function HealthScreen() {
  const { data: h, error } = useHealth()
  const bad = unhealthy(h).length
  useEffect(() => {
    if (h?.servers.length) announce(bad ? `${bad} of ${h.servers.length} servers unhealthy` : "All servers healthy")
  }, [bad, h?.servers.length])

  return (
    <>
      <ScreenHeader title="Health" />
      <div className="space-y-4 px-8 pb-8">
        {error ? (
          <p className="text-destructive">{error.message}</p>
        ) : !h ? (
          <p className="text-muted-foreground">Checking…</p>
        ) : h.servers.length === 0 ? (
          <div className="grid min-h-60 place-items-center rounded-xl border bg-card p-8 text-center">
            <div className="max-w-md">
              <ShieldAlert className="mx-auto mb-3 text-warning" size={20} aria-hidden />
              <h2 className="text-sm font-medium">Server health is not available</h2>
              <p className="mt-1.5 text-xs text-muted-foreground">{h.problem}</p>
              <Link to="/contexts" className="mt-3 inline-block text-xs text-primary hover:underline">
                Manage Contexts
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {h.source === "system" ? "All servers, via System credentials" : "One server, via the Monitoring URL"}
            </p>
            <ul className="space-y-3">
              {h.servers.map((s) => (
                <ServerCard key={s.id} s={s} />
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  )
}

function ServerCard({ s }: { s: ServerHealth }) {
  return (
    <li className="rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        {s.healthy ? <CircleCheck size={15} className="text-success" aria-hidden /> : <CircleAlert size={15} className="text-destructive" aria-hidden />}
        {s.name || s.id}
        <span className={`text-xs font-normal ${s.healthy ? "text-success" : "text-destructive"}`}>{s.healthy ? "Healthy" : "Unhealthy"}</span>
      </h2>
      {s.errors.length > 0 && (
        <ul className="mt-3 divide-y rounded-md border text-xs">
          {s.errors.map((e, i) => (
            <li key={i} className="px-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {[e.type, e.account, e.stream, e.consumer].filter(Boolean).join(" › ")}
              </span>
              <p className="mt-0.5">{e.error}</p>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
