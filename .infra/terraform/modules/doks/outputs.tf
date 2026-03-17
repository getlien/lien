output "cluster_id" {
  description = "DOKS cluster ID"
  value       = digitalocean_kubernetes_cluster.this.id
}

output "cluster_name" {
  description = "DOKS cluster name"
  value       = digitalocean_kubernetes_cluster.this.name
}

output "vpc_id" {
  description = "VPC ID"
  value       = digitalocean_vpc.this.id
}

output "cluster_urn" {
  description = "DOKS cluster URN (for firewall rules)"
  value       = digitalocean_kubernetes_cluster.this.urn
}
