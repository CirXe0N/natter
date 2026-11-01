package placeholders

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

// testdata/natscli-v0.5.1.json holds what natscli v0.5.1's own
// PubReplyBodyTemplate returned for each input; Render must give the same.
func TestRenderMatchesNatscli(t *testing.T) {
	raw, err := os.ReadFile("testdata/natscli-v0.5.1.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		In    string `json:"in"`
		Count int    `json:"count"`
		Out   string `json:"out"`
		Err   bool   `json:"err"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		out, err := Render(c.In, c.Count)
		if out != c.Out || (err != nil) != c.Err {
			t.Errorf("Render(%q, %d) = %q, %v; natscli gave %q, error %v", c.In, c.Count, out, err, c.Out, c.Err)
		}
	}
}

func TestRenderTimeAndRandom(t *testing.T) {
	for in, shape := range map[string]string{
		"{{TimeStamp}}":  `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$`,
		"{{Unix}}":       `^\d{10}$`,
		"{{UnixNano}}":   `^\d{19}$`,
		"{{Time}}":       `^\d{1,2}:\d\d(AM|PM)$`,
		"{{ID}}":         `^[0-9A-Za-z]{22}$`,
		"{{Random 4 4}}": `^[0-9A-Za-z]{4}$`,
		"{{Random 3 9}}": `^[0-9A-Za-z]{3,9}$`,
		"{{Random 9 3}}": `^[0-9A-Za-z]{3,9}$`,
	} {
		out, err := Render(in, 1)
		if err != nil || !regexp.MustCompile(shape).MatchString(out) {
			t.Errorf("Render(%q) = %q, %v; want shape %s", in, out, err, shape)
		}
	}
	a, _ := Render("{{ID}}", 1)
	b, _ := Render("{{ID}}", 1)
	if a == b || strings.Contains(a, "{{") {
		t.Errorf("two IDs should differ: %q %q", a, b)
	}
}
