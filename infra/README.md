# infra

Terraform for the hosted machine on Vultr: one instance (`vhp-4c-8gb-amd` in `icn`, Ubuntu 24.04), a reserved IPv4
address, a firewall group (22 from the owner's address, 80, 443 and 443/udp as `edge` says) and the owner's SSH
key. `/data` lives on the instance's own disk. On first boot `cloud-init.yaml.tftpl` installs Docker from Docker's
repository, writes `/etc/hazelle/` (the env file, the rclone config for R2, both compose files, the Caddyfile, the
copier script) and runs `hazelle-compose up -d`.

## Inputs

The API key is read by the provider from `VULTR_API_KEY` in the shell; it is in no file. Everything else is a
variable (`variables.tf`), passed as `-var` or `TF_VAR_*`, or in a `*.tfvars` file, which git ignores:

| variable | what |
|---|---|
| `ssh_public_key` | the owner's SSH public key |
| `owner_cidrs` | the owner's IPv4 addresses as `["a.b.c.d/32", …]`; the only sources allowed on port 22 |
| `image_digest` | `sha256:…` of the release to start with (the release's `image-digest.txt`) |
| `r2_account_id`, `r2_access_key_id`, `r2_secret_access_key`, `r2_bucket` | the off-site backup bucket and a key that may read, write and delete in it |
| `r2_files_bucket`, `r2_files_access_key_id`, `r2_files_secret_access_key` | optional: the app's own picture bucket and a key that may read, write and delete in it alone (see Pictures in R2); empty keeps pictures on `/data` |
| `alert_webhook` | optional Discord/Slack webhook for backup, disk and server-slowness alerts |
| `edge` | `direct` (default): 80 and 443 open to anyone, the DNS record unproxied; `cloudflare`: only Cloudflare's ranges, the record proxied (see Edge) |
| `cloudflare_ipv4` | for `edge = cloudflare`; defaults to Cloudflare's published list; update it when https://www.cloudflare.com/ips-v4 changes |

The R2 keys and the webhook end up in the instance's user data, in the state file and on the machine
under `/etc/hazelle` (mode 0600). Anything on the instance can read its user data from the metadata service; the app's
outbound policy refuses link-local addresses, so a bot cannot reach it through the app.

## Commands

```
cd infra
terraform init
terraform apply      # creates the machine; prints ip
```

`image_digest` and the files embedded in the user data matter on first boot only: the instance ignores later changes
to `user_data`, and `scripts/deploy.sh <tag>` is the only path that changes the running image. Deploys run one at
a time: each holds an flock on `/run/hazelle-deploy.lock` on the machine from reading the running image to the health
check, and a second one exits 5 without changing anything. A change to a compose
file or the copier reaches a running machine by copying it to `/etc/hazelle/` and `hazelle-compose up -d`, or by a
rebuilt machine.

The copier (`deploy/rclone-backup.sh`) must be the only writer under its remote prefix. It deletes a pooled picture
only when no manifest in the remote's listing names it and the machine's own pool no longer holds it, which assumes a
listing never lags behind by the 7 days the machine keeps a generation.

`prevent_destroy` is set on the instance and the reserved IP, so a plain `terraform destroy` fails. `scripts/destroy.sh`
lifts it only after it has restored the newest off-site generation into a scratch directory, and only in a copy of this
directory (`.destroy.*` beside it, removed on exit) that plans and applies against this directory's state; nothing in
`infra/` changes. A `.destroy.*` left behind by a crash lifts nothing here; delete it.

## Pictures in R2

With `HAZELLE_FILES_BUCKET=r2` and the four `HAZELLE_FILES_R2_*` values in `/etc/hazelle/env`, the app keeps pictures
in an R2 bucket instead of `/data/files` (`src/server/files/`); reads still go through the app. Unset or blank, it
keeps them on disk; a wrong or incomplete setting stops the app at start. The bucket is the pictures' durable home: a
backup generation names its pictures there instead of copying them into `backup/files`, a deleted account's pictures
stay in it for the 7-day backup retention before the hourly sweep removes them, and a restore checks each named picture
there by size. It must be a bucket of its own: the copier prunes everything under the backup remote.

The app keeps a copy of what it reads or puts in `/data/cache` (a read from R2 costs the machine 110–175 ms, one from
disk about 1 ms): at most `HAZELLE_FILES_CACHE_BYTES` (default 20 GiB; `0` turns it off and empties it within the hour),
and a picture unread for 3 days goes, so a deleted account's pictures leave the machine well within the 7 days the
privacy page promises. It counts toward the disk-full warning (below 20 % free); backups and restores ignore it.

Moving the hosted machine, as root on it, after an image with the R2 store is deployed and running on disk (switching
in the same step as a deploy would make that deploy's rollback restore a disk generation while pictures sit in R2):

1. In Cloudflare: create a bucket (e.g. `hazelle-files`), no public access, and an R2 API token with Object Read & Write
   on that bucket only. Note its access key id and secret.
2. Add the remote the move script uses, `[files]` in `/etc/hazelle/rclone/rclone.conf`, written like the `[r2]` section
   above it but with the new key.
3. Copy `scripts/move-pictures-to-r2.sh` to the machine and run `move-pictures-to-r2.sh copy hazelle-files` while the
   app runs (the bulk; repeatable).
4. `hazelle-compose stop app`, then `copy` again (what arrived meanwhile), then `move-pictures-to-r2.sh verify
   hazelle-files`: it compares every `account_files` row with `stored = 1` against the bucket's listing, by size, and
   names any that is missing. Go on only when it prints `ok`.
5. Append to `/etc/hazelle/env`:
   ```
   HAZELLE_FILES_BUCKET=r2
   HAZELLE_FILES_R2_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
   HAZELLE_FILES_R2_BUCKET=hazelle-files
   HAZELLE_FILES_R2_ACCESS_KEY_ID=<key id>
   HAZELLE_FILES_R2_SECRET_ACCESS_KEY=<secret>
   ```
   then `hazelle-compose up -d`. The `listening` log line says `"files":"r2"`; open a chat with pictures to see them.
6. Only then `mv /data/files /data/files.moved`, and `rm -rf /data/files.moved` once the app has run on R2 for a day.
   The space comes back as the old generations expire: their pool, `backup/files`, holds hard links to the same
   pictures, and the daily job drops every pooled picture no disk generation names, within the 7-day retention (the
   copier does the same on the remote).

Back to disk, while the R2 bucket still holds everything: `hazelle-compose stop app`; `hazelle-compose run --rm
--no-deps -T --entrypoint rclone backup copy files:hazelle-files/files /data/files`; blank `HAZELLE_FILES_BUCKET` in
`/etc/hazelle/env`; `hazelle-compose up -d`. A generation captured on R2 restores only with the R2 setting, so keep
the bucket until the last one has expired, 7 days after the switch back; the deferred removals queued meanwhile are
then the operator's (`picture_removals`).

## Snapshot archives in R2

With the R2 store, snapshot archives (the accounts' restore points) live in the same bucket under
`snapshots/<incarnation>/<id>.sqlite.gz` instead of `/data/snapshots`, with no setting of their own. A generation names
them there, and the copier copies each named archive into the backup remote's pool, `snapshots/<bucket>/...`, before it
marks the generation copied, so the backup bucket alone still restores every account's text. The copier reads the
store through the `[files]` remote of `/etc/hazelle/rclone/rclone.conf` (the one the picture move added); the bucket
name comes from the manifest.

Moving the hosted machine's existing archives, as root on it:

1. Before the deploy: install the new `/etc/hazelle/deploy/rclone-backup.sh` and run `hazelle-compose --profile backup
   up -d --force-recreate backup`. An older copier would mark a version 4 generation copied without its archives.
2. Deploy. The new build writes archives to R2 at once; restore points still on disk fail as missing until step 3.
3. Copy `scripts/move-pictures-to-r2.sh` to the machine; `move-pictures-to-r2.sh copy-snapshots hazelle-files` while
   the app runs, then `hazelle-compose stop app`, `move-pictures-to-r2.sh move-snapshots hazelle-files` (copies what
   is left, checks every catalogued archive in the bucket at its size, and only then removes `/data/snapshots`), and
   `hazelle-compose up -d app`. Older generations keep hard links to the old archives until they expire.
4. Take a generation (`hazelle-compose exec -T app kill -USR2 1`), let the copier run, and check that the remote holds
   `snapshots/hazelle-files/...` and the generation's `copied`. Then run the restore drill (`scripts/restore.sh fetch`
   into a scratch directory, as `scripts/destroy.sh` does) to prove the text restores from the backup bucket alone.

## Edge

Korean visitors on KT reach a proxied record through Cloudflare's LAX location (measured 2026-10-11: health 1.5 s median,
up to 16 s, against 0.02 s direct), so the record is unproxied and `edge = direct`. Caddy issues its own Let's Encrypt
certificate, which Cloudflare's Full (strict) mode also trusts, so either edge needs nothing changed on the machine.

Under attack: `terraform apply -target=vultr_firewall_rule.web -var edge=cloudflare`, then turn the record's proxy on in
Cloudflare's dashboard. Vultr applies a firewall change in up to about 7 minutes. The address is public by then, which
is why the firewall, not the proxy alone, is the shield. Back: the same with `edge=direct` and the proxy off.

The login, signup and share-link limits key each visitor on the last X-Forwarded-For entry when the connection comes
from `HAZELLE_TRUSTED_PROXIES` (src/server/frontend-worker.ts), which `docker-compose.hosted.yml` sets to the `edge`
network that Caddy alone shares with the app. That entry is the address Caddy saw; with `edge = cloudflare` it is a
Cloudflare address and every visitor would share a few keys, so switching the edge needs Caddy to name the visitor
Cloudflare saw (CF-Connecting-IP) first.

## State

State is local (`terraform.tfstate`, git-ignored) and holds the secrets above. Keep a copy somewhere private. Losing
it loses nothing on Vultr, but Terraform no longer knows the machine: a new `apply` would try to create a second one.
To take the existing resources back, import each by its Vultr id (shown by the Vultr API or `vultr-cli`):

```
terraform import vultr_ssh_key.owner <ssh-key-id>
terraform import vultr_firewall_group.hazelle <firewall-group-id>
terraform import vultr_firewall_rule.ssh <firewall-group-id>,<rule-id>
terraform import 'vultr_firewall_rule.web["173.245.48.0/20 443"]' <firewall-group-id>,<rule-id>   # one per rule
terraform import vultr_reserved_ip.hazelle <reserved-ip-id>
terraform import vultr_instance.hazelle <instance-id>
```

Then `terraform plan` must show no change to the instance before anything is applied.
