#!/bin/sh
# The off-site copier (src/server/db/README.md, "The copier's contract"), run in the rclone/rclone image.
#   rclone-backup.sh        a pass now and every hour after
#   rclone-backup.sh once   one pass; exits 1 when a copy or the prune failed
# A pass copies departures.json, then every generation that has manifest.json and no copied marker, writes the marker
# after each success, then prunes the remote. The remote mirrors backup/: <remote>/departures.json, <remote>/<id>/ and
# the picture pool <remote>/files/, where scripts/restore.sh looks for them.
# One copier per remote prefix: the prune takes every object under it as this machine's, and the lock below serializes
# passes inside one container only.
set -u
LOCAL=/data/backup
REMOTE=${HAZELLE_BACKUP_REMOTE:?set HAZELLE_BACKUP_REMOTE to an rclone remote and path, e.g. r2:hazelle-backup}
# Equals the app's retention (src/server/backup/snapshots.ts). Both sides drop most of a day's generations sooner (prune
# below), the machine only once they are copied here, so the pool prune still finds every kept generation's pictures
# locally or here.
BACKUP_RETENTION_MS=$((7 * 24 * 60 * 60 * 1000))

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

pending() {
  for dir in "$LOCAL"/[0-9]*-*; do
    if [ -f "$dir/manifest.json" ] && [ ! -f "$dir/copied" ]; then basename "$dir"; fi
  done
}

# copy, never sync: a generation the app expired locally stays on the remote until prune removes it. The manifest goes
# last, so a remote generation with a manifest holds every file it names.
copy_generation() {
  generation=$1
  manifest="$LOCAL/$generation/manifest.json"
  pictures "$manifest" "$generation" >/dev/null || return 1
  bucket=$(snapshot_bucket "$manifest") || return 1
  work=$(mktemp -d) || return 1
  if [ -n "$bucket" ]; then
    snapshots "$manifest" >"$work/snapshots" || { rm -rf "$work"; return 1; }
    # One call for them all: one each took four minutes for 162 accounts' archives (2026-11-26), four seconds this way.
    # --files-from passes over a name the source lacks and still exits 0, so the pool is listed back and must hold
    # every one. --checksum: an archive put again by a restore has a new time and the same bytes.
    if [ -s "$work/snapshots" ]; then
      rclone copy "files:$bucket/snapshots" "$REMOTE/snapshots/$bucket" --files-from-raw "$work/snapshots" --immutable --checksum &&
        rclone lsf -R --files-only "$REMOTE/snapshots/$bucket" --files-from-raw "$work/snapshots" >"$work/pooled" &&
        [ "$(sort "$work/pooled")" = "$(sort "$work/snapshots")" ] || { rm -rf "$work"; return 1; }
    fi
  fi
  rclone copy "$LOCAL/$generation" "$REMOTE/$generation" --exclude manifest.json --exclude copied &&
    rclone copyto "$manifest" "$REMOTE/$generation/manifest.json" &&
    date -u +%Y-%m-%dT%H:%M:%SZ >"$work/copied" &&
    rclone copyto "$work/copied" "$REMOTE/$generation/copied" &&
    mv "$work/copied" "$LOCAL/$generation/copied"
  status=$?
  rm -rf "$work"
  return "$status"
}

# V4 records the R2 bucket because compose deliberately gives the copier no app-store environment. The mounted
# rclone config must supply [files] with access to that bucket (infra/README.md).
snapshot_bucket() {
  if ! grep -q '^{"version":4,' "$1"; then return 0; fi
  if grep -q '"snapshotStore":{"kind":"disk"}' "$1"; then return 0; fi
  bucket=$(sed -n 's/.*"snapshotStore":{"kind":"r2","bucket":"\([a-z0-9.-]*\)"}.*/\1/p' "$1")
  [ -n "$bucket" ] || return 1
  printf '%s\n' "$bucket"
}

