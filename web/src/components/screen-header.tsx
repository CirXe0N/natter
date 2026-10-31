import type { ReactNode } from "react"

export function ScreenHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 px-8 pb-5 pt-7">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
