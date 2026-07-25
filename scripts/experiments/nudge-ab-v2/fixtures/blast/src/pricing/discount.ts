// The edited file. Self-contained on its face: nothing here names or hints at
// the modules that call applyDiscount (they live in other directories).
export function applyDiscount(price: number, rate: number): number {
  return price - price * rate;
}