snapshots() {
  # path is last in each entry, and operations follows the list (generation.ts, scripts/restore.sh). A writer that
  # changes either must fail the copy, not silently mark a generation whose archives were omitted.
  entry='\{[^}]*"path":"snapshots/[0-9a-f]{32}/[0-9]+-[0-9a-f]{12}\.sqlite\.gz"\}'
  grep -Eq "\"snapshots\":\[($entry(,$entry)*)?\],\"operations\":\[" "$1" || return 1
  sed -n 's/.*"snapshots":\[\([^]]*\)\],"operations".*/\1/p' "$1" |
    tr '}' '\n' | sed -n 's|.*"path":"snapshots/\([0-9a-f]\{32\}/[0-9]*-[0-9a-f]\{12\}\.sqlite\.gz\)".*|\1|p'
}

# Prints the pooled picture ids of manifest $1, which must be generation $2's and whole. The pattern follows the key
# order captureGeneration writes (src/server/backup/generation.ts: one line, "bucket" before "pictures", "pictures"
# once, "migrations" last), so no cut-off prefix of a manifest matches it; a change of that order fails every prune
# here until this follows it. A version 2 or 3 manifest whose bucket is r2 names pictures in the app's R2 store, not in the
# pool: it prints none, so the pool of the generations before a switch to R2 empties as they go.
pictures() {
  grep -Eq "^\{\"version\":[1234],\"id\":\"$2\",.*\"pictures\":\[(\"[0-9a-f]{64}\"(,\"[0-9a-f]{64}\")*)?\],\"migrations\":\[[^]]*\]\}\$" "$1" || return 1
  if grep -q '^{"version":[234],.*,"bucket":"r2",' "$1"; then return 0; fi
  sed -e 's/.*"pictures":\[\([^]]*\)\],"migrations".*/\1,/' -e 's/"//g' -e 's/,/\n/g' "$1"
}

# Every pooled picture that no remote manifest and no local generation names. Each step is checked: a failed listing,
# read, sort or write, or a manifest that is not whole, returns before anything is deleted.
prune_pool() {
  work=$1
  rclone lsf -R --files-only --include '/*/manifest.json' "$REMOTE" >"$work/manifests" || return 1
  # The local pool holds the pictures of every generation this machine keeps, so a manifest that a lagging listing
  # does not show yet cannot cost its pictures. Assumes no listing lags behind by the retention.
  ls "$LOCAL/files" >"$work/named" || return 1
  : >"$work/snapshots.named" || return 1
  while IFS= read -r manifest; do
    rclone cat "$REMOTE/$manifest" >"$work/manifest" || return 1
    pictures "$work/manifest" "${manifest%/manifest.json}" >>"$work/named" || { log "$manifest is not whole"; return 1; }
    bucket=$(snapshot_bucket "$work/manifest") || return 1
    if [ -n "$bucket" ]; then
      snapshots "$work/manifest" >"$work/snapshot.keys" || return 1
      sed "s|^|$bucket/|" "$work/snapshot.keys" >>"$work/snapshots.named" || return 1
    fi
  done <"$work/manifests"
  prune_snapshots "$work" || return 1
  # From the root: the remote has no files/ until a generation names a picture, and listing it would fail.
  rclone lsf -R --files-only --include '/files/*' "$REMOTE" >"$work/listed" || return 1
  sed 's|^files/||' "$work/listed" >"$work/pool" || return 1
  sort -u "$work/named" >"$work/named.sorted" || return 1
  sort "$work/pool" >"$work/pool.sorted" || return 1
  comm -23 "$work/pool.sorted" "$work/named.sorted" >"$work/unnamed" || return 1
  [ -s "$work/unnamed" ] || return 0
  rclone delete "$REMOTE/files" --files-from-raw "$work/unnamed" || return 1
  log "pruned $(wc -l <"$work/unnamed") pictures"
}

