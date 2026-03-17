output "k8s_cluster_id" {
  description = "DOKS cluster ID"
  value       = module.doks.cluster_id
}

output "k8s_cluster_name" {
  description = "DOKS cluster name"
  value       = module.doks.cluster_name
}

output "registry_endpoint" {
  description = "DOCR registry endpoint"
  value       = module.registry.endpoint
}

output "pg_host" {
  description = "Managed PostgreSQL private host"
  value       = module.databases.pg_host
  sensitive   = true
}

output "pg_port" {
  description = "Managed PostgreSQL port"
  value       = module.databases.pg_port
}

output "pg_database" {
  description = "Managed PostgreSQL database name"
  value       = module.databases.pg_database
}

output "pg_user" {
  description = "Managed PostgreSQL username"
  value       = module.databases.pg_user
  sensitive   = true
}

output "pg_password" {
  description = "Managed PostgreSQL password"
  value       = module.databases.pg_password
  sensitive   = true
}

output "valkey_host" {
  description = "Managed Valkey private host"
  value       = module.databases.valkey_host
  sensitive   = true
}

output "valkey_port" {
  description = "Managed Valkey port"
  value       = module.databases.valkey_port
}

output "valkey_user" {
  description = "Managed Valkey username"
  value       = module.databases.valkey_user
  sensitive   = true
}

output "valkey_password" {
  description = "Managed Valkey password"
  value       = module.databases.valkey_password
  sensitive   = true
}
