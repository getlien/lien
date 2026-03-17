terraform {
  required_providers {
    digitalocean = {
      source = "digitalocean/digitalocean"
    }
  }
}

data "digitalocean_kubernetes_versions" "this" {
  version_prefix = "${var.k8s_version}."
}

resource "digitalocean_vpc" "this" {
  name   = "lien-vpc"
  region = var.region
}

resource "digitalocean_kubernetes_cluster" "this" {
  name         = "lien-k8s"
  region       = var.region
  version      = data.digitalocean_kubernetes_versions.this.latest_version
  vpc_uuid     = digitalocean_vpc.this.id
  auto_upgrade = true

  registry_integration = true

  node_pool {
    name       = "lien-pool"
    size       = var.node_size
    node_count = var.node_count
  }
}
