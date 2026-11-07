// Small progressive enhancements. The site works without them.
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)]

// Copy buttons: explicit ones carry data-copy; every docs <pre> gets one.
for (const pre of $$(".prose pre")) {
  const b = document.createElement("button")
  b.className = "copy"
  b.type = "button"
  b.textContent = "Copy"
  b.dataset.copy = pre.innerText
  pre.append(b)
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]")
  if (!b) return
  try {
    await navigator.clipboard.writeText(b.dataset.copy.trim())
    const label = b.querySelector("span") ?? b
    const was = label.textContent
    label.textContent = "Copied"
    b.dataset.done = ""
    setTimeout(() => ((label.textContent = was), delete b.dataset.done), 1500)
  } catch {
    /* clipboard needs a secure context; the text is still selectable */
  }
})

// Menus on small screens.
for (const [btn, menu] of [[".menu-toggle", "#site-nav"], [".side-toggle", "#docs-nav"]]) {
  const b = document.querySelector(btn)
  const m = document.querySelector(menu)
  b?.addEventListener("click", () => {
    const open = b.getAttribute("aria-expanded") !== "true"
    b.setAttribute("aria-expanded", String(open))
    open ? (m.dataset.open = "") : delete m.dataset.open
  })
}

// The screenshot tour.
const tabs = $$(".tabs [role=tab]")
const img = document.querySelector("[data-shot-img]")
const pick = (t) => {
  for (const x of tabs) x.setAttribute("aria-selected", String(x === t))
  img.src = `${img.dataset.root}assets/screens/${t.dataset.shot}.webp`
  img.alt = `Natter's ${t.textContent} screen.`
  document.querySelector("[data-shot-caption]").textContent = t.dataset.caption
}
tabs.forEach((t, i) => {
  t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1
  t.addEventListener("click", () => pick(t))
  t.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    if (!d) return
    const n = tabs[(i + d + tabs.length) % tabs.length]
    for (const x of tabs) x.tabIndex = x === n ? 0 : -1
    n.focus()
    pick(n)
  })
})

// Point the download button at the visitor's system.
const ua = navigator.userAgent
const os = /Mac/.test(ua) ? ["mac", "macOS"] : /Win/.test(ua) ? ["windows", "Windows"] : /Linux|X11/.test(ua) ? ["linux", "Linux"] : null
if (os) {
  document.querySelector(`.os[data-os="${os[0]}"]`)?.setAttribute("data-detected", "")
  const label = document.querySelector("[data-download-label]")
  if (label) label.textContent = `Download for ${os[1]}`
}

// Cards follow the pointer with a soft light.
for (const c of $$(".card")) {
  c.addEventListener("pointermove", (e) => {
    const r = c.getBoundingClientRect()
    c.style.setProperty("--mx", `${e.clientX - r.left}px`)
    c.style.setProperty("--my", `${e.clientY - r.top}px`)
  })
}

// "On this page" marks the section in view.
const links = $$(".docs-toc a")
if (links.length && "IntersectionObserver" in window) {
  const seen = new Map()
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) seen.set(en.target.id, en.isIntersecting)
      const current = links.find((a) => seen.get(a.hash.slice(1)))
      for (const a of links) a === current ? (a.dataset.active = "") : delete a.dataset.active
    },
    { rootMargin: "-80px 0px -65% 0px" },
  )
  for (const a of links) {
    const h = document.getElementById(a.hash.slice(1))
    if (h) io.observe(h)
  }
}
