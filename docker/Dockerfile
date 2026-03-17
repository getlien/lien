# syntax=docker/dockerfile:1

# =============================================================================
# Stage 0: Compile PHP extensions once (shared by composer + runtime)
# =============================================================================
FROM php:8.4-cli-alpine AS php-base

RUN apk add --no-cache \
    libpq-dev \
    icu-dev \
    libzip-dev \
    freetype-dev \
    libjpeg-turbo-dev \
    libpng-dev \
    linux-headers \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install \
    pdo_pgsql \
    pgsql \
    bcmath \
    intl \
    zip \
    gd \
    pcntl \
    opcache \
    sockets

# =============================================================================
# Stage 1: Composer dependencies
# =============================================================================
FROM php:8.4-cli-alpine AS composer

RUN apk add --no-cache libpq icu-libs libzip freetype libjpeg-turbo libpng

COPY --from=php-base /usr/local/lib/php/extensions/ /usr/local/lib/php/extensions/
COPY --from=php-base /usr/local/etc/php/conf.d/ /usr/local/etc/php/conf.d/
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

COPY composer.json composer.lock ./
RUN --mount=type=cache,target=/root/.composer/cache \
    composer install --no-dev --no-scripts --no-interaction --prefer-dist --optimize-autoloader

COPY . .
RUN mkdir -p bootstrap/cache \
    && composer dump-autoload --optimize --no-dev \
    && php artisan package:discover --ansi

# =============================================================================
# Stage 2: Node build (Vite assets)
# =============================================================================
FROM node:24-alpine AS node

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY vite.config.js ./
COPY resources/ ./resources/
COPY public/ ./public/
COPY --from=composer /app/vendor ./vendor
RUN npm run build

# =============================================================================
# Stage 3: Runtime (PHP-FPM + Nginx)
# =============================================================================
FROM php:8.4-fpm-alpine AS runtime

RUN apk add --no-cache nginx supervisor libpq icu-libs libzip freetype libjpeg-turbo libpng

COPY --from=php-base /usr/local/lib/php/extensions/ /usr/local/lib/php/extensions/
COPY --from=php-base /usr/local/etc/php/conf.d/ /usr/local/etc/php/conf.d/

WORKDIR /var/www/html

# Copy application code
COPY --from=composer /app/vendor ./vendor
COPY --from=composer /app/bootstrap/cache ./bootstrap/cache
COPY --from=node /app/public/build ./public/build
COPY . .

# Copy config files
COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/zz-docker.conf
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

# Set ownership
RUN chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
