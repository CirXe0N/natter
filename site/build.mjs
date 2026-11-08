// Builds the Natter site into site/dist: the landing page and the user docs.
// No dependencies. Pages are HTML fragments in src/; this script wraps them in
// the shared layout, builds the docs sidebar, each page's "On this page" list
// and prev/next links, and copies src/assets. Links inside pages use {{ROOT}},
// so the site works under any base path, such as GitHub Pages' /natter/.
//
//   node site/build.mjs          writes site/dist
//   NATTER_VERSION=0.2.2 …       overrides the version
//
// The version is the latest published GitHub release when the build runs in
// Actions (or with NATTER_FETCH_LATEST=1), so a release can rebuild the site.
// Otherwise, or if GitHub doesn't answer, it is the latest local v* git tag.
import { execSync } from "node:child_process"
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, "src")
const out = join(here, "dist")
const repo = "https://github.com/CirXe0N/natter"

// The latest published, non-draft, non-prerelease release's tag, or "" when it can't be read.
async function latestRelease() {
  if (!process.env.GITHUB_ACTIONS && !process.env.NATTER_FETCH_LATEST) return ""
  const slug = process.env.GITHUB_REPOSITORY ?? "CirXe0N/natter"
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", ...(token && { Authorization: `Bearer ${token}` }) },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()).tag_name ?? ""
  } catch (e) {
    console.warn(`site: latest release unavailable (${e.message}); using the latest git tag`)
    return ""
  }
}

const version = await (async () => {
  if (process.env.NATTER_VERSION) return process.env.NATTER_VERSION.replace(/^v/, "")
  const tag = await latestRelease()
  if (/^v\d/.test(tag)) return tag.slice(1)
  try {
    return execSync("git describe --tags --abbrev=0 --match 'v*'", { cwd: here, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().replace(/^v/, "")
  } catch {
    return "0.2.2"
  }
})()

// The docs sidebar, in reading order. slug "" is the docs home.
const nav = [
  { group: "Start", pages: [["", "Introduction"], ["install", "Install"], ["quick-start", "Quick start"], ["desktop", "Desktop app"]] },
  { group: "Connect", pages: [["contexts", "Contexts"], ["vault", "The Vault"], ["read-only", "Read-only mode"]] },
  { group: "Use", pages: [["overview", "Overview & Connections"], ["streams", "Streams"], ["consumers", "Consumers"], ["message-browser", "Message browser"], ["publish", "Publish / Request"], ["live-tail", "Live tail"]] },
  { group: "Reference", pages: [["command-line", "Command line"], ["shortcuts", "Keyboard shortcuts"], ["security", "Security model"], ["troubleshooting", "Troubleshooting"]] },
]
const pages = nav.flatMap((g) => g.pages.map(([slug, title]) => ({ slug, title, group: g.group })))

const read = (p) => readFileSync(join(src, p), "utf8")
const fill = (html, vars) => html.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m))
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
const write = (path, html) => {
  mkdirSync(dirname(join(out, path)), { recursive: true })
  writeFileSync(join(out, path), html)
}

// Gives every h2 and h3 an id, and lists the h2s for "On this page".
function headings(html) {
  const toc = []
  const body = html.replace(/<(h[23])(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (m, tag, attrs = "", text) => {
    const id = attrs.match(/id="([^"]+)"/)?.[1] ?? slugify(text)
    if (tag === "h2") toc.push({ id, text: text.replace(/<[^>]+>/g, "") })
    const withId = attrs.includes("id=") ? attrs : `${attrs} id="${id}"`
    return `<${tag}${withId}><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</${tag}>`
  })
  return { body, toc }
}

function layout({ root, title, description, body, page }) {
  return fill(read("layout.html"), {
    ROOT: root,
    TITLE: title,
    DESCRIPTION: description,
    BODY: body,
    PAGE: page,
    HEADER: fill(read("partials/header.html"), { ROOT: root, VERSION: version, REPO: repo }),
    FOOTER: fill(read("partials/footer.html"), { ROOT: root, VERSION: version, REPO: repo, YEAR: String(new Date().getFullYear()) }),
  })
}

rmSync(out, { recursive: true, force: true })
cpSync(join(src, "assets"), join(out, "assets"), { recursive: true })
writeFileSync(join(out, ".nojekyll"), "")

// Landing page.
const vars = (root) => ({ ROOT: root, VERSION: version, REPO: repo })
write("index.html", layout({ root: "./", title: "Natter — a local console for NATS™", description: "Natter is a fast, local web console for NATS and JetStream: browse messages, watch consumer lag, publish test traffic and tail subjects live, from one small binary.", body: fill(read("index.html"), vars("./")), page: "home" }))
// GitHub Pages serves 404.html at any depth, so its links are absolute: SITE_BASE
// is where the site lives, /natter/ for the project site, / on a custom domain.
const base = process.env.SITE_BASE ?? "/natter/"
write("404.html", layout({ root: base, title: "Not found — Natter", description: "This page does not exist.", body: fill(read("404.html"), vars(base)), page: "home" }))

// Docs pages.
pages.forEach((p, i) => {
  const root = p.slug ? "../../" : "../"
  const raw = fill(read(`docs/${p.slug || "index"}.html`), vars(root))
  const description = raw.match(/<!--\s*description:\s*([\s\S]*?)-->/)?.[1].trim() ?? `${p.title} — Natter documentation.`
  const { body, toc } = headings(raw.replace(/<!--[\s\S]*?-->/g, ""))
  const href = (slug) => `${root}docs/${slug ? `${slug}/` : ""}`
  const sidebar = nav
    .map(
      (g) =>
        `<p class="side-group">${g.group}</p><ul>${g.pages
          .map(([slug, title]) => `<li><a href="${href(slug)}"${slug === p.slug ? ' aria-current="page"' : ""}>${title}</a></li>`)
          .join("")}</ul>`,
    )
    .join("")
  const onPage = toc.length ? `<p class="toc-title">On this page</p><ul>${toc.map((t) => `<li><a href="#${t.id}">${t.text}</a></li>`).join("")}</ul>` : ""
  const prev = pages[i - 1]
  const next = pages[i + 1]
  const pager = `<nav class="pager" aria-label="Previous and next page">${prev ? `<a class="pager-prev" href="${href(prev.slug)}"><span>Previous</span>${prev.title}</a>` : "<span></span>"}${next ? `<a class="pager-next" href="${href(next.slug)}"><span>Next</span>${next.title}</a>` : ""}</nav>`
  const docBody = fill(read("partials/docs.html"), { ROOT: root, SIDEBAR: sidebar, GROUP: p.group, TITLE: p.title, CONTENT: body, TOC: onPage, PAGER: pager, EDIT: `${repo}/edit/main/site/src/docs/${p.slug || "index"}.html` })
  write(`docs/${p.slug ? `${p.slug}/` : ""}index.html`, layout({ root, title: `${p.title} — Natter docs`, description, body: docBody, page: "docs" }))
})

console.log(`site: built ${pages.length} docs pages for v${version} into ${out}`)
