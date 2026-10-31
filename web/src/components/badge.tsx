import type { ReactNode } from "react"
import { cn } from "cn"

const tones = {
  muted: "border-border bg-accent text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  info: "border-info/25 bg-info/10 text-info",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
  primary: "border-primary/25 bg-primary/10 text-primary",
}

export function Badge({ tone = "muted", title, children }: { tone?: keyof typeof tones; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium", tones[tone])}>
      {children}
    </span>
  )
}
