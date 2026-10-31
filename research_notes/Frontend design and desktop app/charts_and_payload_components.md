# Live charts and payload viewing/editing components for nats-ui (as of 2026-10-31)

Scope: chart library for the Overview KPI sparklines, per-server time series and consumer-lag charts; the payload editor on the publish page; the JSON tree, text and hex payload viewer for messages up to 4 MB that load progressively (first 64 KB, then the full payload, per `docs/adr/0003-browsing-large-messages.md`); and whether headers and payload kind are decoded in the browser or in the Go backend.

Prototype baseline (`prototypes/ui-shell/src/kit.tsx`). `Sparkline` is a hand-rolled SVG `<polyline>` over a 60-point array. `useLiveSeries` replaces that array once a second with `[...p.slice(1), next]`. `PayloadView` calls `JSON.parse(m.payload)` on the main thread during render. `JsonTree` is a recursive, non-virtualised React tree. `hexDump` builds one big string. The publish editor in `publish.tsx` is a plain `<textarea>`. It validates JSON with `JSON.parse` after substituting placeholders, and lists the natscli placeholder names.

**How sizes were measured.** Unless a size is cited to bundlephobia, it was measured locally on 2026-10-31. Each package was installed from npm at the version given, then bundled with esbuild (`--bundle --minify --format=esm`, React externalised), and the output compressed with `gzip -9`. The entry files imported only what nats-ui would use. These are tree-shaken numbers. bundlephobia measures the whole package entry, so its numbers are larger for libraries that tree-shake. The micro-benchmarks were run locally in Node v26.13.0 on an Intel i9-11900F (V8, the same engine as Chrome). Treat them as order-of-magnitude figures for a desktop browser, not as browser measurements.

---

## Q1. Real-time charts: uPlot vs ECharts vs Recharts vs visx vs Chart.js vs Observable Plot

### Takeaway
Use **uPlot 1.6.32** for both the larger time-series charts and the consumer-lag charts. It costs about 23 KB gzip, uses Canvas 2D, and its own benchmark streams exactly our shape: 3,600 points updating, at 10% CPU. That is one hour of 1 Hz samples. The tiny KPI sparklines can stay as the existing zero-dependency SVG component, fed by a ring buffer and downsampled to the pixel width, or use uPlot with axes and cursor turned off. ECharts 6 is the fallback if we later need rich chart types, built-in ARIA and runtime theme switching. Its cost is about 180 KB gzip even after tree-shaking.

### Cited Findings

**Versions and maintenance (npm registry and GitHub API, 2026-10-31)**

| Library | Latest npm version (date) | Repo activity | License |
|---|---|---|---|
| uPlot | 1.6.32 (2025-03-14) | last push 2026-10-30; commits 2026-10-27/30 rework benchmarks and add "tooltip … pocs of interaction canvas layer"; 10.6k stars, 133 open issues | MIT |
| Apache ECharts | 6.1.0 (2026-05-19), depends on zrender | last push 2026-10-13; 67.6k stars; 1,491 open issues | Apache-2.0 |
| Recharts | 3.10.1 (2026-07-25) | last push 2026-10-30; 27.7k stars | MIT |
| visx | 4.0.0 (2026-06-11), `@visx/xychart` depends on `@visx/react-spring` | last push 2026-06-22; 21.1k stars | MIT |
| Chart.js | 4.6.1 (2026-10-22) | last push 2026-10-23; 67.8k stars | MIT |
| Observable Plot | 0.6.17 (2025-02-14), depends on full `d3` | last push 2026-10-30 | ISC |

