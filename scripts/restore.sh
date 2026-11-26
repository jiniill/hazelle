#!/usr/bin/env sh
# Restores one local generation into an empty data directory, offline. The server must not start until this ends.
# Disk pictures are pooled beside the generation; R2 pictures stay in the configured store. fetch brings a v4 R2
# generation's archives from the backup pool into its directory before restore-cli verifies every archive hash, and
# departures.json beside it, which restore-cli replays and refuses to go without unless given --without-departures.
#   scripts/restore.sh <generation directory> <empty data directory> [--snapshots-from-store] [--without-departures]
# fetch runs where rclone and its backup credentials are available (the copier container); it never reads the
# picture bucket for archives. --snapshots-from-store is explicit for a local v4 generation, not a fallback.
#   scripts/restore.sh fetch <backup remote> <generation id> <download directory>
set -eu
if [ "${1:-}" = fetch ]; then
  [ $# = 4 ] || { echo "usage: restore.sh fetch <backup remote> <generation id> <download directory>" >&2; exit 2; }
  remote=$2 id=$3 root=$4
  rclone copy "$remote/$id" "$root/$id"
  manifest="$root/$id/manifest.json"
  [ -f "$manifest" ] || { echo "restore: missing manifest" >&2; exit 1; }
  rclone copyto "$remote/departures.json" "$root/departures.json" ||
    echo "restore: no departures.json fetched from $remote; restore-cli refuses without --without-departures" >&2
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  if grep -q '^{"version":4,.*"snapshotStore":{"kind":"r2",' "$manifest"; then
    bucket=$(sed -n 's/.*"snapshotStore":{"kind":"r2","bucket":"\([a-z0-9.-]*\)"}.*/\1/p' "$manifest")
    [ -n "$bucket" ] || exit 1
    # The same entry order guard as deploy/rclone-backup.sh snapshots().
    entry='\{[^}]*"path":"snapshots/[0-9a-f]{32}/[0-9]+-[0-9a-f]{12}\.sqlite\.gz"\}'
    grep -Eq "\"snapshots\":\[($entry(,$entry)*)?\],\"operations\":\[" "$manifest"
    sed -n 's/.*"snapshots":\[\([^]]*\)\],"operations".*/\1/p' "$manifest" | tr '}' '\n' |
      sed -n 's|.*"path":"snapshots/\([0-9a-f]\{32\}/[0-9]*-[0-9a-f]\{12\}\.sqlite\.gz\)".*|\1|p' >"$work/snapshots"
    # One call, not one each. A name the pool lacks is passed over here and refused by restore-cli as missing.
    rclone copy "$remote/snapshots/$bucket" "$root/$id/snapshots" --files-from-raw "$work/snapshots"
  fi
  if ! grep -q '"bucket":"r2"' "$manifest"; then
    sed -n 's/.*"pictures":\[\([^]]*\)\].*/\1/p' "$manifest" | tr -d '"' | tr , '\n' >"$work/pictures"
    if [ -s "$work/pictures" ]; then rclone copy "$remote/files" "$root/files" --files-from-raw "$work/pictures"; fi
  fi
  exit 0
fi
exec node "$(dirname "$0")/../dist/server/restore-cli.js" "$@"
