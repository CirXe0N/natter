package api

import "time"

// KVBucket is one row of the Key-Value screen's bucket list. A bucket is the
// stream KV_<bucket>.
type KVBucket struct {
	Bucket string `json:"bucket"`
	// Values counts stored entries: every kept revision and delete marker.
	Values  uint64 `json:"values"`
	History int64  `json:"history"` // revisions kept per key
	// TTL is how long values are kept, in seconds; 0 keeps them forever.
	TTL      int64  `json:"ttl"`
	Bytes    uint64 `json:"bytes"`
	Storage  string `json:"storage"` // file or memory
	Replicas int    `json:"replicas"`
}

// KVOp is what a revision did to its key.
type KVOp string

const (
	KVOpPut    KVOp = "put"
	KVOpDelete KVOp = "delete"
	KVOpPurge  KVOp = "purge" // a delete that also removed the key's earlier revisions
)

// KVEntry is one revision of a key, without its value.
type KVEntry struct {
	Key      string    `json:"key"`
	Revision uint64    `json:"revision"`
	Op       KVOp      `json:"op"`
	Created  time.Time `json:"created" tstype:"string"`
}

// KVKeys is the live key list of one bucket, on topic "kv:<bucket>". A Full
// frame holds every key and replaces the list. Any other frame holds each key
// changed since the last Full frame, at its latest revision, with deletes and
// purges as entries to remove; applying it twice is harmless.
type KVKeys struct {
	Full bool `json:"full,omitempty"`
	// Rev is the newest revision the frame includes. A frame that is not Full
	// and has a lower Rev than the last one applied is stale; skip it.
	Rev  uint64    `json:"rev"`
	Keys []KVEntry `json:"keys"`
	// Problem says, for the user, why the bucket cannot be watched.
	Problem string `json:"problem,omitempty"`
}
