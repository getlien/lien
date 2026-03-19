<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Services\CheckoutService;
use App\Services\OrderService;

class CheckoutController
{
    public function __construct(
        private readonly CheckoutService $checkoutService,
        private readonly OrderService $orderService,
    ) {}

    /**
     * Execute an express single-product checkout.
     * Validates stock, reserves inventory, creates and charges
     * the order in a single request.
     *
     * @param array{user_id: int, product_id: int, quantity: int, payment_method?: string} $request
     */
    public function express(array $request): array
    {
        $order = $this->checkoutService->expressCheckout(
            userId: $request['user_id'],
            productId: $request['product_id'],
            quantity: $request['quantity'],
            paymentMethod: $request['payment_method'] ?? 'credit_card',
        );

        return [
            'status' => 'success',
            'message' => 'Express checkout completed',
            'data' => $order->toArray(),
        ];
    }

    /**
     * Preview cart totals and availability before checkout.
     * Does not create an order or reserve inventory.
     *
     * @param array{items: array<int, array{product_id: int, quantity: int}>} $request
     */
    public function preview(array $request): array
    {
        $cart = $this->checkoutService->previewCart($request['items']);

        return [
            'status' => 'success',
            'data' => $cart,
        ];
    }

    /**
     * Process a return for a paid order.
     * Refunds payment and releases inventory back to stock.
     */
    public function returnOrder(int $orderId): array
    {
        $order = $this->checkoutService->processReturn($orderId);

        return [
            'status' => 'success',
            'message' => 'Return processed successfully',
            'data' => $order->toArray(),
        ];
    }

    /**
     * Get the current status of an order during checkout flow.
     * Returns enriched order details with formatted prices.
     */
    public function status(int $orderId): array
    {
        $orderStatus = $this->checkoutService->getOrderStatus($orderId);

        return [
            'status' => 'success',
            'data' => $orderStatus,
        ];
    }

    /**
     * Display a user's order history for the account dashboard.
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

    /**
     * Admin endpoint to manually confirm payment for an order.
     * Used for offline payments like cash or bank transfers.
     */
    public function confirmPayment(int $orderId): array
    {
        $order = $this->orderService->markOrderPaid($orderId);

        return [
            'status' => 'success',
            'message' => 'Payment confirmed manually',
            'data' => $order->toArray(),
        ];
    }

    /**
     * Admin endpoint to trigger cleanup of expired pending orders.
     * Called by cron job or admin dashboard.
     */
    public function cleanup(): array
    {
        $cancelled = $this->orderService->cancelStaleOrders();

        return [
            'status' => 'success',
            'message' => count($cancelled) . ' expired orders cleaned up',
            'cancelled_count' => count($cancelled),
        ];
    }

    /**
     * Full checkout flow: create an order and immediately process payment.
     * Combines order creation and payment processing for a seamless experience.
     *
     * @param array{user_id: int, items: array<int, array{product_id: int, quantity: int}>, payment_method?: string} $request
     */
    public function fullCheckout(array $request): array
    {
        $order = $this->orderService->createOrder(
            $request['user_id'],
            $request['items'],
        );

        $paymentMethod = $request['payment_method'] ?? 'credit_card';
        $processedOrder = $this->orderService->processOrder($order->id, $paymentMethod);

        return [
            'status' => 'success',
            'message' => 'Order created and payment processed',
            'data' => $processedOrder->toArray(),
        ];
    }
}
