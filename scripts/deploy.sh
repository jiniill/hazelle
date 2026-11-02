#!/usr/bin/env bash
# shellcheck disable=SC2016 # LIB and TRANSACTION expand on the machine
# Deploys a release to the hosted machine by its image digest:
#   scripts/deploy.sh v1.2.3
# or only captures the pre-upgrade backup ahead, which a deploy within 15 minutes uses (scripts/release.sh, see PREPARE):
#   scripts/deploy.sh --prepare
# Needs: a clean tree with the tag, gh logged in, docker, terraform state in infra/ (for the address), and ssh as root
# to the machine. Order: the release's digest and archive are checked against the tag's commit; then one ssh session,
# holding an flock on /run/hazelle-deploy.lock for an hour at most, reads the running digest, has the machine pull the
# image and the running app capture a pre-upgrade backup generation that the copier sends off-site, waits up to 5
# minutes for no reply to be running, records the running digest and that generation in /etc/hazelle/previous, changes
# the image, stops the old app and prints its drain outcome, and is done when the app container runs the selected digest
# and /api/health answers ok. Without the lock a second deploy could read the running digest, wait,
# and capture its generation after the first deploy migrated the database: a pair the recorded digest cannot restore.
# Exit 3: no pre-upgrade backup, nothing changed. Exit 4: the new image is selected but does not run healthy; run this
# again to retry the start, or recover as below. Exit 5: another deploy holds the lock, nothing changed.
# A session that ends without an outcome (connection lost, hour run out) stopped at an unknown step; the kernel drops
# its lock when its last process ends (until then a rerun exits 5). Run this again: /etc/hazelle/env tells where it
# stopped. The running digest still selected: nothing switched, and what it may have done (a pulled image, a
# generation, /etc/hazelle/previous naming the running digest and one of its generations) is harmless; the deploy runs
# from the start. The new digest selected:
# /etc/hazelle/previous was written before the switch, and the run retries the start as after exit 4.
#
# Recovery, when the new image fails or misbehaves. An image refuses a database newer than it knows, so starting the
# previous digest alone does not work once the new one migrated. As root on the machine:
#   { read -r previous; read -r generation; } </etc/hazelle/previous
#   hazelle-compose down
#   failed=/data.failed-$(date -u +%Y%m%dT%H%M%SZ) && mv /data "$failed"
#   mkdir /data /var/tmp/hazelle-restore && chown 1000:1000 /data /var/tmp/hazelle-restore
#   sed -i "s|^HAZELLE_IMAGE=.*|HAZELLE_IMAGE=$previous|" /etc/hazelle/env
#   fetch() { hazelle-compose run --rm --no-deps -v /var/tmp/hazelle-restore:/restore --entrypoint /bin/sh backup -c "$1" "$generation"; }
#   fetch 'rclone copy "$HAZELLE_BACKUP_REMOTE/$0" "/restore/$0" && rclone copyto "$HAZELLE_BACKUP_REMOTE/departures.json" /restore/departures.json'
#   fetch 'grep -q "\"bucket\":\"r2\"" "/restore/$0/manifest.json" ||
#     { sed -n "s/.*\"pictures\":\[\([^]]*\)\].*/\1/p" "/restore/$0/manifest.json" | tr -d "\"" | tr , "\n" >/tmp/pictures &&
#       rclone copy "$HAZELLE_BACKUP_REMOTE/files" /restore/files --files-from-raw /tmp/pictures; }'
#   fetch 'if grep -q "\"snapshotStore\":{\"kind\":\"r2\"," "/restore/$0/manifest.json"; then
#     bucket=$(sed -n "s/.*\"snapshotStore\":{\"kind\":\"r2\",\"bucket\":\"\([a-z0-9.-]*\)\"}.*/\1/p" "/restore/$0/manifest.json") &&
#     grep -o "\"path\":\"snapshots/[^\"]*\"" "/restore/$0/manifest.json" | cut -d\" -f4 | sed "s|^snapshots/||" >/tmp/snapshots &&
#     while IFS= read -r key; do rclone copyto "$HAZELLE_BACKUP_REMOTE/snapshots/$bucket/$key" "/restore/$0/snapshots/$key" || exit 1; done </tmp/snapshots; fi'
#   hazelle-compose run --rm --no-deps -v /var/tmp/hazelle-restore:/restore:ro --entrypoint /app/scripts/restore.sh app \
#     "/restore/$generation" /data
#   hazelle-compose up -d && rm -rf /var/tmp/hazelle-restore
# A generation whose manifest says "bucket":"r2" has no picture pool to fetch: its pictures stay in the app's R2 bucket, which
# the restore checks there (HAZELLE_FILES_* reach it from /etc/hazelle/env). The previous digest is selected before the
# restore so that its own restore.sh reads the generation. Writes after the
# pre-upgrade generation's snapshots are lost; $failed keeps them until it is removed by hand.
# A local v4 R2 generation can instead be read with restore.sh <generation> <empty dir> --snapshots-from-store;
# its archives stay in the store while the generation is kept. Old pre-deploy generations keep their links.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=ghcr.io/jiniill/hazelle

