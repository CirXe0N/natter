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

// TopicKV plus a bucket name is that bucket's live key list. Untyped, so the
// generated Topic stays a string that any bucket fits.
const TopicKV = "kv:"

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
	KV       *KVKeys   `json:"kv,omitempty"`
	// Gap counts frames of Topic the socket dropped, oldest first, because the
	// tab fell behind. It comes in a frame of its own, just before the next
	// frame that did arrive.
	Gap  int   `json:"gap,omitempty"`
	Tail *Tail `json:"tail,omitempty"`
}

// StatsSource says where the Overview's numbers come from.
type StatsSource string

const (
	StatsSourceSystem     StatsSource = "system"     // $SYS STATSZ: every server
	StatsSourceMonitoring StatsSource = "monitoring" // the Monitoring URL: the one server behind it
	StatsSourceNone       StatsSource = "none"       // neither; Problem says what is missing
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
	Source StatsSource `json:"source"`
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

// TopicTailPrefix starts a Live tail's topic. The rest is its subject filter,
// wildcards allowed, as in "tail:orders.>".
const TopicTailPrefix = "tail:"

// Tail is one frame of a Live tail: the rows since the previous frame, and its
// counters since the tail started. The backend sends one every 250 ms.
type Tail struct {
	// Problem says, for the user, why the tail is not receiving.
	Problem string    `json:"problem,omitempty"`
	Rows    []TailRow `json:"rows"`
	// HeldFrom is the oldest row ID whose payload may still be held. Rows
	// before it have lost theirs to the memory budget.
	HeldFrom uint64 `json:"heldFrom"`
	// Rate is how many messages arrived in the last second, dropped ones included.
	Rate     uint64 `json:"rate"`
	Received uint64 `json:"received"`
	// PendingDrops are messages nats.go dropped because the tail's pending
	// limit was full. RateDrops are messages over the rate cap.
	PendingDrops uint64 `json:"pendingDrops"`
	RateDrops    uint64 `json:"rateDrops"`
	// Disconnects counts how often the server closed the tail's connection, a
	// slow-consumer cut-off among the possible reasons. How many messages were
	// missed meanwhile is unknown. Disconnect is the last one's error.
	Disconnects uint64 `json:"disconnects"`
	Disconnect  string `json:"disconnect,omitempty"`
}

// TailRow is one message of a Live tail. IDs count up by one per row, so a
// jump shows how many rows the tab missed. Held says the backend kept the
// payload when the message arrived; HeldFrom says whether it still does.
type TailRow struct {
	ID      uint64    `json:"id"`
	Time    time.Time `json:"time" tstype:"string"`
	Subject string    `json:"subject"`
	Reply   string    `json:"reply,omitempty"`
	Size    int       `json:"size"`
	Headers int       `json:"headers"`
	Preview *string   `json:"preview,omitempty"`
	Kind    MsgKind   `json:"kind,omitempty"`
	Held    bool      `json:"held"`
}

// TailMessage is one held message of a Live tail, opened. Payload is set for
// a text or JSON payload; a binary one only has its Size.
type TailMessage struct {
	TailRow      `tstype:",extends"`
	HeaderValues map[string][]string `json:"headerValues,omitempty"`
	Payload      *string             `json:"payload,omitempty"`
}
