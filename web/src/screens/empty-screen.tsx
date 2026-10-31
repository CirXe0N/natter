import { useMatches } from "@tanstack/react-router"

import { ScreenHeader } from "@/components/screen-header"

export function EmptyScreen() {
  const title = useMatches({ select: (m) => m.at(-1)?.staticData.title })
  return (
    <>
      <ScreenHeader title={title} />
      <p className="px-8 text-muted-foreground">Nothing to show here yet.</p>
    </>
  )
}
