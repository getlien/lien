<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Order;
use RuntimeException;

class PaymentService
{
    /** @var array<string, bool> Supported payment methods and their enabled status */
    private const PAYMENT_METHODS = [
        'credit_card' => true,
        'debit_card' => true,
        'paypal' => true,
        'apple_pay' => true,
        'google_pay' => true,
        'bank_transfer' => false,
        'crypto' => false,
    ];

    /**
     * Process a payment charge for the given order.
     * Validates the order state, communicates with the payment gateway,
     * and marks the order as paid on success.
     * Throws RuntimeException on payment failure — callers should
     * handle or propagate this exception.
     */
    public function charge(Order $order): bool
    {
        if ($order->status === 'paid') {
            throw new RuntimeException(
                "Order {$order->id} has already been paid"
            );
        }

        if ($order->total <= 0) {
            throw new RuntimeException(
                "Order {$order->id} has invalid total: {$order->total}"
            );
        }

        // Simulate payment gateway communication
        $gatewayResponse = $this->callPaymentGateway(
            amount: $order->total,
            currency: 'USD',
            orderId: $order->id,
        );

        if (!$gatewayResponse['success']) {
            throw new RuntimeException(
                "Payment failed for order {$order->id}: {$gatewayResponse['error']}"
            );
        }

        $order->markAsPaid();

        return true;
    }

    /**
     * Process a refund for a previously paid order.
     * Verifies the order was actually paid before attempting the refund
     * and updates the order status on success.
     */
    public function refund(Order $order): bool
    {
        if ($order->status !== 'paid') {
            throw new RuntimeException(
                "Cannot refund order {$order->id} with status '{$order->status}'"
            );
        }

        // Simulate refund through payment gateway
        $gatewayResponse = $this->callPaymentGateway(
            amount: -$order->total,
            currency: 'USD',
            orderId: $order->id,
        );

        if (!$gatewayResponse['success']) {
            throw new RuntimeException(
                "Refund failed for order {$order->id}: {$gatewayResponse['error']}"
            );
        }

        $order->status = 'refunded';

        return true;
    }

    /**
     * Validate whether a payment method is supported and enabled.
     * Returns false for unknown or disabled methods.
     */
    public function validatePaymentMethod(string $method): bool
    {
        $normalizedMethod = strtolower(trim($method));

        if (!isset(self::PAYMENT_METHODS[$normalizedMethod])) {
            return false;
        }

        return self::PAYMENT_METHODS[$normalizedMethod];
    }

    /**
     * Simulate a call to an external payment gateway API.
     * In production this would make an HTTP request to Stripe, etc.
     *
     * @return array{success: bool, transaction_id: string|null, error: string|null}
     */
    private function callPaymentGateway(float $amount, string $currency, int $orderId): array
    {
        // Simulate occasional gateway failures for testing
        // In production, this calls the actual payment API
        $transactionId = sprintf('txn_%s_%d', date('Ymd'), $orderId);

        return [
            'success' => true,
            'transaction_id' => $transactionId,
            'error' => null,
        ];
    }
}
