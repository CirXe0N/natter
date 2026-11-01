// Package examples keeps Example messages in one JSON file in Natter's own
// directory. Every call is a locked read-modify-write, so two natter processes
// can share the file.
package examples

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/atomicfile"
)

var (
	ErrInvalid  = errors.New("invalid value")
	ErrUnknown  = errors.New("no such Example message")
	ErrConflict = errors.New("an Example message with that name is already in the folder")
)

type Store struct{ path string }

// Open returns the Store kept in dir. It touches nothing on disk.
func Open(dir string) *Store { return &Store{path: filepath.Join(dir, "examples.json")} }

func (s *Store) read() ([]api.Example, error) {
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var all []api.Example
	return all, json.Unmarshal(b, &all)
}

// change runs fn on the stored list under the lock and saves what it leaves.
func (s *Store) change(fn func(all []api.Example) ([]api.Example, error)) error {
	unlock, err := atomicfile.Lock(s.path + ".lock")
	if err != nil {
		return err
	}
	defer unlock()
	all, err := s.read()
	if err != nil {
		return err
	}
	if all, err = fn(all); err != nil {
		return err
	}
	b, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	return atomicfile.Write(s.path, b)
}

func (s *Store) List() ([]api.Example, error) {
	unlock, err := atomicfile.Lock(s.path + ".lock")
	if err != nil {
		return nil, err
	}
	defer unlock()
	all, err := s.read()
	if all == nil {
		all = []api.Example{}
	}
	return all, err
}

func (s *Store) Get(id string) (api.Example, error) {
	all, err := s.List()
	if err != nil {
		return api.Example{}, err
	}
	if i := index(all, id); i >= 0 {
		return all[i], nil
	}
	return api.Example{}, ErrUnknown
}

func index(all []api.Example, id string) int {
	return slices.IndexFunc(all, func(e api.Example) bool { return e.ID == id })
}

// find returns the position of the Example other than skipID that holds the name.
func find(all []api.Example, e api.Example, skipID string) int {
	return slices.IndexFunc(all, func(o api.Example) bool {
		return o.ID != skipID && o.Context == e.Context && o.Folder == e.Folder && o.Name == e.Name
	})
}

func check(e *api.Example) error {
	e.Name, e.Folder, e.Context = strings.TrimSpace(e.Name), strings.Trim(strings.TrimSpace(e.Folder), "/"), strings.TrimSpace(e.Context)
	switch {
	case e.Name == "" || e.Context == "":
		return fmt.Errorf("%w: a name and a Context are needed", ErrInvalid)
	case e.Mode != api.SendModePub && e.Mode != api.SendModeReq:
		return fmt.Errorf("%w: mode must be pub or req", ErrInvalid)
	case strings.TrimSpace(e.Subject) == "":
		return fmt.Errorf("%w: a subject is needed", ErrInvalid)
	}
	if e.Headers == nil {
		e.Headers = [][2]string{}
	}
	return nil
}

func (s *Store) Create(e api.Example) (api.Example, error) {
	e.ID = rand.Text()
	if err := check(&e); err != nil {
		return e, err
	}
	return e, s.change(func(all []api.Example) ([]api.Example, error) {
		if find(all, e, "") >= 0 {
			return nil, ErrConflict
		}
		return append(all, e), nil
	})
}

// Update replaces the Example with e.ID. Rename and move are updates.
func (s *Store) Update(e api.Example) (api.Example, error) {
	if err := check(&e); err != nil {
		return e, err
	}
	return e, s.change(func(all []api.Example) ([]api.Example, error) {
		i := index(all, e.ID)
		if i < 0 {
			return nil, ErrUnknown
		}
		if find(all, e, e.ID) >= 0 {
			return nil, ErrConflict
		}
		all[i] = e
		return all, nil
	})
}

func (s *Store) Delete(id string) error {
	return s.change(func(all []api.Example) ([]api.Example, error) {
		i := index(all, id)
		if i < 0 {
			return nil, ErrUnknown
		}
		return slices.Delete(all, i, i+1), nil
	})
}

// Copy puts independent copies of the Examples with ids on context to. Every
// copy that lands on an existing name needs a choice, or nothing is written.
// It returns the Examples it created or replaced.
func (s *Store) Copy(ids []string, to string, choices map[string]api.ConflictChoice) ([]api.Example, error) {
	var made []api.Example
	err := s.change(func(all []api.Example) ([]api.Example, error) {
		type pair struct {
			c      api.Example
			at     int
			choice api.ConflictChoice
		}
		var plan []pair
		for _, id := range ids {
			i := index(all, id)
			if i < 0 {
				return nil, ErrUnknown
			}
			c := all[i]
			c.Context = strings.TrimSpace(to)
			c.Headers = slices.Clone(c.Headers)
			if err := check(&c); err != nil {
				return nil, err
			}
			p := pair{c: c, at: find(all, c, ""), choice: choices[id]}
			if p.at >= 0 && p.choice != api.ConflictKeep && p.choice != api.ConflictReplace && p.choice != api.ConflictSkip {
				return nil, fmt.Errorf("%w: %q already exists on %s; choose keep, replace or skip", ErrInvalid, c.Name, c.Context)
			}
			plan = append(plan, p)
		}
		for _, p := range plan {
			switch {
			case p.at >= 0 && p.choice == api.ConflictSkip:
				continue
			case p.at >= 0 && p.choice == api.ConflictReplace:
				p.c.ID = all[p.at].ID
				all[p.at] = p.c
			default:
				p.c.ID = rand.Text()
				base := p.c.Name
				for n := 1; find(all, p.c, "") >= 0; n++ {
					p.c.Name = copyName(base, n)
				}
				all = append(all, p.c)
			}
			made = append(made, p.c)
		}
		return all, nil
	})
	return made, err
}

func copyName(name string, n int) string {
	if n == 1 {
		return name + " (copy)"
	}
	return fmt.Sprintf("%s (copy %d)", name, n)
}
