// The pieces of the sectioned config forms (Context, consumer): one card,
// a titled section per group, labelled fields with a hint or an error below.
import { type ReactNode, useId } from "react"
import { cn } from "cn"

import { Badge } from "@/components/badge"

export function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="grid gap-x-8 gap-y-3 p-6 md:grid-cols-[14rem_1fr]">
      <div>
        <h2 id={id} className="text-sm font-medium">
          {title}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

// Field labels its control and points it at the hint, or at the error that replaces it.
export function Field({ label, hint, error, fixed, className, children }: { label: string; hint?: ReactNode; error?: string; fixed?: boolean; className?: string; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId()
  const noteId = hint || error ? `${id}-note` : undefined
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <span className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">
          {label}
        </label>
        {fixed && <Badge>fixed after create</Badge>}
      </span>
      {children(id, noteId)}
      {(error || hint) && (
        <p id={noteId} role={error ? "alert" : undefined} className={cn("text-[11px]", error ? "text-destructive" : "text-fg-faint")}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

export function Segmented<T extends string>({ label, value, options, onChange, disabled, fixed, error }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean; fixed?: boolean; error?: string }) {
  return (
    <div className="grid content-start gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {label}
        {fixed && <Badge>fixed after create</Badge>}
      </span>
      <div role="group" aria-label={label} className={cn("flex w-fit flex-wrap gap-0.5 rounded-lg border bg-background/40 p-0.5", disabled && "opacity-60")}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn("h-7 rounded-md px-3 text-xs transition-colors disabled:cursor-not-allowed", value === o.value ? "bg-accent font-medium text-foreground shadow-sm" : "text-muted-foreground enabled:hover:text-foreground")}
          >
            {o.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function Switch({ checked, onChange, label, description, icon, tone = "primary", disabled, fixed }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; icon?: ReactNode; tone?: "primary" | "warning"; disabled?: boolean; fixed?: boolean }) {
  const id = useId()
  const on = tone === "warning" ? "border-warning/40 bg-warning/25" : "border-primary/40 bg-primary/25"
  const knob = tone === "warning" ? "bg-warning" : "bg-primary"
  return (
    <div className={cn("flex items-start gap-3", disabled && "opacity-60")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed", checked ? on : "bg-accent")}
      >
        <span className={cn("absolute size-3.5 rounded-full transition-transform", checked ? `translate-x-4.5 ${knob}` : "translate-x-0.5 bg-muted-foreground")} />
      </button>
      <div className="text-xs">
        <span className="flex items-center gap-1.5">
          <span id={`${id}-label`} className="flex items-center gap-1.5 font-medium">
            {icon}
            {label}
          </span>
          {fixed && <Badge>fixed after create</Badge>}
        </span>
        {description && (
          <p id={`${id}-desc`} className="mt-0.5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}
