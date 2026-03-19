<?php

declare(strict_types=1);

namespace App\Models;

use DateTimeImmutable;

class Product
{
    public function __construct(
        public readonly int $id,
        public readonly string $name,
        public float $price,
        public int $stock,
        public readonly string $sku,
        public readonly string $category,
        public readonly DateTimeImmutable $createdAt,
    ) {}

    /**
     * Simulate finding a product by its primary key.
     * In a real Laravel app this would query the database via Eloquent.
     */
    public static function findById(int $id): self
    {
        // Simulated catalog lookup — in production this hits the DB
        $catalog = [
            1 => ['name' => 'Wireless Headphones', 'price' => 79.99, 'stock' => 150, 'sku' => 'WH-1000', 'category' => 'electronics'],
            2 => ['name' => 'Running Shoes', 'price' => 129.95, 'stock' => 75, 'sku' => 'RS-4200', 'category' => 'footwear'],
            3 => ['name' => 'Coffee Maker', 'price' => 49.99, 'stock' => 200, 'sku' => 'CM-3100', 'category' => 'appliances'],
            4 => ['name' => 'Backpack', 'price' => 59.50, 'stock' => 0, 'sku' => 'BP-7700', 'category' => 'accessories'],
            5 => ['name' => 'Desk Lamp', 'price' => 34.99, 'stock' => 90, 'sku' => 'DL-2200', 'category' => 'home'],
        ];

        $data = $catalog[$id] ?? $catalog[1];

        return new self(
            id: $id,
            name: $data['name'],
            price: $data['price'],
            stock: $data['stock'],
            sku: $data['sku'],
            category: $data['category'],
            createdAt: new DateTimeImmutable(),
        );
    }

    /**
     * Convert the product model to an associative array for API responses.
     */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'price' => $this->price,
            'stock' => $this->stock,
            'sku' => $this->sku,
            'category' => $this->category,
            'in_stock' => $this->isInStock(),
            'created_at' => $this->createdAt->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * Check whether the product currently has available inventory.
     */
    public function isInStock(): bool
    {
        return $this->stock > 0;
    }
}
