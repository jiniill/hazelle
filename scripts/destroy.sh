#!/usr/bin/env bash
# shellcheck disable=SC2016 # the single-quoted scripts run by remote() expand on the machine
# Destroys the hosted machine (infra/), and only after the off-site backup is proven by scripts/machine-restore.sh drill
# on the machine. Then terraform plans the destroy from a copy of infra/ that lifts prevent_destroy, against infra/'s
# state; after the typed confirmation the generation's age is checked again and the saved plan is applied.
#   scripts/destroy.sh
# Needs: terraform initialised in infra/, VULTR_API_KEY, CLOUDFLARE_API_TOKEN and the R2 state keys in the shell (infra/README.md "State"), every required variable of infra/variables.tf
# (infra/README.md "Inputs": the gitignored *.tfvars, TF_VAR_* for what it lacks; the plan fails only after the drill
# without them), ssh as root to the machine, and the free space the drill needs there.
set -euo pipefail
cd "$(dirname "$0")/.."
host=$(terraform -chdir=infra output -raw ip)
remote() { ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "root@$host" "$@" </dev/null; }
machine() { cat scripts/machine-lib.sh scripts/machine-restore.sh | ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "root@$host" bash -s -- "$@"; }

id=$(machine drill)

fresh() {
  local now_ms age_ms
  now_ms=$(remote 'date +%s%3N')
  age_ms=$((now_ms - ${id%%-*}))
  [ "$age_ms" -ge 0 ] && [ "$age_ms" -lt 86400000 ] ||
    { echo "destroy: generation $id is now $((age_ms / 3600000)) hours old; run this again" >&2; exit 1; }
}

# Beside infra/, so every relative path in the configuration and the variable files resolves as it does there. The guard
# is lifted only in this copy: if a crash leaves it behind, infra/ still refuses a raw terraform destroy.
config=$(mktemp -d "$PWD/.destroy.XXXXXX")
# The saved plan holds the variables and the state, secrets included: outside the repository.
plans=$(mktemp -d)
trap 'rm -rf "$config" "$plans"' EXIT
cp infra/*.tf infra/*.tftpl infra/*.asc infra/.terraform.lock.hcl "$config/"
printf '%s\n' \
  'resource "vultr_instance" "hazelle" {' '  lifecycle {' '    prevent_destroy = false' '  }' '}' \
  'resource "vultr_reserved_ip" "hazelle" {' '  lifecycle {' '    prevent_destroy = false' '  }' '}' >"$config/destroy_override.tf"
var_files=()
for file in infra/terraform.tfvars infra/*.auto.tfvars; do
  if [ -f "$file" ]; then var_files+=("-var-file=$PWD/$file"); fi
done
tf() { TF_DATA_DIR=$PWD/infra/.terraform terraform -chdir="$config" "$@"; }

tf plan -destroy -input=false "${var_files[@]}" -out="$plans/destroy"
read -r -p "destroy: type destroy to destroy what the plan lists: " answer
[ "$answer" = destroy ] || { echo "destroy: not confirmed; nothing changed" >&2; exit 1; }
fresh
tf apply -input=false "$plans/destroy"
