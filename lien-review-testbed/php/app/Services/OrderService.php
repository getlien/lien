<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Order;
use App\Repositories\OrderRepository;
use DateTimeImmutable;
use RuntimeException;

class OrderService
{
    public function __construct(
        private readonly OrderRepository $orderRepository,
        private readonly PaymentService $paymentService,
        private readonly InventoryService $inventoryService,
        private readonly PricingService $pricingService,
    ) {}

    /**
     * Create a new order for the given user.
     * Validates inventory availability for all items, calculates the total
     * using the pricing service, reserves stock, and persists the order.
     *
     * @param array<int, array{product_id: int, quantity: int}> $items
     */
    public function createOrder(int $userId, array $items): Order
    {
        if (empty($items)) {
            throw new RuntimeException('Cannot create an order with no items');
        }

        // Verify all items are in stock before proceeding
        foreach ($items as $item) {
            $available = $this->inventoryService->checkAvailability(
                $item['product_id'],
                $item['quantity'],
            );

            if (!$available) {
                throw new RuntimeException(
                    "Product {$item['product_id']} is not available in quantity {$item['quantity']}"
                );
            }
        }

        // Calculate the order total from current catalog prices
        $total = $this->pricingService->calculateOrderTotal($items);

        // Build the line items with resolved unit prices
        $orderItems = [];
        foreach ($items as $item) {
            $product = \App\Models\Product::findById($item['product_id']);
            $orderItems[] = [
                'product_id' => $item['product_id'],
                'quantity' => $item['quantity'],
                'unit_price' => $product->price,
            ];
        }

        // Reserve inventory for each line item
        foreach ($items as $item) {
            $this->inventoryService->reserveStock(
                $item['product_id'],
                $item['quantity'],
            );
        }

        $order = new Order(
            id: random_int(1000, 9999),
            userId: $userId,
            items: $orderItems,
            total: $total,
            status: 'pending',
            createdAt: new DateTimeImmutable(),
        );

        // Recalculate total from line items to ensure consistency
        $order->calculateTotal();

        return $this->orderRepository->save($order);
    }

    /**
     * Process a pending order by charging the customer's payment method.
     * Validates the payment method, finds the order, attempts payment,
     * and lets PaymentService exceptions propagate to the caller for
     * handling at the controller level.
     */
    public function processOrder(int $orderId, string $paymentMethod = 'credit_card'): Order
    {
        $order = $this->orderRepository->findOrder($orderId);

        if ($order->status !== 'pending') {
            throw new RuntimeException(
                "Order {$orderId} cannot be processed — current status: {$order->status}"
            );
        }

        // Validate the payment method before attempting to charge
        if (!$this->paymentService->validatePaymentMethod($paymentMethod)) {
            throw new RuntimeException(
                "Payment method '{$paymentMethod}' is not supported or not enabled"
            );
        }

        // Charge the customer — PaymentService throws RuntimeException on failure,
        // which propagates up to the controller for appropriate HTTP error handling
        $this->paymentService->charge($order);

        return $this->orderRepository->save($order);
    }

    /**
     * Cancel an order, release reserved inventory, and process a refund
     * if the order was already paid.
     */
    public function cancelOrder(int $orderId): Order
    {
        $order = $this->orderRepository->findOrder($orderId);

        if ($order->status === 'cancelled') {
            throw new RuntimeException("Order {$orderId} is already cancelled");
        }

        // Release stock for every line item back to inventory
        foreach ($order->items as $item) {
            $this->inventoryService->releaseStock(
                $item['product_id'],
                $item['quantity'],
            );
        }

        // Refund if the order was already paid
        if ($order->status === 'paid') {
            $this->paymentService->refund($order);
        }

        $order->status = 'cancelled';

        return $this->orderRepository->save($order);
    }

    /**
     * Manually mark an order as paid without going through the payment gateway.
     * Used for admin overrides, cash payments, or external payment confirmations.
     */
    public function markOrderPaid(int $orderId): Order
    {
        $order = $this->orderRepository->findOrder($orderId);

        if ($order->status !== 'pending') {
            throw new RuntimeException(
                "Order {$orderId} must be pending to mark as paid — current status: {$order->status}"
            );
        }

        $order->markAsPaid();

        return $this->orderRepository->save($order);
    }

    /**
     * Cancel all stale pending orders that have not been processed.
     * Iterates recent orders and cancels any still in pending status,
     * releasing their reserved inventory.
     *
     * @return array<int, Order> The list of cancelled orders
     */
    public function cancelStaleOrders(int $maxAge = 50): array
    {
        $recentOrders = $this->orderRepository->getRecentOrders($maxAge);
        $cancelledOrders = [];

        foreach ($recentOrders as $order) {
            if ($order->status !== 'pending') {
                continue;
            }

            // Check if the order is older than the staleness threshold
            $ageInHours = (time() - $order->createdAt->getTimestamp()) / 3600;

            if ($ageInHours > 24) {
                $cancelled = $this->cancelOrder($order->id);
                $cancelledOrders[] = $cancelled;
            }
        }

        return $cancelledOrders;
    }
}
