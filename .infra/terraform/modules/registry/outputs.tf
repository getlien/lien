output "endpoint" {
  description = "DOCR registry endpoint"
  value       = digitalocean_container_registry.this.endpoint
}

output "name" {
  description = "DOCR registry name"
  value       = digitalocean_container_registry.this.name
}
