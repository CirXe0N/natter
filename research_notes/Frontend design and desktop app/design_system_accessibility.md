# Turning the nats-ui prototype look into a production design system: tokens, theming, density, accessibility

Scope: the prototype at `/home/dwayne/Work/nats-ui/prototypes/ui-shell/src/` (`index.css`, `App.tsx`, `overview.tsx`, `kit.tsx`). As of 31 October 2026. Contrast numbers were computed in this session (method in the Colour section). Facts about Omarchy come from the Omarchy 4.5.0rc2 install on the user's machine (`pacman -Qs omarchy` gives `omarchy 4.5.0rc2-1`) and from the basecamp/omarchy repo.

## 1. Tailwind v4 theming: @theme vs CSS variables, a dark-first semantic token architecture, class vs prefers-color-scheme, and the shadcn/ui token mapping

### Takeaway
Use three layers. Raw OKLCH ramps go in plain CSS variables. Semantic tokens go in `:root` and are overridden under a `[data-theme]` selector. A single `@theme inline` block maps the semantic tokens onto Tailwind utilities, which is exactly shadcn's pattern. Toggle with `@custom-variant dark` on a data attribute, and default to "system" through `prefers-color-scheme`. The prototype's own names `muted` and `accent` clash with shadcn's names for different things, so rename before adopting shadcn components.

