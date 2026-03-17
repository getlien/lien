terraform {
  required_providers {
    digitalocean = {
      source = "digitalocean/digitalocean"
    }
  }
}

resource "digitalocean_database_cluster" "pg" {
  name                 = "lien-pg"
  engine               = "pg"
  version              = var.pg_version
  size                 = var.pg_size
  region               = var.region
  node_count           = 1
  private_network_uuid = var.vpc_id
}

resource "digitalocean_database_db" "lien_platform" {
  cluster_id = digitalocean_database_cluster.pg.id
  name       = "lien_platform"
}

resource "digitalocean_database_firewall" "pg" {
  cluster_id = digitalocean_database_cluster.pg.id

  rule {
    type  = "k8s"
    value = var.k8s_cluster_id
  }
}

resource "digitalocean_database_cluster" "valkey" {
  name                 = "lien-valkey"
  engine               = "valkey"
  version              = var.valkey_version
  size                 = var.valkey_size
  region               = var.region
  node_count           = 1
  private_network_uuid = var.vpc_id
}

resource "digitalocean_database_firewall" "valkey" {
  cluster_id = digitalocean_database_cluster.valkey.id

  rule {
    type  = "k8s"
    value = var.k8s_cluster_id
  }
}
