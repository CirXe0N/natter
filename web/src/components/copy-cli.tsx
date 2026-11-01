import { useState } from "react"
import { Check, Copy } from "lucide-react"

// "Copy as CLI": shows the matching nats command and copies it on click.
// compact shows only the icon; the command stays in the accessible name and tooltip.
export function CopyCli({ cmd, compact }: { cmd: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={`Copy as CLI: ${cmd}`}
      title={compact ? `Copy as CLI: ${cmd}` : "Copy as CLI"}
      onClick={() => {
        void navigator.clipboard.writeText(cmd).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border bg-background px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check size={12} className="shrink-0 text-success" aria-hidden /> : <Copy size={12} className="shrink-0" aria-hidden />}
      {!compact && <span className="truncate">{cmd}</span>}
      <span role="status" className="sr-only">{copied ? "Copied" : ""}</span>
    </button>
  )
}
