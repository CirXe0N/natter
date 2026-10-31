package api

import (
	"encoding/json"
	"time"
)

// StreamKind tells a plain stream from one that backs a KV bucket (KV_*) or
// an Object Store (OBJ_*).
type StreamKind string

const (
	StreamKindStream StreamKind = "stream"
	StreamKindKV     StreamKind = "kv"
	StreamKindObject StreamKind = "object"
)

// StreamHealth is the health dot on a stream. Problem says why it is not ok.
type StreamHealth string

const (
	StreamHealthOK      StreamHealth = "ok"
	StreamHealthWarning StreamHealth = "warning"
	StreamHealthError   StreamHealth = "error"
)

// StreamSummary is one row of the Streams list.
type StreamSummary struct {
	Name     string     `json:"name"`
	Kind     StreamKind `json:"kind"`
	Subjects []string   `json:"subjects"`
	Storage  string     `json:"storage"` // file or memory
	Replicas int        `json:"replicas"`
	Msgs     uint64     `json:"msgs"`
	Bytes    uint64     `json:"bytes"`
	// FirstTime and LastTime are absent while the stream is empty.
	FirstTime *time.Time   `json:"firstTime,omitempty" tstype:"string"`
	LastTime  *time.Time   `json:"lastTime,omitempty" tstype:"string"`
	Consumers int          `json:"consumers"`
	Leader    string       `json:"leader"`
	Health    StreamHealth `json:"health"`
	Problem   string       `json:"problem,omitempty"`
}

// StreamList is every stream in the active Context's account. Offline maps a
// stream the server knows but could not describe to the reason.
type StreamList struct {
	Streams []StreamSummary   `json:"streams"`
	Offline map[string]string `json:"offline"`
}

// StreamDetail is one stream's stats, config, replicas and sources.
type StreamDetail struct {
	StreamSummary `tstype:",extends"`
	Description   string    `json:"description"`
	Created       time.Time `json:"created" tstype:"string"`
	FirstSeq      uint64    `json:"firstSeq"`
	LastSeq       uint64    `json:"lastSeq"`
	NumDeleted    int       `json:"numDeleted"`
	NumSubjects   int       `json:"numSubjects"`
	// MaxPayload is the server's max_payload: the real size limit of one
	// message when the stream's max_msg_size is -1.
	MaxPayload int64 `json:"maxPayload"`
	// Config is the stream config exactly as the server sent it.
	Config  json.RawMessage `json:"config" tstype:"{ [key: string]: unknown }"`
	Cluster string          `json:"cluster,omitempty"`
	// ReplicaState lists the leader first, then the followers.
	ReplicaState []Replica     `json:"replicaState"`
	Mirror       *SourceState  `json:"mirror,omitempty"`
	Sources      []SourceState `json:"sources"`
}

// Replica is one server holding a copy of a stream.
type Replica struct {
	Name    string `json:"name"`
	Leader  bool   `json:"leader"`
	Current bool   `json:"current"`
	Offline bool   `json:"offline"`
	Lag     uint64 `json:"lag"` // operations behind the leader
	// Active is nanoseconds since the leader last heard from it.
	Active int64 `json:"active"`
}

// SourceState is how far a mirror or source is behind its origin stream.
type SourceState struct {
	Name   string `json:"name"`
	Filter string `json:"filter,omitempty"`
	Lag    uint64 `json:"lag"`
	// Active is nanoseconds since the last contact with the origin, -1 for never.
	Active int64  `json:"active"`
	Error  string `json:"error,omitempty"`
}

// StreamSubjects is the subjects a stream holds and their message counts,
// as STREAM.INFO with subjects_filter returns them. Truncated is set when the
// server returned only its first page.
type StreamSubjects struct {
	Filter    string            `json:"filter"`
	Subjects  map[string]uint64 `json:"subjects"`
	Truncated bool              `json:"truncated"`
}

// StreamPurge is the body of POST /api/streams/{name}/purge. With no Subject,
// Keep or Sequence it purges everything. Confirm must equal the stream name.
// Keep and Sequence are exclusive; the server refuses both.
type StreamPurge struct {
	Subject  string `json:"subject,omitempty"`
	Keep     uint64 `json:"keep,omitempty"`
	Sequence uint64 `json:"sequence,omitempty"` // purge up to but not including it
	Confirm  string `json:"confirm"`
}

// StreamPurged says how many messages a purge removed.
type StreamPurged struct {
	Purged uint64 `json:"purged"`
}

// StreamDelete is the body of DELETE /api/streams/{name}. Confirm must equal the stream name.
type StreamDelete struct {
	Confirm string `json:"confirm"`
}

// FieldError is the 400 body for a refused stream config. Field is the config
// key the message belongs to, or empty when it fits none.
type FieldError struct {
	Error string `json:"error"`
	Field string `json:"field,omitempty"`
}
