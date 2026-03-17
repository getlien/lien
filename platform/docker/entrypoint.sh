#!/bin/sh
set -e

# Ensure storage directories exist
mkdir -p storage/framework/sessions storage/framework/views storage/framework/cache storage/logs bootstrap/cache

# Set permissions
chown -R www-data:www-data storage bootstrap/cache

# Cache configuration at runtime so K8s env vars are picked up
php artisan config:cache
php artisan event:cache

exec "$@"
