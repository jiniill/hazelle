---
name: infra
description: Look at or change Hazelle's hosting from the CLI - the Vultr machine, its firewall, the Cloudflare DNS record, R2 buckets and Terraform state (서버, 방화벽, DNS, R2, 테라폼). Use when the user asks about the server, the domain, backups' storage, keys, or setting this up on a fresh machine.
---

# Infra

`infra/README.md` owns how the hosting works (inputs, edge, state, rebuild, destroy). Read the section you need there; this skill only says which tool reaches what.

## Shell

Every command below needs the keys in the shell. Load them first in each Bash call: `. ~/.config/hazelle/secrets.env`. It holds `VULTR_API_KEY`, `CLOUDFLARE_API_TOKEN` and the R2 state keys (`AWS_*`, README "State"). The CLIs are in `~/.local/bin`.

## What reaches what

- **Terraform** (`terraform -chdir=infra …`): the source of truth for the machine, reserved IP, firewall, SSH key and the domain's A record. Any lasting change goes through it, never through a dashboard or `vultr-cli`, or the next plan undoes it. Always `plan` first and show the user what it lists; `apply` only on their word. After editing `infra/terraform.tfvars`, put it back in R2 (README "State").
- **vultr-cli**: reading (`instance list`, `instance get`, `firewall rule list <group>`, `account info`, bandwidth and billing). Writes only for what Terraform does not own, such as a snapshot.
- **Cloudflare API** (`curl` with `Authorization: Bearer $CLOUDFLARE_API_TOKEN`): zone `hazelle.app`, its DNS records, R2 buckets. The apex A record is Terraform's; the mail records (MX, DKIM, SPF) belong to Cloudflare Email Routing and stay out of Terraform.
- **wrangler** (`wrangler r2 … --remote`): R2 objects, such as the tfvars copy in `hazelle-tfstate`.
- **ssh** `root@$(terraform -chdir=infra output -raw ip)`: the machine itself. Config under `/etc/hazelle/` (`env`, `rclone/rclone.conf`, compose files), the stack through `hazelle-compose`. Only this machine's key is authorized and password login is off.

## Buckets

- `hazelle-backup`: off-site backup generations; the copier (`deploy/rclone-backup.sh`) is its only writer.
- `hazelle-files`: the app's pictures; the app is its only writer.
- `hazelle-tfstate`: Terraform state and the tfvars copy.

Never write into the first two by hand; a test object goes under a name of its own and is deleted at once.

## Rotating a key

R2 keys are Account API tokens, Object Read & Write on one bucket each. A new key goes into `/etc/hazelle/rclone/rclone.conf` (backup `[r2]`, pictures `[files]`), `/etc/hazelle/env` (`HAZELLE_FILES_R2_*`) and `infra/terraform.tfvars` (then R2). The copier reads its config on each run; the app reads `env` only when it starts, so the old pictures key may be deleted only after the next deploy. Test a key before swapping it in: list, write and delete a check object, and confirm the other bucket is refused.
