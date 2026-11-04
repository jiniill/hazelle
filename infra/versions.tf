terraform {
  required_version = ">= 1.9"
  required_providers {
    vultr = {
      source  = "vultr/vultr"
      version = "2.32.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.28.1"
    }
  }

  # State lives in the private R2 bucket hazelle-tfstate (README "State"). The endpoint and keys come from
  # AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the shell, so the account stays out of the repo.
  backend "s3" {
    bucket                      = "hazelle-tfstate"
    key                         = "infra/terraform.tfstate"
    region                      = "auto"
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

# Both keys come from the shell running terraform, never from a file: VULTR_API_KEY and CLOUDFLARE_API_TOKEN.
provider "vultr" {}
provider "cloudflare" {}
