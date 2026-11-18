export type Tier = { minQty: number; unitPrice: number };

/** Unit price for a quantity: the best tier whose minQty is met, else the base price. */
export function unitPriceFor(basePrice: number, tiers: Tier[], qty: number): number {
  let price = basePrice;
  let best = 0;
  for (const t of tiers) {
    if (qty >= t.minQty && t.minQty > best) {
      best = t.minQty;
      price = t.unitPrice;
    }
  }
  return price;
}

/** Lowest possible unit price (used for "from $x" labels). */
export function fromPrice(basePrice: number, tiers: Tier[]): number {
  return Math.min(basePrice, ...tiers.map((t) => t.unitPrice));
}
