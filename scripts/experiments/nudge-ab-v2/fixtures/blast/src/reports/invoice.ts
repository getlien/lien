import { applyDiscount } from '../pricing/discount.js';

// Out-of-directory dependent #2 of applyDiscount. Calls it positionally.
export function invoiceLine(label: string, price: number, rate: number): string {
  return `${label}: ${applyDiscount(price, rate).toFixed(2)}`;
}
