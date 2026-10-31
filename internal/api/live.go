package api

import (
	"encoding/json"
	"math"
	"time"
)

// Topic names one live feed on the WebSocket at /ws.
type Topic string

const (
	TopicOverview Topic = "overview"
)

// ClientOp is what the browser asks of the WebSocket.
type ClientOp string

const (
	ClientOpSub   ClientOp = "sub"
	ClientOpUnsub ClientOp = "unsub"
)

// ClientFrame is one message from the browser on /ws.
type ClientFrame struct {
	Op    ClientOp `json:"op"`
	Topic Topic    `json:"topic"`
}

// ServerFrame is one message to the browser on /ws. Error or the payload
// field for Topic is set.
type ServerFrame struct {
	Topic Topic `json:"topic"`
	// Error says why a subscribe was refused.
	Error    string    `json:"error,omitempty"`
	Overview *Overview `json:"overview,omitempty"`
}

// OverviewSource says where the Overview's numbers come from.
type OverviewSource string

const (
	OverviewSourceSystem     OverviewSource = "system"     // $SYS STATSZ: every server
	OverviewSourceMonitoring OverviewSource = "monitoring" // the Monitoring URL: the one server behind it
	OverviewSourceNone       OverviewSource = "none"       // neither; Problem says what is missing
)

// Series names one Overview KPI series, summed over all servers.
type Series string

const (
	SeriesConnections   Series = "connections"
	SeriesMsgsIn        Series = "msgsIn"   // messages per second received from clients
	SeriesMsgsOut       Series = "msgsOut"  // messages per second sent to clients
	SeriesBytesIn       Series = "bytesIn"  // bytes per second received from clients
	SeriesBytesOut      Series = "bytesOut" // bytes per second sent to clients
	SeriesSlowConsumers Series = "slowConsumers"
)

// Overview answers "is this system healthy right now?". The backend sends one
// each second.
type Overview struct {
	Source OverviewSource `json:"source"`
	// Problem says, for the user, what access is missing or why sampling failed.
	Problem string `json:"problem,omitempty"`
	// Time is the unix second of the newest point.
	Time   int64          `json:"time"`
	Points map[Series]Num `json:"points" tstype:"{ [S in Series]: number | null }"`
	// History is the last 3,600 points of each series, oldest first, ending at
	// Time. Only the first frame after a subscribe carries it.
	History   map[Series][]Num `json:"history,omitempty" tstype:"{ [S in Series]: (number | null)[] }"`
	Servers   []ServerSummary  `json:"servers"`
	JetStream *JetStreamUsage  `json:"jetStream,omitempty"`
}

// ServerSummary is one row of the Overview's servers table.
type ServerSummary struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Version     string    `json:"version"`
	Cluster     string    `json:"cluster,omitempty"`
	Start       time.Time `json:"start" tstype:"string"`
	Connections int       `json:"connections"`
	CPU         float64   `json:"cpu"`
	Mem         int64     `json:"mem"`
}

// JetStreamUsage is JetStream storage used against its limits, in bytes,
// summed over the servers that run JetStream.
type JetStreamUsage struct {
	Store     uint64 `json:"store"`
	MaxStore  int64  `json:"maxStore"`
	Memory    uint64 `json:"memory"`
	MaxMemory int64  `json:"maxMemory"`
}

// Num is one point of a series. NaN marks a missing point and is null in JSON.
type Num float32

func (n Num) MarshalJSON() ([]byte, error) {
	if math.IsNaN(float64(n)) {
		return []byte("null"), nil
	}
	return json.Marshal(float32(n))
}
