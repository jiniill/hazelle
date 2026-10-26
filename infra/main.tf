resource "vultr_ssh_key" "owner" {
  name    = "hazelle-owner"
  ssh_key = var.ssh_public_key
}

resource "vultr_firewall_group" "hazelle" {
  description = "hazelle"
}

resource "vultr_firewall_rule" "ssh" {
  for_each          = toset(var.owner_cidrs)
  firewall_group_id = vultr_firewall_group.hazelle.id
  protocol          = "tcp"
  ip_type           = "v4"
  subnet            = split("/", each.value)[0]
  subnet_size       = tonumber(split("/", each.value)[1])
  port              = "22"
  notes             = "owner ssh"
}

resource "vultr_firewall_rule" "web" {
  # 443/udp: HTTP/3, which Caddy announces in alt-svc.
  for_each          = { for pair in setproduct(var.edge == "direct" ? ["0.0.0.0/0"] : var.cloudflare_ipv4, ["80", "443", "443/udp"]) : "${pair[0]} ${pair[1]}" => pair }
  firewall_group_id = vultr_firewall_group.hazelle.id
  protocol          = endswith(each.value[1], "/udp") ? "udp" : "tcp"
  ip_type           = "v4"
  subnet            = split("/", each.value[0])[0]
  subnet_size       = tonumber(split("/", each.value[0])[1])
  port              = split("/", each.value[1])[0]
  notes             = var.edge
}

# The address hazelle.app points at; it outlives a rebuilt instance.
resource "vultr_reserved_ip" "hazelle" {
  region  = var.region
  ip_type = "v4"
  label   = "hazelle"
  lifecycle {
    prevent_destroy = true
  }
}

resource "vultr_instance" "hazelle" {
  region            = var.region
  plan              = var.plan
  os_id             = var.os_id
  label             = "hazelle"
  hostname          = "hazelle"
  backups           = "disabled"
  enable_ipv6       = false
  ssh_key_ids       = [vultr_ssh_key.owner.id]
  firewall_group_id = vultr_firewall_group.hazelle.id
  reserved_ip_id    = vultr_reserved_ip.hazelle.id
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    # https://download.docker.com/linux/ubuntu/gpg, fingerprint 9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88.
    docker_apt_key = file("${path.module}/docker-apt.asc")
    env = join("\n", [
      "HAZELLE_IMAGE=ghcr.io/jiniill/hazelle@${var.image_digest}",
      "HAZELLE_BACKUP_REMOTE=r2:${var.r2_bucket}",
      "HAZELLE_ALERT_WEBHOOK=${var.alert_webhook}",
      "HAZELLE_FILES_BUCKET=${var.r2_files_bucket == "" ? "" : "r2"}",
      "HAZELLE_FILES_R2_ENDPOINT=https://${var.r2_account_id}.r2.cloudflarestorage.com",
      "HAZELLE_FILES_R2_BUCKET=${var.r2_files_bucket}",
      "HAZELLE_FILES_R2_ACCESS_KEY_ID=${var.r2_files_access_key_id}",
      "HAZELLE_FILES_R2_SECRET_ACCESS_KEY=${var.r2_files_secret_access_key}",
    ])
    rclone_conf = join("\n", [
      "[r2]",
      "type = s3",
      "provider = Cloudflare",
      "access_key_id = ${var.r2_access_key_id}",
      "secret_access_key = ${var.r2_secret_access_key}",
      "endpoint = https://${var.r2_account_id}.r2.cloudflarestorage.com",
      "no_check_bucket = true",
    ])
    compose        = file("${path.module}/../docker-compose.yml")
    compose_hosted = file("${path.module}/../docker-compose.hosted.yml")
    caddyfile      = file("${path.module}/../deploy/Caddyfile")
    copier         = file("${path.module}/../deploy/rclone-backup.sh")
  })
  lifecycle {
    # scripts/destroy.sh is the only path that lifts this, after it verified the newest off-site generation.
    prevent_destroy = true
    # user_data runs once, on first boot. deploy.sh rewrites /etc/hazelle/env afterwards, so a changed digest or file
    # here must not read as a reason to replace the machine.
    ignore_changes = [user_data]
  }
}

output "ip" {
  value = vultr_reserved_ip.hazelle.subnet
}
