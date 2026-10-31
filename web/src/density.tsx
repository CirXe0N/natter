import { useState } from "react"
import { Rows2, Rows3, Rows4 } from "lucide-react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

// Density sets --row-h on <html> (see index.css) and persists per browser.
const densities = [
  { value: "compact", label: "Compact", Icon: Rows4 },
  { value: "default", label: "Default", Icon: Rows3 },
  { value: "comfortable", label: "Comfortable", Icon: Rows2 },
] as const
type Density = (typeof densities)[number]["value"]
const key = "natter.density"

function stored(): Density {
  const v = localStorage.getItem(key)
  return densities.find((d) => d.value === v)?.value ?? "default"
}

export function applyStoredDensity() {
  document.documentElement.dataset.density = stored()
}

export function DensityToggle() {
  const [density, setDensity] = useState(stored)
  return (
    <ToggleGroup
      aria-label="Row density"
      value={[density]}
      onValueChange={(v: string[]) => {
        const next = densities.find((d) => d.value === v[0])?.value
        if (!next) return // pressing the current density again would leave none selected
        localStorage.setItem(key, next)
        document.documentElement.dataset.density = next
        setDensity(next)
      }}
    >
      {densities.map(({ value, label, Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          title={`${label} rows`}
          className="h-6 min-w-6 px-1 text-muted-foreground aria-pressed:bg-primary/15 aria-pressed:text-primary"
        >
          <Icon />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
