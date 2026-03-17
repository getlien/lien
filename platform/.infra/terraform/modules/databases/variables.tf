variable "region" {
  description = "DigitalOcean region"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for private networking"
  type        = string
}

variable "k8s_cluster_id" {
  description = "DOKS cluster ID for database firewall rules"
  type        = string
}

variable "pg_version" {
  description = "PostgreSQL engine version"
  type        = string
}

variable "pg_size" {
  description = "PostgreSQL node size"
  type        = string
}

variable "valkey_version" {
  description = "Valkey engine version"
  type        = string
}

variable "valkey_size" {
  description = "Valkey node size"
  type        = string
}
