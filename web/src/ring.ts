// One live series: a Float32Array slot per second for an hour, NaN where no
// point arrived. Writing a point never copies the array.
export const SLOTS = 3600

export class Ring {
  readonly v = new Float32Array(SLOTS).fill(NaN)
  last = 0 // unix second of the newest point; 0 while empty

  // put records the point for second sec. Skipped seconds become NaN; a second
  // older than the newest is dropped.
  put(sec: number, val: number | null) {
    if (this.last && sec <= this.last) return
    if (this.last) for (let s = this.last + 1; s < sec && s <= this.last + SLOTS; s++) this.v[s % SLOTS] = NaN
    this.v[sec % SLOTS] = val ?? NaN
    this.last = sec
  }

  // load replaces everything with a window of points, oldest first, ending at sec.
  load(sec: number, points: (number | null)[]) {
    this.v.fill(NaN)
    const first = sec - points.length + 1
    points.forEach((p, i) => (this.v[(first + i) % SLOTS] = p ?? NaN))
    this.last = sec
  }

  // at is the point for second sec, NaN if there is none in the window.
  at(sec: number) {
    return sec > this.last || sec <= this.last - SLOTS ? NaN : this.v[sec % SLOTS]
  }
}
