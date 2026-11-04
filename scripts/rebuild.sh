#!/usr/bin/env bash
# Replaces the hosted machine with one on the plan infra/variables.tf names, behind the same reserved address, and
# restores its data from the off-site backup. Vultr changes a plan in place only upwards: downwards is a new machine.
#   scripts/rebuild.sh
#   TF_VAR_image_digest=sha256:… scripts/rebuild.sh --resume <generation id>
# Order: the replacement is planned from a copy of infra/ that lifts prevent_destroy on the instance alone, against
# infra/'s state, with the running image as image_digest and start = false (the new machine pulls the images and waits
# for the restore: an app on an empty /data with the store's credentials would sweep the store's archives within a
# minute); the newest off-site generation is drilled (scripts/machine-restore.sh); the typed confirmation starts the
# downtime: Caddy stops so nothing more is written, the app captures a generation that the copier sends off-site
# (scripts/machine-lib.sh capture), the plan is applied (the old machine goes, the new one takes the address), and once
# the new machine has finished its first boot the generation is installed on it and the stack started. The address
# stays and its host key changes, so the old key leaves known_hosts first.
# --resume: after an apply that destroyed the old machine and failed to create the new one. Creates it with a plain
# apply and installs the generation; image_digest must be the one the generation was written by, which the first run
# printed with this command.
# Needs what scripts/destroy.sh needs: terraform initialised in infra/, VULTR_API_KEY, CLOUDFLARE_API_TOKEN and the R2 state keys in the shell (infra/README.md "State"), every required
# variable of infra/variables.tf, ssh as root to the machine, and the free space the drill needs there.
set -euo pipefail
cd "$(dirname "$0")/.."
host=$(terraform -chdir=infra output -raw ip)
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
remote() { ssh "${ssh_opts[@]}" "root@$host" "$@" </dev/null; }
machine() { cat scripts/machine-lib.sh scripts/machine-restore.sh | ssh "${ssh_opts[@]}" "root@$host" bash -s -- "$@"; }

export TF_VAR_start=false
if [ "${1:-}" = --resume ]; then
  generation=${2:?usage: scripts/rebuild.sh --resume <generation id>}
  [[ ${TF_VAR_image_digest:-} =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "rebuild: set TF_VAR_image_digest to the digest the generation was written by" >&2; exit 1; }
else
  [ $# -eq 0 ] || { echo "usage: scripts/rebuild.sh | scripts/rebuild.sh --resume <generation id>" >&2; exit 2; }
  # The new machine boots the image the old one runs: the generation it restores was written by it.
  TF_VAR_image_digest=$(remote 'sed -n "s/^HAZELLE_IMAGE=.*@//p" /etc/hazelle/env')
  [[ $TF_VAR_image_digest =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "rebuild: /etc/hazelle/env on the machine names no image digest" >&2; exit 1; }
  export TF_VAR_image_digest
fi

# Beside infra/, so every relative path in the configuration and the variable files resolves as it does there. The guard
# is lifted only in this copy, and only on the instance: the reserved address is never replaced.
config=$(mktemp -d "$PWD/.rebuild.XXXXXX")
# The saved plan holds the variables and the state, secrets included: outside the repository.
plans=$(mktemp -d)
trap 'rm -rf "$config" "$plans"' EXIT
cp infra/*.tf infra/*.tftpl infra/*.asc infra/.terraform.lock.hcl "$config/"
printf '%s\n' 'resource "vultr_instance" "hazelle" {' '  lifecycle {' '    prevent_destroy = false' '  }' '}' >"$config/rebuild_override.tf"
var_files=()
for file in infra/terraform.tfvars infra/*.auto.tfvars; do
  if [ -f "$file" ]; then var_files+=("-var-file=$PWD/$file"); fi
done
tf() { TF_DATA_DIR=$PWD/infra/.terraform terraform -chdir="$config" "$@"; }

install() {
  local resume="TF_VAR_image_digest=$TF_VAR_image_digest scripts/rebuild.sh --resume $generation"
  # The address stays; the machine behind it is new, with a new host key.
  ssh-keygen -R "$host" >/dev/null 2>&1 || true
  ssh_opts+=(-o StrictHostKeyChecking=accept-new)
  local deadline=$(($(date +%s) + 900))
  until remote 'test -f /var/lib/cloud/instance/boot-finished' 2>/dev/null; do
    [ "$(date +%s)" -lt "$deadline" ] || { echo "rebuild: the new machine has not finished its first boot after 15 minutes; once it has: $resume" >&2; exit 1; }
    sleep 10
  done
  machine install "$generation" || { echo "rebuild: the install failed; the machine is up without data, the generation is off-site: $resume" >&2; exit 1; }
  echo "rebuild: $host runs $generation on the new machine" >&2
}

if [ "${1:-}" = --resume ]; then
  tf plan -input=false "${var_files[@]}" -out="$plans/rebuild"
  tf apply -input=false "$plans/rebuild"
  install
  exit 0
fi

tf plan -input=false "${var_files[@]}" -replace=vultr_instance.hazelle -out="$plans/rebuild"
drilled=$(machine drill)
echo "rebuild: $drilled restores on the machine; the replacement is planned above" >&2
read -r -p "rebuild: type rebuild to stop the site, back it up and replace the machine: " answer
[ "$answer" = rebuild ] || { echo "rebuild: not confirmed; nothing changed" >&2; exit 1; }

# Under the deploy lock, so no deploy switches the image between the capture and the destroy; a deploy during the drill
# would already have made the planned digest older than the one writing the generation, which the new machine could not
# read, so the running image is checked again under the lock. With Caddy stopped nothing is written any more, so the
# generation captured now holds everything.
generation=$({
  cat scripts/machine-lib.sh
  printf '%s\n' \
    'set -eu' \
    'exec 9>/run/hazelle-deploy.lock' \
    'flock -n 9 || { echo "rebuild: another deploy holds /run/hazelle-deploy.lock on the machine; nothing changed" >&2; exit 5; }' \
    "[ \"\$(sed -n 's/^HAZELLE_IMAGE=.*@//p' /etc/hazelle/env)\" = $TF_VAR_image_digest ] || { echo 'rebuild: the machine no longer runs the planned image; run this again' >&2; exit 1; }" \
    'hazelle-compose stop caddy >&2' \
    'capture' \
    'echo "$generation"'
} | ssh "${ssh_opts[@]}" "root@$host" bash -s) ||
  { echo "rebuild: no final generation; the old machine stands with Caddy stopped: hazelle-compose up -d caddy serves again" >&2; exit 1; }
echo "rebuild: final generation $generation is off-site; replacing the machine" >&2
tf apply -input=false "$plans/rebuild" ||
  { echo "rebuild: the apply failed; if the old machine is gone: TF_VAR_image_digest=$TF_VAR_image_digest scripts/rebuild.sh --resume $generation" >&2; exit 1; }
install
