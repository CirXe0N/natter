import { expect, test } from "@playwright/test"

// Measures the tokens as the browser renders them, with WCAG 2.x relative luminance.
const surfaces = ["--background", "--card", "--popover"]
const text = ["--foreground", "--muted-foreground", "--fg-faint", "--primary", "--success", "--warning", "--destructive", "--info"]

type RGB = [number, number, number]
const luminance = (rgb: RGB) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test("every text token passes WCAG 2.2 AA on every surface", async ({ page }) => {
  await page.goto("/overview")
  const names = [...surfaces, ...text, "--accent", "--primary-foreground", "--input"]
  const rgb: Record<string, RGB> = await page.evaluate((names) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
    const style = getComputedStyle(document.documentElement)
    return Object.fromEntries(
      names.map((n) => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = style.getPropertyValue(n).trim()
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
        return [n, [r, g, b] as RGB]
      }),
    )
  }, names)

  const hex = (n: string) => "#" + rgb[n].map((c) => c.toString(16).padStart(2, "0")).join("")
  expect.soft(hex("--fg-faint")).toBe("#7d8595")
  expect.soft(hex("--muted-foreground")).toBe("#9ca5b6")

  for (const s of surfaces)
    for (const t of text) expect.soft(contrast(rgb[t], rgb[s]), `${t} on ${s}`).toBeGreaterThanOrEqual(4.5)
  for (const t of ["--foreground", "--muted-foreground"]) expect.soft(contrast(rgb[t], rgb["--accent"]), `${t} on --accent`).toBeGreaterThanOrEqual(4.5)
  expect.soft(contrast(rgb["--primary-foreground"], rgb["--primary"]), "--primary-foreground on --primary").toBeGreaterThanOrEqual(4.5)
  expect.soft(contrast(rgb["--input"], rgb["--card"]), "--input border on --card (SC 1.4.11)").toBeGreaterThanOrEqual(3)
})
