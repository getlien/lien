terraform {
  required_version = ">= 1.5"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }

  backend "s3" {
    endpoint                    = "https://fra1.digitaloceanspaces.com"
    bucket                      = "getlien-tfstate"
    key                         = "infrastructure/terraform.tfstate"
    region                      = "us-east-1" # Required but ignored by DO Spaces
    skip_credentials_validation = true
    skip_metadata_api_check     = true
  }
}

provider "digitalocean" {
  token = var.do_token
}

module "registry" {
  source = "./modules/registry"
}

module "doks" {
  source = "./modules/doks"

  region      = var.region
  k8s_version = var.k8s_version
  node_size   = var.node_size
  node_count  = var.node_count

  depends_on = [module.registry]
}

module "databases" {
  source = "./modules/databases"

  region         = var.region
  vpc_id         = module.doks.vpc_id
  k8s_cluster_id = module.doks.cluster_id
  pg_version     = var.pg_version
  pg_size        = var.pg_size
  valkey_version = var.valkey_version
  valkey_size    = var.valkey_size
}

resource "digitalocean_certificate" "origin" {
  name              = "lien-origin-cert"
  type              = "custom"
  leaf_certificate  = var.origin_cert
  private_key       = var.origin_key
}