# A source object protects a pool entry even if a manifest listing lags. Pool paths retain the source bucket name,
# so the last manifest expiring never loses the information needed to test the source.
prune_snapshots() {
  work=$1
  rclone lsf -R --files-only --include '/snapshots/**' "$REMOTE" >"$work/snapshots.listed" || return 1
  sed 's|^snapshots/||' "$work/snapshots.listed" >"$work/snapshots.pool" || return 1
  cut -d/ -f1 "$work/snapshots.pool" | sort -u >"$work/buckets" || return 1
  while IFS= read -r bucket; do
    [ -n "$bucket" ] || continue
    rclone lsf -R --files-only "files:$bucket/snapshots" >"$work/source" || return 1
    sed "s|^|$bucket/|" "$work/source" >>"$work/snapshots.named" || return 1
  done <"$work/buckets"
  sort -u "$work/snapshots.named" >"$work/snapshots.named.sorted" || return 1
  sort "$work/snapshots.pool" >"$work/snapshots.pool.sorted" || return 1
  comm -23 "$work/snapshots.pool.sorted" "$work/snapshots.named.sorted" >"$work/snapshots.unnamed" || return 1
  [ -s "$work/snapshots.unnamed" ] || return 0
  rclone delete "$REMOTE/snapshots" --files-from-raw "$work/snapshots.unnamed" || return 1
}

# A generation goes at the retention, and one with a manifest sooner unless it is one of the two newest with a manifest
# or the newest with a manifest of its UTC day; then the pool. Read from the remote listing alone, so a machine that lost
# its generations never empties the remote. The same rule as thinGenerations (src/server/backup/generation.ts) for a
# copied generation: change both together. One without a manifest is a copy cut off, which the next pass completes.
prune() {
  now_ms=$(($(date +%s) * 1000))
  dirs=$(rclone lsf --dirs-only "$REMOTE") || return 1
  manifests=$(rclone lsf -R --files-only --include '/*/manifest.json' "$REMOTE") || return 1
  whole=0
  days=' '
  for id in $(printf '%s\n' $dirs | sed 's|/$||' | sort -t- -k1,1nr); do
    at=${id%%-*}
    case $at in '' | *[!0-9]*) continue ;; esac
    if [ $((now_ms - at)) -ge "$BACKUP_RETENTION_MS" ]; then
      drop=1
    elif printf '%s\n' $manifests | grep -qx "$id/manifest.json"; then
      day=$((at - at % 86400000))
      drop=1
      if [ "$whole" -lt 2 ]; then drop=0; fi
      case $days in *" $day "*) ;; *) drop=0 ;; esac
      whole=$((whole + 1))
      days="$days$day "
    else
      drop=0
    fi
    if [ "$drop" = 1 ]; then
      rclone purge "$REMOTE/$id" || return 1
      log "pruned $id"
    fi
  done
  work=$(mktemp -d) || return 1
  prune_pool "$work"
  status=$?
  rm -rf "$work"
  return "$status"
}

pass() {
  # Overwritten whole on every pass, as the app rewrites it (src/server/backup/departures.ts), so a departure reaches the
  # remote within the hour; the remote's expired entries go with the overwrite. Without the file the app has captured no
  # generation here yet, and the remote's is left alone.
  if [ -f "$LOCAL/departures.json" ]; then
    rclone copyto "$LOCAL/departures.json" "$REMOTE/departures.json" || { log "departures copy failed"; return 1; }
  fi
  ids=$(pending)
  if [ -n "$ids" ]; then
    # The pool first, so no copied generation names a picture the remote lacks.
    rclone copy "$LOCAL/files" "$REMOTE/files" || { log "pool copy failed; nothing marked"; return 1; }
    failed=0
    for id in $ids; do
      if copy_generation "$id"; then log "copied $id"; else log "copy of $id failed; not marked"; failed=1; fi
    done
    [ "$failed" = 0 ] || return 1
  fi
  # No pool yet: the app has not begun its first generation, and the remote may not exist.
  [ -d "$LOCAL/files" ] || return 0
  prune || { log "prune failed"; return 1; }
}

# One pass at a time per container: deploy.sh runs a pass beside the loop's, and a prune that listed the manifests
# before the other pass uploaded one would take that generation's new pictures.
locked_pass() { (flock 9 && pass) 9>/tmp/rclone-backup.lock; }

if [ "${1:-}" = once ]; then
  locked_pass
  exit
fi
trap 'exit 0' TERM INT
while :; do
  locked_pass || log "pass failed; next try in an hour"
  sleep 3600 &
  wait $!
done
