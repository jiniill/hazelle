variable "region" {
  type    = string
  default = "icn"
}

variable "plan" {
  type    = string
  default = "vhp-4c-8gb-amd"
}

# "Ubuntu 24.04 LTS x64" in Vultr's GET /v2/os.
variable "os_id" {
  type    = number
  default = 2284
}

variable "ssh_public_key" {
  type = string
}

# The addresses allowed to reach port 22, as CIDRs (a.b.c.d/32).
variable "owner_cidrs" {
  type = list(string)
  validation {
    condition     = length(var.owner_cidrs) > 0 && alltrue([for cidr in var.owner_cidrs : can(cidrhost(cidr, 0)) && !strcontains(cidr, ":")])
    error_message = "owner_cidrs lists IPv4 CIDRs such as 203.0.113.7/32."
  }
}

# The image the machine starts with on first boot. Later images go through scripts/deploy.sh only.
variable "image_digest" {
  type = string
  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.image_digest))
    error_message = "image_digest is sha256:<64 hex>, as the release's image-digest.txt asset records it."
  }
}

variable "r2_account_id" {
  type      = string
  sensitive = true
}

variable "r2_access_key_id" {
  type      = string
  sensitive = true
}

variable "r2_secret_access_key" {
  type      = string
  sensitive = true
}

variable "r2_bucket" {
  type = string
}

# The app's picture store (README "Pictures in R2"): a bucket of its own, not the backup bucket, whose copier prunes
# everything under its remote. Empty keeps pictures on /data. The key may read, write and delete in that bucket only.
variable "r2_files_bucket" {
  type    = string
  default = ""
}

variable "r2_files_access_key_id" {
  type      = string
  sensitive = true
  default   = ""
}

variable "r2_files_secret_access_key" {
  type      = string
  sensitive = true
  default   = ""
}

# A Discord- or Slack-compatible webhook for backup and disk alerts; empty sends none.
variable "alert_webhook" {
  type      = string
  sensitive = true
  default   = ""
}

# Who may reach 80 and 443. direct: anyone, the DNS record unproxied. cloudflare: only Cloudflare's proxy, the record
# proxied; the way back if the machine is attacked (README "Edge").
variable "edge" {
  type    = string
  default = "direct"
  validation {
    condition     = contains(["direct", "cloudflare"], var.edge)
    error_message = "edge is direct or cloudflare."
  }
}

# Cloudflare's published IPv4 ranges (https://www.cloudflare.com/ips-v4), read 2026-10-05, for edge = cloudflare. The
# reserved IP is IPv4 and the instance has no IPv6, so no IPv6 ranges are needed.
variable "cloudflare_ipv4" {
  type = list(string)
  default = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
  ]
}
