import { useId } from "react"

import { Button } from "@/components/ui/button"

// A Button that Read-only mode (or anything else) blocks. It stays visible and
// focusable, its click does nothing, and the reason is visible text that the
// button points to with aria-describedby, so no hover is needed.
export function BlockedButton({ reason, ...props }: { reason?: string } & React.ComponentProps<typeof Button>) {
  const id = useId()
  return (
    <>
      <Button {...props} disabled={!!reason || props.disabled} focusableWhenDisabled aria-describedby={reason ? id : undefined} />
      {reason && (
        <span id={id} className="text-xs text-muted-foreground">
          {reason}
        </span>
      )}
    </>
  )
}