### Cited Findings
- Theme variables "instruct Tailwind to create new utility classes"; "Use `@theme` when you want a design token to map directly to a utility class, and use `:root` for defining regular CSS variables that shouldn't have corresponding utility classes." — [Tailwind: Theme variables](https://tailwindcss.com/docs/theme)
- Theme variables "are also required to be defined top-level and not nested under other selectors or media queries". So per-theme values cannot go inside `@theme` and must live in ordinary selectors. — [Tailwind: Theme variables](https://tailwindcss.com/docs/theme)
- `@theme inline` is for "theme variables that reference other variables". With it the utility uses the variable's value (`.font-sans { font-family: var(--font-inter); }`). Without it, "your utility classes might resolve to unexpected values because of how variables are resolved in CSS". — [Tailwind: Theme variables](https://tailwindcss.com/docs/theme)
- `@theme static` emits every variable. By default "only used CSS variables will be generated". — [Tailwind: Theme variables](https://tailwindcss.com/docs/theme)
- `--color-*: initial;` removes the whole default palette, so that "only your custom values … will be available". Themes can be shared as a plain imported CSS file or an npm package. — [Tailwind: Theme variables](https://tailwindcss.com/docs/theme)
- The dark variant uses `prefers-color-scheme` by default. Manual toggling uses `@custom-variant dark (&:where(.dark, .dark *));` or `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`. The docs give a light/dark/system script built on `localStorage.theme` and `matchMedia("(prefers-color-scheme: dark)")`, which is "best to add inline in `head` to avoid FOUC". — [Tailwind: Dark mode](https://tailwindcss.com/docs/dark-mode)
- shadcn tokens: `background/foreground`, `card(-foreground)`, `popover(-foreground)`, `primary(-foreground)`, `secondary(-foreground)`, `muted(-foreground)`, `accent(-foreground)`, `destructive`, `border`, `input`, `ring`, `chart-1..5`, `sidebar`, `sidebar-foreground`, `sidebar-primary(-foreground)`, `sidebar-accent(-foreground)`, `sidebar-border`, `sidebar-ring` and `radius`. The base token is the surface and `-foreground` is the text on it. Values are in `oklch()`. "Dark mode works by overriding the same tokens inside a `.dark` selector". The mapping is `@theme inline { --color-background: var(--background); … }` with `@custom-variant dark (&:is(.dark *));`. — [shadcn/ui: Theming](https://ui.shadcn.com/docs/theming)
- In shadcn, **accent** is for "interactive hover, focus, and active surfaces" (ghost buttons, menu highlight, hovered rows, selected items). **muted** is for "subtle surfaces and lower-emphasis content". The default theme defines no `destructive-foreground`. — [shadcn/ui: Theming](https://ui.shadcn.com/docs/theming)
- Primer separates token tiers. **Base** tokens (`color-scale-pink-5`) "don't respect color modes and shouldn't be used directly". **Functional** tokens (`bgColor-default`, `fgColor-default`, `borderColor-{role}-emphasis`, `fgColor-onEmphasis`) reference base tokens and respect colour modes. **Component** tokens (`focus-outlineColor`) are limited. — [Primer: Color overview](https://primer.style/foundations/color/overview)
- Primer React's `colorMode` is `day`, `night` or `auto`, where `auto` is "synced with the operating system". Separate `dayScheme` and `nightScheme` choose, for example, `dark_dimmed` for night. — [Primer React: Theming](https://primer.style/product/getting-started/react/theming/)
- On WebKitGTK, a dark GTK theme can leak into native controls. Setting `color-scheme: dark` on `:root` fixed a light `<select>` popup in a dark app. — [WebKit bug 197947](https://bugs.webkit.org/show_bug.cgi?id=197947); [ant-ui PR #141](https://github.com/WithAutonomi/ant-ui/pull/141)

### What the prototype does today (from reading the source)
- `index.css` puts literal hex values straight into `@theme` (`--color-bg`, `--color-panel`, `--color-raised`, `--color-line`, `--color-line-soft`, `--color-fg`, `--color-muted`, `--color-faint`, `--color-accent`, `--color-accent-dim`, `--color-ok/warn/bad/info`). It keeps Tailwind's full default palette, since there is no `--color-*: initial`.
- It hard-codes colours that are dark-only and would break a light theme: `bg-white/5` (×5), `bg-white/10`, `hover:bg-white/[0.04]`, `bg-black/20`, `bg-black/30` (×2), `bg-black/60`, `text-black` (×2), `border-white/5`, `shadow-black/20`, and a literal `rgb(45 212 191 / 0.14)` in the `flash` keyframes. Counts come from a grep over the three TSX files.
- Usage counts: `text-faint` 29, `text-muted` 23, `text-fg` 20, `text-[11px]` 9, `text-[10px]` 3. Faint is the most-used text colour in the prototype.

### Inferences
- **Recommended structure (dark-first):**
  1. `:root { --teal-1 … --teal-12; --gray-1 … --gray-12; … }` holds raw OKLCH ramps, in the style of Radix and Geist step scales. These do not become utilities.
  2. `:root, [data-theme="dark"] { color-scheme: dark; --background: var(--gray-1); --foreground: var(--gray-12); … }` holds the dark values, which are the default. `[data-theme="light"] { color-scheme: light; … }` overrides them. Optionally add `@media (prefers-color-scheme: light) { :root:not([data-theme]) { … } }` so "system" works without JS.
  3. `@theme inline { --color-background: var(--background); … }` maps them, plus `--color-*: initial` so off-system colours such as `teal-400` cannot creep back in.
  4. `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` handles the few `dark:` overrides. Most components should never need `dark:`, because the tokens flip.
- **Rename to avoid shadcn collisions.** The prototype's `accent` is the brand teal, but shadcn's `accent` is a hover surface. The prototype's `muted` is a text colour, but shadcn's `muted` is a surface and `muted-foreground` is its text. Suggested mapping:

| shadcn token | nats-ui meaning | prototype value today |
|---|---|---|
| `background` / `foreground` | app canvas / primary text | `bg #0b0c0f` / `fg #e7e9ee` |
| `card` / `card-foreground` | panel surface | `panel #111318` / `fg` |
| `popover` / `popover-foreground` | menus, palette, dialogs | `raised #171a21` / `fg` |
| `primary` / `primary-foreground` | brand teal action | `accent #2dd4bf` / near-black (black on teal is 11.28:1) |
| `secondary` / `secondary-foreground` | neutral button | `raised` / `fg` |
| `muted` / `muted-foreground` | subtle surface / secondary text | `panel` or `raised` / prototype `muted #8a92a3` |
| `accent` / `accent-foreground` | hover, selected row | currently `bg-white/5` / `fg` (move into a token) |
| `destructive` | danger | `bad #f87171` (use dark text on it: white on bad is 2.77:1 and fails, black is 7.59:1) |
| `border` / `input` / `ring` | separators / control borders / focus ring | `line #232731` / needs a new stronger token (see section 2) / teal |
| `sidebar-*` | left nav | `panel` and friends |
| `chart-1..5` | sparklines and series | define separately; don't reuse status colours |
| *extra (not in shadcn)* | `success`, `warning`, `info` (each with `-foreground` and `-subtle`), `faint`/tertiary text, `border-subtle`, `readonly` (alias of warning), `overlay`/`scrim`, `inset` | `ok`, `warn`, `info`, `faint`, `line-soft`, `bg-black/30` |

- A light theme then needs only one new selector block with about 30 values, and no component edits once the hard-coded `white/`, `black/` and `rgb()` literals are replaced by tokens (`--hover`, `--scrim`, `--inset`, `--flash`).
- `data-theme` with three states (system, dark, light) is better than a bare `.dark` class. "System" can follow `prefers-color-scheme` live through a `matchMedia` change listener, and an explicit choice still wins.
- How Tailwind compiles opacity modifiers such as `bg-ok/10` against a `var()` (for example via `color-mix()`) was not stated on the pages read. Check the compiled CSS before relying on alpha tints of runtime-swapped variables.

### Gaps
- shadcn's default focus-ring utility recipe (ring width and opacity) was not captured in this session.
- Primer's CSS attributes (`data-color-mode`, `data-light-theme`, `data-dark-theme`) were not on the pages fetched, so they are not cited here.

## 2. Colour: WCAG 2.2 audit of the prototype palette, APCA relevance, OKLCH in Tailwind v4, and fixes for faint text

### Takeaway
`fg`, `muted`, `accent` and every status colour pass WCAG AA (4.5:1) on all three surfaces and on their own 10% tints. **`faint` (#5b6271) fails for text everywhere**: 3.19:1 on bg, 3.04:1 on panel, 2.84:1 on raised and 2.56:1 on the active-nav tint. It is still the most-used text colour, often at 10–11px. Raise faint to about `oklch(61.5% 0.026 266)` = `#7d8595`, which gives 5.00:1 on panel and 4.68:1 on raised. Nudge muted up to `oklch(72% 0.027 265)` = `#9ca5b6` so the hierarchy keeps its steps. Keep the old faint only for disabled or decorative use. Borders and the teal "subtle" outlines are all below 3:1, which is fine for decoration but not for control boundaries or focus. APCA is useful as a design aid, but it is not a standard; WCAG 2.2 AA stays the compliance bar.

### Method
- **WCAG 2.x:** linearise each sRGB channel (c/12.92 if c ≤ 0.04045, else ((c+0.055)/1.055)^2.4), take L = 0.2126R + 0.7152G + 0.0722B, and compute the ratio (L1+0.05)/(L2+0.05). Ratios are not rounded, so 4.499 fails. Normal text needs 4.5:1, large text (≥ 18pt, or ≥ 14pt bold, about 24px or 18.66px) needs 3:1, and placeholder text is *not* exempt while disabled controls are. — [W3C Understanding SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- **Non-text (SC 1.4.11):** 3:1 against adjacent colours for "visual information required to identify user interface components and states". Inactive components are exempt. Focus indicators "must have sufficient contrast". A visible boundary "is only required when there is no other visual way to identify the presence of the control". — [W3C Understanding SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- **Tints:** `bg-X/10` was composited as 10% X over the surface in sRGB before measuring, which is the colour the eye sees.
- **APCA:** an implementation of APCA-W3 0.0.98G-4g (exponents 0.56/0.57 and 0.65/0.62, scale 1.14, black clamp 0.022^1.414, offset 0.027). Negative Lc means light text on dark. The constants were reproduced from the published algorithm ([Myndex/apca-w3](https://github.com/Myndex/apca-w3)); that repo was not re-fetched this session, so treat Lc as ±1. The Bronze thresholds are Lc 90 preferred body, 75 minimum body, 60 minimum content text, 45 headlines and large text, 30 "absolute minimum" for placeholder and disabled text, and 15 non-text. — [APCA in a Nutshell](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html)
- **OKLCH:** converted with Björn Ottosson's OKLab matrices and clamped to sRGB. The prototype hues are low-chroma, so no clipping occurred.

### Token values in OKLCH (computed)
| token | hex | OKLCH | rel. luminance |
|---|---|---|---|
| bg | #0b0c0f | 15.5% 0.007 271 | 0.0037 |
| panel | #111318 | 18.7% 0.011 268 | 0.0065 |
| raised | #171a21 | 21.8% 0.015 267 | 0.0103 |
| line-soft | #1a1d24 | 23.1% 0.014 267 | 0.0123 |
| line | #232731 | 27.3% 0.019 268 | 0.0203 |
| faint | #5b6271 | 49.6% 0.026 266 | 0.1215 |
| muted | #8a92a3 | 65.9% 0.027 265 | 0.2861 |
| fg | #e7e9ee | 93.4% 0.007 269 | 0.8144 |
| accent | #2dd4bf | 78.5% 0.133 182 | 0.5141 |
| accent-dim | #134e4a | 38.6% 0.059 188 | 0.0608 |
| ok | #4ade80 | 80.0% 0.182 152 | 0.5526 |
| warn | #fbbf24 | 83.7% 0.164 84 | 0.5790 |
| bad | #f87171 | 71.1% 0.166 22 | 0.3296 |
| info | #60a5fa | 71.4% 0.143 255 | 0.3630 |

Surfaces step about 3 L units each (15.5 → 18.7 → 21.8). That is a clean, even elevation ramp in a perceptual space.

### Text on surfaces (WCAG ratio / APCA Lc)
| text | on bg | on panel | on raised | WCAG AA (4.5) |
|---|---|---|---|---|
| fg | 16.10 / −93.3 | 15.30 / −92.9 | 14.33 / −92.2 | pass (AAA) |
| muted | 6.26 / −43.2 | 5.95 / −42.8 | 5.57 / −42.1 | pass |
| **faint** | **3.19 / −21.0** | **3.04 / −20.6** | **2.84 / −19.9** | **FAIL** (also below APCA Lc 30, the floor for *any* text) |
| accent | 10.51 / −67.7 | 9.98 / −67.3 | 9.35 / −66.6 | pass |
| ok | 11.22 / −71.2 | 10.66 / −70.8 | 9.99 / −70.1 | pass |
| warn | 11.72 / −73.5 | 11.13 / −73.1 | 10.43 / −72.4 | pass |
| bad | 7.07 / −48.9 | 6.72 / −48.4 | 6.29 / −47.8 | pass |
| info | 7.69 / −52.1 | 7.31 / −51.7 | 6.85 / −51.0 | pass |

### Status badges (text on its own 10% tint: `bg-X/10 text-X`, as in kit.tsx Badge)
| badge | over panel | over bg | over raised |
|---|---|---|---|
| ok | 8.90 (tint #172722) | 9.59 | 8.21 |
| warn (Read-only) | 9.24 (tint #282419) | 9.95 | 8.52 |
| bad | 5.92 (tint #281c21) | 6.33 | 5.49 |
| info | 6.33 (tint #19222f) | 6.79 | 5.85 |
| accent | 8.41 (tint #142629) | 9.04 | 7.75 |

All pass AA. `bad` and `info` sit closest to the line at about 5.5–6.3:1. The Read-only amber badge is robust at 8.5–10:1.

### Other pairs
- Active nav item (`bg-accent/10` over panel): fg 12.88:1, accent icon 8.41:1, **faint 2.56:1 (fail)**.
- Selection (`::selection` accent-dim) with fg text: 7.80:1, pass.
- Solid button (`bg-accent text-black`): 11.28:1, APCA Lc 69.2.
- Hover surface `bg-white/10` over panel gives #292b2f, which is only 1.30:1 against panel. That is fine for hover, but too weak as the *only* selected-state cue. fg on it is 11.73:1.
- Code chip (`bg-black/20` over panel) with faint text: 3.13:1, **fail**. It is used for CLI equivalents and the confirm-dialog command preview.

### Non-text contrast (3:1 needed only where the boundary or state is the sole cue)
| element | ratio vs surface |
|---|---|
| line vs bg / panel | 1.31 / 1.24 |
| line-soft vs panel | 1.10 |
| accent/20 border (overview "subtle teal" sections) over panel | 1.50 |
| accent/25 ring (active nav) over panel | 1.70 |
| accent/30, /40, /60 over panel | 1.95 / 2.55 / 4.26 |
| warn/25 border over panel | 1.78 |
| bad/60 focus border (typed-confirm input) over panel | 3.12 (just passes) |
| accent solid (as a focus ring) over panel | 9.98 |

### Faint-text fix candidates (same hue 266 and chroma 0.026, only OKLCH L raised)
| L | hex | bg | panel | raised | APCA panel |
|---|---|---|---|---|---|
| 0.496 (current) | #5b6271 | 3.19 | 3.04 | 2.84 | −20.6 |
| 0.56 | #6d7584 | 4.20 | 3.99 | 3.74 | −28.7 |
| 0.58 | #737a8a | 4.56 | 4.33 | 4.06 | −31.3 |
| 0.60 | #798090 | 4.95 | 4.70 | 4.41 | −34.1 |
| **0.615** | **#7d8595** | **5.26** | **5.00** | **4.68** | **−36.2** |
| 0.64 | #858c9c | 5.81 | 5.52 | 5.17 | −39.9 |

Paired muted bump: `oklch(72% 0.027 265)` = `#9ca5b6`, giving 7.88 on bg, 7.49 on panel, 7.01 on raised and Lc −52.5. Resulting hierarchy on panel: fg 15.3, muted 7.5, faint 5.0. Every text tier passes AA on every surface, including raised (faint 4.68).

Control-border candidate (`--input`): `oklch(52% 0.026 266)` = `#626978` gives 3.37:1 on panel and 3.16:1 on raised, which meets 3:1 for input and select outlines such as the `h-7 border-line bg-raised` select in App.tsx.

### Other cited findings
- Radix Colors: steps 1–2 are backgrounds, 3–5 component backgrounds (normal, hover, pressed/selected), 6–8 borders (8 = "stronger borders on interactive components and focus rings"), 9–10 solid, 11–12 text. Steps 11 and 12 are "guaranteed to Lc 60 and Lc 90 APCA contrast" on step 2 of the same scale. — [Radix: Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- APCA status: as of the 8 April 2026 Editor's Draft, WCAG 3 says "The contrast algorithm used in WCAG 3 is yet to be determined". APCA was pulled from the July 2023 WCAG 3 Working Draft. Advice: if you use APCA, pick colours that *also* meet WCAG 2. — [Adrian Roselli, "WCAG3 Contrast as of April 2026"](https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html); [WCAG 3 Working Draft, July 2023](https://www.w3.org/TR/2023/WD-wcag-3.0-20230724/#color-and-contrast); [WCAG 3 Editor's Draft](https://w3c.github.io/wcag3/guidelines/#dfn-contrast-ratio-test)
- WCAG 3 had a Working Draft for review on 3 March 2026. It is still a draft, not a standard. — [W3C WAI news, March 2026](https://www.w3.org/WAI/news/2026-03-03/wcag3); [WCAG 3 Introduction](https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/)
- APCA's own docs say WCAG 2.x contrast "cannot be used for guidance designing 'dark mode'", and that Lc is perceptually uniform across light and dark. — [APCA in a Nutshell](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html)
- Tailwind v4's default palette is written in OKLCH (for example `--color-red-500: oklch(63.7% 0.237 25.331)`). Custom colours go under `--color-*` in `@theme`, and the docs' own override examples use `oklch()`. Colours are exposed as `var(--color-…)`, `bg-black/75` sets alpha, and CSS can use `--alpha(var(--color-gray-950) / 10%)`. — [Tailwind: Colors](https://tailwindcss.com/docs/colors); [Tailwind: Theme variables](https://tailwindcss.com/docs/theme)
- Linear rebuilt theme generation on LCH, which keeps equal lightness looking equal, and reduced each theme from 98 variables to 3 (base, accent, contrast). The contrast variable enables high-contrast themes. — [Linear: How we redesigned the Linear UI (part II), 28 Mar 2024](https://linear.app/now/how-we-redesigned-the-linear-ui)

### Inferences
- APCA is worth using as a *design aid* in dark mode. It flags that `muted` at 11–13px (Lc about 43) is weak even though it passes WCAG 2 at about 6:1, which matches the "dim" feel of dense dark UIs. But ship to WCAG 2.2 AA, because that is what any audit will use.
- Build ramps in OKLCH by fixing hue and chroma and stepping L. Contrast against a fixed surface then rises almost monotonically with L, as the faint table shows. Contrast can be targeted by solving for L, which is the Linear "base, accent, contrast" idea in miniature.
- The prototype's status hexes appear to be Tailwind v3's 400 steps (teal-400 #2dd4bf, green-400 #4ade80, amber-400 #fbbf24, red-400 #f87171, blue-400 #60a5fa). This is from memory and was not re-verified this session. Replacing them with a custom ramp in OKLCH and adding `--color-*: initial` makes the system self-owned.
- Use the old faint (#5b6271) only for disabled text (exempt), the separator `·` glyphs, and JSON punctuation where it is decorative. Rename it something like `--fg-disabled` so nobody uses it for content again.
- The overview's "subtle teal" section borders (accent/20 at 1.50:1) are decorative and need not meet 1.4.11, since sections are identified by headings. A *selected or current* state must not rely on the accent/25 ring alone (1.70:1). The prototype also changes text to fg and the icon to accent (8.41:1), which is an adequate second cue.

### Gaps
- No light palette was computed. The token mapping above is ready for one, but light values still need choosing and auditing.
- APCA's font-size lookup table, which links Lc to px and weight, was not fetched, so no APCA pass/fail per font size is claimed.

## 3. Dense data UI: row heights, tabular numerals, monospace, focus rings in dark UIs, table keyboard navigation, reduced motion, live-counter announcements

### Takeaway
Keep the dense 13px base, but make density a token (row height and cell padding), not hard-coded `py-1.5`. Turn on `tnum` for every numeric column because Inter's and Geist's digits are proportional by default. Replace `outline-none` with a 2px solid teal `focus-visible` outline offset outside the element (about 10:1 on panel). Use plain `<table>`s with one focusable link per row for read-only lists, and keep the ARIA grid pattern only for genuinely interactive multi-action tables. Give live updates a pause control, honour reduced motion for the `.flash` highlight, and never put per-second counters in a live region; announce summarised state changes through one `role="status"` region instead.

### Cited Findings
- **Focus Appearance (2.4.13, AAA):** the indicator must be at least the area of a 2 CSS px thick perimeter and have 3:1 contrast between focused and unfocused pixels. A solid outline of 2px or more on or outside the edge meets the area rule, while an inset outline should be thicker (3px). On dark buttons a dark-grey indicator (#555 on black) fails. Use two-colour indicators when backgrounds vary. — [W3C Understanding SC 2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
- 1.4.11 measures the focus indicator against *adjacent* colours, while 2.4.13 measures focused against unfocused. An indicator can pass one and fail the other. — [W3C Understanding SC 2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
- Radix assigns step 8 to "focus rings". Primer has a dedicated component token, `focus-outlineColor`. — [Radix scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale); [Primer color overview](https://primer.style/foundations/color/overview)
- **Grid vs table:** the grid pattern is "particularly useful if the tabular information is editable or interactive". Its benefit is a single tab stop: "Only one of the focusable elements contained by the grid is included in the page tab sequence". Arrow keys move one cell and do not wrap, Page Up/Down move an author-defined number of rows, Home/End go to the row ends, and Ctrl+Home/End go to the first and last cell. It "Requires the author to provide code that manages focus movement". In application mode, screen-reader users "may unknowingly overlook elements" that are not focusable. — [WAI-ARIA APG: Grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
- **Auto-updating content (SC 2.2.2, Level A):** "For any auto-updating information that (1) starts automatically and (2) is presented in parallel with other content, there is a mechanism for the user to pause, stop, or hide it or to control the frequency of the update". There is no 5-second exception for auto-updating content. For real-time data, resuming should jump to current values, because pausing and resuming would otherwise "present misleading information". — [W3C Understanding SC 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- **Live regions:** "Normally, only `aria-live="polite"` is used". `assertive` "should only be used for time-sensitive/critical notifications… can be extremely annoying and disruptive". `role="timer"` and `role="marquee"` are implicitly `aria-live="off"`. `role="status"` and `role="log"` are polite. Establish the region in initial markup *before* updating it. `aria-atomic="true"` makes the whole region read, so a clock reads "17:34" rather than "34". Do not combine `role="alert"` with `aria-live`, because VoiceOver on iOS double-speaks. — [MDN: ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)
- The desktop portal exposes `org.freedesktop.appearance` keys `reduced-motion` (0/1) and `contrast` (0 normal, 1 higher), alongside `color-scheme` and `accent-color`, with a `SettingChanged` signal. — [xdg-desktop-portal Settings](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html)
- Grafana's component height scale is `sm: 3, md: 4, lg: 6` "for normal buttons, inputs, radio buttons, etc". Grafana's spacing `gridSize` defaults to 8px (`spacing(2)` = 16px). Its table tokens are colours only (`rowHoverBackground`, `rowSelectedBackground`, `rowStripedBackground`, `headerBackground`). No density setting is defined. — [grafana createComponents.ts](https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/createComponents.ts); [grafana createSpacing.ts](https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/createSpacing.ts)
- Inter and Geist both ship `tnum`, and their default digits are **proportional**. Measured advance widths of 0–9 are 833–1323 units in Inter 4.001 and 384–663 in Geist 1.900. IBM Plex Sans digits are tabular by default (all 600), and all the monospaces are naturally fixed-width. This was measured in this session from the font files (see section 6). — [Inter feature list](https://rsms.me/inter/)
- **Target size (SC 2.5.8, AA, new in 2.2):** pointer targets of at least 24×24 CSS px, or enough spacing around them. — [W3C Understanding SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

### What the prototype does (from source)
- `outline-none` appears on the palette input, the typed-confirm input and the browse `<select>`. Only the confirm input gets a replacement (`focus:border-bad/60`, 3.12:1, a 1px border, so it is below the 2.4.13 area guideline). Buttons rely on browser defaults.
- The `.flash` keyframes animate a teal 14% background for 1.2s on updates, with no `prefers-reduced-motion` guard.
- `.tabular { font-variant-numeric: tabular-nums }` exists but is opt-in per element.
- Controls are `h-7` (28px) or `h-8`. Badges and kbd are `py-0.5` at 10–11px, and some badges are clickable (the Read-only toggle in App.tsx), so they may fall under the 24px target size without spacing.
- There are no `aria-live`, `role="status"` or `role="grid"` attributes in the three files (grep found none).

### Inferences
- **Density tokens:** `--row-h` with about 28px compact (the prototype's look), 32px default (which matches Grafana's `md` if the unit is gridSize, an assumption) and 36–40px comfortable, plus `--cell-px`. Expose a compact/comfortable toggle and keep the minimum control height at 24px or more for 2.5.8.
- **Numerals:** put `font-variant-numeric: tabular-nums` (or `font-feature-settings: "tnum"`) on `body` or every table, right-align numeric columns, and keep proportional digits only in prose.
- **Monospace:** use it for subjects, stream and consumer names, IDs, sequence numbers, JSON and CLI echoes, not for labels. Keep its size about 1px smaller than the sans at the same nominal size, or tune it with `font-size-adjust`. Disable ligatures for subjects (see section 6).
- **Focus:** `focus-visible:outline-2 outline-offset-2 outline-[var(--ring)]` with ring = teal gives 9.98:1 on panel and 10.51:1 on bg, so it passes 1.4.11 and 2.4.13 with a large margin. For focus inside a selected (teal-tinted) row, a two-tone ring (teal outline plus a 1px bg-coloured inner gap) is the safe pattern.
- **Tables:** most nats-ui lists (streams, consumers, KV keys, connections) are read-and-drill-down. Use a semantic `<table>` with a sortable `<button>` in each `<th>` (plus `aria-sort`) and one `<a>` per row, and add `j/k` shortcuts as a progressive enhancement. Move to `role="grid"` with roving tabindex only for tables with several per-row actions, such as a message browser with inline ack, redeliver and delete.
- **Live data:** (1) offer a global "Pause live updates" control, which satisfies 2.2.2, and resume to the latest values. (2) Wrap the flash highlight in `motion-safe:` or `@media (prefers-reduced-motion: no-preference)`, and fall back to a static change marker. (3) Keep counters in tables out of live regions, or treat them as `role="timer"`/`off`. (4) Keep one visually hidden polite `role="status"` region, present from first render, that announces *threshold crossings* ("Consumer orders-worker stalled", "Stream lag above 10k"). Coalesce changes into at most one announcement every few seconds. The throttle interval is a design choice; no primary source gives a number.

### Gaps
- No primary source gave recommended row heights in px for dense tables. Primer and Geist density docs were not fetched, and Grafana's height unit is not stated in the file read.
- No primary source gave a recommended announcement throttle interval for live regions.

## 4. References: Linear, Vercel/Geist, GitHub Primer, Grafana and Radix Colors on dark-theme colour and density

### Takeaway
They all converge on the same model. Each has a small set of neutral surfaces for elevation, a stepped scale with fixed roles (backgrounds, then borders, then solids, then text), semantic or functional tokens on top, and text contrast guaranteed against a named background step. Linear and Radix go further and generate scales in perceptual space (LCH, or APCA-checked).

### Cited Findings
- **Linear:** themes are generated in LCH from three variables (base, accent, contrast) instead of 98. The same generator serves light, dark and custom themes. They limited how much blue chrome feeds into the calculations for a more neutral look, and made text and neutral icons darker in light mode and lighter in dark mode. LCH also governs elevation (background, panels, dialogs, modals). Headings use Inter Display and body text regular Inter. Density appears only as a goal ("hierarchy and density of navigation elements"). — [Linear blog, 28 Mar 2024](https://linear.app/now/how-we-redesigned-the-linear-ui)
- **Vercel Geist:** there are 10 colour scales (including `gray` and `gray-alpha`). Background 1 (`--ds-background-100`) is the default and Background 2 (`--ds-background-200`) is for subtle differentiation, "sparingly". Steps 100–300 are component backgrounds (default, hover, active), 400–600 borders, 700–800 high-contrast backgrounds, and 900–1000 text and icons. Use solid gray by default and alpha gray only when the background should show through. P3 colours are used where supported. — [Geist Colors](https://vercel.com/geist/colors)
- **GitHub Primer:** it has base, functional and component token tiers, nine themes across light and dark modes, and neutral scales 0–13. Steps 0–5 are backgrounds. Step 8 is the minimum for interactive control borders against `bgColor-muted`, step 9 the minimum for text against steps 0–4, and step 10 against steps 5–6. High-contrast themes target at least 7:1 for most text and interactive elements. — [Primer color overview](https://primer.style/foundations/color/overview). Theme names `light`, `dark`, `dark_dimmed` and `colorMode: day | night | auto` — [Primer React theming](https://primer.style/product/getting-started/react/theming/)
- **Grafana:** themes are TypeScript objects (`createTheme`, `useTheme2`, `useStyles2`). In the dark theme, text secondary is `rgba(204,204,220,0.65)`, disabled is 0.61 alpha, and borders are weak 0.12, medium 0.2 and strong 0.30 alpha of `whiteBase 204,204,220`. Action hover is 0.16, selected 0.12 and focus 0.16. `contrastThreshold` is 3. Backgrounds are canvas `gray05`, primary `gray10`, secondary and elevated `gray15`. — [grafana createColors.ts](https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/createColors.ts); [Grafana themes style guide](https://github.com/grafana/grafana/blob/main/contribute/style-guides/themes.md)
- **Radix Colors:** 12 steps with fixed roles. Steps 11 and 12 are guaranteed APCA Lc 60 and Lc 90 on step 2. Use a mutable `AppBg` alias that points at white in light mode and step 1 or 2 in dark mode. — [Radix: Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)

### Inferences
- Mapping the prototype onto a 12-step neutral: bg is about step 1, panel step 2, raised step 3, line-soft step 4–5, line step 6, the proposed `--input` (#626978) step 8, the fixed faint (#7d8595) step 10–11, the fixed muted (#9ca5b6) step 11 and fg step 12. Adopting Radix-style roles explicitly gives the light theme a ready template: swap the ramp and keep the roles.
- Grafana's alpha-on-white approach (borders and text as alpha of one base) is what the prototype's `bg-white/5` does implicitly. It is simple, but it flips badly in light mode. Primer's and Geist's solid-by-default advice argues for solid tokens with alpha reserved for overlays.
- Linear's "contrast" knob maps to Omarchy and portal signals (`org.freedesktop.appearance.contrast`). A `[data-contrast="more"]` variant that raises faint and muted L and the border steps is cheap once tokens are in OKLCH.

### Gaps
- Linear's published colour values or step counts, and Geist's and Primer's density or row-height specs, were not found or fetched.
- Grafana's palette constants (`gray05`, `gray10` and so on) were not resolved to hex this session.

## 5. Following the Omarchy/Hyprland system theme from a web app or webview

### Takeaway
More than `prefers-color-scheme` is possible. Omarchy stores the live theme as plain files: `~/.local/state/omarchy/current/theme/colors.toml` has a `mode` key and about 30 named colours, and a `theme.generation` stamp changes on every switch. It also offers two official extension points: user templates in `~/.config/omarchy/themed/*.tpl` and hooks in `~/.config/omarchy/hooks/theme-set.d/`. A Go backend can watch the file, map Omarchy colours onto nats-ui semantic tokens, re-check contrast, and push the result to the UI. `prefers-color-scheme` alone only carries dark or light, which Omarchy derives from `mode` and sets through gsettings.

### Cited Findings (local Omarchy 4.5.0rc2 install unless a URL is given)
- `omarchy-theme-set` defines `CURRENT_THEME_PATH="$HOME/.local/state/omarchy/current/theme"`, `theme.name`, `theme.generation`, `next-theme`, user themes in `~/.config/omarchy/themes` and built-in themes in `$OMARCHY_PATH/themes` (`/usr/share/omarchy/themes`). It writes a new `theme.generation` value (`$$-${EPOCHREALTIME}`) on each switch, then runs `omarchy-hook theme-set "$THEME_NAME"`. — local `/usr/share/omarchy/bin/omarchy-theme-set`; repo [basecamp/omarchy](https://github.com/basecamp/omarchy), whose theme listing is on the `quattro` branch ([themes/](https://github.com/basecamp/omarchy/tree/master/themes))
- The old path `~/.config/omarchy/current/` does **not** exist on this 4.5 install. Only `~/.local/state/omarchy/current/` does, containing `theme/`, `theme.name` (currently `tokyo-night`), `theme.generation` and a `background` symlink. — local filesystem
- `colors.toml` (current theme, Tokyo Night) holds `mode = "dark"`, `accent`, `selection`, `muted`, `background`, `dark_background`, `darker_background`, `lighter_background`, `foreground`, `dark_foreground`, `light_foreground`, `bright_foreground`, `red/yellow/orange/green/cyan/blue/magenta/brown` and `bright_*` variants. The `white` theme sets `mode = "light"`. — local `~/.local/state/omarchy/current/theme/colors.toml`, `/usr/share/omarchy/themes/white/colors.toml`
- The built-in themes are catppuccin, catppuccin-latte, ethereal, everforest, flexoki-light, gruvbox, hackerman, jade-horse, kanagawa, last-horizon, lumon, lupine, matte-black, miasma, nord, osaka-jade, retro-82, ristretto, rose-pine, solitude, starship, tokyo-night, vantablack and white. — local `/usr/share/omarchy/themes/`; [GitHub listing](https://github.com/basecamp/omarchy/tree/master/themes)
- **Templates:** `omarchy-theme-set-templates` renders `~/.config/omarchy/themed/*.tpl` (user) and `$OMARCHY_PATH/default/themed/*.tpl` (built-in, user wins) into the next-theme directory, which becomes `current/theme/`. Variables include `{{ background }}`, `{{ foreground }}`, `{{ accent }}`, `{{ selection }}`, `{{ color0 }}`…`{{ color15 }}` and the semantic names, with `_strip` (hex without `#`) and `_rgb` (`26,27,38`) modifiers. Built-in templates already exist for alacritty, btop, chromium, ghostty, kitty, helix, neovim, obsidian, vscode, hyprland and others. — local `~/.config/omarchy/themed/alacritty.toml.tpl.sample`, `/usr/share/omarchy/bin/omarchy-theme-set-templates`, `/usr/share/omarchy/default/themed/`
- **Hooks:** scripts in `~/.config/omarchy/hooks/theme-set.d/` are called "with the snake-cased name of the theme that has just been set". The installed `10-owe-sync` hook shows the pattern: it pings a daemon socket. — local `~/.config/omarchy/hooks/theme-set.d/`
- **Mode to system preference:** `omarchy-theme-set-gnome` reads `mode` from colors.toml (or a legacy `light.mode` marker, or background luminance) and sets `gsettings org.gnome.desktop.interface color-scheme` to `prefer-dark` or `prefer-light`. It currently reads `'prefer-dark'`. — local `/usr/share/omarchy/bin/omarchy-theme-set-gnome`, `gsettings get`
- Omarchy also ships `omarchy-theme-set-browser` and `omarchy-theme-set-browser-policy`, theming Chromium via `chromium.theme`. — local `/usr/share/omarchy/bin/`
- The freedesktop portal publishes `color-scheme` (0 none, 1 dark, 2 light), `accent-color` (sRGB tuple), `contrast` and `reduced-motion`, with a `SettingChanged` signal. — [xdg-desktop-portal Settings](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html)
- Webviews on Linux are unreliable at turning the GTK or portal preference into `prefers-color-scheme`. WebKitGTK has a long-standing dark-GTK-theme bug and needs `color-scheme` set in CSS. An Obsidian forum thread reports Chromium on Linux not reacting to the GTK theme. — [WebKit bug 197947](https://bugs.webkit.org/show_bug.cgi?id=197947); [ant-ui PR #141](https://github.com/WithAutonomi/ant-ui/pull/141); [Obsidian forum](https://forum.obsidian.md/t/color-scheme-adapt-to-system-not-working-on-linux-fedora-gnome/38743/15). These are issue threads, not vendor docs.
- The Omarchy package list includes `monologue`, "A simple, theme-synced webcam recorder for Omarchy", which shows first-party apps follow the theme live. — local `pacman -Qs`

### Inferences
- **Recommended "Follow Omarchy" mode (opt-in, Linux only):**
  1. The Go backend checks for `~/.local/state/omarchy/current/theme/colors.toml`. If it is absent, it falls back to `prefers-color-scheme` or the portal.
  2. Watch `theme.generation` with fsnotify. It is a single small file rewritten once per switch, so it is a cleaner trigger than the whole directory. Re-read colors.toml on change.
  3. Map the colours onto semantic tokens: `background` → `--background`, `dark_background` or `darker_background` → canvas/inset, `lighter_background` → `--popover`/raised, `foreground` → `--foreground`, `dark_foreground` and `muted` → muted and faint text, `accent` → `--primary`/`--ring`, `selection` → `::selection`, `red/yellow/green/blue` → bad/warn/ok/info, and `mode` → `data-theme` plus `color-scheme`.
  4. **Re-validate contrast server-side.** Theme authors' "muted" colours can be very low. Tokyo Night `muted = #414868` on `#1a1b26` was not measured, but it looks low. Raise OKLCH L for any text token until it reaches 4.5:1 on its surface, using the same solve-for-L method as section 2.
  5. Push the token set over the existing SSE or websocket channel. The frontend sets the CSS variables on `:root`, and the `@theme inline` mapping does the rest.
- **Alternative with zero code in the watcher:** ship a `nats-ui.css.tpl` that the user drops into `~/.config/omarchy/themed/`. Omarchy then renders `current/theme/nats-ui.css` with `--background: {{ background }}`. Still watch for changes. This is closer to how Omarchy's own integrations work, but it needs the user to install the template.
- Even without Omarchy files, set `color-scheme` on `:root` per theme so native controls (selects, scrollbars) match in WebKitGTK and Chromium.
- Brand identity: following Omarchy should probably replace neutrals and the accent, but keep status semantics (ok, warn, bad, and amber Read-only) recognisable. Hue-shift them only if the theme's own red, yellow and green pass contrast.

### Gaps
- The desktop shell (Tauri/WebKitGTK, Wails, or a plain browser tab) was not specified, so whether `prefers-color-scheme` updates live inside it on Hyprland was not tested.
- Whether Hyprland's portal stack (xdg-desktop-portal-hyprland plus the gtk backend) serves `org.freedesktop.appearance.color-scheme` from the gsettings value was not verified.
- Omarchy's online manual pages on themes were not fetched. The findings rely on the installed 4.5.0rc2 scripts, so paths may differ on older Omarchy versions.

## 6. Fonts: Inter vs Geist vs IBM Plex (UI) and JetBrains Mono vs Geist Mono (mono): licences, variable fonts, tabular figures, self-hosting in the binary

### Takeaway
All five families are SIL OFL 1.1, so they can be bundled and embedded freely. Recommended pairing: **Inter Variable** (wght 100–900 plus an opsz 14–32 axis, the "Display" end Linear uses for headings) with **Geist Mono** or **JetBrains Mono**. Geist Mono has no `calt` ligatures, which is safer for subjects. JetBrains Mono has ligatures on by default, so turn them off. Ship the files from npm (Fontsource or the vendors' own packages) through Vite and embed them in the Go binary, with no CDN. Beware that Fontsource's subset files strip Inter's `zero`, `ss` and `cv` features, so use the official `InterVariable.woff2` if you need a slashed zero or disambiguation in sans.

### Cited Findings
- Inter is under SIL OFL 1.1. Its OpenType features include `tnum`, `zero` (slashed zero), `case`, `ss01–ss08` (ss02 = disambiguation) and `cv01–cv13`. It has optical sizes from "text" to "display", and the page recommends `InterVariable` inside `@supports (font-variation-settings: normal)`. — [rsms.me/inter](https://rsms.me/inter/)
- Geist and Geist Mono are under SIL OFL 1.1, published on npm as `geist`. — [vercel/geist-font](https://github.com/vercel/geist-font)
- JetBrains Mono is OFL-1.1 (the source is Apache 2.0). It has 8 weights with italics, ligatures on by default, and a "JetBrains Mono NL" build without ligatures. It has `ss01–ss20` and `cv01–cv99` from v2.304, and a maximised x-height. — [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono)
- IBM Plex is OFL-1.1, with npm packages `@ibm/plex-sans`, `@ibm/plex-mono` and others. — [IBM/plex](https://github.com/IBM/plex)
- Fontsource "Self-host with npm packages, or use a CDN". — [Fontsource: Inter](https://fontsource.org/fonts/inter/install)
- Linear uses Inter Display for headings and Inter for body text. — [Linear blog](https://linear.app/now/how-we-redesigned-the-linear-ui)
- Go's `embed` package embeds files and directories (such as a Vite `dist/` with woff2 assets) into the binary through `//go:embed` and `embed.FS`. — [pkg.go.dev/embed](https://pkg.go.dev/embed)

### Measured this session (npm packages downloaded and inspected with fontTools; npm `license` field in brackets)
| package (version) [licence] | file | axes | default digits | GSUB features (selection) | size |
|---|---|---|---|---|---|
| `inter-ui` 4.1.1 [OFL-1.1] (official) | InterVariable.woff2 (Inter 4.001) | opsz 14–32, wght 100–900 | proportional (833–1323) | tnum, pnum, zero, case, ss01–ss08, cv01–cv14, calt, dlig | 343 KB (all scripts) |
| `@fontsource-variable/inter` 5.3.0 [OFL-1.1] | inter-latin-wght-normal | wght 100–900 | proportional | calt, tnum, pnum, frac (**no zero, ss or cv**) | 47 KB |
| same | inter-latin-opsz-normal | opsz 14–32, wght 100–900 | proportional | same as above | 71 KB |
| `geist` 1.9.0 [SIL OFL] (official) | Geist-Variable.woff2 (1.900) | wght 100–900 | proportional (384–663) | tnum, pnum, liga, case, ss01–ss11 | 67 KB |
| `@fontsource-variable/geist` 5.3.0 [OFL-1.1] | geist-latin-wght-normal (1.800) | wght 100–900 | proportional | tnum, pnum, liga (no ss) | 28 KB |
| `geist` 1.9.0 | GeistMono-Variable.woff2 (1.900) | wght 100–900 | fixed 600 | ss01–ss11, case, **no calt/liga**, no `zero` feature | 69 KB |
| `@fontsource-variable/geist-mono` 5.3.0 | geist-mono-latin-wght-normal (1.701) | wght 100–900 | fixed | frac, locl only | 22 KB |
| `@fontsource-variable/jetbrains-mono` 5.3.0 [OFL-1.1] | jetbrains-mono-latin-wght-normal (2.211) | wght 100–800 | fixed | **calt (ligatures)**, frac; no ss or cv in subset | 39 KB |
| `@fontsource-variable/ibm-plex-sans` 5.3.0 [OFL-1.1] | latin-wght-normal (3.201) | wght 100–700 | **tabular by default** (600) | liga, frac; no tnum or pnum | 44 KB |
| `@ibm/plex-mono` 2.5.0 [OFL-1.1] | IBMPlexMono-Regular.woff2 (2.005) | static (no fvar) | fixed | zero, ss01–ss09, onum, lnum | 48 KB per style |
| `@fontsource-variable/ibm-plex-mono` | — | npm returned 404 (no variable Plex Mono on Fontsource) | | | |

- Zero glyph shape (contour count of the default `0`): Geist Mono 3, JetBrains Mono 3 and Plex Mono 3, so each has a marked zero (dot or slash) by default. Inter has 2 contours, an unmarked zero, with `zero.slash` available through `zero`.
- Fontsource `font-family` names: `'Inter Variable'`, `'Geist Variable'`, `'Geist Mono Variable'`, `'JetBrains Mono Variable'`, `'IBM Plex Sans Variable'`. The prototype's `--font-sans: "Inter", "Geist", …` will **not** match these names, and the prototype loads no font files, so today it renders with whatever is installed locally or the system fallback.

### Inferences
- **UI sans: Inter Variable.** It has the richest data-UI feature set (`tnum`, `zero`, `ss02` disambiguation for Il1 and O0, `case`), plus an opsz axis that gives Display headings without a second family, and it matches Linear's "sleek" reference. Geist is a close, smaller (67 KB) alternative with the Vercel look but no `zero`. Plex Sans has tabular digits by default, which helps tables, but its wght range stops at 700 and its humanist look is less "sleek".
- **Mono: Geist Mono** if you want no ligature risk, a marked zero by default, and a family match with Geist. **JetBrains Mono** if you want the taller x-height for small 11px IDs; set `font-variant-ligatures: none` (or `font-feature-settings: "calt" 0`) on subject and ID cells so `->`, `>=` and `!=` are not merged. NATS subjects use `.`, `*` and `>`, so ligatures on `>`-sequences are a readability risk. Plex Mono is static-only, which means multiple files.
- **Bundling:** for Latin-only use, the Fontsource latin `wght` (or `opsz`) subset is 22–71 KB per family. Use the official full files only if you need Inter's `zero`/`ss02`/`cv` or Geist's stylistic sets. Inter in full is 343 KB, and it can be subset yourself (for example with `pyftsubset` and `--layout-features=*`) to keep its features at a fraction of the size. Vite emits the woff2 as hashed assets, which `//go:embed dist` embeds, so it works offline. Add `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the sans to avoid a flash of fallback text.
- **CSS:** `--font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif; --font-mono: "Geist Mono Variable", ui-monospace, monospace;`, plus `font-feature-settings: "cv11", "ss02"` only if the full Inter file is shipped, and `font-variant-numeric: tabular-nums` on data regions.

### Gaps
- No primary source compared the x-heights or small-size legibility of these families. That remains a visual judgement to test in the prototype at 11–13px.
- The exact shapes of the marked zeros (dotted vs slashed) were inferred from contour counts, not rendered.
- The full official JetBrains Mono variable file (with ss and cv) was not inspected; only the Fontsource subset was.
