variable "region" {
  description = "DigitalOcean region"
  type        = string
}

variable "k8s_version" {
  description = "Kubernetes version prefix (e.g. 1.32)"
  type        = string
}

variable "node_size" {
  description = "Worker node droplet size"
  type        = string
}

variable "node_count" {
  description = "Number of worker nodes"
  type        = number
}
