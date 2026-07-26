export interface Order {
  id: string;
  state: string;
  customerName: string;
}

export function formatStatus(order: Order): string {
  return `Order ${order.id}: ${order.state}`;
}