tag=${1:?usage: scripts/deploy.sh <tag> | --prepare}
host=$(terraform -chdir=infra output -raw ip)

# The functions the transaction starts with (health, capture, running), shared with scripts/rebuild.sh.
LIB=$(<scripts/machine-lib.sh)

# The deploy on the machine, from reading the selected image to the health check. Every exit other than 0 goes
# through ended(), which prints the step's summary and exits with the step's code. set -e skips a failing && list
# that is not the script's last command, so each such list carries its own || exit 1.
# The capture is skipped for a generation --prepare left under the digest still selected, within PREPARED_FOR.
TRANSACTION='
set -eu
code=1
summary="nothing changed"
ended() {
  status=$?
  [ "$status" -eq 0 ] && return
  echo "deploy: $summary" >&2
  exit "$code"
}
trap ended EXIT

selected=$(sed -n "s/^HAZELLE_IMAGE=//p" /etc/hazelle/env)
if [ "$selected" = "$image" ]; then
  # A run that ended with exit 4, or lost its session after the switch, left the image selected; this starts it again
  # and checks it the same way.
  code=4 summary="$image is selected but does not run healthy; see the header for recovery"
  if ! { running "$image" && health_ok; }; then
    timeout 300 hazelle-compose up -d app >&2
    wait_health "\"ok\":true" 300 && running "$image" || exit 1
  fi
  echo "deploy: $image is selected and runs healthy" >&2
  exit 0
fi

echo "deploy: running $selected" >&2
summary="the app is not running $selected healthy; nothing changed"
running "$selected" && health_ok || exit 1
summary="the machine could not pull $image; nothing changed"
timeout 900 docker pull -q "$image" >/dev/null

code=3 summary="no pre-upgrade backup; nothing changed"
prepared=$(cat /run/hazelle-prepared 2>/dev/null || true)
rm -f /run/hazelle-prepared
at=$(echo "$prepared" | sed -n 3p)
generation=$(echo "$prepared" | sed -n 2p)
if [ "$(echo "$prepared" | sed -n 1p)" = "$selected" ] && [ "$(($(date +%s) - ${at:-0}))" -lt "$PREPARED_FOR" ] &&
  [ -f "/data/backup/$generation/copied" ]; then
  echo "deploy: pre-upgrade generation $generation went off-site $(($(date +%s) - at)) s ago" >&2
else
  capture
fi

# A running reply holds the drain of the old app until it ends or the 60 s run out, and every request meanwhile waits in
# Caddy past the browser 15 s. 300 s is the longest reply measured; past it the drain cuts what still runs.
quiet_from=$(date +%s)
wait_health "\"liveCalls\":0," 300 || echo "deploy: replies still running after 300 s; the drain cuts any past its 60 s" >&2
echo "deploy: waited $(($(date +%s) - quiet_from)) s for no reply to run" >&2

