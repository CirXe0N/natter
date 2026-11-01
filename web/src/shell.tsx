import { useEffect, type ComponentType } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, Outlet, useMatches, useRouter, type LinkProps } from "@tanstack/react-router"
import { Activity, Boxes, Cable, ChevronRight, Database, Layers, Radio, Send } from "lucide-react"

import { api } from "@/api"
import { ConnectionStatus, ContextSwitcher, ReadOnlyBadge, useActiveContext } from "@/contexts"
import { CommandPalette } from "@/command-palette"
import { LiveRegion } from "@/live"

type NavItem = { to: NonNullable<LinkProps["to"]>; Icon: ComponentType<{ size?: number }> }
const nav: { group: string; items: NavItem[] }[] = [
  { group: "", items: [{ to: "/overview", Icon: Activity }] },
  { group: "Core", items: [{ to: "/connections", Icon: Cable }, { to: "/publish", Icon: Send }, { to: "/tail", Icon: Radio }] },
  { group: "JetStream", items: [{ to: "/streams", Icon: Layers }, { to: "/consumers", Icon: Boxes }, { to: "/messages", Icon: Database }] },
]

export function Shell() {
  const title = useMatches({ select: (m) => m.at(-1)?.staticData.title })
  const ro = useActiveContext().data?.context?.readOnly
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
      <LiveRegion />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`flex h-12 shrink-0 items-center gap-4 border-b px-6 ${ro ? "border-warning/25 bg-warning/5" : "bg-card/40"}`}>
          <Breadcrumb />
          <CommandPalette />
          <div className="flex min-w-0 flex-1 items-center justify-end gap-3 text-xs">
            <ConnectionStatus />
            <ReadOnlyBadge />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

// Context › section › stream or bucket. The section is the first path segment's screen.
function Breadcrumb() {
  const { routesByPath } = useRouter()
  const ctx = useActiveContext().data?.context?.name
  const last = useMatches({ select: (m) => m.at(-1) })
  if (!last) return <div className="flex-1" />
  const section = `/${last.pathname.split("/")[1]}` as keyof typeof routesByPath
  const sectionTitle = routesByPath[section]?.options.staticData?.title
  const params = last.params as { stream?: string; bucket?: string; name?: string; consumer?: string }
  const named = params.consumer ?? params.stream ?? params.bucket ?? params.name
  const leaf = named ?? (last.staticData.title !== sectionTitle ? last.staticData.title : undefined)
  const sep = <ChevronRight size={12} aria-hidden className="shrink-0 text-fg-faint" />
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1 text-xs">
      <ol className="flex items-center gap-1.5">
        {ctx && (
          <li className="flex items-center gap-1.5">
            <Link to="/contexts" activeOptions={{ exact: true }} className="rounded px-1 font-mono text-muted-foreground hover:text-foreground">
              {ctx}
            </Link>
            {sep}
          </li>
        )}
        {leaf ? (
          <>
            <li className="flex items-center gap-1.5">
              <Link to={section} activeOptions={{ exact: true }} className="rounded px-1 text-muted-foreground hover:text-foreground">
                {sectionTitle}
              </Link>
              {sep}
            </li>
            <li aria-current="page" className={`truncate px-1 ${named ? "font-mono" : ""}`}>
              {leaf}
            </li>
          </>
        ) : (
          <li aria-current="page" className="truncate px-1">
            {sectionTitle ?? last.staticData.title}
          </li>
        )}
      </ol>
    </nav>
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
