import { useState } from "react"
import { Check, Copy } from "lucide-react"

// "Copy as CLI": shows the matching nats command and copies it on click.
export function CopyCli({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={`Copy as CLI: ${cmd}`}
      title="Copy as CLI"
      onClick={() => {
        void navigator.clipboard.writeText(cmd).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border bg-background px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check size={12} className="shrink-0 text-success" aria-hidden /> : <Copy size={12} className="shrink-0" aria-hidden />}
      <span className="truncate">{cmd}</span>
      <span role="status" className="sr-only">{copied ? "Copied" : ""}</span>
    </button>
  )
}
