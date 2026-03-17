# Lien Platform

The web platform for [Lien Review](https://lien.dev) — AI-powered code review as a service.

## Stack

- **Backend:** Laravel 12, PHP 8.4
- **Frontend:** Inertia.js v2 + Vue 3, Tailwind CSS v4
- **Database:** PostgreSQL 18
- **Cache/Sessions/Queues:** Valkey 8 (Redis-compatible)
- **Auth:** GitHub OAuth (Laravel Socialite)

## Prerequisites

### With Kubernetes (recommended)

- [OrbStack](https://orbstack.dev/) (includes Docker and Kubernetes)

### Without Kubernetes

- PHP 8.4+
- Composer
- Node.js 24+
- PostgreSQL
- Valkey or Redis

## Local Setup

### With OrbStack (recommended)

```bash
# Clone and install
git clone git@github.com:getlien/lien-platform.git
cd lien-platform
cp .env.example .env
# Fill in .env with your APP_KEY, GitHub OAuth credentials, etc.

# Build image and deploy to local K8s (reads secrets from .env)
./k8s/deploy.sh

# Visit http://lien.k8s.orb.local
```

### Without Kubernetes

```bash
# Clone and install
git clone git@github.com:getlien/lien-platform.git
cd lien-platform
composer install
npm install
cp .env.example .env
php artisan key:generate

# Update .env with your local database credentials:
# DB_HOST=127.0.0.1
# REDIS_HOST=127.0.0.1

# Run migrations and start
php artisan migrate
npm run dev
php artisan serve

# Visit http://localhost:8000
```

## Common Commands

| Command | Kubernetes | Native |
|---------|-----------|--------|
| Deploy all | `./k8s/deploy.sh` | `composer run dev` |
| App logs | `kubectl logs deploy/laravel -n lien` | `php artisan pail` |
| Worker logs | `kubectl logs deploy/laravel-worker -n lien` | — |
| Run tests | `kubectl exec deploy/laravel -n lien -- php artisan test` | `php artisan test` |
| Tinker | `kubectl exec -it deploy/laravel -n lien -- php artisan tinker` | `php artisan tinker` |
| Migration status | `kubectl exec deploy/laravel -n lien -- php artisan migrate:status` | `php artisan migrate:status` |
| Teardown | `kubectl delete namespace lien` | — |

## License

Proprietary. All rights reserved.
