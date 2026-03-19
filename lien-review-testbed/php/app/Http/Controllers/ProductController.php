<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Product;
use App\Services\CheckoutService;
use App\Services\InventoryService;
use App\Services\PricingService;

class ProductController
{
    public function __construct(
        private readonly InventoryService $inventoryService,
        private readonly PricingService $pricingService,
        private readonly CheckoutService $checkoutService,
    ) {}

    /**
     * Display a single product by its ID.
     * Looks up the product and returns its serialized representation.
     */
    public function show(int $id): array
    {
        $product = Product::findById($id);

        return [
            'status' => 'success',
            'data' => $product->toArray(),
            'formatted_price' => $this->pricingService->formatPrice($product->price),
        ];
    }

    /**
     * Check whether a product is available in the requested quantity.
     * Returns availability status along with product details.
     */
    public function checkStock(int $id, int $quantity): array
    {
        $product = Product::findById($id);
        $available = $this->inventoryService->checkAvailability($id, $quantity);

        return [
            'status' => 'success',
            'data' => [
                'product_id' => $id,
                'product_name' => $product->name,
                'requested_quantity' => $quantity,
                'available' => $available,
                'current_stock' => $product->stock,
            ],
        ];
    }

    /**
     * Calculate the total price for a set of items.
     * Useful for cart preview and checkout summary endpoints.
     * Optionally applies a discount code to the total.
     *
     * @param array<int, array{product_id: int, quantity: int, discount_code?: string}> $items
     */
    public function calculatePrice(array $items, string $discountCode = ''): array
    {
        $total = $this->pricingService->calculateOrderTotal($items);

        // Apply discount code if provided for preview purposes
        if ($discountCode !== '') {
            $total = $this->pricingService->applyDiscount($total, $discountCode);
        }

        $lineItems = [];
        foreach ($items as $item) {
            $product = Product::findById($item['product_id']);
            $lineItems[] = [
                'product_id' => $item['product_id'],
                'product_name' => $product->name,
                'quantity' => $item['quantity'],
                'unit_price' => $this->pricingService->formatPrice($product->price),
                'line_total' => $this->pricingService->formatPrice($product->price * $item['quantity']),
            ];
        }

        return [
            'status' => 'success',
            'data' => [
                'items' => $lineItems,
                'total' => $total,
                'formatted_total' => $this->pricingService->formatPrice($total),
                'discount_applied' => $discountCode !== '',
            ],
        ];
    }

    /**
     * Quick-buy a single product via express checkout.
     * Shorthand for the full checkout flow when buying one item.
     */
    public function quickBuy(int $id, int $quantity, int $userId): array
    {
        $order = $this->checkoutService->expressCheckout(
            userId: $userId,
            productId: $id,
            quantity: $quantity,
        );

        return [
            'status' => 'success',
            'message' => 'Product purchased successfully',
            'data' => $order->toArray(),
        ];
    }

    /**
     * Preview a cart containing the given items.
     * Shows availability and pricing without committing to an order.
     *
     * @param array<int, array{product_id: int, quantity: int}> $items
     */
    public function cartPreview(array $items): array
    {
        $preview = $this->checkoutService->previewCart($items);

        return [
            'status' => 'success',
            'data' => $preview,
        ];
    }
}
