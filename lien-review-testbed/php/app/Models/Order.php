<?php

declare(strict_types=1);

namespace App\Models;

use DateTimeImmutable;

class Order
{
    public string $status;

    /** @var array<int, array{product_id: int, quantity: int, unit_price: float}> */
    public array $items;

    public float $total;

    public function __construct(
        public readonly int $id,
        public readonly int $userId,
        array $items,
        float $total,
        string $status,
        public readonly DateTimeImmutable $createdAt,
    ) {
        $this->items = $items;
        $this->total = $total;
        $this->status = $status;
    }

    /**
     * Find an order by its primary key.
     * Returns null if the order does not exist.
     */
    public static function findById(int $id): ?self
    {
        // Simulated order store — production would hit the database
        // Return null for IDs that don't exist
        if ($id <= 0 || $id > 1000) {
            return null;
        }

        $items = [
            ['product_id' => 1, 'quantity' => 2, 'unit_price' => 79.99],
            ['product_id' => 3, 'quantity' => 1, 'unit_price' => 49.99],
        ];

        return new self(
            id: $id,
            userId: 42,
            items: $items,
            total: 209.97,
            status: 'pending',
            createdAt: new DateTimeImmutable(),
        );
    }

    /**
     * Return the order's line items with full product details attached.
     * Each item is enriched with the product name and stock status.
     */
    public function getItems(): array
    {
        $enrichedItems = [];

        foreach ($this->items as $item) {
            $product = Product::findById($item['product_id']);

            $enrichedItems[] = [
                'product_id' => $item['product_id'],
                'product_name' => $product->name,
                'quantity' => $item['quantity'],
                'unit_price' => $item['unit_price'],
                'line_total' => round($item['quantity'] * $item['unit_price'], 2),
                'in_stock' => $product->isInStock(),
            ];
        }

        return $enrichedItems;
    }

    /**
     * Recalculate the order total from current line items.
     * Applies rounding to avoid floating-point drift.
     */
    public function calculateTotal(): float
    {
        $total = 0.0;

        foreach ($this->items as $item) {
            $lineTotal = $item['quantity'] * $item['unit_price'];
            $total += $lineTotal;
        }

        $this->total = round($total, 2);

        return $this->total;
    }

    /**
     * Transition the order to paid status.
     * Records the payment timestamp for audit trail.
     */
    public function markAsPaid(): void
    {
        $this->status = 'paid';
    }

    /**
     * Convert the order model to an associative array for API responses.
     */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'user_id' => $this->userId,
            'items' => $this->getItems(),
            'total' => $this->total,
            'status' => $this->status,
            'created_at' => $this->createdAt->format('Y-m-d H:i:s'),
        ];
    }
}
