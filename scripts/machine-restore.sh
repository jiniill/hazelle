# Runs on the hosted machine, fed to bash -s over ssh behind scripts/machine-lib.sh:
#   cat scripts/machine-lib.sh scripts/machine-restore.sh | ssh root@<ip> bash -s -- drill
#   cat scripts/machine-lib.sh scripts/machine-restore.sh | ssh root@<ip> bash -s -- install <generation id>
# drill (scripts/destroy.sh, scripts/rebuild.sh) proves the newest off-site generation: it must have its manifest, be
# marked copied on this machine, be younger than a day, and restore with the image's scripts/restore.sh into a scratch
# directory, removed on exit. Needs free space on this disk, which the live app shares, for the generation as downloaded
# and as restored plus a fifth of the disk (added up from the manifest and checked). Prints the generation's id.
# install (scripts/rebuild.sh), on a rebuilt machine whose /data no app has run on (infra/ start = false): fetches the
# generation from the backup remote, restores it into /data, starts the stack and waits for the app's health.
set -eu
remote=$(sed -n 's/^HAZELLE_BACKUP_REMOTE=//p' /etc/hazelle/env)
image=$(sed -n 's/^HAZELLE_IMAGE=//p' /etc/hazelle/env)
rclone() { docker run --rm --user 1000:1000 -e HOME=/tmp -v /etc/hazelle/rclone:/config/rclone -v "$root:/restore" rclone/rclone:1.75 "$@"; }

# The generation and the departures ledger from the backup remote into $root, then the image's restore.sh into an empty
# data directory. The env of the app names the picture store: an r2 generation restores only into it, and without the
# env the restore looks for a pool beside the generation.
fetch_restore() {
  docker run --rm --entrypoint cat "$image" /app/scripts/restore.sh >"$root/fetch.sh"
  docker run --rm --user 1000:1000 -e HOME=/tmp -v /etc/hazelle/rclone:/config/rclone -v "$root:/restore" --entrypoint /bin/sh rclone/rclone:1.75 /restore/fetch.sh fetch "$remote" "$1" /restore
  docker run --rm --user 1000:1000 --env-file /etc/hazelle/env --entrypoint /app/scripts/restore.sh -v "$root:/restore" -v "$2:/target" "$image" "/restore/$1" /target >&2
}

drill() {
  root=/var/tmp/hazelle-drill
  rm -rf "$root" && mkdir -p "$root/data" && chown -R 1000:1000 "$root"
  trap 'rm -rf "$root"' EXIT
  listing=$(rclone lsf --dirs-only "$remote") || { echo "drill: cannot list $remote" >&2; exit 1; }
  id=$(printf '%s\n' "$listing" | sed -n 's|^\([0-9]*-[0-9a-f]\{8\}\)/$|\1|p' | sort -n | tail -1)
  [ -n "$id" ] || { echo "drill: no generation on $remote" >&2; exit 1; }
  age_ms=$(($(date +%s%3N) - ${id%%-*}))
  [ "$age_ms" -ge 0 ] && [ "$age_ms" -lt 86400000 ] ||
    { echo "drill: the newest generation $id is $((age_ms / 3600000)) hours old" >&2; exit 1; }
  [ -f "/data/backup/$id/copied" ] || { echo "drill: $id is not marked copied" >&2; exit 1; }
  rclone copyto "$remote/$id/manifest.json" /restore/manifest.json
  grep -Eq "^\{\"version\":[0-9]+,\"id\":\"$id\"," "$root/manifest.json" || { echo "drill: the remote manifest of $id names another generation" >&2; exit 1; }
  grep -q '"materialized":' "$root/manifest.json" ||
    { echo "drill: the manifest of $id records no materialized sizes (an older build wrote it); run this after the next daily generation" >&2; exit 1; }
  grep -o '"pictures":\[[^]]*\]' "$root/manifest.json" | grep -o '[0-9a-f]\{64\}' >"$root/pictures" || true
  if grep -q '"bucket":"r2"' "$root/manifest.json"; then : >"$root/pictures"; fi
  sum() { grep -o "\"$1\":[0-9]*" "$root/manifest.json" | cut -d: -f2 | awk '{ s += $1 } END { print s + 0 }'; }
  artifacts=$(sum bytes)
  service=$(grep -o '"service":{[^}]*}' "$root/manifest.json" | grep -o '"expanded":[0-9]*' | cut -d: -f2)
  expanded=$((service + $(sum materialized)))
  held=$(sum pictureBytes)
  if grep -q '"bucket":"r2"' "$root/manifest.json"; then held=0; fi
  # No pictures: the remote may have no files/ at all.
  pictures=0
  if [ -s "$root/pictures" ]; then
    size=$(rclone size "$remote/files" --files-from-raw /restore/pictures --json)
    pictures=$(echo "$size" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
  fi
  space=$(df -Pk "$root" | awk 'NR == 2 { print $2, $4 }')
  disk_kb=${space% *}
  free_kb=${space#* }
  # The restore gunzips the service and materializes each account file (expanded: the size of the service and the
  # materialized one of every snapshot, a delta counted with its base, the target of a rewound account as a second
  # file), copies the snapshots as they are (artifacts, which counts the service gzip too) and copies each picture into
  # every account holding it (held).
  download=$((artifacts + pictures))
  restore=$((expanded + artifacts + held))
  need=$((download + restore + disk_kb * 1024 / 5))
  echo "drill: $id downloads $download bytes (generation $artifacts, pictures $pictures) and restores to $restore (databases $expanded, snapshots $artifacts, pictures per account $held); the drill needs $need bytes free on $root with a fifth of the disk, $((free_kb * 1024)) are" >&2
  [ $((free_kb * 1024)) -ge "$need" ] || { echo "drill: not enough free space for the drill" >&2; exit 1; }
  fetch_restore "$id" "$root/data"
  echo "drill: $id restores" >&2
  echo "$id"
}

install() {
  id=${1:?usage: machine-restore.sh install <generation id>}
  [ -z "$(ls -A /data)" ] || { echo "install: /data is not empty; nothing restored" >&2; exit 1; }
  root=/var/tmp/hazelle-restore
  rm -rf "$root" && mkdir -p "$root" && chown 1000:1000 "$root"
  trap 'rm -rf "$root"' EXIT
  fetch_restore "$id" /data
  hazelle-compose up -d >&2
  wait_health '"ok":true' 300 || { echo "install: the app does not answer healthy within 5 minutes" >&2; exit 1; }
  echo "install: $id restored; the app runs $image" >&2
}

# Everything above is read before this line runs, so no command below can swallow the script from stdin.
case ${1:-} in
  drill) drill ;;
  install) install "${2:-}" ;;
  *) echo 'usage: machine-restore.sh drill | install <generation id>' >&2; exit 2 ;;
esac
