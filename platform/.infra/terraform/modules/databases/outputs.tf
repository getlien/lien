output "pg_host" {
  description = "PostgreSQL private host"
  value       = digitalocean_database_cluster.pg.private_host
}

output "pg_port" {
  description = "PostgreSQL port"
  value       = digitalocean_database_cluster.pg.port
}

output "pg_database" {
  description = "PostgreSQL database name"
  value       = digitalocean_database_db.lien_platform.name
}

output "pg_user" {
  description = "PostgreSQL default username"
  value       = digitalocean_database_cluster.pg.user
}

output "pg_password" {
  description = "PostgreSQL default password"
  value       = digitalocean_database_cluster.pg.password
  sensitive   = true
}

output "valkey_host" {
  description = "Valkey private host"
  value       = digitalocean_database_cluster.valkey.private_host
}

output "valkey_port" {
  description = "Valkey port"
  value       = digitalocean_database_cluster.valkey.port
}

output "valkey_user" {
  description = "Valkey default username"
  value       = digitalocean_database_cluster.valkey.user
}

output "valkey_password" {
  description = "Valkey default password"
  value       = digitalocean_database_cluster.valkey.password
  sensitive   = true
}