Sources: [npm uplot](https://registry.npmjs.org/uplot), [npm echarts](https://registry.npmjs.org/echarts), [npm recharts](https://registry.npmjs.org/recharts), [npm @visx/xychart](https://registry.npmjs.org/@visx/xychart), [npm chart.js](https://registry.npmjs.org/chart.js), [npm @observablehq/plot](https://registry.npmjs.org/@observablehq/plot); GitHub API [leeoniya/uPlot](https://api.github.com/repos/leeoniya/uPlot), [uPlot commits](https://api.github.com/repos/leeoniya/uPlot/commits?per_page=5), [apache/echarts](https://api.github.com/repos/apache/echarts), [recharts/recharts](https://api.github.com/repos/recharts/recharts), [airbnb/visx](https://api.github.com/repos/airbnb/visx), [chartjs/Chart.js](https://api.github.com/repos/chartjs/Chart.js), [observablehq/plot](https://api.github.com/repos/observablehq/plot).
- uPlot has had no npm release for about 19 months, but the master branch is active. Pin the version, and expect the next release may change the tooltip and interaction APIs — [uPlot commits](https://api.github.com/repos/leeoniya/uPlot/commits?per_page=5).

**Bundle size (min / gzip)**

| Library | What was bundled | Tree-shaken (measured locally) | bundlephobia, whole entry |
|---|---|---|---|
| uPlot 1.6.32 | `new uPlot(...)` | 52.7 KB / **23.5 KB** | 50.8 / 21.9 KB ([bundlephobia](https://bundlephobia.com/package/uplot@1.6.32)) |
| ECharts 6.1.0 | `echarts/core` with LineChart, Grid, Tooltip and CanvasRenderer | 524 KB / **180 KB** | 1,115 / 368 KB ([bundlephobia](https://bundlephobia.com/package/echarts@6.1.0)) |
| ECharts 6.1.0 | full `import * as echarts` | 1,161 KB / 393 KB | n/a |
| Recharts 3.10.1 | LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer (React external) | 374 KB / **113 KB** | 562 / 150 KB ([bundlephobia](https://bundlephobia.com/package/recharts@3.10.1)) |
| Chart.js 4.6.1 | line controller, line and point elements, linear and category scales, Tooltip, Filler | 162 KB / **57 KB** | 205 / 70 KB ([bundlephobia](https://bundlephobia.com/package/chart.js@4.6.1)) |
| visx 4.0.0 | `@visx/shape` LinePath and AreaClosed plus `@visx/scale` | 47 KB / **17 KB** | n/a |
| visx 4.0.0 | `@visx/xychart` XYChart, LineSeries, Axis, Tooltip | 161 KB / 57 KB | 152 / 50 KB ([bundlephobia](https://bundlephobia.com/package/@visx/xychart@4.0.0)) |
| Observable Plot 0.6.17 | `Plot.lineY().plot()` | 280 KB / **95 KB** | 388 / 130 KB ([bundlephobia](https://bundlephobia.com/package/@observablehq/plot@0.6.17)) |
| For scale: React 19 and react-dom | `createRoot` | 223 KB / 69 KB | n/a |

**Streaming and update performance (primary benchmarks)**
- uPlot README: "In most sane cases, you can live-stream data with uPlot at 60fps, though it may begin to struggle beyond 100k in-view points." Also: "When updating 3,600 points at 60fps, uPlot uses 10% CPU and 12.3MB RAM. The next fastest Canvas-based libs (Chart.js and ECharts) use 40% / 77MB and 70% / 85MB, respectively." — [uPlot README](https://github.com/leeoniya/uPlot#readme), demos [sine-stream](https://leeoniya.github.io/uPlot/demos/sine-stream.html), [Chart.js4-sine-stream](https://leeoniya.github.io/uPlot/bench/Chart.js4-sine-stream.html), [ECharts5-sine-stream](https://leeoniya.github.io/uPlot/bench/ECharts5-sine-stream.html)
- The same README contradicts the 10% figure for other hardware. The author's Manjaro laptop (Ryzen 7 PRO 5850U, integrated GPU, 4K) shows "99% CPU usage" on the same sine-stream demo when Chrome rasterises on the CPU, versus 57% on a Windows desktop with a discrete GPU. The cause is Canvas2D rasterisation settings, not the library — [uPlot README, "Unclog your rendering pipeline"](https://github.com/leeoniya/uPlot#unclog-your-rendering-pipeline)
- Cold-start benchmark (166,650 points; 2023-03-11; Ryzen 7 PRO 5850U; Chrome 113; DPR 1.5). Here "size" means the library plus required dependencies, as uPlot reports it:

  | Library | Size | Time to done | Heap, peak / final |
  |---|---|---|---|
  | uPlot 1.6.24 | 47.9 KB | 34 ms | 21 / 3 MB |
  | Chart.js 4.2.1 | 254 KB | 38 ms | 29 / 10 MB |
  | ECharts 5.4.1 | 1000 KB | 55 ms | 17 / 3 MB |
  | Plotly 2.18.2 | 3600 KB | 310 ms | n/a |

  Source: [uPlot README Performance](https://github.com/leeoniya/uPlot#performance) and [raw results](https://github.com/leeoniya/uPlot/blob/master/bench/results.json). The benchmark predates ECharts 6, Chart.js 4.6 and Recharts 3. Recharts, visx and Observable Plot are not in it. It also measures uPlot's own author's library.
- uPlot non-goals: no transitions or animations, no general data aggregation, no collision avoidance for tick labels, and no built-in drag panning — [uPlot README](https://github.com/leeoniya/uPlot#readme)
- Chart.js's own advice for large or streaming data: disable animations (Path2D caching then applies to line charts), decimate data, pass `parsing: false` with pre-normalised data, set `normalized: true`. It can render in a web worker via OffscreenCanvas, though "transferring large data between threads can be costly" — [Chart.js Performance](https://www.chartjs.org/docs/latest/general/performance.html)
- Recharts' own performance guide covers React patterns only: isolate frequently updating components, keep `dataKey` and props referentially stable, throttle mouse handlers. It asks "Does your chart truly need to display all 50,000 data points?" It states no point-count limits — [Recharts Performance guide](https://recharts.github.io/en-US/guide/performance/)

**Dark theming**
- ECharts 6 shipped a new default theme. It supports registering and switching themes at runtime (`setTheme`), and adapting to the system dark or light mode — [ECharts 6 features](https://echarts.apache.org/handbook/en/basics/release-note/v6-feature), [changelog](https://echarts.apache.org/changelog.html), [setTheme API](https://echarts.apache.org/en/api.html#echartsInstance.setTheme)
- uPlot is Canvas 2D-based. Its README does not discuss theming. Colours are passed in the options (`stroke`, `fill`, axis `stroke` and `grid`), so CSS variables must be read with `getComputedStyle` and the chart re-created or redrawn when the theme changes — [uPlot README](https://github.com/leeoniya/uPlot#readme). The point about options is an inference from the API; see Gaps.

**Accessibility**
- ECharts: the `aria` component auto-generates a chart description from title, series and data, and adds decal patterns as a "secondary representation of color". It is "turned off by default", and since v5 `AriaComponent` must be imported explicitly. Auto descriptions get too long on dense charts — [ECharts ARIA handbook](https://echarts.apache.org/handbook/en/best-practices/aria/)
- Recharts 3.x reportedly turns `accessibilityLayer` on by default: keyboard tab-in and arrow-key navigation on cartesian and polar charts. This is confirmed only via a release mirror and secondary sources, not the official changelog — [newreleases.io recharts 3.0.0](https://newreleases.io/project/npm/recharts/release/3.0.0), [recharts discussion #4484](https://github.com/recharts/recharts/discussions/4484)
- uPlot's README does not mention accessibility at all — [uPlot README](https://github.com/leeoniya/uPlot#readme)

### Inferences
- **Fit to our data.** One hour at 1 Hz is 3,600 points per series. That is exactly uPlot's published streaming scenario, at 1/60 of the update rate (1 Hz, not 60 fps). Even with tens of series on a Servers page, CPU should be negligible for uPlot. Recharts and visx re-render SVG through React every second, which is fine for a few charts but scales worse. That is an inference from SVG and React architecture; no benchmark was found.
- **Library-by-library.** Recharts costs about 113 KB gzip for a line chart and is React-idiomatic, but SVG-based. Observable Plot rebuilds a whole SVG per `plot()` call. It pulls in all of d3 (95 KB gzip), has had no npm release since Feb 2025, and is aimed at exploratory or static charts. Inference: it is poorly suited to 1 Hz updates. visx primitives are tiny (17 KB) but leave axes, tooltips and the cursor to us. Chart.js (57 KB) is a credible second choice, with OffscreenCanvas worker rendering.
- **Sparklines.** A KPI sparkline is about 120 px wide, so 3,600 points cannot all be shown. Downsample to about 2 points per pixel (min/max per bucket) and keep the SVG `Sparkline`. It costs 0 KB, is themable with CSS variables, and can carry `role="img"` plus `aria-label` with the current value and trend. Alternatively, reuse uPlot with `axes: [{show:false},{show:false}]`, `cursor: {show:false}`, `legend: {show:false}` to keep one rendering path.
- **Data path.** Avoid `[...p.slice(1), x]`, which copies 3,600 elements per tick per series. Keep a columnar ring buffer (`Float64Array` timestamps and values) outside React state. On each SSE or WebSocket tick, call `u.setData([ts, v1, v2…])`. Subscribe with `useSyncExternalStore`, or let a ref-driven effect drive uPlot directly, so React does not re-render the page each second.
- **Consumer lag.** Show `num_pending` and `num_ack_pending` per consumer as a small uPlot area chart, using the same 1 Hz ring buffer. A step path (`uPlot.paths.stepped`) suits counters better than splines, which uPlot discourages.
- **Accessibility gap.** Since uPlot is a bare canvas, pair each chart with a visually hidden summary ("Messages in: 12.4k/s, up 8% over 1h") and a "view as table" toggle.

uPlot React wrapper sketch (no third-party wrapper; about 40 lines):
```tsx
import uPlot from "uplot"; import "uplot/dist/uPlot.min.css";
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function TimeSeries({ store, series, height = 160, label }: {
  store: RingStore;               // columnar ring buffer, emits on each 1 Hz tick
  series: { label: string; colorVar: string }[]; height?: number; label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opts: uPlot.Options = {
      width: el.current!.clientWidth, height,
      series: [{}, ...series.map(s => ({ label: s.label, stroke: css(s.colorVar), width: 1.5,
                                         fill: css(s.colorVar) + "22" }))],
      axes: [{ stroke: css("--color-faint"), grid: { stroke: css("--color-line-soft") } },
             { stroke: css("--color-faint"), grid: { stroke: css("--color-line-soft") }, size: 48 }],
      scales: { x: { time: true } }, legend: { show: false },
    };
    const u = new uPlot(opts, store.snapshot(), el.current!);
    const off = store.subscribe(() => u.setData(store.snapshot()));          // 1 Hz
    const ro = new ResizeObserver(([e]) => u.setSize({ width: e.contentRect.width, height }));
    ro.observe(el.current!);
    const mq = matchMedia("(prefers-color-scheme: dark)");                   // or app theme event
    return () => { off(); ro.disconnect(); u.destroy(); };
  }, [store, series, height]);
  return <div ref={el} role="img" aria-label={label} />;
}

// Ring buffer: 3600 slots, Float64Array per column; snapshot() returns subarray views in time order
// (copy into a reusable array only when the buffer wraps).
```

### Gaps
- There is no independent (non-uPlot-author) 2025 or 2026 benchmark comparing ECharts 6, Chart.js 4.6, Recharts 3 and uPlot on streaming. The uPlot table is dated 2023-03 and uses older versions. Commits from late October 2026 rework the benchmarks, but no new published table was found.
- uPlot theming and ARIA are not documented in the README. The colour-option approach above comes from API knowledge and was not verified against docs in this pass.
- Chart.js accessibility (canvas fallback content) was not fetched; its Accessibility page is linked from the Performance page.
- The Recharts 3 `accessibilityLayer` default was not verified against the official changelog or source.

---

## Q2. Payload editor: CodeMirror 6 vs Monaco

### Takeaway
Use **CodeMirror 6**: about 115 KB gzip for a JSON editor with lint, fold, history and a placeholder highlighter. It supports mobile and screen readers, and `MatchDecorator` highlights `{{…}}` placeholders in a few lines. Monaco, even trimmed to JSON, costs about 1.06 MB gzip of main-thread JS plus CSS, font and two workers. Its own FAQ says it is not supported in mobile browsers.

### Cited Findings
- **Versions.** `@codemirror/view` 6.43.15 (2026-10-19), `@codemirror/state` 6.7.6 (2026-09-22), `@codemirror/lang-json` 6.0.2, `@codemirror/lint` 6.9.7 (2026-06-09), meta-package `codemirror` 6.0.2 — [npm @codemirror/view](https://registry.npmjs.org/@codemirror/view), [npm @codemirror/lint](https://registry.npmjs.org/@codemirror/lint), [npm @codemirror/lang-json](https://registry.npmjs.org/@codemirror/lang-json). `monaco-editor` 0.57.0 (2026-09-24), whose dependencies include `marked` and `dompurify`. `@monaco-editor/react` 4.7.0 (2025-02-13) — [npm monaco-editor](https://registry.npmjs.org/monaco-editor), [npm @monaco-editor/react](https://registry.npmjs.org/@monaco-editor/react)
- **CodeMirror hosting has moved.** The GitHub repos `codemirror/view` and `codemirror/dev` were archived on 2026-04-15. The npm `repository` field now points to `code.haverbeke.berlin/codemirror/view.git`, and npm releases continue (6.43.15 on 2026-10-19). Issue trackers and PR links for CodeMirror are now off GitHub — [GitHub API codemirror/dev](https://api.github.com/repos/codemirror/dev), [npm @codemirror/view latest](https://registry.npmjs.org/@codemirror/view/latest)
- **Bundle sizes**, measured locally:
  - CodeMirror minimal JSON editor (lineNumbers, history, foldGutter, bracketMatching, highlightActiveLine, default highlight style, keymaps, `json()`, `linter(jsonParseLinter())`, `lintGutter`, `MatchDecorator`): **352 KB min / 115 KB gzip**.
  - `codemirror` `basicSetup` plus `json()`: 418 KB min / 137 KB gzip.
  - bundlephobia lists the `codemirror` package at 373 KB / 119 KB gzip — [bundlephobia codemirror](https://bundlephobia.com/package/codemirror@6.0.2)
  - Monaco 0.57.0 `editor.api.js` plus the JSON contribution only: **4.05 MB min / 1.06 MB gzip JS**, 175 KB min (27 KB gzip) CSS and a 153 KB codicon TTF (75 KB gzip). On top of that come the `editor.worker` at 310 KB min (96 KB gzip) and the `json.worker` at 441 KB min (134 KB gzip).
  - Full `monaco-editor` entry: 4.55 MB min / 1.18 MB gzip.
  - bundlephobia reports Monaco as 195 KB / 28 KB gzip — [bundlephobia monaco-editor](https://bundlephobia.com/package/monaco-editor@0.57.0). This is clearly wrong: it measures only the entry stub, contradicted by the local bundle.
- **Mobile.** Monaco's FAQ asks "Is the editor supported in mobile browsers or mobile web app frameworks?" and answers "No." Its AMD build "is deprecated and will be removed", ESM is the supported path, and language services run in web workers, which cannot be created from `file://` — [microsoft/monaco-editor README](https://github.com/microsoft/monaco-editor). CodeMirror lists "Mobile Support: Use the platform's native selection and editing features on phones" and "Accessibility: Works well with screen readers and keyboard-only users" — [codemirror.net](https://codemirror.net/)
- **Large documents.** CodeMirror claims it "Remains responsive even on huge documents and long lines" — [codemirror.net](https://codemirror.net/). Its demo "loads a document of a few million lines". The parser "limits the amount of work it does to avoid wasting too much battery and memory", so highlighting can lag far down an inactive editor — [CodeMirror huge-document example](https://codemirror.net/examples/million/)
- **Placeholder highlighting.** CodeMirror's decoration guide uses `MatchDecorator`, "a helper class that can be used to quickly set up view plugins that decorate all matches", with regexp `/\[\[(\w+)\]\]/g` turning `[[name]]` into atomic widgets. Matching happens in the viewport only — [CodeMirror decoration example](https://codemirror.net/examples/decoration/)
- **Linting and JSON Schema.** `@codemirror/lang-json` provides `jsonParseLinter` (used in the measured bundle). `@codemirror/lint` provides `linter` and `lintGutter` — [npm @codemirror/lint](https://registry.npmjs.org/@codemirror/lint). Third-party `codemirror-json-schema` 0.8.1 (2025-04-21, stale for 18 months) adds schema validation and completion. Its dependencies include `json-schema-library` and `@shikijs/markdown-it` — [npm codemirror-json-schema](https://registry.npmjs.org/codemirror-json-schema)
- **React wrapper.** `@uiw/react-codemirror` 4.25.12 (2026-09-24) bundles `@codemirror/theme-one-dark` and a basic-setup package — [npm @uiw/react-codemirror](https://registry.npmjs.org/@uiw/react-codemirror)
- **natscli template syntax.** The help text reads "Body and Header values of the messages may use Go templates to create unique messages". Examples are `"Message {{Count}} @ {{Time}}"` and `"{{ Random 10 100 }}"`, with spaces allowed inside the braces. The functions are `Count`, `TimeStamp`, `Unix`, `UnixNano`, `Time`, `ID` and `Random(min, max)` — [natscli cli/pub_command.go (commit 7a43b35)](https://github.com/nats-io/natscli/blob/7a43b35fa891a02196527373572e54658d94553e/cli/pub_command.go#L70-L87)
- **Conflict inside natscli.** The same file's `--templates` flag says it "Enables template functions in the body and subject (does not affect headers)", which contradicts the help text above — [natscli pub_command.go L113](https://github.com/nats-io/natscli/blob/7a43b35fa891a02196527373572e54658d94553e/cli/pub_command.go#L113). The glossary's Placeholder term allows headers, so "copy as nats command" may not reproduce header placeholders.

### Inferences
- **Size.** Monaco's JSON-only cost (about 1.06 MB gzip JS plus about 330 KB of workers, CSS and font) is about 15× the whole React runtime. Its schema support (via the bundled `json.worker`) is not worth that for a payload box. CodeMirror is the clear fit, especially since nats-ui is embedded in a Go binary and may be used from a phone on an ops call.
- **Regex.** Placeholders are Go-template actions, so the regex must allow inner spaces and arguments: `/\{\{\s*([A-Za-z]+)(?:\s+[^}]*)?\s*\}\}/g`. Decorate known names with `cm-ph`, a mark that keeps the text editable. Decorate unknown names with `cm-ph-bad` and also report them as a lint diagnostic, matching the prototype's "refuse to send" rule. Use `Decoration.mark`, not `Decoration.replace` widgets, so users can still edit the token text.
- **JSON validity with placeholders.** `{"n": {{Count}}}` is invalid JSON until substituted. Do not use `jsonParseLinter` directly. Write a custom linter that replaces each placeholder with a same-length, type-plausible stand-in, then parses and maps error positions back. Stand-ins: digits for `Count`, `Unix` and `UnixNano`; a quoted string body for the others. Because the length is the same, offsets match one-to-one. Inference: a bare `{{ID}}` outside quotes would yield invalid JSON at send time too, which should be flagged.
- **Payload size.** The editor will rarely hold multi-MB payloads, since the default `max_payload` is 1 MB (per ADR-0003). CodeMirror renders only the viewport, but the Lezer parse and the lint `JSON.parse` both scale with document size. Debounce lint (`delay: 300`), and skip linting above about 1 MB with a "validate" button.

CodeMirror sketch:
```ts
import { EditorView, Decoration, MatchDecorator, ViewPlugin, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle, foldGutter, bracketMatching } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const KNOWN = new Set(["Count", "ID", "TimeStamp", "Unix", "UnixNano", "Time", "Random"]);
const PH = /\{\{\s*([A-Za-z]+)(?:\s+[^}]*)?\s*\}\}/g;

const phMatcher = new MatchDecorator({
  regexp: PH,
  decoration: m => Decoration.mark({ class: KNOWN.has(m[1]) ? "cm-ph" : "cm-ph-bad" }),
});
const placeholders = ViewPlugin.fromClass(class {
  decorations; constructor(v: EditorView) { this.decorations = phMatcher.createDeco(v); }
  update(u: any) { this.decorations = phMatcher.updateDeco(u, this.decorations); }
}, { decorations: v => v.decorations });

const stand = (name: string, len: number) =>             // same length keeps offsets aligned
  ["Count", "Unix", "UnixNano"].includes(name) ? "1".repeat(len) : `"${"x".repeat(Math.max(0, len - 2))}"`;

const jsonWithPlaceholders = linter(view => {
  const src = view.state.doc.toString(); const out: Diagnostic[] = [];
  const sub = src.replace(PH, (m, n, off) => {
    if (!KNOWN.has(n)) out.push({ from: off, to: off + m.length, severity: "error", message: `Unknown placeholder {{${n}}}` });
    return stand(n, m.length);
  });
  if (sub.trim() && /^\s*[\[{"]/.test(sub)) try { JSON.parse(sub); } catch (e) {
    const pos = Number(/position (\d+)/.exec(String(e))?.[1] ?? 0);   // V8 message format
    out.push({ from: pos, to: Math.min(pos + 1, src.length), severity: "error", message: String((e as Error).message) });
  }
  return out;
}, { delay: 300 });

const darkTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--color-fg)", fontSize: "12.5px" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--color-faint)", border: "none" },
  ".cm-ph": { color: "var(--color-accent)", backgroundColor: "color-mix(in srgb, var(--color-accent) 15%, transparent)", borderRadius: "3px" },
  ".cm-ph-bad": { textDecoration: "wavy underline var(--color-bad)" },
}, { dark: true });

export const payloadExtensions = [lineNumbers(), history(), foldGutter(), bracketMatching(), json(),
  syntaxHighlighting(HighlightStyle.define([{ tag: t.propertyName, color: "var(--color-accent)" },
    { tag: t.string, color: "var(--color-ok)" }, { tag: t.number, color: "var(--color-info)" },
    { tag: [t.bool, t.null], color: "var(--color-warn)" }])),
  placeholders, jsonWithPlaceholders, lintGutter(), darkTheme,
  keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping];
```
The CodeMirror read-only text view (`EditorState.readOnly.of(true)`, `json()`) can also serve as the "text" mode of the payload viewer. It gives virtualised rendering of multi-MB text for free.

### Gaps
- No primary benchmark was found comparing CodeMirror 6 and Monaco on a 4 MB single-line JSON, which is the common minified case. CodeMirror's "long lines" claim is qualitative. Recommend measuring in the prototype.
- Monaco's JSON Schema API (`json.jsonDefaults.setDiagnosticsOptions`) and its large-file limits were not verified in this pass.
- `codemirror-json-schema` maintenance (last release April 2025) and its compatibility with `@codemirror/*` 6.4x is unverified.
- Which natscli behaviour on header templates is correct (help text vs flag description) needs a test against the CLI.

---

## Q3. JSON tree for payloads up to 4 MB: libraries vs a custom virtualised tree; parsing off the main thread

### Takeaway
None of the React JSON viewers checked documents virtualisation. A 4 MB JSON can contain about 364k nodes (measured), so build a **custom flattened tree virtualised with `@tanstack/react-virtual`** (10.6 KB gzip). Parsing is not the bottleneck: `JSON.parse` of 4 MB took about 19 ms. Moving the parsed object graph from a worker back to the main thread is the bottleneck: `structuredClone` of the graph took about 45 ms, 2.4× the parse. So either parse on the main thread, chunked behind `requestIdleCallback`, or keep the tree inside a worker and send only visible rows. Show the first 64 KB chunk as raw, highlighted text, because it is usually truncated JSON.

### Cited Findings
- **react-json-view-lite 2.5.0** (2025-09-06; no dependencies; 7.7 KB min / 2.6 KB gzip measured; bundlephobia 6.6 / 2.2 KB). The README says it "focused on the balance between performance for large JSON inputs and functionality". v2 "provides better a11y support, collapsing/expanding and navigation through nested elements using arrow keys", following the WAI-ARIA APG treeview pattern. It ships `darkStyles` and `shouldExpandNode`. The README does not mention virtualisation — [npm react-json-view-lite](https://registry.npmjs.org/react-json-view-lite), [GitHub AnyRoad/react-json-view-lite](https://github.com/AnyRoad/react-json-view-lite), [bundlephobia](https://bundlephobia.com/package/react-json-view-lite@2.5.0)
- **@uiw/react-json-view 2.0.0-alpha.44** (2026-10-06; v2 still alpha; zero dependencies; 36.9 KB min / 10.1 KB gzip measured, with the dark theme). It offers themes including dark mode, clipboard, editing, and `collapsed` / `shouldExpandNodeInitially`. The README does not mention virtualisation or ARIA — [npm @uiw/react-json-view](https://registry.npmjs.org/@uiw/react-json-view), [GitHub uiwjs/react-json-view](https://api.github.com/repos/uiwjs/react-json-view)
- **Other options.** `@textea/json-viewer` 4.0.1 has had no release since 2024-12-15 and depends on `zustand` — [npm @textea/json-viewer](https://registry.npmjs.org/@textea/json-viewer). `json-edit-react` 2.0.5 (2026-10-23; 21.5 KB gzip per [bundlephobia](https://bundlephobia.com/package/json-edit-react@2.0.5)) is an editor with JSON Schema validation through a third-party library — [npm json-edit-react](https://registry.npmjs.org/json-edit-react)
- **Virtualisers.** `@tanstack/react-virtual` 3.14.24 (2026-10-29; 34.9 KB min / 10.6 KB gzip measured), `react-window` 2.5.2 (2026-10-30) and `react-virtuoso` 4.18.20 (2026-10-29) are all actively released — [npm @tanstack/react-virtual](https://registry.npmjs.org/@tanstack/react-virtual), [npm react-window](https://registry.npmjs.org/react-window), [npm react-virtuoso](https://registry.npmjs.org/react-virtuoso)
- **JSON.parse is the fast path.** V8: "`JSON.parse('…')` is much faster to parse, compile, and execute compared to an equivalent JavaScript literal — not just in V8 (1.7× as fast), but in all major JavaScript engines" — [V8 blog, The cost of JavaScript in 2019](https://v8.dev/blog/cost-of-javascript-2019)
- **Transfer vs clone.** For an `ArrayBuffer`, "the memory resource that it points to is literally moved between contexts in a fast and efficient zero-copy operation"; after transfer the original is detached (`byteLength` 0). By default `postMessage` and `structuredClone` copy — [MDN Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects). Parsed JS objects are not transferable, so a parsed tree posted from a worker is always structured-cloned (same source).
- **Streaming parser.** `@streamparser/json` 0.0.26 (2026-08-21; zero dependencies; 6.2 KB gzip per [bundlephobia](https://bundlephobia.com/package/@streamparser/json@0.0.26)) provides a `Tokenizer` and `TokenParser`. Options include `paths` (emit only selected sub-paths), `keepStack`, a `separator` for NDJSON and `emitPartialTokens` ("whether to emit tokens mid-parsing"). It warns that large strings cause "many string concatenations", which can exhaust memory unless `stringBufferSize` is set — [npm @streamparser/json](https://registry.npmjs.org/@streamparser/json). `clarinet` (last release 2023) and `oboe` (2024) are stale — [npm clarinet](https://registry.npmjs.org/clarinet), [npm oboe](https://registry.npmjs.org/oboe)
- **Local micro-benchmark** (Node 26.13 / V8, i9-11900F; a 4,194,374-byte JSON array of 21,421 order-like objects, giving 364,158 nodes; mean of 5 runs after warm-up):
  - `TextDecoder('utf-8', {fatal:true}).decode`: 0.7 ms
  - `JSON.parse`: **18.7 ms**
  - `structuredClone(parsed)`: **44.9 ms**
  - `structuredClone(Uint8Array 4 MB)`: 0.6 ms
  - full recursive walk: 12.5 ms
  - hex-formatting 64 KB (4,096 rows): 1.3 ms

  Measured locally; method in the header. Browsers on slower laptops or phones will be several times slower; not measured.

### Inferences
- **Libraries.** react-json-view-lite is the best off-the-shelf choice for small payloads: 2.6 KB, ARIA treeview, dark styles. It renders every expanded node into the DOM, though. With `shouldExpandNode` limited to depth 1–2, the initial DOM stays small, but "expand all" on a 20k-element array would create hundreds of thousands of DOM nodes. A custom virtualised tree is needed for the 4 MB case. One component for all sizes is simpler than switching libraries, so prefer custom throughout. Reuse the prototype's colours and the ARIA treeview roles from the APG pattern.
- **Where to parse.** Up to about 4 MB on desktop, parsing on the main thread (about 20 ms) is acceptable and avoids the 45 ms clone. For low-end devices, or when the UI must not jank, use a "tree lives in the worker" design. The worker owns the parsed value and an expanded-path set. The main thread asks for `rows(start, count)` and gets back small arrays of `{depth, key, preview, type, hasChildren, path}`. Each request clones only about 50 rows. This also keeps memory for one large message in one place.
- **Progressive load (ADR-0003).** The first 64 KB of a 4 MB JSON is almost always invalid, truncated JSON. Show it in text mode, using a CodeMirror read-only view with `json()` highlighting, which tolerates errors. Label it "showing first 64 KB of 4.0 MB, Load full". Once the full bytes arrive, auto-switch to the tree. `@streamparser/json` with `emitPartialTokens` could build a partial tree from 64 KB, but that adds complexity for little value, and its string-concatenation caveat argues against it for multi-MB strings.
- **Fetching.** Fetch the payload as binary (`res.arrayBuffer()`, or `res.body.getReader()` for a progress bar). Transfer the `ArrayBuffer` to the worker zero-copy, then decode and parse there.

Flattened virtual tree sketch (main-thread variant):
```tsx
type Row = { id: string; depth: number; key: string | null; v: unknown; kind: "obj" | "arr" | "leaf"; size: number };
function flatten(v: unknown, open: Set<string>, rows: Row[] = [], path = "$", depth = 0, key: string | null = null) {
  const kind = Array.isArray(v) ? "arr" : v && typeof v === "object" ? "obj" : "leaf";
  const entries = kind === "leaf" ? [] : kind === "arr" ? (v as unknown[]).map((x, i) => [String(i), x] as const) : Object.entries(v as object);
  rows.push({ id: path, depth, key, v, kind, size: entries.length });
  if (kind !== "leaf" && open.has(path)) for (const [k, x] of entries) flatten(x, open, rows, `${path}/${k}`, depth + 1, kind === "arr" ? null : k);
  return rows;   // only expanded subtrees are visited: cost ∝ visible-if-scrolled rows, not total nodes
}

export function JsonTreeView({ value }: { value: unknown }) {
  const [open, setOpen] = useState(() => new Set(["$"]));
  const rows = useMemo(() => flatten(value, open), [value, open]);
  const parent = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 18, overscan: 20 });
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div ref={parent} role="tree" className="overflow-auto font-mono text-[12px]" style={{ maxHeight: 480 }}>
      <div style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map(it => { const r = rows[it.index]; return (
          <div key={r.id} role="treeitem" aria-level={r.depth + 1} aria-expanded={r.kind === "leaf" ? undefined : open.has(r.id)}
               style={{ position: "absolute", top: 0, transform: `translateY(${it.start}px)`, paddingLeft: r.depth * 16, height: 18 }}
               onClick={() => r.kind !== "leaf" && toggle(r.id)}>
            {r.key !== null && <span className="text-accent">"{r.key}"</span>}{r.key !== null && <span className="text-faint">: </span>}
            {r.kind === "leaf" ? <Leaf v={r.v} /> : <span className="text-faint">{r.kind === "arr" ? "[" : "{"} {open.has(r.id) ? "" : `… ${r.size} ${r.kind === "arr" ? "]" : "}"}`}</span>}
          </div>); })}
      </div>
    </div>
  );
}
```
For 100k+ children under a single opened array, cap expansion at about 1,000 children per page, with a "show next 1,000" row. That keeps `flatten` cheap and matches how the message table already pages.

Worker variant sketch (tree stays in the worker):
```ts
// payload.worker.ts
let root: unknown; const open = new Set<string>(["$"]);
self.onmessage = ({ data }) => {
  if (data.type === "load") { root = JSON.parse(new TextDecoder().decode(data.buf)); postMessage({ type: "count", n: flatten(root, open).length }); }
  if (data.type === "toggle") { open.has(data.id) ? open.delete(data.id) : open.add(data.id); postMessage({ type: "count", n: flatten(root, open).length }); }
  if (data.type === "rows") postMessage({ type: "rows", start: data.start, rows: flatten(root, open).slice(data.start, data.start + data.count)
                                          .map(r => ({ ...r, v: r.kind === "leaf" ? r.v : undefined })) }); // never clone subtrees
};
// main: worker.postMessage({ type: "load", buf }, [buf]);   // zero-copy transfer
// (cache the flattened array in the worker between "rows" calls; recompute only on toggle/load)
```

### Gaps
- The micro-benchmark used Node/V8 on a desktop CPU. No browser or mobile measurements were made, and Firefox (SpiderMonkey) and Safari (JSC) parse and clone costs were not measured.
- No published benchmark of react-json-view-lite or @uiw/react-json-view on multi-MB inputs was found. Their "large JSON" behaviour is undocumented beyond the qualitative README line.
- Worker message latency and the cost of very large strings (a single 4 MB string value) in a virtualised row were not measured. Long leaf strings need truncation with "show full" in the row.

---

## Q4. Hex view for binary payloads

### Takeaway
Build a simple custom virtualised hex view: 16 bytes per row, about 60 lines of code, reusing `@tanstack/react-virtual`. The one ready-made React option, `react-hex-editor`, was last released in 2020 and pulls in an older `react-window` stack. Formatting is cheap: 64 KB, or 4,096 rows, takes about 1.3 ms. Virtualised, only about 40 rows are formatted per frame.

### Cited Findings
- `react-hex-editor` 0.3.0: last release 2020-07-16, package modified 2022-05-14. Dependencies are `react-window`, `react-virtualized-auto-sizer`, `keycode-js` and `keycoder`. The README notes `highlightColumn` "can lead to degraded performance when there are a lot of rows visible". It offers themes such as `oneDarkPro` via a styled-components peer dependency, and accepts `Uint8Array` — [npm react-hex-editor](https://registry.npmjs.org/react-hex-editor), [GitHub kmck/react-hex-editor](https://github.com/kmck/react-hex-editor)
- Hex-formatting 64 KB took 1.3 ms. Measured locally; method in the header.
- `TextDecoder` with `fatal: true` throws on invalid UTF-8. That allows a cheap "is this text?" check, which took 0.7 ms on 4 MB here — [MDN TextDecoder.fatal](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/fatal)

### Inferences
- The prototype's `hexDump` builds the whole dump as one string. For 4 MB that is 262,144 rows of about 70 chars, roughly 18 MB of UTF-16 string, rendered in one `<pre>`. Virtualising by row index means each row is formatted from the `Uint8Array` on demand, with nothing precomputed.
- Show three columns: offset, hex and ASCII (`.` for non-printables). Selecting bytes highlights both panes. Copying as hex or base64 works on the selected byte range.
- With progressive loading, the virtualiser count is `ceil(loadedBytes/16)`. When the full payload arrives, swap in the full buffer and keep the scroll offset.

```tsx
const H = "0123456789abcdef";
function HexView({ bytes }: { bytes: Uint8Array }) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: Math.ceil(bytes.length / 16), getScrollElement: () => ref.current, estimateSize: () => 18, overscan: 30 });
  return <div ref={ref} className="overflow-auto font-mono text-[12px]" style={{ maxHeight: 480 }}>
    <div style={{ height: v.getTotalSize(), position: "relative" }}>
      {v.getVirtualItems().map(it => { const o = it.index * 16, row = bytes.subarray(o, o + 16);
        let hex = "", asc = ""; for (let j = 0; j < 16; j++) { if (j < row.length) { const b = row[j]; hex += H[b >> 4] + H[b & 15] + (j === 7 ? "  " : " "); asc += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."; } else hex += "   "; }
        return <div key={it.index} style={{ position: "absolute", top: 0, transform: `translateY(${it.start}px)` }}>
          <span className="text-faint">{o.toString(16).padStart(8, "0")}</span>  {hex} <span className="text-muted">{asc}</span></div>; })}
    </div></div>;
}
```

### Gaps
- No actively maintained (2025–2026) React hex viewer was found. Searching beyond npm, for example for WASM-based hex viewers, was not done.

---

## Q5. Decoding headers and payload kind: browser or backend?

### Takeaway
Let the Go backend do what it already gets for free. nats.go parses headers into a map, so send headers as JSON along with `Nats-Msg-Size`. Ship the payload as **raw bytes** (`application/octet-stream` over HTTP, or a binary WebSocket frame), never base64 inside JSON. Detect the payload kind in the browser from the bytes it already has: the first 64 KB chunk, via `TextDecoder({fatal:true})` plus a first-non-whitespace-byte check, then `JSON.parse` on demand. Both sides are cheap. The real costs are bytes on the wire and main-thread cloning, not the CPU spent detecting the kind.

### Cited Findings
- **Header wire format.** Headers are `NATS/1.0␍␊` followed by `Name: value␍␊` lines and a blank line. "entries that have more than one value should be serialized one per line". Names are case-preserving, and "All operations are case-sensitive". `HMSG` carries `HDR_LEN` and `TOT_LEN` — [ADR-4 NATS Message Headers](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-4.md)
- **Listing.** The listing path is a `headers_only` consumer that delivers headers plus `Nats-Msg-Size` and no payload. Full payloads come from a Direct Get when a message is opened — [ADR-0003 (local), citing nats-server consumer.go L5774-L5790](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L5774-L5790)
- **Base64.** Base64 encodes each 3 bytes as 4 characters, a 33% size overhead — [RFC 4648 §4](https://www.rfc-editor.org/rfc/rfc4648#section-4)
- **Local measurements** (V8, desktop): UTF-8 validation and decoding of 4 MB with `TextDecoder` fatal took 0.7 ms; base64-encoding 4 MB took 1.3 ms. Moving a 4 MB `Uint8Array` across a structured-clone boundary took 0.6 ms (copy), or zero-copy with transfer — [MDN Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects). Measurements were local; method in the header.

### Inferences
- **Headers belong on the backend.** The Go client already has them as a map; the `nats.Header` type in nats.go is not verified here, see Gaps. Serialising that map to JSON is trivial and avoids writing an ADR-4 parser in TypeScript. Status headers (`NATS/1.0 503`, `Nats-Msg-Size`) can be normalised server-side into typed fields.
- **Kind detection is better in the browser** for opened messages. The browser needs the bytes anyway, and the detection is under 1 ms. For the table listing there is no payload (headers_only), so no kind is known. Per ADR-0003, "payload previews exist only for small messages", so the backend could add a `kind` hint only when it already holds the bytes: the Live tail buffer and small Direct Gets. Go's `utf8.Valid` and `json.Valid` are single-pass and cheap ([pkg.go.dev unicode/utf8.Valid](https://pkg.go.dev/unicode/utf8#Valid), [pkg.go.dev encoding/json.Valid](https://pkg.go.dev/encoding/json#Valid)). Doing it for every Live tail row at high rates still costs backend CPU per message for something only shown when viewed. Compute it lazily, or on the first N bytes.
- **Content-type hints.** Respect a `Content-Type` header, or a common `Nats-*` convention such as a schema subject, before guessing. Order: header hint, then a first-byte sniff (`{` or `[` after whitespace means try JSON; `\x1f\x8b` means gzip; a valid UTF-8 decode means text; otherwise hex), then the user's override (the prototype's Auto/Text/Hex toggle).
- **Progressive chunk boundary.** The first 64 KB may cut a multi-byte UTF-8 character. Decode with `TextDecoder.decode(chunk, {stream:true})` for the preview, and don't apply `fatal` to the truncated tail — [MDN TextDecoder.decode](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode).

Endpoint shape sketch:
```
GET /api/streams/{s}/msgs/{seq}            -> JSON { seq, subject, time, headers: {k:[v…]}, size, status? }
GET /api/streams/{s}/msgs/{seq}/payload    -> application/octet-stream; supports Range: bytes=0-65535
```
```ts
const head = await fetch(`${u}/payload`, { headers: { Range: "bytes=0-65535" } }).then(r => r.arrayBuffer());
const kind = sniff(new Uint8Array(head));        // "json" | "text" | "binary"
// later, "Load full":  const full = await fetch(`${u}/payload`).then(r => r.arrayBuffer()); worker.postMessage({type:"load", buf: full}, [full]);
function sniff(b: Uint8Array) {
  let i = 0; while (i < b.length && (b[i] === 0x20 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x09)) i++;
  try { new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(0, Math.max(0, b.length - 3))); } catch { return "binary"; }
  return b[i] === 0x7b || b[i] === 0x5b ? "json" : "text";   // confirm with JSON.parse once full
}
```
Inference: the Direct Get returns the full payload to the Go backend regardless. The 64 KB first step therefore saves browser transfer and render time, not NATS transfer, which matches ADR-0003's rationale.

### Gaps
- The `nats.go` `Header` type and its Direct Get return types were not fetched in this pass, so the claim that headers arrive pre-parsed rests on the ADR-4 format plus general knowledge of the client.
- No browser measurement of `fetch` plus `arrayBuffer` throughput over the embedded Go server was made.
- Whether the backend should support HTTP `Range` on the payload endpoint, or a `?limit=65536` query, is a design choice not covered by any source.
