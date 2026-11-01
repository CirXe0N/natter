package api

import "time"

// MsgKind is what a previewed payload holds.
type MsgKind string

const (
	MsgKindJSON   MsgKind = "json"
	MsgKindText   MsgKind = "text"
	MsgKindBinary MsgKind = "binary"
)

// MsgMeta is one row of the message browser. Size is the payload size from
// Nats-Msg-Size, and Headers counts the message's own headers. Only a small
// payload is fetched for a Preview, so Kind is empty for a large one.
type MsgMeta struct {
	Seq     uint64    `json:"seq"`
	Subject string    `json:"subject"`
	Time    time.Time `json:"time" tstype:"string"`
	Size    int       `json:"size"`
	Headers int       `json:"headers"`
	Preview *string   `json:"preview,omitempty"`
	Kind    MsgKind   `json:"kind,omitempty"`
}

// MessagePageRequest asks a view's consumer for the next page. A request that
// does not continue where the last page ended (another Seq, a Time, another
// Filter) starts a new consumer there. Seq 0 and no Time start at the first
// message.
type MessagePageRequest struct {
	View   string     `json:"view"`
	Filter string     `json:"filter,omitempty"`
	Seq    uint64     `json:"seq,omitempty"`
	Time   *time.Time `json:"time,omitempty" tstype:"string"`
}

// MessagePage is up to 100 rows in sequence order. Pending is how many
// matching messages come after the last row, or after the start when there
// are no rows.
type MessagePage struct {
	Messages []MsgMeta `json:"messages"`
	Pending  uint64    `json:"pending"`
}

// Msg is one opened message: its metadata and its own headers. Its payload is
// served on its own, as raw bytes, by GET …/messages/{seq}/payload.
type Msg struct {
	Seq     uint64              `json:"seq"`
	Subject string              `json:"subject"`
	Time    time.Time           `json:"time" tstype:"string"`
	Size    int                 `json:"size"`
	Headers map[string][]string `json:"headers"`
}

// MsgDelete deletes one message. Erase overwrites its data on disk too.
type MsgDelete struct {
	Erase bool `json:"erase,omitempty"`
}
