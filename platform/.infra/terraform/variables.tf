variable "do_token" {
  description = "DigitalOcean API token"
  type        = string
  sensitive   = true
}

variable "region" {
  description = "DigitalOcean region"
  type        = string
  default     = "fra1"
}

variable "k8s_version" {
  description = "DOKS Kubernetes version prefix"
  type        = string
  default     = "1.32"
}

variable "node_size" {
  description = "DOKS node droplet size"
  type        = string
  default     = "s-2vcpu-4gb"
}

variable "node_count" {
  description = "Number of DOKS worker nodes"
  type        = number
  default     = 2
}

variable "pg_version" {
  description = "Managed PostgreSQL engine version"
  type        = string
  default     = "17"
}

variable "pg_size" {
  description = "Managed PostgreSQL node size"
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "valkey_version" {
  description = "Managed Valkey engine version"
  type        = string
  default     = "8"
}

variable "valkey_size" {
  description = "Managed Valkey node size"
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "origin_cert" {
  description = "Cloudflare Origin Certificate (PEM)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "origin_key" {
  description = "Cloudflare Origin Certificate private key (PEM)"
  type        = string
  sensitive   = true
  default     = ""
}
