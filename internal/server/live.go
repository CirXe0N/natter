package server

import (
	"net/http"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/live"
)

func init() {
	routes = append(routes, route{pattern: "GET /ws", handle: (*server).liveSocket})
}

func (s *server) newHub() *live.Hub {
	h := live.NewHub(map[api.Topic]func() live.Producer{
		api.TopicOverview: func() live.Producer { return live.NewOverview(s.Contexts.Active) },
	})
	h.Families = map[api.Topic]func(string) live.Producer{
		api.TopicKV: func(bucket string) live.Producer { return live.NewKVKeys(s.Contexts.Active, bucket) },
	}
	return h
}

// liveSocket is the one WebSocket per tab. The session check has already run;
// the upgrade adds coder/websocket's Origin check, which also trusts -dev's
// Vite origin.
func (s *server) liveSocket(w http.ResponseWriter, r *http.Request) {
	s.hub.Serve(w, r, s.TrustedOrigins)
}
