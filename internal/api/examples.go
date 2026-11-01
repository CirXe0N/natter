package api

// Example is a saved message on one Context. Placeholders in Subject, Headers
// and Payload are stored as typed, unrendered. Folder is "" for the top level.
// Name is unique within a Context and Folder.
type Example struct {
	ID        string      `json:"id"`
	Context   string      `json:"context"`
	Name      string      `json:"name"`
	Folder    string      `json:"folder"`
	Mode      SendMode    `json:"mode"`
	Subject   string      `json:"subject"`
	Headers   [][2]string `json:"headers" tstype:"Headers"`
	Payload   string      `json:"payload"`
	TimeoutMs int         `json:"timeoutMs,omitempty"`
}

// ConflictChoice says what a copy does with an Example that already has the
// same Folder and Name on the target Context. Keep stores both, naming the new
// one "<name> (copy)"; replace overwrites the existing one; skip drops the copy.
type ConflictChoice string

const (
	ConflictKeep    ConflictChoice = "keep"
	ConflictReplace ConflictChoice = "replace"
	ConflictSkip    ConflictChoice = "skip"
)

// ExampleCopy copies Examples (by ID) to another Context as independent
// copies. Choices needs an entry for every ID that conflicts.
type ExampleCopy struct {
	IDs     []string                  `json:"ids"`
	Context string                    `json:"context"`
	Choices map[string]ConflictChoice `json:"choices"`
}
