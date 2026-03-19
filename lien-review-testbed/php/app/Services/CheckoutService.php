<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Order;
use App\Models\Product;
use App\Repositories\OrderRepository;
use DateTimeImmutable;
use RuntimeException;

class CheckoutService
{
    public function __construct(
        private readonly OrderRepository $orderRepository,
        private readonly PaymentService $paymentService,
        private readonly InventoryService $inventoryService,
        private readonly PricingService $pricingService,
    ) {}

    /**
     * Execute an express checkout for a single product.
     * Combines inventory check, stock reservation, order creation,
     * and payment processing into a single streamlined operation.
     */
    public function expressCheckout(int $userId, int $productId, int $quantity, string $paymentMethod = 'credit_card'): Order
    {
        $product = Product::findById($productId);

        if (!$this->inventoryService->checkAvailability($productId, $quantity)) {
            throw new RuntimeException(
                "Product '{$product->name}' is not available in quantity {$quantity}"
            );
        }

        if (!$this->paymentService->validatePaymentMethod($paymentMethod)) {
            throw new RuntimeException(
                "Payment method '{$paymentMethod}' is not accepted"
            );
        }

        // Reserve stock immediately for express checkout
        $this->inventoryService->reserveStock($productId, $quantity);

        $items = [
            ['product_id' => $productId, 'quantity' => $quantity],
        ];

        $total = $this->pricingService->calculateOrderTotal($items);

        $order = new Order(
            id: random_int(10000, 99999),
            userId: $userId,
            items: [
                [
                    'product_id' => $productId,
                    'quantity' => $quantity,
                    'unit_price' => $product->price,
                ],
            ],
            total: $total,
            status: 'pending',
            createdAt: new DateTimeImmutable(),
        );

        $order->calculateTotal();
        $savedOrder = $this->orderRepository->save($order);

        // Charge immediately for express checkout — on failure, release stock
        try {
            $this->paymentService->charge($savedOrder);
        } catch (RuntimeException $e) {
            $this->inventoryService->releaseStock($productId, $quantity);
            throw new RuntimeException(
                "Express checkout failed: {$e->getMessage()}"
            );
        }

        return $this->orderRepository->save($savedOrder);
    }

    /**
     * Process a refund for an order and release all reserved inventory.
     * Used when a customer requests a return after payment.
     */
    public function processReturn(int $orderId): Order
    {
        $order = $this->orderRepository->findOrder($orderId);

        if ($order->status !== 'paid') {
            throw new RuntimeException(
                "Order {$orderId} cannot be returned — must be in paid status"
            );
        }

        // Refund payment first
        $this->paymentService->refund($order);

        // Release inventory for all line items
        foreach ($order->items as $item) {
            $this->inventoryService->releaseStock(
                $item['product_id'],
                $item['quantity'],
            );
        }

        $order->status = 'returned';

        return $this->orderRepository->save($order);
    }

    /**
     * Preview a cart summary without creating an order.
     * Validates stock availability and calculates totals for display.
     *
     * @param array<int, array{product_id: int, quantity: int}> $items
     * @return array{available: bool, total: float, items: array}
     */
    public function previewCart(array $items): array
    {
        $allAvailable = true;
        $cartItems = [];

        foreach ($items as $item) {
            $product = Product::findById($item['product_id']);
            $available = $this->inventoryService->checkAvailability(
                $item['product_id'],
                $item['quantity'],
            );

            if (!$available) {
                $allAvailable = false;
            }

            $cartItems[] = [
                'product' => $product->toArray(),
                'quantity' => $item['quantity'],
                'available' => $available,
                'line_total' => $product->price * $item['quantity'],
            ];
        }

        $total = $this->pricingService->calculateOrderTotal($items);

        return [
            'available' => $allAvailable,
            'total' => $total,
            'formatted_total' => $this->pricingService->formatPrice($total),
            'items' => $cartItems,
        ];
    }

    /**
     * Look up an existing order by its ID for the checkout status page.
     * Enriches the order with formatted pricing and item details.
     */
    public function getOrderStatus(int $orderId): array
    {
        $order = Order::findById($orderId);
        $items = $order->getItems();

        return [
            'order_id' => $order->id,
            'status' => $order->status,
            'total' => $this->pricingService->formatPrice($order->total),
            'items' => $items,
            'item_count' => count($items),
            'created_at' => $order->createdAt->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * Get a user's order history through the repository.
     * Formats each order for display in the account dashboard.
     */
    public function getUserOrderHistory(int $userId): array
    {
        $orders = $this->orderRepository->findByUserId($userId);

        return array_map(function (Order $order) {
            return [
                'id' => $order->id,
                'total' => $this->pricingService->formatPrice($order->total),
                'status' => $order->status,
                'item_count' => count($order->getItems()),
                'created_at' => $order->createdAt->format('Y-m-d H:i:s'),
            ];
        }, $orders);
    }
}
