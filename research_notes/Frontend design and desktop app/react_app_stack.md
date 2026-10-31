# React application stack for nats-ui's production frontend

Scope: libraries and patterns for the production SPA (React 19.3, Vite 8.3, Tailwind 4.3, TypeScript 7.0, per `prototypes/ui-shell/package.json`). It covers the component base, routing with typed URL state, server state over REST plus one multiplexed WebSocket per tab, the 1M+ row message table, the palette, toasts and panels, API typing from Go, and library-specific testing. Research date: 2026-10-31.

Method: versions and publish dates come from `npm view <pkg> version time[<ver>]`, and weekly downloads from `api.npmjs.org/downloads/point/last-week/<pkg>`, both queried 2026-10-31. Repo activity (archived, pushed_at, stars) comes from `gh api repos/<owner>/<repo>`, also queried 2026-10-31. Source files were read raw via `gh api repos/.../contents/...`. A link to `https://www.npmjs.com/package/<pkg>` stands for the npm registry query.

Project constraints that shape the picks: ADR-0003 says the table holds metadata only, is fetched in pages of 100 keyed by sequence, evicts distant pages and scrolls on a scaled scrollbar. The backend report says live data is one multiplexed WebSocket per tab carrying metadata only, payloads come from an HTTP Range endpoint, and there is one ordered consumer per open table view, with a new consumer only on jump or filter change. The prototype's message table (`prototypes/ui-shell/src/messages.tsx`) already hand-rolls a scaled track: `MAX_SCROLL = 4_000_000`, pure ratio mapping, pages of 100 in an LRU of 40 pages.

### Version snapshot used by all sections (verified 2026-10-31)

| Package | Version | Published | Weekly downloads | Repo last push |
|---|---|---|---|---|
| shadcn (CLI) | 4.23.0 | 2026-10-27 | n/a | shadcn-ui/ui 2026-10-31 |
| @base-ui/react | 1.9.0 | 2026-10-09 (1.0.0: 2025-12-11) | 26.2M | mui/base-ui 2026-10-31 |
| radix-ui (unified) | 1.8.1 | 2026-10-12 | 24.9M | radix-ui/primitives 2026-10-14 |
| react-aria-components | 1.22.1 | 2026-10-09 | 7.6M | adobe/react-spectrum 2026-10-29 |
| @ark-ui/react | 5.40.0 | 2026-10-29 | 1.4M | chakra-ui/ark 2026-10-31 |
| @tanstack/react-router | 1.170.46 | 2026-10-22 | 21.7M | TanStack/router 2026-10-30 |
| @tanstack/router-plugin | 1.168.48 | 2026-10-22 | n/a | same |
| react-router | 8.5.1 | 2026-10-27 (8.0.0: 2026-06-17) | 74.1M | remix-run/react-router 2026-10-30 |
| @tanstack/react-query | 5.105.0 | 2026-10-26 | n/a | TanStack/query 2026-10-30 |
| @tanstack/react-virtual | 3.14.24 (virtual-core 3.19.9) | 2026-10-29 | 39.2M | TanStack/virtual 2026-10-30 |
| @tanstack/react-table | 9.3.1 (9.0.0: 2026-08-04) | 2026-10-12 | n/a | TanStack/table 2026-10-21 |
| cmdk | 1.1.1 | **2025-03-14** | 44.3M | dip/cmdk **2025-10-29** (README only) |
| kbar | 1.0.0 | 2026-08-10 | 0.47M | n/a |
| sonner | 2.0.8 | 2026-08-09 | 54.5M | emilkowalski/sonner 2026-08-10 |
| react-resizable-panels | 4.15.3 | 2026-10-30 (4.0.0: 2025-12-16) | 29.8M | bvaughn/... 2026-10-30, 1 open issue |
| zustand | 5.0.16 | 2026-10-22 | n/a | pmndrs/zustand 2026-10-22 |
| zod | 4.6.7 | (modified 2026-10-12) | n/a | n/a |
| openapi-typescript / openapi-fetch | 7.13.0 / 0.17.0 | 2026-02-11 | n/a | openapi-ts/openapi-typescript 2026-09-25 |
| orval | 8.46.0 | 2026-10-30 | n/a | n/a |
| @hey-api/openapi-ts | 0.99.0 | 2026-06-22 | n/a | n/a |
| @tanstack/react-hotkeys | 0.19.0 (pre-1.0) | (modified 2026-10-30) | n/a | n/a |
| vaul | 1.1.2 | **2024-12-14** | n/a | n/a |
| tailwindcss-animate | 1.0.7 | **2023-08-28** | n/a | n/a |
| tw-animate-css | 1.4.0 | (modified 2026-02-28) | n/a | n/a |
| @glideapps/glide-data-grid | 6.0.3 | **2024-02-03** | n/a | glideapps/glide-data-grid 2026-01-21 |
| msw | 3.0.3 (3.0.0: 2026-09-28) | n/a | n/a | n/a |
| Playwright | v1.64.1 | 2026-10-14 | n/a | n/a |

