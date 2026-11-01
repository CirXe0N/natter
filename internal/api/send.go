package api

// SendMode says how a message goes out: pub publishes it, req sends it as a
// request and waits for one reply.
type SendMode string

const (
	SendModePub SendMode = "pub"
	SendModeReq SendMode = "req"
)

// SendRequest is one message to send. The shape matches an Example message:
// Headers is an ordered list of key and value, because a key may repeat.
// TimeoutMs applies to a request only. Zero means the default of 2000.
type SendRequest struct {
	Mode      SendMode    `json:"mode"`
	Subject   string      `json:"subject"`
	Headers   [][2]string `json:"headers" tstype:"Headers"`
	Payload   string      `json:"payload"`
	TimeoutMs int         `json:"timeoutMs"`
	// Count is how many messages to send, like nats pub --count. Zero means 1.
	// Subject, header values and payload may hold Placeholders, rendered anew
	// for each message, with {{Count}} running from 1.
	Count int `json:"count"`
}

// SendPreview is message number 1 of a SendRequest with its Placeholders
// rendered. An error field holds the reason when that text has a bad
// Placeholder (an unknown name, a broken {{…}}); the text then stays as typed.
// HeaderErrors parallels Headers, with "" for a header that is fine.
type SendPreview struct {
	Subject      string      `json:"subject"`
	SubjectError string      `json:"subjectError,omitempty"`
	Headers      [][2]string `json:"headers" tstype:"Headers"`
	HeaderErrors []string    `json:"headerErrors"`
	Payload      string      `json:"payload"`
	PayloadError string      `json:"payloadError,omitempty"`
}

// SendStatus is how a send ended. A request that got a reply with a
// Nats-Service-Error header ends in SendStatusError, like one the server
// refused, so it is never taken for a success.
type SendStatus string

const (
	SendStatusPublished    SendStatus = "published"
	SendStatusOK           SendStatus = "ok"
	SendStatusNoResponders SendStatus = "no-responders"
	SendStatusTimeout      SendStatus = "timeout"
	SendStatusError        SendStatus = "error"
)

// Reply is the one message a request got back.
type Reply struct {
	Subject string      `json:"subject"`
	Headers [][2]string `json:"headers" tstype:"Headers"`
	Payload string      `json:"payload"`
	Size    int         `json:"size"`
}

// SendResult says what happened. LatencyMs is how long a request took, or how
// long the flush took for a publish. Error carries the reason for
// SendStatusError. A send that is refused before it goes out (too large, a bad
// subject, Read-only mode) is an HTTP error and has no result.
type SendResult struct {
	Status    SendStatus `json:"status"`
	LatencyMs float64    `json:"latencyMs"`
	Reply     *Reply     `json:"reply,omitempty"`
	Error     string     `json:"error,omitempty"`
	// Sent is how many messages went out. Result is the last one's.
	Sent int `json:"sent"`
}
