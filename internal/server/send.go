package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/placeholders"
)

// Sending is not exempt from Read-only mode: the route sets no allowReadOnly,
// so the wrapper in New refuses it, requests included.
func init() {
	routes = append(routes,
		route{pattern: "POST /api/send", handle: (*server).send},
		// Rendering a preview sends nothing, so Read-only mode lets it through.
		route{pattern: "POST /api/send/preview", handle: (*server).sendPreview, allowReadOnly: true},
	)
}

const (
	defaultSendTimeout = 2 * time.Second
	maxSendTimeout     = time.Minute
	maxSendCount       = 10000
)

var (
	validHeaderKey = regexp.MustCompile(`^[!-9;-~]+$`) // printable ASCII but no colon
	badSubject     = regexp.MustCompile(`[\s*>]`)
)

func (s *server) send(w http.ResponseWriter, r *http.Request) {
	a := s.Contexts.Active()
	switch {
	case a == nil:
		http.Error(w, "No Context is active. Pick one on the Contexts screen.", http.StatusConflict)
		return
	case a.NC == nil || !a.NC.IsConnected():
		http.Error(w, fmt.Sprintf("%s is not connected (%s).", a.Context.Name, a.Status), http.StatusConflict)
		return
	}
	// JSON can spell one byte as six, so the body limit scales with max_payload.
	limit := int64(a.NC.MaxPayload())*6 + maxBody
	var req api.SendRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, limit)).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := checkSend(req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	count := max(req.Count, 1)
	timeout := defaultSendTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}

	var res api.SendResult
	var msg *nats.Msg
	var err error
	start := time.Now()
	for i := 1; i <= count; i++ {
		if msg, err = buildMsg(req, i); err != nil {
			if i == 1 {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			res.Status, res.Error = api.SendStatusError, fmt.Sprintf("Message %d was not sent: %s", i, err)
			break
		}
		if size, limit := len(msg.Data)+headerSize(msg.Header), int(a.NC.MaxPayload()); size > limit {
			if i == 1 {
				tooLarge(w, size, limit)
				return
			}
			res.Status, res.Error = api.SendStatusError, fmt.Sprintf("Message %d is %d bytes, over the server's max_payload of %d bytes.", i, size, limit)
			break
		}
		start = time.Now()
		res = api.SendResult{Sent: res.Sent}
		if req.Mode == api.SendModePub {
			err = a.NC.PublishMsg(msg)
			if err == nil && i == count {
				err = a.NC.FlushTimeout(defaultSendTimeout)
			}
			res.Status = api.SendStatusPublished
		} else {
			var reply *nats.Msg
			reply, err = a.NC.RequestMsg(msg, timeout)
			if reply != nil {
				res.Reply = &api.Reply{Subject: reply.Subject, Headers: headerList(reply.Header), Payload: string(reply.Data), Size: len(reply.Data) + headerSize(reply.Header)}
				res.Status = api.SendStatusOK
				if e := reply.Header.Get("Nats-Service-Error"); e != "" {
					res.Status, res.Error = api.SendStatusError, e
				}
			}
		}
		res.LatencyMs = float64(time.Since(start)) / float64(time.Millisecond)
		switch {
		case err == nil:
		case errors.Is(err, nats.ErrMaxPayload):
			if i == 1 {
				tooLarge(w, len(msg.Data)+headerSize(msg.Header), int(a.NC.MaxPayload()))
				return
			}
			res.Status, res.Error = api.SendStatusError, err.Error()
		case errors.Is(err, nats.ErrNoResponders):
			res.Status = api.SendStatusNoResponders
		case errors.Is(err, nats.ErrTimeout):
			res.Status = api.SendStatusTimeout
		default:
			res.Status, res.Error = api.SendStatusError, err.Error()
		}
		if err == nil {
			res.Sent++
		}
		// A bulk send stops at the first message that did not go through.
		if res.Status != api.SendStatusPublished && res.Status != api.SendStatusOK {
			break
		}
	}
	writeJSON(w, res)
}

