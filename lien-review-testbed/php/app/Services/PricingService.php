<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Product;

class PricingService
{
    /** @var array<string, float> Discount codes mapped to their percentage value */
    private const DISCOUNT_CODES = [
        'SAVE10' => 0.10,
        'SAVE20' => 0.20,
        'WELCOME' => 0.15,
        'VIP30' => 0.30,
        'FLASH50' => 0.50,
    ];

    /**
     * Calculate the total price for an array of order items.
     * Each item must include product_id and quantity; prices are looked up
     * from the product catalog to ensure accuracy.
     *
     * @param array<int, array{product_id: int, quantity: int}> $items
     */
    public function calculateOrderTotal(array $items): float
    {
        $total = 0.0;

        foreach ($items as $item) {
            $product = Product::findById($item['product_id']);
            $linePrice = $product->price * $item['quantity'];

            // Apply category-based markup for premium categories
            if ($product->category === 'electronics') {
                $linePrice *= 1.02; // 2% handling fee for electronics
            }

            $total += $linePrice;
        }

        return round($total, 2);
    }

    /**
     * Apply a discount code to the given total.
     * Returns the discounted total, or the original total if the code is invalid.
     * Ensures the result never goes below zero.
     */
    public function applyDiscount(float $total, string $code): float
    {
        $normalizedCode = strtoupper(trim($code));

        if (!isset(self::DISCOUNT_CODES[$normalizedCode])) {
            return $total;
        }

        $discountRate = self::DISCOUNT_CODES[$normalizedCode];
        $discountAmount = $total * $discountRate;
        $discountedTotal = $total - $discountAmount;

        return round(max(0.0, $discountedTotal), 2);
    }

    /**
     * Format a numeric amount as a USD currency string.
     * Uses standard locale-aware formatting with two decimal places.
     */
    public function formatPrice(float $amount): string
    {
        $formatted = number_format(abs($amount), 2, '.', ',');

        if ($amount < 0) {
            return "-\${$formatted}";
        }

        return "\${$formatted}";
    }
}
