import { useEffect, type ComponentType } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, Outlet, useMatches, useRouter, type LinkProps } from "@tanstack/react-router"
import { Activity, Boxes, Cable, Database, KeyRound, Layers, Radio, Send } from "lucide-react"

import { api } from "@/api"
import { ConnectionStatus, ContextSwitcher } from "@/contexts"
import { CommandPalette } from "@/command-palette"
import { DensityToggle } from "@/density"

type NavItem = { to: NonNullable<LinkProps["to"]>; Icon: ComponentType<{ size?: number }> }
const nav: { group: string; items: NavItem[] }[] = [
  { group: "", items: [{ to: "/overview", Icon: Activity }] },
  { group: "Core", items: [{ to: "/connections", Icon: Cable }, { to: "/publish", Icon: Send }, { to: "/tail", Icon: Radio }] },
  { group: "JetStream", items: [{ to: "/streams", Icon: Layers }, { to: "/consumers", Icon: Boxes }, { to: "/messages", Icon: Database }, { to: "/kv", Icon: KeyRound }] },
]

export function Shell() {
  const title = useMatches({ select: (m) => m.at(-1)?.staticData.title })
  useEffect(() => {
    document.title = title ? `${title} · Natter` : "Natter"
  }, [title])

  return (
    <div className="flex h-full">
      <aside className="flex w-58 shrink-0 flex-col border-r bg-card">
        <div className="p-3">
          <ContextSwitcher />
        </div>
        <SideNav />
        <Version />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-4 border-b bg-card/40 px-6">
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1 text-xs">
            <ol className="flex items-center gap-1.5">
              <li aria-current="page" className="truncate">{title}</li>
            </ol>
          </nav>
          <CommandPalette />
          <ConnectionStatus />
          <DensityToggle />
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function SideNav() {
  const { routesByPath } = useRouter()
  return (
    <nav aria-label="Screens" className="flex-1 space-y-4 overflow-auto px-2 pt-1">
      {nav.map((g) => (
        <div key={g.group}>
          {g.group && <h2 className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">{g.group}</h2>}
          <ul>
            {g.items.map(({ to, Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  className="group flex h-(--row-h) items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
                >
                  <span className="group-aria-[current=page]:text-primary">
                    <Icon size={15} />
                  </span>
                  {routesByPath[to as keyof typeof routesByPath]?.options.staticData?.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Version() {
  const info = useQuery({ queryKey: ["info"], queryFn: ({ signal }) => api.info(signal) })
  return (
    <p className="px-4 py-3 text-[11px] text-fg-faint">
      {info.isError ? <span className="text-destructive">{info.error.message}</span> : <>Natter {info.data?.version}</>}
    </p>
  )
}
