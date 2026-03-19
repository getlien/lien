<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Repositories\OrderRepository;
use App\Services\CheckoutService;
use App\Services\OrderService;
use App\Services\PaymentService;
use App\Services\PricingService;

class OrderController
{
    public function __construct(
        private readonly OrderService $orderService,
        private readonly OrderRepository $orderRepository,
        private readonly PricingService $pricingService,
        private readonly PaymentService $paymentService,
        private readonly CheckoutService $checkoutService,
    ) {}

    /**
     * Display a single order by its ID.
     * Fetches the order through the repository and serializes it
     * with enriched line items for the response.
     */
    public function show(int $id): array
    {
        $order = $this->orderRepository->findOrder($id);
        $items = $order->getItems();

        return [
            'status' => 'success',
            'data' => $order->toArray(),
            'item_count' => count($items),
        ];
    }

    /**
     * Create a new order from the request payload.
     * Expects user_id and an array of items with product_id and quantity.
     * Optionally applies a discount code before persisting.
     *
     * @param array{user_id: int, items: array<int, array{product_id: int, quantity: int}>, discount_code?: string} $request
     */
    public function store(array $request): array
    {
        $userId = $request['user_id'];
        $items = $request['items'];

        $order = $this->orderService->createOrder($userId, $items);

        // Apply discount code if provided in the request
        if (isset($request['discount_code'])) {
            $discountedTotal = $this->pricingService->applyDiscount(
                $order->total,
                $request['discount_code'],
            );
            $order->total = $discountedTotal;
        }

        return [
            'status' => 'success',
            'message' => 'Order created successfully',
            'data' => $order->toArray(),
            'formatted_total' => $this->pricingService->formatPrice($order->total),
        ];
    }

    /**
     * Process payment for a pending order.
     * Validates the payment method, then delegates to OrderService
     * which calls PaymentService internally. PaymentService exceptions
     * propagate up for appropriate error response formatting.
     */
    public function process(int $id, string $paymentMethod = 'credit_card'): array
    {
        // Early validation at the controller level for fast feedback
        if (!$this->paymentService->validatePaymentMethod($paymentMethod)) {
            return [
                'status' => 'error',
                'message' => "Payment method '{$paymentMethod}' is not supported",
            ];
        }

        $order = $this->orderService->processOrder($id, $paymentMethod);

        return [
            'status' => 'success',
            'message' => 'Order processed and payment charged',
            'data' => $order->toArray(),
        ];
    }

    /**
     * Cancel an existing order and release its inventory.
     * Refunds payment if the order was already charged.
     */
    public function cancel(int $id): array
    {
        $order = $this->orderService->cancelOrder($id);

        return [
            'status' => 'success',
            'message' => 'Order cancelled successfully',
            'data' => $order->toArray(),
        ];
    }

    /**
     * List all orders for a given user.
     * Uses the repository to fetch orders filtered by user ID.
     */
    public function index(int $userId): array
    {
        $orders = $this->orderRepository->findByUserId($userId);

        $serialized = array_map(
            fn($order) => $order->toArray(),
            $orders,
        );

        return [
            'status' => 'success',
            'data' => $serialized,
            'count' => count($serialized),
        ];
    }

    /**
     * List the most recent orders across all users.
     * Useful for admin dashboard and order monitoring.
     */
    public function recent(int $limit = 10): array
    {
        $orders = $this->orderRepository->getRecentOrders($limit);

        $serialized = array_map(
            fn($order) => $order->toArray(),
            $orders,
        );

        return [
            'status' => 'success',
            'data' => $serialized,
            'count' => count($serialized),
        ];
    }

    /**
     * Admin endpoint to manually mark an order as paid.
     * Used for cash payments or manual payment confirmations.
     */
    public function markPaid(int $id): array
    {
        $order = $this->orderService->markOrderPaid($id);

        return [
            'status' => 'success',
            'message' => 'Order marked as paid',
            'data' => $order->toArray(),
        ];
    }

    /**
     * Admin endpoint to clean up stale pending orders.
     * Cancels orders that have been pending for over 24 hours.
     */
    public function cleanupStale(): array
    {
        $cancelled = $this->orderService->cancelStaleOrders();

        $serialized = array_map(
            fn($order) => $order->toArray(),
            $cancelled,
        );

        return [
            'status' => 'success',
            'message' => count($cancelled) . ' stale orders cancelled',
            'data' => $serialized,
        ];
    }

    /**
     * Return a previously paid order and process a refund.
     * Uses the checkout service to handle refund and inventory release.
     */
    public function returnOrder(int $id): array
    {
        $order = $this->checkoutService->processReturn($id);

        return [
            'status' => 'success',
            'message' => 'Order returned and refund processed',
            'data' => $order->toArray(),
        ];
    }

    /**
     * Get a detailed status view for a specific order.
     * Returns enriched data including formatted prices and item details.
     */
    public function status(int $id): array
    {
        $orderStatus = $this->checkoutService->getOrderStatus($id);

        return [
            'status' => 'success',
            'data' => $orderStatus,
        ];
    }

    /**
     * Get a formatted order history for a specific user.
     * Uses the checkout service for consistent formatting.
     */
    public function history(int $userId): array
    {
        $history = $this->checkoutService->getUserOrderHistory($userId);

        return [
            'status' => 'success',
            'data' => $history,
            'count' => count($history),
        ];
    }
}
