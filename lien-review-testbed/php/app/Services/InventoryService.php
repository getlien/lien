<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Product;
use RuntimeException;

class InventoryService
{
    /** @var array<int, int> Tracks reserved quantities per product during checkout */
    private array $reservations = [];

    /**
     * Check whether the requested quantity of a product is available.
     * Accounts for any stock already reserved by in-flight orders.
     */
    public function checkAvailability(int $productId, int $quantity): bool
    {
        $product = Product::findById($productId);

        if (!$product->isInStock()) {
            return false;
        }

        $reservedQty = $this->reservations[$productId] ?? 0;
        $availableStock = $product->stock - $reservedQty;

        return $availableStock >= $quantity;
    }

    /**
     * Reserve stock for a product during the checkout flow.
     * Reduces available inventory so concurrent orders cannot oversell.
     * Throws if insufficient stock remains.
     */
    public function reserveStock(int $productId, int $quantity): void
    {
        if (!$this->checkAvailability($productId, $quantity)) {
            throw new RuntimeException(
                "Insufficient stock for product {$productId}. " .
                "Requested: {$quantity}, available: {$this->getAvailableStock($productId)}"
            );
        }

        $product = Product::findById($productId);
        $product->stock -= $quantity;

        $currentReservation = $this->reservations[$productId] ?? 0;
        $this->reservations[$productId] = $currentReservation + $quantity;
    }

    /**
     * Release previously reserved stock back to available inventory.
     * Called when an order is cancelled or a checkout session expires.
     */
    public function releaseStock(int $productId, int $quantity): void
    {
        $product = Product::findById($productId);
        $product->stock += $quantity;

        $currentReservation = $this->reservations[$productId] ?? 0;
        $newReservation = max(0, $currentReservation - $quantity);

        if ($newReservation === 0) {
            unset($this->reservations[$productId]);
        } else {
            $this->reservations[$productId] = $newReservation;
        }
    }

    /**
     * Get the effective available stock for a product after reservations.
     */
    private function getAvailableStock(int $productId): int
    {
        $product = Product::findById($productId);
        $reservedQty = $this->reservations[$productId] ?? 0;

        return max(0, $product->stock - $reservedQty);
    }
}
