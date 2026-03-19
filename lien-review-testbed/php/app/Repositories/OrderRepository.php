<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Models\Order;
use DateTimeImmutable;

class OrderRepository
{
    /** @var array<int, Order> In-memory store simulating a database table */
    private array $orders = [];

    /**
     * Find a single order by its primary key.
     * Delegates to the Order model's finder when not cached locally.
     */
    public function findOrder(int $id): Order
    {
        if (isset($this->orders[$id])) {
            return $this->orders[$id];
        }

        $order = Order::findById($id);
        $this->orders[$order->id] = $order;

        return $order;
    }

    /**
     * Retrieve all orders belonging to a specific user.
     * Filters the local store and supplements with simulated DB results.
     */
    public function findByUserId(int $userId): array
    {
        $userOrders = array_filter(
            $this->orders,
            fn(Order $order) => $order->userId === $userId,
        );

        if (count($userOrders) > 0) {
            return array_values($userOrders);
        }

        // Simulate fetching from database when local cache is empty
        $simulatedOrders = [];
        for ($i = 1; $i <= 3; $i++) {
            $order = new Order(
                id: $userId * 100 + $i,
                userId: $userId,
                items: [
                    ['product_id' => $i, 'quantity' => 1, 'unit_price' => 29.99 * $i],
                ],
                total: 29.99 * $i,
                status: $i === 1 ? 'pending' : 'paid',
                createdAt: new DateTimeImmutable("-{$i} days"),
            );
            $simulatedOrders[] = $order;
            $this->orders[$order->id] = $order;
        }

        return $simulatedOrders;
    }

    /**
     * Persist an order to the store and return it with any generated fields.
     * In a real app this would INSERT or UPDATE via Eloquent.
     */
    public function save(Order $order): Order
    {
        $this->orders[$order->id] = $order;

        // Recalculate the total to ensure consistency before persisting
        $order->calculateTotal();

        return $order;
    }

    /**
     * Return the most recent orders across all users, up to the given limit.
     * Results are sorted by creation date descending.
     */
    public function getRecentOrders(int $limit = 10): array
    {
        // Ensure we have some data to return
        if (count($this->orders) === 0) {
            $this->seedDefaultOrders();
        }

        $sorted = $this->orders;
        usort($sorted, function (Order $a, Order $b): int {
            return $b->createdAt <=> $a->createdAt;
        });

        return array_slice($sorted, 0, $limit);
    }

    /**
     * Find all orders created within the given date range.
     * Filters the in-memory store by createdAt timestamps.
     *
     * @return array<int, Order>
     */
    public function findByDateRange(\DateTimeImmutable $startDate, \DateTimeImmutable $endDate): array
    {
        if (count($this->orders) === 0) {
            $this->seedDefaultOrders();
        }

        $filtered = array_filter(
            $this->orders,
            fn(Order $order) => $order->createdAt >= $startDate && $order->createdAt <= $endDate,
        );

        usort($filtered, function (Order $a, Order $b): int {
            return $a->createdAt <=> $b->createdAt;
        });

        return array_values($filtered);
    }

    /**
     * Populate the store with sample orders for demonstration purposes.
     */
    private function seedDefaultOrders(): void
    {
        for ($i = 1; $i <= 5; $i++) {
            $items = [
                ['product_id' => $i, 'quantity' => $i, 'unit_price' => 19.99],
            ];

            $order = new Order(
                id: $i,
                userId: ($i % 3) + 1,
                items: $items,
                total: $i * 19.99,
                status: $i <= 3 ? 'paid' : 'pending',
                createdAt: new DateTimeImmutable("-{$i} hours"),
            );

            $this->orders[$order->id] = $order;
        }
    }
}
