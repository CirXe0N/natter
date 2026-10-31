// A list taller than browsers let an element be scrolls on a capped track,
// mapped the way Glide Data Grid does it. A move no bigger than the viewport
// (wheel, arrow keys, PageDown) shifts the list 1:1. A bigger one (dragging
// the scrollbar) lands proportionally, and the ends of the track pin to the
// ends of the list.
export const MAX_TRACK = 4_000_000

export type Scroll = { scrollTop: number; top: number }

export const trackHeight = (height: number) => Math.min(height, MAX_TRACK)

// follow turns the element's new scrollTop into the list pixel at the top of the view.
export function follow(prev: Scroll, scrollTop: number, viewport: number, height: number): number {
  const track = trackHeight(height)
  if (track === height) return scrollTop
  const maxScroll = track - viewport
  const maxTop = height - viewport
  if (scrollTop <= 0) return 0
  if (scrollTop >= maxScroll - 1) return maxTop
  const delta = scrollTop - prev.scrollTop
  if (Math.abs(delta) > viewport) return (scrollTop / maxScroll) * maxTop
  return Math.min(maxTop, Math.max(0, prev.top + delta))
}

// scrollTopFor is where to put the element's scrollTop to show list pixel top.
export function scrollTopFor(top: number, viewport: number, height: number): number {
  const track = trackHeight(height)
  if (track === height) return top
  return (top / (height - viewport)) * (track - viewport)
}
