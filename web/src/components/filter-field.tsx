// FilterField is the one look for filter, search and jump boxes: the Live
// tail's small bordered pill with an optional leading icon. The label names the
// input for screen readers; the placeholder is what sighted people read.
import type { ComponentProps, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "cn"

type Props = ComponentProps<"input"> & {
  label: string
  icon?: LucideIcon
  mono?: boolean
  /** Buttons inside the pill, after the input. */
  children?: ReactNode
}

export function FilterField({ label, icon: Icon, mono, className, children, ...input }: Props) {
  return (
    <div className={cn("flex h-7 items-center rounded-md border bg-background pl-2 text-xs focus-within:border-primary/60", children ? "pr-0.5" : "pr-2", className)}>
      <label className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch">
        {Icon && <Icon size={12} aria-hidden className="shrink-0 text-fg-faint" />}
        <span className="sr-only">{label}</span>
        <input {...input} className={cn("min-w-0 flex-1 bg-transparent placeholder:font-sans placeholder:text-fg-faint", mono && "font-mono")} />
      </label>
      {children}
    </div>
  )
}
