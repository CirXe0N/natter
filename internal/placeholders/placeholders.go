// Copyright 2025 The NATS Authors
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Package placeholders renders the {{Count}}, {{ID}} and friends in a subject,
// header value or payload exactly as natscli does. Render is copied from
// natscli v0.5.1, internal/util/headers.go (PubReplyBodyTemplate, without the
// Request function), and RandomString from internal/util/random.go. natscli
// keeps them in an internal package, so they cannot be imported.
package placeholders

import (
	"bytes"
	"math/rand/v2"
	"text/template"
	"time"

	"github.com/nats-io/nuid"
)

type data struct {
	Cnt       int
	Count     int
	Unix      int64
	UnixNano  int64
	TimeStamp string
	Time      string
}

// Render expands the placeholders in body for message number ctr. A bad
// template returns body unchanged with the error.
func Render(body string, ctr int) (string, error) {
	now := time.Now()
	funcMap := template.FuncMap{
		"Random":    randomString,
		"Count":     func() int { return ctr },
		"Cnt":       func() int { return ctr },
		"Unix":      func() int64 { return now.Unix() },
		"UnixNano":  func() int64 { return now.UnixNano() },
		"TimeStamp": func() string { return now.Format(time.RFC3339) },
		"Time":      func() string { return now.Format(time.Kitchen) },
		"ID":        func() string { return nuid.Next() },
	}

	templ, err := template.New("body").Funcs(funcMap).Parse(body)
	if err != nil {
		return body, err
	}

	var b bytes.Buffer
	err = templ.Execute(&b, &data{
		Cnt:       ctr,
		Count:     ctr,
		Unix:      now.Unix(),
		UnixNano:  now.UnixNano(),
		TimeStamp: now.Format(time.RFC3339),
		Time:      now.Format(time.Kitchen),
	})
	if err != nil {
		return body, err
	}

	return b.String(), nil
}

var letterRunes = []rune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")

// randomString generates a random string that includes only a-zA-Z0-9
func randomString(shortest uint, longest uint) string {
	if shortest > longest {
		shortest, longest = longest, shortest
	}

	var desired int

	if longest == shortest {
		desired = int(shortest)
	} else {
		desired = int(shortest) + rand.IntN(int(longest-shortest)+1)
	}

	b := make([]rune, desired)
	for i := range b {
		b[i] = letterRunes[rand.IntN(len(letterRunes))]
	}

	return string(b)
}
