// FilterField is the one look for filter, search and jump boxes: the Live
// tail's small bordered pill with an optional leading icon. The label names the
// input for screen readers; the placeholder is what sighted people read.
// Focus shows as the box's full-primary border, so the input drops the global
// focus outline (allowed for this file in scripts/check-styles.js).
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"

type Props = ComponentProps<"input"> & {
  label: string
  icon?: LucideIcon
  mono?: boolean
  /** Buttons inside the pill, after the input. */
  children?: ReactNode
}

export function FilterField({ label, icon: Icon, mono, className, children, ...input }: Props) {
  return (
    <div className={cn("flex h-7 items-center rounded-md border bg-background pl-2 text-xs focus-within:border-primary", children ? "pr-0.5" : "pr-2", className)}>
      <label className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch">
        {Icon && <Icon size={12} aria-hidden className="shrink-0 text-fg-faint" />}
        <span className="sr-only">{label}</span>
        <input {...input} className={cn("min-w-0 flex-1 bg-transparent outline-none placeholder:font-sans placeholder:text-fg-faint", mono && "font-mono")} />
      </label>
      {children}
    </div>
  )
}

const DEBOUNCE_MS = 300

// FilterForm is how every filter works: it applies as you type, and Clear shows
// while a filter is applied. A filter that fetches passes debounce, so it applies
// a moment after typing stops; Enter applies at once. The box starts from value
// and keeps its own text after that.
export function FilterForm({ value, onApply, debounce, ...field }: Omit<Props, "value" | "onChange" | "children"> & { value: string; onApply: (value: string) => void; debounce?: boolean }) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const input = useRef<HTMLInputElement>(null)
  // The value this box last applied. A different value came from outside (a
  // link, Back), so the box shows it instead of its own stale text.
  const applied = useRef(value)
  useEffect(() => {
    if (value !== applied.current) {
      applied.current = value
      clearTimeout(timer.current)
      setDraft(value)
    }
  }, [value])
  useEffect(() => () => clearTimeout(timer.current), [])
  const apply = (v: string) => {
    clearTimeout(timer.current)
    applied.current = v.trim()
    onApply(applied.current)
  }
  return (
    <div role="search" className="flex items-center gap-2">
      <FilterField
        {...field}
        ref={input}
        value={draft}
        onChange={(e) => {
          const v = e.target.value
          setDraft(v)
          if (!debounce) apply(v)
          else {
            clearTimeout(timer.current)
            timer.current = setTimeout(() => apply(v), DEBOUNCE_MS)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply(draft)
        }}
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Clear filter"
          onClick={() => {
            setDraft("")
            apply("")
            input.current?.focus() // the button is about to unmount
          }}
        >
          Clear
        </Button>
      )}
    </div>
  )
}
