/**
 * Store adapters expose narrow, auditable operations to agents.
 * They deliberately do not expose arbitrary retailer APIs or checkout.
 */

export const STORE_CAPABILITIES = Object.freeze({
  SEARCH: "search",
  QUOTE: "quote",
  ORDER_HISTORY: "order_history",
  DRAFT_CART: "draft_cart",
});

const ALLOWED_CAPABILITIES = new Set(Object.values(STORE_CAPABILITIES));

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
}

export function validateAdapterMetadata(metadata) {
  requireText(metadata?.id, "metadata.id");
  requireText(metadata?.name, "metadata.name");
  if (!Array.isArray(metadata.capabilities)) {
    throw new TypeError("metadata.capabilities must be an array.");
  }
  for (const capability of metadata.capabilities) {
    if (!ALLOWED_CAPABILITIES.has(capability)) {
      throw new TypeError(`Unsupported adapter capability: ${capability}`);
    }
  }
  return Object.freeze({
    ...metadata,
    capabilities: Object.freeze([...metadata.capabilities]),
  });
}

export class StoreAdapter {
  constructor(metadata) {
    this.metadata = validateAdapterMetadata(metadata);
  }

  async searchProducts() {
    throw new Error(`${this.metadata.id} does not implement searchProducts().`);
  }

  async createQuote() {
    throw new Error(`${this.metadata.id} does not implement createQuote().`);
  }

  async getOrderHistory() {
    throw new Error(`${this.metadata.id} does not implement getOrderHistory().`);
  }

  async createDraftCart() {
    throw new Error(`${this.metadata.id} does not implement createDraftCart().`);
  }
}

export function summarizeQuoteHealth(lineItems, thresholds) {
  const summary = {
    corePassing: 0,
    coreTotal: 0,
    flexPassing: 0,
    flexTotal: 0,
    unknownFood: 0,
  };

  for (const item of lineItems) {
    if (!["core", "flex"].includes(item.role)) continue;
    if (item.role === "core") summary.coreTotal += 1;
    if (item.role === "flex") summary.flexTotal += 1;

    if (typeof item.healthScore !== "number") {
      summary.unknownFood += 1;
      continue;
    }
    if (item.role === "core" && item.healthScore >= thresholds.core) {
      summary.corePassing += 1;
    }
    if (item.role === "flex" && item.healthScore >= thresholds.flex) {
      summary.flexPassing += 1;
    }
  }
  return summary;
}

export function quoteToDiscountInput(quote, comparison, household) {
  if (!quote || !Array.isArray(quote.lineItems)) {
    throw new TypeError("A quote with lineItems is required.");
  }
  return {
    quoteId: quote.id,
    store: quote.storeName,
    capturedAt: quote.capturedAt,
    priceBasis: quote.priceBasis,
    comparableNeedShare: comparison.comparableNeedShare,
    replacesOrderIds: comparison.replacesOrderIds,
    baselineEquivalentCost: comparison.baselineEquivalentCost,
    order: {
      foodSubtotal: quote.totals.foodSubtotal,
      houseSubtotal: quote.totals.houseSubtotal,
      deliveryFee: quote.totals.deliveryFee,
      serviceFee: quote.totals.serviceFee,
      minimumFoodSubtotal: quote.payment.minimumFoodSubtotal,
      maxVouchers: quote.payment.maxVouchers,
      voucherValues: comparison.voucherValues,
    },
    health: summarizeQuoteHealth(quote.lineItems, household.health.thresholds),
  };
}