// sendPreview renders message number 1 of the request, so the browser needs no
// Placeholder code of its own. It sends nothing and needs no connection.
func (s *server) sendPreview(w http.ResponseWriter, r *http.Request) {
	var req api.SendRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body: "+err.Error(), http.StatusBadRequest)
		return
	}
	var p api.SendPreview
	p.Subject, p.SubjectError = render(req.Subject, 1)
	p.Payload, p.PayloadError = render(req.Payload, 1)
	p.Headers, p.HeaderErrors = [][2]string{}, []string{}
	for _, h := range req.Headers {
		v, msg := render(strings.TrimSpace(h[1]), 1)
		p.Headers = append(p.Headers, [2]string{h[0], v})
		p.HeaderErrors = append(p.HeaderErrors, msg)
	}
	writeJSON(w, p)
}

// render expands Placeholders like natscli. A bad one leaves the text as typed
// and comes back as a message.
func render(text string, n int) (string, string) {
	out, err := placeholders.Render(text, n)
	if err != nil {
		return out, err.Error()
	}
	return out, ""
}

func tooLarge(w http.ResponseWriter, size, max int) {
	http.Error(w, fmt.Sprintf("The message is %d bytes, over the server's max_payload of %d bytes. Nothing was sent.", size, max), http.StatusRequestEntityTooLarge)
}

// checkSend validates what does not change from one message to the next.
func checkSend(req api.SendRequest) error {
	if req.Mode != api.SendModePub && req.Mode != api.SendModeReq {
		return errors.New(`mode must be "pub" or "req".`)
	}
	if req.TimeoutMs < 0 || time.Duration(req.TimeoutMs)*time.Millisecond > maxSendTimeout {
		return errors.New("The timeout must be between 0 and 60000 ms.")
	}
	if req.Count < 0 || req.Count > maxSendCount {
		return fmt.Errorf("The count must be between 1 and %d.", maxSendCount)
	}
	return nil
}

// buildMsg renders message number n and checks it. Placeholders work in the
// subject, header values and payload, never in header names. A bad one in the
// subject or payload leaves that text as typed, and in a header value it is an
// error, as in natscli. Headers keep their order and their spelling, and a
// repeated key becomes several values.
func buildMsg(req api.SendRequest, n int) (*nats.Msg, error) {
	subject, _ := placeholders.Render(req.Subject, n)
	if subject == "" || badSubject.MatchString(subject) || strings.HasPrefix(subject, ".") || strings.HasSuffix(subject, ".") || strings.Contains(subject, "..") {
		return nil, errors.New("The subject must be a literal subject: tokens separated by dots, with no spaces or wildcards.")
	}
	msg := nats.NewMsg(subject)
	payload, _ := placeholders.Render(req.Payload, n)
	msg.Data = []byte(payload)
	for _, h := range req.Headers {
		if !validHeaderKey.MatchString(h[0]) {
			return nil, fmt.Errorf("%q is not a valid header name.", h[0])
		}
		if strings.ContainsAny(h[1], "\r\n") {
			return nil, fmt.Errorf("The value of header %q has a line break.", h[0])
		}
		v, err := placeholders.Render(strings.TrimSpace(h[1]), n)
		if err != nil {
			return nil, fmt.Errorf("The value of header %q has a bad placeholder: %s", h[0], err)
		}
		msg.Header[h[0]] = append(msg.Header[h[0]], v)
	}
	return msg, nil
}

// headerSize is the encoded size of h on the wire, as nats.go counts it.
func headerSize(h nats.Header) int {
	if len(h) == 0 {
		return 0
	}
	n := len("NATS/1.0\r\n") + 2
	for k, vs := range h {
		for _, v := range vs {
			n += len(k) + len(strings.TrimSpace(v)) + 4
		}
	}
	return n
}

func headerList(h nats.Header) [][2]string {
	out := [][2]string{}
	for k, vs := range h {
		for _, v := range vs {
			out = append(out, [2]string{k, v})
		}
	}
	slices.SortFunc(out, func(a, b [2]string) int { return strings.Compare(a[0], b[0]) })
	return out
}
