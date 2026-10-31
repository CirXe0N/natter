import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router"

import { Shell } from "@/shell"
import { ContextsScreen } from "@/screens/contexts"
import { EmptyScreen } from "@/screens/empty-screen"

// Each screen is one route here. staticData.title names it in the top bar,
// the browser tab and the left nav. Replace EmptyScreen with the real screen.
const root = createRootRoute({ component: Shell })
const screen = { getParentRoute: () => root, component: EmptyScreen }

const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/", beforeLoad: () => { throw redirect({ to: "/overview", replace: true }) } }),
  createRoute({ ...screen, path: "/overview", staticData: { title: "Overview" } }),
  createRoute({ ...screen, path: "/connections", staticData: { title: "Connections" } }),
  createRoute({ ...screen, path: "/publish", staticData: { title: "Publish / request" } }),
  createRoute({ ...screen, path: "/tail", staticData: { title: "Live tail" } }),
  createRoute({ ...screen, path: "/streams", staticData: { title: "Streams" } }),
  createRoute({ ...screen, path: "/consumers", staticData: { title: "Consumers" } }),
  createRoute({ ...screen, path: "/messages", staticData: { title: "Message browser" } }),
  createRoute({ ...screen, path: "/kv", staticData: { title: "Key-Value" } }),
  createRoute({ ...screen, path: "/contexts", staticData: { title: "Contexts" }, component: ContextsScreen }),
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
  interface StaticDataRouteOption {
    title?: string
  }
}
