/**
 * Intentionally complex function to test Veille's review pipeline.
 * DELETE THIS FILE after verifying the app works end-to-end.
 */
export function processOrder(
  order: { items: any[]; customer: any; discount?: string; region?: string },
  inventory: Map<string, number>,
  config: { taxRates: Record<string, number>; freeShippingThreshold: number },
) {
  let total = 0;
  let taxAmount = 0;
  let shippingCost = 0;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const item of order.items) {
    if (!item.id) {
      errors.push('Item missing ID');
      continue;
    }

    const stock = inventory.get(item.id);
    if (stock === undefined) {
      errors.push(`Item ${item.id} not found in inventory`);
      continue;
    } else if (stock < item.quantity) {
      if (stock === 0) {
        errors.push(`Item ${item.id} is out of stock`);
        continue;
      } else {
        warnings.push(`Item ${item.id} only has ${stock} in stock, requested ${item.quantity}`);
        item.quantity = stock;
      }
    }

    let price = item.price * item.quantity;

    if (order.discount) {
      if (order.discount === 'HALF') {
        price = price * 0.5;
      } else if (order.discount === 'QUARTER') {
        price = price * 0.75;
      } else if (order.discount === 'TENOFF') {
        price = price * 0.9;
      } else if (order.discount.startsWith('CUSTOM_')) {
        const pct = parseInt(order.discount.replace('CUSTOM_', ''), 10);
        if (!isNaN(pct) && pct > 0 && pct <= 100) {
          price = price * (1 - pct / 100);
        } else {
          warnings.push(`Invalid custom discount: ${order.discount}`);
        }
      } else {
        warnings.push(`Unknown discount code: ${order.discount}`);
      }
    }

    if (item.category === 'electronics') {
      if (order.region === 'EU') {
        taxAmount += price * (config.taxRates['EU_electronics'] || 0.21);
      } else if (order.region === 'US') {
        taxAmount += price * (config.taxRates['US_electronics'] || 0.08);
      } else if (order.region === 'UK') {
        taxAmount += price * (config.taxRates['UK_electronics'] || 0.20);
      } else {
        taxAmount += price * (config.taxRates['default'] || 0.15);
      }
    } else if (item.category === 'food') {
      if (order.region === 'EU') {
        taxAmount += price * (config.taxRates['EU_food'] || 0.09);
      } else if (order.region === 'US') {
        taxAmount += price * 0;
      } else {
        taxAmount += price * (config.taxRates['default_food'] || 0.05);
      }
    } else if (item.category === 'clothing') {
      if (order.region === 'EU') {
        taxAmount += price * (config.taxRates['EU_clothing'] || 0.21);
      } else if (order.region === 'US') {
        if (price > 110) {
          taxAmount += price * (config.taxRates['US_clothing_luxury'] || 0.08);
        }
      } else {
        taxAmount += price * (config.taxRates['default'] || 0.15);
      }
    } else {
      taxAmount += price * (config.taxRates['default'] || 0.15);
    }

    total += price;
    inventory.set(item.id, stock - item.quantity);
  }

  if (total < config.freeShippingThreshold) {
    if (order.region === 'EU') {
      shippingCost = 12.99;
    } else if (order.region === 'US') {
      shippingCost = 9.99;
    } else if (order.region === 'UK') {
      shippingCost = 11.99;
    } else {
      shippingCost = 19.99;
    }
  }

  if (errors.length > 0) {
    return { success: false, errors, warnings, total: 0, tax: 0, shipping: 0 };
  }

  return {
    success: true,
    errors: [],
    warnings,
    total: total + taxAmount + shippingCost,
    tax: taxAmount,
    shipping: shippingCost,
  };
}
