package examples

import (
	"errors"
	"testing"

	"github.com/CirXe0N/natter/internal/api"
)

func ex(ctx, folder, name, payload string) api.Example {
	return api.Example{Context: ctx, Folder: folder, Name: name, Mode: api.SendModePub, Subject: "orders.{{id}}", Headers: [][2]string{{"X-A", "1"}, {"X-A", "2"}}, Payload: payload}
}

func TestRoundTripSurvivesReopen(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	a, err := s.Create(ex("dev", "orders", "new", `{"id":"{{uuid}}"}`))
	if err != nil {
		t.Fatal(err)
	}
	a.Name, a.Folder = "created", "archive"
	if _, err := s.Update(a); err != nil {
		t.Fatal(err)
	}
	b, _ := s.Create(ex("dev", "", "gone", ""))
	if err := s.Delete(b.ID); err != nil {
		t.Fatal(err)
	}

	got, err := Open(dir).List()
	if err != nil || len(got) != 1 {
		t.Fatalf("%v %v", got, err)
	}
	if got[0].Name != "created" || got[0].Folder != "archive" || got[0].Payload != `{"id":"{{uuid}}"}` || got[0].Subject != "orders.{{id}}" || len(got[0].Headers) != 2 {
		t.Fatalf("not stored as typed: %+v", got[0])
	}
	if err := s.Delete("nope"); !errors.Is(err, ErrUnknown) {
		t.Fatalf("%v", err)
	}
}

func TestNamesAreUniquePerContextAndFolder(t *testing.T) {
	s := Open(t.TempDir())
	a, _ := s.Create(ex("dev", "f", "n", ""))
	if _, err := s.Create(ex("dev", "f", "n", "")); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate: %v", err)
	}
	if _, err := s.Create(ex("dev", "g", "n", "")); err != nil {
		t.Fatalf("other folder: %v", err)
	}
	if _, err := s.Create(ex("prod", "f", "n", "")); err != nil {
		t.Fatalf("other context: %v", err)
	}
	a.Folder = "g"
	if _, err := s.Update(a); !errors.Is(err, ErrConflict) {
		t.Fatalf("move onto a taken name: %v", err)
	}
	for _, bad := range []api.Example{ex("dev", "", "", ""), {Context: "dev", Name: "x", Mode: "zap", Subject: "a"}, {Context: "dev", Name: "x", Mode: api.SendModePub}} {
		if _, err := s.Create(bad); !errors.Is(err, ErrInvalid) {
			t.Errorf("%+v: %v", bad, err)
		}
	}
}

func TestCopyToAnotherContextHandlesConflicts(t *testing.T) {
	s := Open(t.TempDir())
	keep, _ := s.Create(ex("dev", "f", "keep", "dev-keep"))
	repl, _ := s.Create(ex("dev", "f", "replace", "dev-replace"))
	skip, _ := s.Create(ex("dev", "f", "skip", "dev-skip"))
	fresh, _ := s.Create(ex("dev", "", "fresh", "dev-fresh"))
	old, _ := s.Create(ex("prod", "f", "replace", "prod-old"))
	s.Create(ex("prod", "f", "keep", "prod-keep"))
	s.Create(ex("prod", "f", "skip", "prod-skip"))

	ids := []string{keep.ID, repl.ID, skip.ID, fresh.ID}
	if _, err := s.Copy(ids, "prod", map[string]api.ConflictChoice{keep.ID: api.ConflictKeep}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("an unresolved conflict must fail: %v", err)
	}
	if all, _ := s.List(); len(all) != 7 {
		t.Fatalf("a refused copy wrote %d", len(all))
	}

	made, err := s.Copy(ids, "prod", map[string]api.ConflictChoice{keep.ID: api.ConflictKeep, repl.ID: api.ConflictReplace, skip.ID: api.ConflictSkip})
	if err != nil || len(made) != 3 {
		t.Fatalf("%v %v", made, err)
	}
	byKey := map[string]api.Example{}
	all, _ := s.List()
	for _, e := range all {
		byKey[e.Context+"/"+e.Folder+"/"+e.Name] = e
	}
	if len(all) != 9 {
		t.Fatalf("%d examples", len(all))
	}
	if e := byKey["prod/f/replace"]; e.Payload != "dev-replace" || e.ID != old.ID || e.Context != "prod" {
		t.Fatalf("replace: %+v", e)
	}
	if byKey["prod/f/keep"].Payload != "prod-keep" || byKey["prod/f/keep (copy)"].Payload != "dev-keep" {
		t.Fatalf("keep: %+v", byKey)
	}
	if byKey["prod/f/skip"].Payload != "prod-skip" || byKey["prod//fresh"].Payload != "dev-fresh" {
		t.Fatalf("skip or fresh: %+v", byKey)
	}
	// independent: editing the copy leaves the original alone
	c := byKey["prod//fresh"]
	c.Payload = "edited"
	if _, err := s.Update(c); err != nil {
		t.Fatal(err)
	}
	if o, _ := s.Get(fresh.ID); o.Payload != "dev-fresh" || c.ID == fresh.ID {
		t.Fatalf("copy is not independent: %+v", o)
	}
}
