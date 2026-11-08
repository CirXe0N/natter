import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router"

import { Shell } from "@/shell"
import { ConnectionsScreen } from "@/screens/connections"
import { ContextsScreen } from "@/screens/contexts"
import { EditContextScreen, NewContextScreen } from "@/screens/context-form"
import { EmptyScreen } from "@/screens/empty-screen"
import { OverviewScreen } from "@/screens/overview"
import { ConsumerDetail, StreamConsumers } from "@/screens/consumers"
import { EditConsumer, NewConsumer } from "@/screens/consumer-form"
import { ConsumersScreen } from "@/screens/all-consumers"
import { StreamConfig, StreamOverview, StreamScreen } from "@/screens/stream"
import { StreamsScreen } from "@/screens/streams"
import { EditStream, NewStreamScreen } from "@/screens/stream-form"
import { MessageBrowserScreen, StreamMessages } from "@/screens/messages"
import { PublishScreen } from "@/screens/publish"
import { BucketScreen, KVScreen } from "@/screens/kv"
import { EditBucketScreen, NewBucketScreen } from "@/screens/kv-form"
import { TailScreen } from "@/screens/tail"

// Each screen is one route here. staticData.title names it in the top bar,
// the browser tab and the left nav. Replace EmptyScreen with the real screen.
const root = createRootRoute({ component: Shell })
const screen = { getParentRoute: () => root, component: EmptyScreen }
// A stream's tabs are its child routes; StreamScreen lists them.
const stream = createRoute({ ...screen, path: "/streams/$stream", staticData: { title: "Stream" }, component: StreamScreen })

const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: "/", beforeLoad: () => { throw redirect({ to: "/overview", replace: true }) } }),
  createRoute({ ...screen, path: "/overview", staticData: { title: "Overview" }, component: OverviewScreen }),
  createRoute({ ...screen, path: "/connections", staticData: { title: "Connections" }, component: ConnectionsScreen, validateSearch: (s: Record<string, unknown>): { server?: string; cid?: number } => (typeof s.server === "string" && typeof s.cid === "number" ? { server: s.server, cid: s.cid } : {}) }),
  createRoute({ ...screen, path: "/publish", staticData: { title: "Publish / Request" }, component: PublishScreen }),
  createRoute({ ...screen, path: "/tail", staticData: { title: "Live tail" }, component: TailScreen, validateSearch: (s: Record<string, unknown>): { subject?: string } => (typeof s.subject === "string" && s.subject ? { subject: s.subject } : {}) }),
  createRoute({ ...screen, path: "/streams", staticData: { title: "Streams" }, component: StreamsScreen, validateSearch: (s: Record<string, unknown>): { subject?: string } => (typeof s.subject === "string" && s.subject ? { subject: s.subject } : {}) }),
  createRoute({ ...screen, path: "/streams/new", staticData: { title: "New stream" }, component: NewStreamScreen }),
  createRoute({ ...screen, path: "/consumers", staticData: { title: "Consumers" }, component: ConsumersScreen }),
  // Consumers are created and managed here; a stream's Consumers tab only lists them.
  createRoute({ ...screen, path: "/consumers/new", staticData: { title: "New consumer" }, component: NewConsumer }),
  createRoute({ ...screen, path: "/consumers/$stream/$consumer", staticData: { title: "Consumers" }, component: ConsumerDetail }),
  createRoute({ ...screen, path: "/consumers/$stream/$consumer/edit", staticData: { title: "Edit consumer" }, component: EditConsumer }),
  createRoute({ ...screen, path: "/messages", staticData: { title: "Message browser" }, component: MessageBrowserScreen, validateSearch: (s: Record<string, unknown>): { stream?: string } => (typeof s.stream === "string" && s.stream ? { stream: s.stream } : {}) }),
  createRoute({ ...screen, path: "/kv", staticData: { title: "Key-Value" }, component: KVScreen }),
  createRoute({ ...screen, path: "/kv/new", staticData: { title: "New bucket" }, component: NewBucketScreen }),
  createRoute({ ...screen, path: "/contexts", staticData: { title: "Contexts" }, component: ContextsScreen }),
  createRoute({ ...screen, path: "/contexts/new", staticData: { title: "New Context" }, component: NewContextScreen }),
  createRoute({ ...screen, path: "/contexts/$source/$name/edit", staticData: { title: "Edit Context" }, component: EditContextScreen }),
  createRoute({ ...screen, path: "/kv/$bucket", staticData: { title: "Key-Value" }, component: BucketScreen }),
  createRoute({ ...screen, path: "/kv/$bucket/edit", staticData: { title: "Edit bucket" }, component: EditBucketScreen }),
  stream.addChildren([
    createRoute({ getParentRoute: () => stream, path: "/", staticData: { title: "Stream" }, component: StreamOverview }),
    createRoute({ getParentRoute: () => stream, path: "config", staticData: { title: "Stream" }, component: StreamConfig }),
    createRoute({ getParentRoute: () => stream, path: "edit", staticData: { title: "Stream" }, component: EditStream }),
    createRoute({ getParentRoute: () => stream, path: "consumers", staticData: { title: "Stream" }, component: StreamConsumers }),
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
