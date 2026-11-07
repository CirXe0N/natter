#!/bin/sh
# Writes THIRD_PARTY_LICENSES.txt: the licence files of every Go module linked
# into cmd/natter and every production npm package bundled into web/dist.
# Needs `npm --prefix web ci` first. Run by GoReleaser's before hook.
set -eu
out=THIRD_PARTY_LICENSES.txt
: > "$out"
emit() { # name version dir
  printf '\n================================================================\n%s %s\n================================================================\n' "$1" "$2" >> "$out"
  found=0
  for f in $(find "$3" -maxdepth 1 -type f \( -iname 'licen[cs]e*' -o -iname 'copying*' -o -iname 'notice*' \)); do
    cat "$f" >> "$out"; printf '\n' >> "$out"; found=1
  done
  [ "$found" = 1 ] && return
  # Some npm packages ship no licence file, only the SPDX id in package.json.
  spdx=$(sed -n 's/.*"license": *"\([^"]*\)".*/\1/p' "$3/package.json" 2>/dev/null | head -1)
  [ -n "$spdx" ] || { echo "licenses.sh: no licence for $1 $2" >&2; exit 1; }
  printf 'Licence (from package.json, no licence file shipped): %s\n' "$spdx" >> "$out"
}
go list -deps -f '{{with .Module}}{{if not .Main}}{{.Path}} {{.Version}} {{.Dir}}{{end}}{{end}}' ./cmd/natter |
  sort -u | while read -r path ver dir; do emit "$path" "$ver" "$dir"; done
# One path per line. Not --long: its ":" fields clash with Windows drive letters.
npm --prefix web ls --omit=dev --all --parseable 2>/dev/null | tail -n +2 |
  while read -r dir; do
    command -v cygpath >/dev/null && dir=$(cygpath -u "$dir")
    emit "$(sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' "$dir/package.json" | head -1)" \
         "$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$dir/package.json" | head -1)" "$dir"
  done
