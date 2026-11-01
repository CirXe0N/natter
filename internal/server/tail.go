package server

import (
	"net/http"
	"strconv"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/live"
)

// The Live tail itself runs on /ws. This route opens one of its rows, which
// Read-only mode allows: it only reads what the tail already holds.
func init() {
	routes = append(routes, route{pattern: "GET /api/tail/message", handle: (*server).tailMessage})
}

func (s *server) tailMessage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	id, err := strconv.ParseUint(q.Get("id"), 10, 64)
	tail, _ := s.hub.Producer(api.Topic(api.TopicTailPrefix + q.Get("filter"))).(*live.Tail)
	if err != nil || tail == nil {
		http.Error(w, "This Live tail is not running.", http.StatusNotFound)
		return
	}
	m, ok := tail.Message(id)
	if !ok {
		http.Error(w, "The tail no longer holds this message's payload. It drops the oldest payloads to stay within its memory budget.", http.StatusGone)
		return
	}
	writeJSON(w, m)
}
