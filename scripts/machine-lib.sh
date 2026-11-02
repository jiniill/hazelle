# Functions that run on the hosted machine, sent over ssh by scripts/deploy.sh (inside bash -c "...") and
# scripts/rebuild.sh and scripts/destroy.sh (on the stdin of bash -s, ahead of scripts/machine-restore.sh). No single
# quote anywhere in this file: deploy.sh wraps it in one pair.
# health_has <text>: the app answers 2xx holding text. health_ok: holding "ok":true. wait_health <text> <seconds>.
# running <image>: the app container runs that image.
# capture: a pre-upgrade backup generation, off-site; sets generation. It asks the running app for one (the SIGUSR2
# handler of node.ts), follows its log for the outcome, has the copier send the generation off-site and checks its copied
# marker; 30 minutes in all. The signal goes from inside the container: the kill API of Docker marks a container manually
# stopped, after which restart: unless-stopped no longer restarts it.
# PREPARED_FOR: how long after it went off-site a prepared generation stands in for the capture. The build of a release
# takes minutes; an older one would widen the writes a rollback loses.
# shellcheck disable=SC2034 # read by the TRANSACTION of deploy.sh
PREPARED_FOR=900
health_has() {
  body=$(timeout 10 hazelle-compose exec -T app wget -qO- -T 5 http://127.0.0.1:8080/api/health 2>/dev/null) &&
    case $body in *"$1"*) ;; *) false ;; esac
}
health_ok() { health_has "\"ok\":true"; }
wait_health() {
  deadline=$(($(date +%s) + $2))
  until health_has "$1"; do
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 3
  done
}
capture() {
  deadline=$(($(date +%s) + 1800))
  app=$(hazelle-compose ps -q app)
  # Since the process started: a request cut off by a crash before it ended never logs its outcome.
  started=$(docker inspect --format "{{.State.StartedAt}}" "$app")
  count() { docker logs --since "$started" "$app" 2>&1 | grep -c "\"event\":\"backup $1\"" || true; }
  # An earlier request still running would log the first "backup finished" after this one was sent.
  [ "$(count requested)" -le "$(count finished)" ] || { echo "deploy: an earlier backup request has not finished yet" >&2; exit 1; }
  since=$(date +%s.%N)
  hazelle-compose exec -T app kill -USR2 1
  until line=$(docker logs --since "$since" "$app" 2>&1 | grep -m1 -e "\"event\":\"backup finished\"" -e "\"event\":\"backup refused\""); do
    [ "$(date +%s)" -lt "$deadline" ] || { echo "deploy: the app logged no backup outcome within 30 minutes" >&2; exit 1; }
    sleep 5
  done
  case $line in *"\"snapshots\":\"ok\""*) ;; *) echo "deploy: backup failed: $line" >&2; exit 1 ;; esac
  case $line in *"\"generation\":\"ok\""*) ;; *) echo "deploy: backup failed: $line" >&2; exit 1 ;; esac
  generation=$(echo "$line" | sed -n "s/.*\"id\":\"\([0-9]*-[0-9a-f]*\)\".*/\1/p")
  [ -n "$generation" ] || { echo "deploy: backup finished without a generation id: $line" >&2; exit 1; }
  left=$((deadline - $(date +%s)))
  [ "$left" -gt 0 ] && timeout "$left" hazelle-compose exec -T backup /bin/sh /hazelle/rclone-backup.sh once >&2 ||
    { echo "deploy: the copier failed or did not finish within 30 minutes" >&2; exit 1; }
  [ -f "/data/backup/$generation/copied" ] || { echo "deploy: generation $generation is not marked copied" >&2; exit 1; }
  echo "deploy: pre-upgrade generation $generation is off-site" >&2
}
running() {
  id=$(hazelle-compose ps -q app) && [ -n "$id" ] &&
    [ "$(docker inspect --format "{{.Config.Image}}" "$id")" = "$1" ] &&
    docker image inspect --format "{{join .RepoDigests \"\n\"}}" "$(docker inspect --format "{{.Image}}" "$id")" | grep -qxF "$1"
}
