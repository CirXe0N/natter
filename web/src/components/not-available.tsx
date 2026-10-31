import { Link } from "@tanstack/react-router"
import { ShieldAlert } from "lucide-react"

import type { StatsSource } from "@/gen/api"

// Where server-wide numbers come from, in words. Empty for "none".
export const sourceLabel: Record<StatsSource, string> = {
  system: "All servers, via System credentials",
  monitoring: "One server, via the Monitoring URL",
  none: "",
}

// The empty state for a screen that needs System credentials or a Monitoring URL.
export function NotAvailable({ title, problem }: { title: string; problem?: string }) {
  return (
    <div className="grid min-h-60 place-items-center rounded-xl border bg-card p-8 text-center">
      <div className="max-w-md">
        <ShieldAlert className="mx-auto mb-3 text-warning" size={20} aria-hidden />
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{problem}</p>
        <Link to="/contexts" className="mt-3 inline-block text-xs text-primary hover:underline">
          Manage Contexts
        </Link>
      </div>
    </div>
  )
}