Sources: npm registry ([shadcn](https://www.npmjs.com/package/shadcn), [@base-ui/react](https://www.npmjs.com/package/@base-ui/react), [radix-ui](https://www.npmjs.com/package/radix-ui), [react-aria-components](https://www.npmjs.com/package/react-aria-components), [@ark-ui/react](https://www.npmjs.com/package/@ark-ui/react), [@tanstack/react-router](https://www.npmjs.com/package/@tanstack/react-router), [react-router](https://www.npmjs.com/package/react-router), [@tanstack/react-query](https://www.npmjs.com/package/@tanstack/react-query), [@tanstack/react-virtual](https://www.npmjs.com/package/@tanstack/react-virtual), [@tanstack/react-table](https://www.npmjs.com/package/@tanstack/react-table), [cmdk](https://www.npmjs.com/package/cmdk), [kbar](https://www.npmjs.com/package/kbar), [sonner](https://www.npmjs.com/package/sonner), [react-resizable-panels](https://www.npmjs.com/package/react-resizable-panels), [zustand](https://www.npmjs.com/package/zustand), [openapi-typescript](https://www.npmjs.com/package/openapi-typescript), [orval](https://www.npmjs.com/package/orval), [@hey-api/openapi-ts](https://www.npmjs.com/package/@hey-api/openapi-ts), [vaul](https://www.npmjs.com/package/vaul), [tailwindcss-animate](https://www.npmjs.com/package/tailwindcss-animate), [tw-animate-css](https://www.npmjs.com/package/tw-animate-css), [msw](https://www.npmjs.com/package/msw)); GitHub API ([shadcn-ui/ui](https://api.github.com/repos/shadcn-ui/ui), [mui/base-ui](https://api.github.com/repos/mui/base-ui), [dip/cmdk](https://api.github.com/repos/dip/cmdk), [cmdk commits](https://api.github.com/repos/dip/cmdk/commits), [TanStack/virtual](https://api.github.com/repos/TanStack/virtual), [Playwright releases](https://github.com/microsoft/playwright/releases)).

---

## 1. shadcn/ui in late 2026: base library, Tailwind v4, React 19, CLI and registry; alternatives

### Takeaway
shadcn/ui is still the right base, and it is now explicitly multi-primitive. **Base UI has been the default since 2026-07-02**, Radix stays fully supported, and React Aria became a third first-class base on 2026-07-17. CLI v4 (`shadcn@4.23.0`) adds `--base`, presets, `--diff` for pulling upstream updates into owned code, and namespaced or private registries. Recommendation: `npx shadcn@latest init -t vite` with the default Base UI base. Expect two non-Base-UI leftovers: the Command component still wraps **cmdk** (which pulls in Radix Dialog), and the Sonner wrapper imports `next-themes`.

### Cited Findings
- **Base UI is the default.** "Starting today, Base UI is the default component library in shadcn/ui" (dated 2026-07-02). The stated reasons: "Base UI is stable. It's at 1.6.0 with 6M+ weekly downloads" and "Projects created on shadcn/create now pick Base UI over Radix 2 to 1." — [shadcn changelog 2026-07-base-ui-default](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-07-base-ui-default.mdx)
- **Radix is not deprecated.** "Radix is not being deprecated. We still support it, and every update and new component will ship for both libraries (unless a component only exists in Base UI)." Radix is opt-in with `npx shadcn init -b radix`. Registries can pin a library by shipping a `registry:base`, and "Items without one now init as Base UI." — [same](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-07-base-ui-default.mdx)
- **Migration is a skill, not a codemod.** It runs via `npx skills add shadcn/ui`, and "`asChild` is now `render`" is the main mechanical rename between the Radix and Base UI APIs. — [same](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-07-base-ui-default.mdx)
- **React Aria is a third base.** "React Aria is now a first-class component base in shadcn/ui", initialised with `npx shadcn@latest init --base aria`, across "all eight styles" (Vega, Nova, Maia, Lyra, Mira, Luma, Rhea, Sera). Dated 2026-07-17. — [shadcn changelog 2026-07-react-aria](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-07-react-aria.mdx)
- **CLI v4 (2026-03-06).** It adds `--preset`, `--dry-run`, `--diff`, `--view` ("check for registry updates"), and `init --template` for Vite (and others) with dark mode included for Vite. It also adds `init --base`, `shadcn info`, `shadcn docs <component>`, `registry:base` ("distribute an entire design system as a single payload") and `registry:font`. — [shadcn changelog 2026-03-cli-v4](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-03-cli-v4.mdx)
- **CLI 3.0 (2025-08-27) registry workflow.** Namespaced registries are configured in `components.json` under `"registries": { "@acme": "https://acme.com/r/{name}.json" }`, with auth headers such as `Bearer ${REGISTRY_TOKEN}`, and installed with `npx shadcn add @acme/button`. Commands `view`, `search` and `list` exist, plus an MCP server via `npx shadcn@latest mcp init`. "It's completely decentralized. There's no central registrar." — [shadcn changelog 2025-08-cli-3-mcp](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2025-08-cli-3-mcp.mdx)
- **More registry features.** GitHub registries arrived in June 2026. Private GitHub registries (August 2026) authenticate via `gh auth login` or `GH_TOKEN`/`GITHUB_TOKEN`. — [ui.shadcn.com/docs/changelog](https://ui.shadcn.com/docs/changelog)
- **Unified Radix package.** Since 2026-02-02, Radix-based components import from the single `radix-ui` package (`import { Dialog as DialogPrimitive } from "radix-ui"`). `npx shadcn@latest migrate radix` converts existing code. — [shadcn changelog 2026-02-radix-ui](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-02-radix-ui.mdx)
- **`cn` package (September 2026).** "Every shadcn component now imports `cn` from the `cn` package", which replaces the `clsx` + `tailwind-merge` setup. `shadcn migrate cn` removes the old packages. — [ui.shadcn.com/docs/changelog](https://ui.shadcn.com/docs/changelog)
- **Tailwind v4 integration.** It is CSS-first: `init` writes `@import "tailwindcss"; @import "tw-animate-css"; @import "shadcn/tailwind.css";`. `shadcn/tailwind.css` holds the shared `@custom-variant data-open { … }` and `@theme inline { @keyframes accordion-down … }` utilities that both bases need. `npx shadcn@latest eject` inlines it and drops the `shadcn` dependency. Dated 2026-05-31. — [shadcn changelog 2026-05-shadcn-eject](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-05-shadcn-eject.mdx)
- **`tailwindcss-animate` is superseded by `tw-animate-css`.** The init CSS above imports `tw-animate-css`. `tailwindcss-animate`'s last release was 1.0.7 on 2023-08-28. — [shadcn eject changelog](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-05-shadcn-eject.mdx); [npm tailwindcss-animate](https://www.npmjs.com/package/tailwindcss-animate)
- **What each base's components wrap.** In the current registry source, the Base UI and Radix `command.tsx` both `import { Command as CommandPrimitive } from "cmdk"`. The Aria `command.tsx` imports from `react-aria-components` instead. All three `resizable.tsx` import `react-resizable-panels`. All three `sonner.tsx` import `sonner` and `useTheme` from `next-themes`. Only the Base UI base has a native `toast.tsx`. — [registry/bases/base/ui/command.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/command.tsx), [bases/aria/ui/command.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/aria/ui/command.tsx), [bases/base/ui/sonner.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/sonner.tsx), [bases/base/ui/resizable.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/resizable.tsx)
- **Native Toast.** "A new Toast component built on Base UI primitives" supports "actions, status types, promises, stacking, and swipe dismissal", added with `npx shadcn@latest add toast`. Dated 2026-07-23. — [shadcn changelog 2026-07-toast](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-07-toast.mdx)
- **Base UI accessibility.** Components "adhere to the WAI-ARIA Authoring Practices to provide basic keyboard accessibility out of the box", manage focus (with `initialFocus` and `finalFocus` props), and "are tested on a broad spectrum of browsers, devices, platforms, screen readers, and environments". The developer owns visible focus styles, colour contrast, and accessible names for custom controls. — [base-ui.com accessibility](https://base-ui.com/react/overview/accessibility)
- **Base UI release cadence.** 1.0.0 was 2025-12-11. Minor releases have been roughly monthly: v1.7.0 2026-08-04, v1.8.0 2026-09-04, v1.9.0 2026-10-09. — [npm @base-ui/react](https://www.npmjs.com/package/@base-ui/react); [GitHub releases mui/base-ui](https://github.com/mui/base-ui/releases)
- **Base UI has a Combobox.** The shadcn CLI's own `docs combobox` output points to `https://base-ui.com/react/components/combobox`. — [shadcn changelog 2026-03-cli-v4](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-03-cli-v4.mdx)
- **React Aria's claims.** "All components are extensively tested using many popular screen readers and devices", with "translations in over 30 languages" and "right-to-left layout". "All components are optimized for mouse, touch, keyboard, and screen reader interactions", and "Hover interactions only apply when using a mouse – no sticky touch hover states." — [react-aria.adobe.com](https://react-aria.adobe.com/) (react-spectrum.adobe.com/react-aria now 301-redirects there)
- **Maintenance signals, 2026-10-31.** mui/base-ui: 11.3k stars, 447 open issues, pushed 2026-10-31. adobe/react-spectrum: 16.0k stars, 676 open, pushed 2026-10-29. chakra-ui/ark: 5.4k stars, 7 open, pushed 2026-10-31. radix-ui/primitives: 19.5k stars, 261 open, pushed 2026-10-14. None is archived. — GitHub API ([mui/base-ui](https://api.github.com/repos/mui/base-ui), [adobe/react-spectrum](https://api.github.com/repos/adobe/react-spectrum), [chakra-ui/ark](https://api.github.com/repos/chakra-ui/ark), [radix-ui/primitives](https://api.github.com/repos/radix-ui/primitives))
- **Ark UI has no shadcn base.** The changelog names only Base UI, React Aria and Radix as bases. — [ui.shadcn.com/docs/changelog](https://ui.shadcn.com/docs/changelog)

### Inferences
- **Pick shadcn + Base UI** (`npx shadcn@latest init -t vite`, default base). It is the default path, so new components and blocks land there first. Its a11y story matches Radix's. React Aria has the strongest documented a11y and i18n testing, but its shadcn base is three months old and its render-prop API differs more from the shadcn idiom. Choose it only if screen-reader quality on complex widgets becomes the deciding factor. Ark UI (Zag.js state machines) has no shadcn base, so adopting it means losing the copy-in registry workflow.
- **Treat shadcn as code you own.** Run `shadcn add <c> --diff` periodically to merge upstream fixes into local edits. Don't fork a component library.
- **Vite fixes needed after `add`:**
  1. Replace `next-themes` in `sonner.tsx` with the app's own theme hook, or prefer the Base UI `toast` and skip Sonner.
  2. Accept that `command.tsx` keeps a cmdk dependency, which pulls `@radix-ui/react-dialog`, `-primitive`, `-id` and `-compose-refs` into a Base UI app (see section 5).
- **Don't add these:** `vaul` (last release 2024-12-14) or `tailwindcss-animate` (2023). Both are effectively unmaintained.

Sketch, project init:
```bash
npx shadcn@latest init -t vite            # Base UI default; add "-b radix" or "--base aria" to switch
npx shadcn@latest add button dialog table toast resizable command badge tabs tooltip
npx shadcn@latest add dialog --diff       # later: see upstream changes vs your local copy
```

### Gaps
- I did not fetch the shadcn "Tailwind v4" and "React 19" docs pages. Tailwind v4 compatibility is inferred from the CSS emitted by `init` and `eject`, and React 19 compatibility from peer dependencies.
- I found no primary source on whether Base UI ships an "Autocomplete" separate from Combobox. Check base-ui.com before building the palette on it.
- I did not verify that `components.json` records the chosen base under a specific key name.

---

## 2. Routing: TanStack Router vs React Router v8 (library mode) for typed search params

### Takeaway
**Use TanStack Router (1.170.x).** It validates and types search params with Standard Schema (Zod v4 directly), offers `retainSearchParams` and `stripSearchParams` middlewares, and has functional `search: prev => …` updates. That is exactly what `/c/$ctx/streams/$stream?seq=…&filter=…` needs. React Router is now **v8** (v7 "library mode" no longer exists as the current major). Its typed route API is Framework-mode only, and search params remain `URLSearchParams` strings in Declarative and Data modes.

### Cited Findings
- **`validateSearch`.** It receives JSON-parsed unvalidated params, and its typed result is available to "this route's other options and any child routes, too!" If it throws, the route's `errorComponent` renders with `error.routerCode === 'VALIDATE_SEARCH'`. — [TanStack Router search params guide](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)
- **Schema libraries.** "With Zod v4, you should directly use the schema in `validateSearch`" (no adapter). Valibot ≥1.0 and ArkType need no adapter because they implement Standard Schema. With Zod v4, `.catch()` keeps type inference. The guide recommends fallbacks over errors because "you probably don't want to halt the user's experience." — [same](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)
- **Middlewares.** `retainSearchParams(['rootValue'])` keeps listed params on every link, and `stripSearchParams(defaultValues)` removes params that equal their defaults. Writes use `navigate({ search: (prev) => ({ page: prev.page + 1 }) })` and `<Link search={prev => …}>`. — [same](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)
- **TanStack's own comparison table** (a vendor source): "TypeSafe Search Params" and "Search Param Schema Validation" are ✅ for TanStack Router and 🛑 for React Router. "Search Param Immutability + Structural Sharing" is ✅ vs 🔶 ("possible but needs custom code"), and Devtools ✅ vs 🟠. Both support file-based and code-based routes. — [tanstack.com/router comparison](https://tanstack.com/router/latest/docs/framework/react/comparison)
- **React Router v8.0.0 (2026-06-17).** It requires "React 19.2.7+", "Vite 7+" and Node 22.22.0+, and is "ESM-only". `react-router-dom` is dropped ("swap them to `react-router` and `react-router/dom`"), and v7 future flags become defaults. Releases since: 8.4.0 (2026-09-15) added an unstable `unstable_validateParams` for **path** params in Data mode, and 8.5.1 shipped 2026-10-27. — [reactrouter.com/changelog](https://reactrouter.com/changelog)
- **React Router modes.** "Framework Mode wraps Data Mode with a Vite plugin to add … type-safe `href`, type-safe Route Module API." Declarative mode is "basic routing features like matching URLs to components", and Data mode adds "loader, action, and useFetcher". No mode lists typed search params. — [reactrouter.com/start/modes](https://reactrouter.com/start/modes)
- **Activity.** TanStack/router: 15.3k stars, 808 open issues, pushed 2026-10-30. remix-run/react-router: 56.6k stars, 224 open, pushed 2026-10-30. — GitHub API ([TanStack/router](https://api.github.com/repos/TanStack/router), [remix-run/react-router](https://api.github.com/repos/remix-run/react-router))

### Inferences
- **Context in the path, view state in search.** Put the Context name in the path (`/c/$ctx/...`) so that switching Context is a navigation and every query key can include `ctx`. Keep `seq`, `filter`, `tab` and `from` (time) in search, validated by one Zod v4 schema per route.
- **Use `stripSearchParams` for defaults** to keep share-links short. Use `retainSearchParams` only for app-wide toggles, if any.
- **React Router v8 would need hand-rolled code** for parse, validate and serialize on top of `useSearchParams`. The prototype already needs exactly what TanStack provides. Choosing React Router would only make sense for SSR or Framework mode, which an embedded SPA does not need.
- **File-based routing** via `@tanstack/router-plugin` (Vite plugin, 1.168.48) gives generated route types and auto code-splitting. Code-based routing is also supported if generated files are unwanted in the Go-embedded repo.

Sketch, routes with typed search (Zod v4, code-based for brevity):
```ts
import { createRootRoute, createRoute, createRouter, stripSearchParams } from '@tanstack/react-router'
import { z } from 'zod'

const root = createRootRoute()
const ctx = createRoute({ getParentRoute: () => root, path: '/c/$ctx' })

const streamSearch = z.object({
  seq: z.number().int().positive().optional().catch(undefined),   // open message
  filter: z.string().default('').catch(''),                       // subject filter, e.g. orders.>
  tab: z.enum(['messages', 'config', 'consumers']).default('messages').catch('messages'),
})
const defaults = { filter: '', tab: 'messages' } as const

export const streamRoute = createRoute({
  getParentRoute: () => ctx,
  path: 'streams/$stream',
  validateSearch: streamSearch,
  search: { middlewares: [stripSearchParams(defaults)] },
})

export const router = createRouter({ routeTree: root.addChildren([ctx.addChildren([streamRoute])]) })
declare module '@tanstack/react-router' { interface Register { router: typeof router } }

// In a component:
const { seq, filter } = streamRoute.useSearch()
const navigate = streamRoute.useNavigate()
const open = (s: number) => navigate({ search: (p) => ({ ...p, seq: s }) })      // /c/prod/streams/ORDERS?seq=123
```

### Gaps
- TypeScript 7.0 (the Go-native compiler) compatibility with TanStack Router's heavy type inference was not verified. Typecheck the router early in the spike.
- I did not confirm from the docs whether `useSearch({ select })` exists for fine-grained subscriptions; the fetched guide does not mention it.
- I did not fetch the React Router `useSearchParams` API page itself. The "no typed search params" claim rests on the modes page, the changelog and TanStack's (vendor) comparison.

---

## 3. Server state: polling that pauses when hidden, plus a multiplexed WebSocket

### Takeaway
Use **TanStack Query 5.105** for every request/response call, including polled lists. `refetchInterval` already pauses in hidden tabs by default (`refetchIntervalInBackground: false`). For the WebSocket, use **one plain-TS socket client** that ref-counts subscriptions, and route its frames in one of two ways by feed shape:
- **Snapshot or keyed feeds** (stream info, KV state, consumer lag, server stats): write into the Query cache with `setQueryData`, with `staleTime: Infinity` on those keys.
- **Append feeds** (Live tail, chart rings): bounded external stores read with React's `useSyncExternalStore`, flushed once per animation frame.

Skip `streamedQuery` (still `experimental_`, accumulates every chunk by default) and skip Zustand for live data. A Zustand store adds nothing over `useSyncExternalStore` here.

### Cited Findings
- **Polling options.** `refetchInterval` takes a number or a function "executed with the latest data and query to compute a frequency". `refetchIntervalInBackground` defaults to `false`; "If set to `true`, the query will continue to refetch while their tab/window is in the background." `refetchOnWindowFocus` defaults to `true` and refetches if stale. `staleTime` accepts `Infinity` or `'static'`. `structuralSharing` defaults to `true`. `subscribed: false` unsubscribes an observer. — [useQuery reference](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)
- **"Focus" is document visibility.** The default focus handler listens to `visibilitychange` and calls `handleFocus(document.visibilityState === 'visible')`. `focusManager.setEventListener` replaces it. — [Window focus refetching guide (source)](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/window-focus-refetching.md)
- **Patterns for WebSockets with React Query (TkDodo, a TanStack Query maintainer):**
  - Open the connection "in an app-wide `useEffect`".
  - Prefer `queryClient.invalidateQueries({ queryKey })` because it "avoids the problem of over pushing"; invalidated queries without observers refetch only when next used.
  - Use `setQueriesData` for "small, frequent changes" to large data sets. He calls that approach too dynamic for additions and deletions.
  - "if you update all your data via websockets anyways, consider setting a high `staleTime`."

  — [tkdodo.eu: Using WebSockets with React Query](https://tkdodo.eu/blog/using-web-sockets-with-react-query)
- **`streamedQuery`** is exported only as `experimental_streamedQuery` (`export { streamedQuery as experimental_streamedQuery }` in query-core's index). Its options are `streamFn` (returns an `AsyncIterable`), `refetchMode` (`'reset'` default, which "erases all data and puts the query back into `pending` state"; `'append'`; or `'replace'`, which "writes all data to the cache once the stream ends"), and an optional `reducer` + `initialValue`. The default reducer appends every chunk (`addToEnd`). "The query will stay in fetchStatus 'fetching' until the stream ends." — [query-core/src/streamedQuery.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/streamedQuery.ts); [streamedQuery reference](https://tanstack.com/query/latest/docs/reference/streamedQuery)
- **Zustand 5's peer dependencies** include `use-sync-external-store`. — [npm zustand](https://www.npmjs.com/package/zustand)
- **Backend contract.** One multiplexed WebSocket per tab, carrying metadata only, with subscribe/unsubscribe and bounded per-subscription buffers. Tails drop oldest and send a gap marker, while metrics and KV collapse to the latest value per key. Producers are ref-counted with a short grace period so reloads don't churn consumers. — `reports/Go backend building blocks.md` (sections "Three server-side layers…" and "One ordered consumer per view…")

### Inferences
- **Why not `streamedQuery`?** It models one query owning one iterable that eventually ends. A shared socket would have to be adapted into an `AsyncIterable` per key. The query sits in `fetching` forever, and `'reset'` on refetch blanks the view. A capped reducer could bound memory, but the helper is experimental and gains nothing over the two routes above.
- **Why not Zustand?** Each feed is an independent ring or map keyed by subscription. A 30-line `createFeedStore()` with `subscribe`/`getSnapshot` plus `useSyncExternalStore` is the whole need. Zustand stays optional for UI state (palette open, panel sizes), though React state or context covers that too.
- **Batch appends.** Coalesce Live tail frames per `requestAnimationFrame` and swap an immutable snapshot reference once per frame. Calling `setQueryData` per message would run structural sharing over the whole array on every frame.
- **Reconnects.** Resend active subscriptions on reconnect, then `invalidateQueries` for snapshot keys, because the server may have changed while the socket was down.
- **Hidden tabs.** Polling already pauses. For WS feeds, consider unsubscribing high-rate feeds (Live tail, 1 s charts) on `visibilitychange` to hidden, after a grace period. That matches the backend's ref-count grace.

Sketch, socket client, Query bridge and append store:
```ts
// ws.ts: one socket per tab, ref-counted topics
type Frame = { topic: string; kind: 'snapshot' | 'append' | 'gap'; data: unknown }
type Handler = (f: Frame) => void
export class LiveSocket {
  private ws?: WebSocket; private subs = new Map<string, Set<Handler>>()
  connect() {
    this.ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`)
    this.ws.onopen = () => this.subs.forEach((_, t) => this.send({ op: 'sub', topic: t }))
    this.ws.onmessage = (e) => { const f: Frame = JSON.parse(e.data); this.subs.get(f.topic)?.forEach((h) => h(f)) }
    this.ws.onclose = () => setTimeout(() => this.connect(), 1000)          // add backoff + jitter
  }
  subscribe(topic: string, h: Handler) {
    let set = this.subs.get(topic)
    if (!set) { set = new Set(); this.subs.set(topic, set); this.send({ op: 'sub', topic }) }
    set.add(h)
    return () => { set!.delete(h); if (!set!.size) { this.subs.delete(topic); this.send({ op: 'unsub', topic }) } }
  }
  private send(m: object) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)) }
}
export const live = new LiveSocket()

// Snapshot feeds -> Query cache. The REST GET gives the initial value; WS keeps it fresh.
export function useLiveQuery<T>(key: readonly unknown[], topic: string, fetcher: () => Promise<T>) {
  const qc = useQueryClient()
  useEffect(() => live.subscribe(topic, (f) => { if (f.kind === 'snapshot') qc.setQueryData(key, f.data as T) }), [topic])
  return useQuery({ queryKey: key, queryFn: fetcher, staleTime: Infinity })
}

// Append feeds (Live tail) -> bounded store + useSyncExternalStore, flushed per frame
export function createRing<T>(cap: number) {
  let buf: T[] = [], snap: readonly T[] = buf, dropped = 0, raf = 0
  const ls = new Set<() => void>()
  const flush = () => { raf = 0; snap = buf.slice(-cap); buf = snap as T[]; ls.forEach((l) => l()) }
  return {
    push(x: T) { buf.push(x); if (!raf) raf = requestAnimationFrame(flush) },
    gap(n: number) { dropped += n },
    subscribe(l: () => void) { ls.add(l); return () => ls.delete(l) },
    getSnapshot: () => snap, getDropped: () => dropped,
  }
}
// const rows = useSyncExternalStore(tail.subscribe, tail.getSnapshot)

// Polled list that pauses in hidden tabs (default refetchIntervalInBackground: false)
useQuery({ queryKey: ['connections', ctx], queryFn: getConnections, refetchInterval: 5000 })
```

### Gaps
- I found no TanStack primary doc that recommends a pattern for one multiplexed socket feeding many query keys. The design above combines TkDodo's guidance with the backend contract.
- I did not verify whether TanStack Query 5.105 has added a non-experimental subscription or "live query" primitive beyond `streamedQuery`.

---

## 4. Virtualised message table for 1M+ rows: TanStack Virtual limits, scaled scroll, keyset paging

### Takeaway
**TanStack Virtual 3.x still has no built-in scroll scaling.**
- Issue #616 ("Reach browser max height pixels") has been open since 2023-10-24.
- The community PR #1172 (`maxScrollSize`) was sent back for a rethink on 2026-10-27.
- The maintainer's guidance: compress only the scroll offset, keep items at real size and shift them by one shared delta, make it opt-in, and remember that Firefox caps near 17.9M px.

AG Grid ("Stretching", a pure ratio mapping) and Glide Data Grid (a hybrid mapping) both solve this themselves. With fixed 34 px rows, the recommendation is to **keep a small custom scaled viewport**, as the prototype does, upgraded to Glide's hybrid mapping. Use TanStack Virtual only below the threshold, or not at all for this table. Feed rows from a **bidirectional `useInfiniteQuery` keyed by anchor sequence with `maxPages`**, which matches the backend's one-consumer-per-view rule.

### Cited Findings
- **The original report (#616):** "If the list size is long it could beat the max height value which is: Firefox: 33554400px, Chrome: 33554428px". The repro uses 1,677,723 items × 20 px. The issue was still open on 2026-10-31. A collaborator invited a PR with an example after a user linked a custom-scrollbar approach. — [TanStack/virtual#616](https://github.com/TanStack/virtual/issues/616)
- **The scaling PR (#1172, opened 2026-05-23, still open).** It proposes `maxScrollSize` (default 33,000,000) and a `scale` property. Maintainer piecyk's review (2026-10-27) found three problems:
  - "`getVirtualItems()` divides `start`, `end` and `size` by `scale`, so the items themselves get shrunk."
  - The fix he suggests: "compress only the scroll offset and keep the visible items at their real sizes, shifted by one shared delta, something like `physicalStart = virtualStart - (virtualOffset - physicalOffset)`."
  - "this should be opt-in for now… It also doesn't help Firefox, which caps at around 17.9M."

  He also flags `scrollMargin` and `scrollToEnd` bugs, and says the feature is "still on the table, just not in this shape yet". — [TanStack/virtual#1172](https://github.com/TanStack/virtual/pull/1172)
- **Conflicting figures for Firefox's limit:** #616 says 33,554,400 px; the maintainer says about 17.9M. AG Grid says the limit "is not published so can differ between different browsers as well as different browser versions". — [#616](https://github.com/TanStack/virtual/issues/616); [#1172](https://github.com/TanStack/virtual/pull/1172); [AG Grid massive-row-count doc source](https://github.com/ag-grid/ag-grid/blob/2058a4be8c9dd100906170bf7dcb6a839a570466/documentation/ag-grid-docs/src/content/docs/massive-row-count/index.mdoc)
- **TanStack Virtual extension points.** virtual-core's options include `count`, `getScrollElement`, `estimateSize`, `scrollToFn`, `observeElementOffset`, `initialRect`, `initialOffset`, `overscan`, `rangeExtractor` and `scrollMargin`. These are the seams through which a scaled offset could be injected. — [virtual-core/src/index.ts](https://github.com/TanStack/virtual/blob/main/packages/virtual-core/src/index.ts)
- **Other open TanStack Virtual work:** PR #1241 "add useVirtualizerSnapshot for React Compiler compatibility via useSyncExternalStore" (open since 2026-07-25). PR #1338 (2026-10-24) switched table examples to "spacer rows instead of translateY". — [#1241](https://github.com/TanStack/virtual/pull/1241); [#1338](https://github.com/TanStack/virtual/pull/1338)
- **AG Grid "Stretching".** AG Grid measures the max div height at startup ("on Chrome v118 the maximum height was 32,000,000 pixels", logged as `RowContainerHeightService - maxDivHeight`). When rows exceed it, `rowOffset = (scrollY / maxScrollY) * (combinedRowHeight - maxDivHeight)`. Consequence: "the grid will appear to scroll faster… If x10 space is required, the rows will appear to move x10 when scrolling… There is no way around this." — [AG Grid docs source: massive-row-count](https://github.com/ag-grid/ag-grid/blob/2058a4be8c9dd100906170bf7dcb6a839a570466/documentation/ag-grid-docs/src/content/docs/massive-row-count/index.mdoc); [rowContainerHeightService.ts](https://github.com/ag-grid/ag-grid/blob/2058a4be8c9dd100906170bf7dcb6a839a570466/packages/ag-grid-community/src/rendering/rowContainerHeightService.ts)
- **Glide Data Grid's hybrid mapping.**
  - Constants: `BROWSER_MAX_DIV_HEIGHT = 33_554_400`, and padders of at most `MAX_PADDER_SEGMENT_HEIGHT = 5_000_000` "to avoid browser performance issues".
  - When content exceeds the DOM height, the mapping is: "For large jumps (scrollbar interaction) or edge positions, recalculate position based on percentage" (`Math.abs(delta) > 2000 || newY === 0 || newY === scrollableHeight`). Otherwise "apply the delta directly to virtual position. This preserves 1:1 pixel movement for smooth scrolling."
  - Virtual tracking resets when `devicePixelRatio` changes (zoom).

  — [glide-data-grid infinite-scroller.tsx](https://github.com/glideapps/glide-data-grid/blob/main/packages/core/src/internal/scrolling-data-grid/infinite-scroller.tsx)
- **Glide Data Grid's npm release is stale:** 6.0.3 was published 2024-02-03, although the repo was pushed 2026-01-21. It renders to canvas. — [npm @glideapps/glide-data-grid](https://www.npmjs.com/package/@glideapps/glide-data-grid); [GitHub API](https://api.github.com/repos/glideapps/glide-data-grid)
- **Grafana** depends on both `react-window` 1.8.11 and `@tanstack/react-virtual` ^3.5.1 in its root package.json. — [grafana/grafana package.json](https://github.com/grafana/grafana/blob/main/package.json)
- **Bidirectional keyset with eviction is native to Query:** "use the `maxPages` option in conjunction with `getNextPageParam` and `getPreviousPageParam` to allow fetching pages when needed in both directions… only 3 pages are kept." — [TanStack Query infinite queries guide (source)](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/infinite-queries.md)
- **TanStack Table v9 (9.0.0, 2026-08-04)** is the version to pair with this.
  - `useReactTable` is renamed `useTable`, and a "new required `features` table option" takes `tableFeatures({...})` of imported features (`columnSizingFeature`, `columnResizingFeature`, `columnVisibilityFeature`…).
  - The state system is built on TanStack Store, which brings "React Compiler compatibility" and fine-grained `table.atoms` and selectors.
  - It is ESM-only, targets ES2022, and still has `manualPagination`, `manualSorting` and `manualFiltering`. `useLegacyTable` is a deprecated v8 shim.

  — [TanStack Table React migration guide (source)](https://github.com/TanStack/table/blob/main/docs/framework/react/guide/migrating.md)

### Inferences
- **How big the problem is.** At 34 px rows, the DOM limit is reached at about 985k rows (Chrome's ~33.5M) or about 526k rows (Firefox's ~17.9M, if the maintainer is right). nats-ui must therefore scale for exactly the streams ADR-0003 targets.
- **Don't wait on PR #1172.** The prototype's approach (a fixed `MAX_SCROLL` track of 4M px, safely under every browser cap) is AG Grid's ratio mapping. Upgrade it to Glide's hybrid: big jumps and edges map by ratio, small wheel or trackpad deltas move 1:1. That avoids AG Grid's "x10 faster" wheel scrolling.
- **TanStack Virtual is optional for this table.** Fixed-height rows need no measurement. It remains the right tool for variable-height lists elsewhere (KV values, payload viewer lines).
- **Keyset paging, not row numbers.** Treat the scroll fraction as an approximate sequence:
  - `anchorSeq ≈ lastSeq − fraction × (lastSeq − firstSeq)` (newest first).
  - Big jumps and "Jump to seq" set a new anchor, which becomes part of the query key. A new key means a new backend consumer, matching "a new consumer only on jump or filter change".
  - Small scrolls call `fetchNextPage` or `fetchPreviousPage` on the same key, so the same consumer continues.
  - `maxPages` (for example 10 pages × 100 rows) does the "distant pages evicted" part of ADR-0003.
  - Row count and the thumb size come from `NumPending` plus the stream's first and last sequence, so the thumb position is approximate, as ADR-0003 accepts.
- **Rendering.** Use TanStack Table v9 only for column definitions, sizing and visibility (`columnSizingFeature`, `columnVisibilityFeature`). Use no client row models, because sorting and filtering live on the server. Render the visible slice from the infinite-query pages.

Sketch, hybrid scaled viewport plus anchor-keyed infinite query:
```ts
const ROW = 34, TRACK_MAX = 4_000_000   // under every browser cap, incl. Firefox's ~17.9M

function useScaledScroll(el: HTMLElement | null, total: number, viewportH: number) {
  const fullH = total * ROW, trackH = Math.min(fullH, TRACK_MAX)
  const virtualY = useRef(0), lastY = useRef(0)
  const [y, setY] = useState(0)
  const onScroll = () => {
    const top = el!.scrollTop, delta = top - lastY.current, maxPhys = trackH - viewportH
    lastY.current = top
    if (fullH <= TRACK_MAX) virtualY.current = top                                   // no scaling needed
    else if (Math.abs(delta) > 2000 || top === 0 || top >= maxPhys)                  // thumb drag / edges: ratio
      virtualY.current = (top / maxPhys) * (fullH - viewportH)
    else virtualY.current += delta                                                    // wheel: 1:1 (Glide)
    virtualY.current = Math.max(0, Math.min(virtualY.current, fullH - viewportH))
    setY(virtualY.current)
  }
  const first = Math.floor(y / ROW)
  return { trackH, first, offsetPx: -(y % ROW), onScroll }   // render rows first..first+visible at translateY(offsetPx)
}

// Rows: one query per anchor; scrolling continues the same consumer; jumps re-key.
const msgs = useInfiniteQuery({
  queryKey: ['msgs', ctx, stream, filter, anchorSeq],
  initialPageParam: { from: anchorSeq, dir: 'older' as const },
  queryFn: ({ pageParam, signal }) => api.listMessages({ ctx, stream, filter, ...pageParam, limit: 100 }, signal),
  getNextPageParam: (p) => (p.olderFrom ? { from: p.olderFrom, dir: 'older' } : undefined),
  getPreviousPageParam: (p) => (p.newerFrom ? { from: p.newerFrom, dir: 'newer' } : undefined),
  maxPages: 10,                  // ADR-0003 "distant pages evicted"
  staleTime: Infinity,           // stream rows are immutable once read
})
```

### Gaps
- I did not fetch AG Grid's or Glide's handling of keyboard navigation (Page Down, Home, End) under scaling; check before building.
- I found no primary source on Grafana's treatment of the browser height cap. Only its dependencies were confirmed.
- No browser-vendor primary source (Chromium or Gecko) for the exact max element height was found; the figures above are from library authors.
- The "Firefox ~17.9M" figure is a maintainer's comment, not a measurement published with a method. Test it in Playwright on Firefox.

---

## 5. Command palette, toasts, resizable panels, hotkeys

### Takeaway
- **Palette:** cmdk is **dormant**. The last release was 1.1.1 (2025-03-14), and the last commit (2025-10-29) was a README edit. It still works with React 19 and has 44M weekly downloads, and shadcn's Base UI and Radix `Command` still wrap it. Because the palette is a core feature here, either (a) accept cmdk via shadcn `command` and keep the risk visible, or (b) build the palette on Base UI Combobox inside a shadcn `Dialog`. Option (b) means no Radix in a Base UI app. kbar is alive (1.0.0, 2026-08-10) but small.
- **Toasts:** use the shadcn **Base UI Toast**, or Sonner 2.0.8 (maintained, but the shadcn wrapper imports `next-themes`).
- **Panels:** react-resizable-panels 4.15.3, actively maintained, via shadcn `resizable`.

### Cited Findings
- **cmdk is dormant.**
  - Release history: v1.1.1 2025-03-14, v1.1.0 2025-03-14, v1.0.4 2024-11-04. The latest commits are "Update README" (2025-10-29) and "fix styles for raycast preset" (2025-08-03).
  - The repo now lives at `dip/cmdk`: 13.1k stars, 80 open issues, not archived.

  — [GitHub API dip/cmdk commits](https://api.github.com/repos/dip/cmdk/commits); [releases](https://github.com/dip/cmdk/releases); [repo](https://api.github.com/repos/dip/cmdk)
- **cmdk dependencies.** Peers are `react: ^18 || ^19 || ^19.0.0-rc`. It depends on `@radix-ui/react-dialog ^1.1.6`, `@radix-ui/react-primitive`, `@radix-ui/react-id` and `@radix-ui/react-compose-refs`. — [npm cmdk](https://www.npmjs.com/package/cmdk)
- **What shadcn wraps.** The Base UI and Radix `command.tsx` import `cmdk`. The React Aria `command.tsx` uses `react-aria-components`. — [bases/base/ui/command.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/command.tsx); [bases/aria/ui/command.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/aria/ui/command.tsx)
- **kbar** 1.0.0 was published 2026-08-10, with 468k weekly downloads. — [npm kbar](https://www.npmjs.com/package/kbar)
- **Sonner** 2.0.8 was published 2026-08-09, with peers React ^18 || ^19 and 54.5M weekly downloads. The repo was last pushed 2026-08-10 and has 84 open issues. — [npm sonner](https://www.npmjs.com/package/sonner); [GitHub API emilkowalski/sonner](https://api.github.com/repos/emilkowalski/sonner)
- **Base UI Toast in shadcn** supports "actions, status types, promises, stacking, and swipe dismissal". — [shadcn changelog 2026-07-toast](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/changelog/2026-07-toast.mdx)
- **react-resizable-panels** 4.0.0 shipped 2025-12-16 and 4.15.3 on 2026-10-30; the repo has 1 open issue. The v4 API is `Group` / `Panel` / `Separator` ("A Group wraps a set of resizable Panel components"), with `data-group` attributes usable in tests. shadcn's `resizable.tsx` wraps it in every base. — [README](https://github.com/bvaughn/react-resizable-panels); [npm](https://www.npmjs.com/package/react-resizable-panels); [bases/base/ui/resizable.tsx](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/resizable.tsx)
- **@tanstack/react-hotkeys** is at 0.19.0 (pre-1.0). — [npm](https://www.npmjs.com/package/@tanstack/react-hotkeys)

### Inferences
- **Palette: use shadcn `command` (cmdk) now and wrap it behind the app's own `CommandPalette` interface.** The prototype already has one (`kit.tsx` `CommandPalette`, `commands.ts` `Command[]` with group, label, hint, cli and run). That makes a later swap to Base UI Combobox a one-file change if cmdk breaks on a future React. cmdk is "done" rather than abandoned, but it has no active maintainer response.
- **Toasts: prefer Base UI Toast** to stay on one primitive set. If Sonner is used, replace `next-themes` in the wrapper.
- **Panels: use resizable panels** for the stream view (message table | drawer) and for Publish (editor | result). Persist layout per screen in `localStorage`.
- **Hotkeys:** `⌘K`, `j`/`k` and `Esc` can stay hand-rolled (the prototype does this). `@tanstack/react-hotkeys` is pre-1.0; hold off.

### Gaps
- I did not verify Base UI Combobox's suitability as a palette (grouped items, custom filtering of about 1,000 commands, `cmdk`-style scoring).
- I found no announcement from the cmdk maintainers about deprecation or a successor.

---

## 6. Typing the API: Go to TypeScript

### Takeaway
For a stdlib-`ServeMux` backend whose only client is this SPA, **tygo** (v0.2.21, 2026-02-03) is the lightest fit. It generates TS types straight from Go source, keeps comments and `const` enums, and leaves handlers untouched. It also covers WebSocket frame types, which OpenAPI cannot describe. If a published, validated HTTP contract is wanted (OpenAPI 3.1, request validation, docs UI), use **Huma v2** (v2.40.0, 2026-10-27) with its `humago` stdlib adapter. Then generate types with **openapi-typescript 7.13 + openapi-fetch 0.17**, or Query hooks with **orval 8.46**. Spec-first generators (oapi-codegen, ogen) invert the workflow and fit less well.

### Cited Findings
- **tygo.** "Tygo is a tool for generating Typescript typings from Golang source files that just works. It preserves comments, understands constants and also supports non-struct `type` expressions." It supports generics (Go 1.18+), `json` tags (`omitempty` → optional, `omitzero`), `tstype:"string | null"` overrides and `tstype:"-"`, and the default `enum_style: "const"`. It installs with `go install github.com/gzuidhof/tygo@latest`. Latest is v0.2.21 (2026-02-03); 934 stars, 21 open issues. — [gzuidhof/tygo README](https://github.com/gzuidhof/tygo); [releases](https://github.com/gzuidhof/tygo/releases); [GitHub API](https://api.github.com/repos/gzuidhof/tygo)
- **tkrajina/typescriptify-golang-structs** (reflection-based struct converter): last push 2026-02-07, 583 stars. — [GitHub API](https://api.github.com/repos/tkrajina/typescriptify-golang-structs)
- **Huma.** It is "backed by OpenAPI 3 and JSON Schema", "Described by OpenAPI 3.1", and supports "Bring your own router (including Go 1.22+)". From the README: "Replace `chi.NewMux()` → `http.NewServeMux()` and `humachi.New` → `humago.New` to use the standard library router from Go 1.22+." Its adapters include `humago`, `humachi`, `humagin` and more. Latest is v2.40.0 (2026-10-27). — [danielgtaylor/huma README](https://github.com/danielgtaylor/huma); [releases](https://github.com/danielgtaylor/huma/releases)
- **Spec-first generators:** oapi-codegen v2.8.1 (2026-10-24) and ogen (pushed 2026-10-26). swaggo/swag's latest tag is `v2.0.0-rc6` (2026-09-13), so its v2 is still a release candidate. kin-openapi was pushed 2026-10-30. — GitHub API ([oapi-codegen](https://api.github.com/repos/oapi-codegen/oapi-codegen/releases), [ogen](https://api.github.com/repos/ogen-go/ogen), [swaggo/swag](https://api.github.com/repos/swaggo/swag/releases), [kin-openapi](https://api.github.com/repos/getkin/kin-openapi))
- **TS-side OpenAPI clients:**
  - openapi-typescript 7.13.0, openapi-fetch 0.17.0 and openapi-react-query 0.5.4 all released 2026-02-11, with no release since (the repo was pushed 2026-09-25).
  - orval 8.46.0 (2026-10-30) is very active.
  - @hey-api/openapi-ts is 0.99.0 (pre-1.0).

  — [openapi-ts releases](https://github.com/openapi-ts/openapi-typescript/releases); [npm orval](https://www.npmjs.com/package/orval); [npm @hey-api/openapi-ts](https://www.npmjs.com/package/@hey-api/openapi-ts)
- **The backend is stdlib ServeMux.** It uses Go 1.22 patterns (`GET /api/streams/{name}`) plus four middlewares, and chi is optional. — `research_notes/Go backend building blocks/web_serving_and_security.md` §2

### Inferences
- **tygo + a hand-written `api.ts`** of about 30 typed functions over `fetch` is the least machinery. It keeps Go handlers idiomatic and gives one source of truth for both REST DTOs and WS frames (`Frame` union keyed by `kind`). Run it via `go generate` and a CI `git diff --exit-code` check. The cost is that paths and methods aren't typed, since they live in the hand-written client.
- **Huma** gives typed paths, request validation and free API docs, at the cost of rewriting every handler into Huma's `huma.Register(api, op, func(ctx, *In) (*Out, error))` shape. It is worth it only if a public API or third-party clients are planned. ADR-0001 says only "a domain API … to the browser".
- **orval vs openapi-fetch.** If OpenAPI is adopted, orval's generated TanStack Query hooks are the most active option. openapi-fetch is smaller but has had no release in eight months.

Sketch, tygo config and use:
```yaml
# tygo.yaml (run: go generate ./... with //go:generate tygo generate)
packages:
  - path: "github.com/<org>/nats-ui/internal/api"      # REST DTOs + WS frame structs
    output_path: "web/src/gen/api.ts"
    type_mappings: { "time.Time": "string /* RFC3339 */" }
```
```ts
import type { StreamInfo, MessageRow } from './gen/api'
export const api = {
  streams: (ctx: string, s?: AbortSignal) => get<StreamInfo[]>(`/api/c/${enc(ctx)}/streams`, s),
  listMessages: (q: { ctx: string; stream: string; filter: string; from: number; dir: 'older' | 'newer'; limit: number }, s?: AbortSignal) =>
    get<{ rows: MessageRow[]; olderFrom?: number; newerFrom?: number }>(`/api/c/${enc(q.ctx)}/streams/${enc(q.stream)}/messages?${qs(q)}`, s),
}
```

### Gaps
- I did not verify whether tygo can emit discriminated unions for Go interface-typed WS payloads. That likely needs `tstype` overrides or a hand-written union.
- I did not check Huma's behaviour with Go 1.27's `encoding/json` v2 default noted in the backend report.

---

## 7. Testing additions specific to these libraries

### Takeaway
On top of the existing Vitest 5 + RTL + Playwright plan, there are four additions:
1. Mock the single WebSocket with Playwright's `page.routeWebSocket` (since v1.48; current v1.64.1).
2. Test the scaled table in **real browsers, including Firefox**, because jsdom has no layout and Firefox's height cap differs.
3. Create a fresh `QueryClient` and a memory-history router per test.
4. Use MSW 3 (3.0.0, 2026-09-28; it has a `ws` module) for component-level REST and WS mocks.

### Cited Findings
- **Playwright WebSocket routing.** `class: WebSocketRoute` "since: v1.48". "Whenever a WebSocket route is set up with `Page.routeWebSocket` or `BrowserContext.routeWebSocket`… By default, the routed WebSocket will not connect to the server. This way, you can mock entire communication." Latest Playwright is v1.64.1 (2026-10-14). — [Playwright docs source class-websocketroute.md](https://github.com/microsoft/playwright/blob/main/docs/src/api/class-websocketroute.md); [releases](https://github.com/microsoft/playwright/releases)
- **MSW** is at 3.0.3 (3.0.0 on 2026-09-28), and its source has a `src/ws/ws.ts` WebSocket module. — [npm msw](https://www.npmjs.com/package/msw); [mswjs/msw src/ws](https://github.com/mswjs/msw/tree/main/src/ws)
- **TanStack Virtual's `initialRect` option** exists. It lets a virtualizer render rows without layout, as in jsdom. — [virtual-core/src/index.ts](https://github.com/TanStack/virtual/blob/main/packages/virtual-core/src/index.ts)
- **react-resizable-panels** elements carry `data-group` and `data-testid` attributes for test selection. — [README](https://github.com/bvaughn/react-resizable-panels)
- **The Firefox height cap may be about 17.9M** versus Chrome's ~33.5M. — [TanStack/virtual#1172](https://github.com/TanStack/virtual/pull/1172)

### Inferences
- **Playwright on Chromium and Firefox:**
  - Drag the thumb to the bottom of a 2M-row mocked stream and assert the oldest sequence is visible.
  - Wheel-scroll 10 rows and assert 1:1 movement (Glide hybrid).
  - "Jump to seq" changes `?seq=` and the query key.
- **Socket contract test.** Reuse the tygo-generated frame types in the Playwright `routeWebSocket` handler so mocks can't drift from Go.
- **Unit tests.** Use a new `QueryClient({ defaultOptions: { queries: { retry: false } } })` per test, a TanStack Router instance with `createMemoryHistory({ initialEntries: ['/c/prod/streams/ORDERS?seq=5'] })`, and test the search-schema `.catch()` fallbacks directly.
- **Ring-buffer and scaled-scroll maths** (`createRing`, `useScaledScroll`) are pure enough for Vitest without DOM layout.

### Gaps
- I did not re-verify the TanStack Router `createMemoryHistory` testing API or TanStack Query's testing guide this session; the unit-test bullets above are standard practice, not freshly cited.
- I did not confirm MSW 3's `ws` API surface or any breaking changes from MSW 2.
