import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router"

import { Shell } from "@/shell"
import { ConnectionsScreen } from "@/screens/connections"
import { ContextsScreen } from "@/screens/contexts"
import { EmptyScreen } from "@/screens/empty-screen"
import { HealthScreen } from "@/screens/health"
import { OverviewScreen } from "@/screens/overview"
import { ConsumerDetail, StreamConsumers } from "@/screens/consumers"
import { StreamConfig, StreamOverview, StreamScreen } from "@/screens/stream"
import { StreamsScreen } from "@/screens/streams"
import { EditStream, NewStreamScreen } from "@/screens/stream-form"
import { StreamMessages } from "@/screens/messages"
import { PublishScreen } from "@/screens/publish"

// Each screen is one route here. staticData.title names it in the top bar,
// the browser tab and the left nav. Replace EmptyScreen with the real screen.
const root = createRootRoute({ component: Shell })
const screen = { getParentRoute: () => root, component: EmptyScreen }
// A stream's tabs are its child routes; StreamScreen lists them.
const stream = createRoute({ ...screen, path: "/streams/$stream", staticData: { title: "Stream" }, component: StreamScreen })

const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/", beforeLoad: () => { throw redirect({ to: "/overview", replace: true }) } }),
  createRoute({ ...screen, path: "/overview", staticData: { title: "Overview" }, component: OverviewScreen }),
  createRoute({ ...screen, path: "/health", staticData: { title: "Health" }, component: HealthScreen }),
  createRoute({ ...screen, path: "/connections", staticData: { title: "Connections" }, component: ConnectionsScreen, validateSearch: (s: Record<string, unknown>): { server?: string; cid?: number } => (typeof s.server === "string" && typeof s.cid === "number" ? { server: s.server, cid: s.cid } : {}) }),
  createRoute({ ...screen, path: "/publish", staticData: { title: "Publish / request" }, component: PublishScreen }),
  createRoute({ ...screen, path: "/tail", staticData: { title: "Live tail" } }),
  createRoute({ ...screen, path: "/streams", staticData: { title: "Streams" }, component: StreamsScreen, validateSearch: (s: Record<string, unknown>): { subject?: string } => (typeof s.subject === "string" && s.subject ? { subject: s.subject } : {}) }),
  createRoute({ ...screen, path: "/streams/new", staticData: { title: "New stream" }, component: NewStreamScreen }),
  createRoute({ ...screen, path: "/consumers", staticData: { title: "Consumers" } }),
  createRoute({ ...screen, path: "/messages", staticData: { title: "Message browser" } }),
  createRoute({ ...screen, path: "/kv", staticData: { title: "Key-Value" } }),
  createRoute({ ...screen, path: "/contexts", staticData: { title: "Contexts" }, component: ContextsScreen }),
  stream.addChildren([
    createRoute({ getParentRoute: () => stream, path: "/", staticData: { title: "Stream" }, component: StreamOverview }),
    createRoute({ getParentRoute: () => stream, path: "config", staticData: { title: "Stream" }, component: StreamConfig }),
    createRoute({ getParentRoute: () => stream, path: "edit", staticData: { title: "Stream" }, component: EditStream }),
    createRoute({ getParentRoute: () => stream, path: "consumers", staticData: { title: "Stream" }, component: StreamConsumers }),
    createRoute({ getParentRoute: () => stream, path: "consumers/$consumer", staticData: { title: "Stream" }, component: ConsumerDetail }),
    createRoute({ getParentRoute: () => stream, path: "messages", staticData: { title: "Stream" }, component: StreamMessages }),
  ]),
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
