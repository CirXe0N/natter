package live

import (
	"math"

	"github.com/CirXe0N/natter/internal/api"
)

// Slots is how many 1-second points a ring keeps: one hour.
const Slots = 3600

// ring is one series: a fixed float32 slot per second, NaN where no point
// was recorded. It never allocates after creation.
type ring struct {
	v    [Slots]float32
	last int64 // unix second of the newest point; 0 before the first
}

func newRing() *ring {
	r := &ring{}
	for i := range r.v {
		r.v[i] = float32(math.NaN())
	}
	return r
}

// put records the point for second sec. Skipped seconds become NaN, so a
// point older than an hour is never shown as current. A second older than
// the newest is dropped.
func (r *ring) put(sec int64, val float32) {
	if sec <= r.last && r.last != 0 {
		return
	}
	if r.last != 0 {
		for s := r.last + 1; s < sec && s <= r.last+Slots; s++ {
			r.v[s%Slots] = float32(math.NaN())
		}
	}
	r.v[sec%Slots] = val
	r.last = sec
}

// history returns the whole window, oldest first, ending at the newest point.
func (r *ring) history() []api.Num {
	out := make([]api.Num, Slots)
	for i := range out {
		out[i] = api.Num(r.v[(r.last+1+int64(i))%Slots])
	}
	return out
}
