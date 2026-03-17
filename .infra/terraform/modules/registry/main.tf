terraform {
  required_providers {
    digitalocean = {
      source = "digitalocean/digitalocean"
    }
  }
}

resource "digitalocean_container_registry" "this" {
  name                   = "getlien"
  subscription_tier_slug = "basic"
  region                 = "fra1"
}
