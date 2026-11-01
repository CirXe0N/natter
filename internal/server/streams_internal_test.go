package server

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	jsmapi "github.com/nats-io/jsm.go/api"

	"github.com/CirXe0N/natter/internal/api"
)

func TestStreamHealth(t *testing.T) {
	peer := func(p jsmapi.PeerInfo) *jsmapi.ClusterInfo {
		return &jsmapi.ClusterInfo{Leader: "n1", Replicas: []*jsmapi.PeerInfo{{Name: "n2", Current: true}, &p}}
	}
	for _, c := range []struct {
		name string
		info jsmapi.StreamInfo
		want api.StreamHealth
	}{
		{"standalone", jsmapi.StreamInfo{}, api.StreamHealthOK},
		{"all current", jsmapi.StreamInfo{Cluster: peer(jsmapi.PeerInfo{Name: "n3", Current: true})}, api.StreamHealthOK},
		{"no leader", jsmapi.StreamInfo{Cluster: &jsmapi.ClusterInfo{}}, api.StreamHealthError},
		{"replica behind", jsmapi.StreamInfo{Cluster: peer(jsmapi.PeerInfo{Name: "n3", Lag: 9})}, api.StreamHealthWarning},
		{"replica offline", jsmapi.StreamInfo{Cluster: peer(jsmapi.PeerInfo{Name: "n3", Offline: true})}, api.StreamHealthWarning},
		{"broken mirror", jsmapi.StreamInfo{Mirror: &jsmapi.StreamSourceInfo{Name: "A", Error: &jsmapi.ApiError{Description: "gone"}}}, api.StreamHealthError},
		{"broken source", jsmapi.StreamInfo{Sources: []*jsmapi.StreamSourceInfo{{Name: "A"}, {Name: "B", Error: &jsmapi.ApiError{Description: "gone"}}}}, api.StreamHealthError},
		{"lost data", jsmapi.StreamInfo{State: jsmapi.StreamState{Lost: &jsmapi.LostStreamData{Msgs: []uint64{4}}}}, api.StreamHealthError},
	} {
		got, problem := health(&c.info)
		if got != c.want || (got == api.StreamHealthOK) != (problem == "") {
			t.Errorf("%s: %s %q, want %s", c.name, got, problem, c.want)
		}
	}
}

func TestFieldErrorPicksTheLongestMatchingKey(t *testing.T) {
	for msg, want := range map[string]string{
		"max msgs per subject must be positive":            "max_msgs_per_subject",
		"subjects overlap with an existing stream":         "subjects",
		"max msgs must be positive":                        "max_msgs",
		"duplicates window can not be larger then max age": "duplicate_window",
	} {
		rec := httptest.NewRecorder()
		writeFieldError(rec, jsmapi.ApiError{Code: 400, Description: msg})
		var got api.FieldError
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != 400 || got.Field != want {
			t.Errorf("%q: %d %+v, want field %s", msg, rec.Code, got, want)
		}
	}
}
