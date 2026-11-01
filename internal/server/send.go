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
)

// Sending is not exempt from Read-only mode: the route sets no allowReadOnly,
// so the wrapper in New refuses it, requests included.
func init() {
	routes = append(routes, route{pattern: "POST /api/send", handle: (*server).send})
}

const (
	defaultSendTimeout = 2 * time.Second
	maxSendTimeout     = time.Minute
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
	msg, timeout, err := buildMsg(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if size, max := len(msg.Data)+headerSize(msg.Header), int(a.NC.MaxPayload()); size > max {
		tooLarge(w, size, max)
		return
	}

	start := time.Now()
	var res api.SendResult
	if req.Mode == api.SendModePub {
		err = a.NC.PublishMsg(msg)
		if err == nil {
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
		tooLarge(w, len(msg.Data)+headerSize(msg.Header), int(a.NC.MaxPayload()))
		return
	case errors.Is(err, nats.ErrNoResponders):
		res.Status = api.SendStatusNoResponders
	case errors.Is(err, nats.ErrTimeout):
		res.Status = api.SendStatusTimeout
	default:
		res.Status, res.Error = api.SendStatusError, err.Error()
	}
	writeJSON(w, res)
}

func tooLarge(w http.ResponseWriter, size, max int) {
	http.Error(w, fmt.Sprintf("The message is %d bytes, over the server's max_payload of %d bytes. Nothing was sent.", size, max), http.StatusRequestEntityTooLarge)
}

// buildMsg checks the request and turns it into a message. Headers keep their
// order and their spelling, and a repeated key becomes several values.
func buildMsg(req api.SendRequest) (*nats.Msg, time.Duration, error) {
	if req.Mode != api.SendModePub && req.Mode != api.SendModeReq {
		return nil, 0, errors.New(`mode must be "pub" or "req".`)
	}
	if req.Subject == "" || badSubject.MatchString(req.Subject) || strings.HasPrefix(req.Subject, ".") || strings.HasSuffix(req.Subject, ".") || strings.Contains(req.Subject, "..") {
		return nil, 0, errors.New("The subject must be a literal subject: tokens separated by dots, with no spaces or wildcards.")
	}
	if req.TimeoutMs < 0 || time.Duration(req.TimeoutMs)*time.Millisecond > maxSendTimeout {
		return nil, 0, errors.New("The timeout must be between 0 and 60000 ms.")
	}
	timeout := defaultSendTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	msg := nats.NewMsg(req.Subject)
	msg.Data = []byte(req.Payload)
	for _, h := range req.Headers {
		if !validHeaderKey.MatchString(h[0]) {
			return nil, 0, fmt.Errorf("%q is not a valid header name.", h[0])
		}
		if strings.ContainsAny(h[1], "\r\n") {
			return nil, 0, fmt.Errorf("The value of header %q has a line break.", h[0])
		}
		msg.Header[h[0]] = append(msg.Header[h[0]], h[1])
	}
	return msg, timeout, nil
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
