import { applyDiscount } from '../pricing/discount.js';

interface LineItem {
  price: number;
  rate: number;
}

// Out-of-directory dependent #1 of applyDiscount. Calls it positionally.
export function cartTotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + applyDiscount(item.price, item.rate), 0);
}