code=1 summary="could not record the rollback pair or select $image; nothing changed"
printf "%s\n%s\n" "$selected" "$generation" >/etc/hazelle/previous
sed -i "s|^HAZELLE_IMAGE=.*|HAZELLE_IMAGE=$image|" /etc/hazelle/env
code=4 summary="$image is selected but did not start; see the header for recovery"
# Stopped here, not by up: up removes the old container and its drain outcome with it.
old=$(hazelle-compose ps -q app)
timeout 120 docker stop -t 90 "$old" >/dev/null
docker logs --tail 50 "$old" 2>&1 | grep -e "\"event\":\"draining\"" -e "\"event\":\"stopped\"" >&2 || true
timeout 300 hazelle-compose up -d app >&2
summary="$image does not run healthy within 5 minutes; see the header for recovery"
wait_health "\"ok\":true" 300 && running "$image" || exit 1
echo "deploy: running $image (previous $selected, pre-upgrade generation $generation)" >&2
'

# --prepare (scripts/release.sh, while the image builds): the capture alone, recorded in /run/hazelle-prepared with
# the digest it was taken under and when it went off-site. Under the same lock, so no deploy switches the image between
# the capture and the record.
PREPARE='
set -eu
selected=$(sed -n "s/^HAZELLE_IMAGE=//p" /etc/hazelle/env)
running "$selected" && health_ok || { echo "deploy: the app is not running $selected healthy; nothing prepared" >&2; exit 1; }
capture
printf "%s\n%s\n%s\n" "$selected" "$generation" "$(date +%s)" >/run/hazelle-prepared
'

# Every process the script starts inherits fd 9 and with it the lock. LIB (scripts/machine-lib.sh), TRANSACTION and
# PREPARE hold no single quote, and $image is a checked digest, so the single-quoted bash -c argument reaches bash whole
# whatever root's login shell is. ssh gives up on a dead connection within a minute on its own.
on_machine() {
  status=0
  ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "root@$host" "
    exec 9>/run/hazelle-deploy.lock
    flock -n 9 || { echo 'deploy: another deploy holds /run/hazelle-deploy.lock on the machine; nothing changed' >&2; exit 5; }
    exec timeout -k 60 3600 bash -c '$LIB
$1'" </dev/null || status=$?
  case $status in
    0 | 1 | 3 | 4 | 5) exit "$status" ;;
  esac
  echo "deploy: the session ended without an outcome (status $status; 124: the hour on the machine ran out, 255: the connection was lost); run this again, it carries on from what /etc/hazelle/env selects (see the header)" >&2
  exit 1
}

[ "$tag" = --prepare ] && on_machine "$PREPARE"


[ -z "$(git status --porcelain)" ] || { echo "deploy: uncommitted changes" >&2; git status --short >&2; exit 1; }
git fetch -q origin tag "$tag"
commit=$(git rev-parse "$tag^{commit}")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

gh release download "$tag" -p image-digest.txt -p source.tar.gz -D "$work"
digest=$(cat "$work/image-digest.txt")
[[ $digest =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "deploy: image-digest.txt of $tag holds no image digest" >&2; exit 1; }
image="$REPO@$digest"

archive_commit() { gunzip -c "$1" | git get-tar-commit-id; }
[ "$(archive_commit "$work/source.tar.gz")" = "$commit" ] || { echo "deploy: the release's source archive is not $tag's commit" >&2; exit 1; }
docker pull -q --platform linux/amd64 "$image" >/dev/null
container=$(docker create --platform linux/amd64 "$image")
docker cp -q "$container:/app/dist/client/source.tar.gz" "$work/image-source.tar.gz"
docker rm "$container" >/dev/null
[ "$(archive_commit "$work/image-source.tar.gz")" = "$commit" ] || { echo "deploy: $image serves a source archive of another commit" >&2; exit 1; }
echo "deploy: $tag = $commit = $image"

on_machine "image=$image
$TRANSACTION"
