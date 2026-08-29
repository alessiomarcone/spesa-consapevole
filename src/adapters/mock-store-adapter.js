import { randomUUID } from "node:crypto";
import { StoreAdapter, STORE_CAPABILITIES } from "../contracts/store-adapter.js";
import { verifyCartApproval } from "../approval.js";

const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export class MockStoreAdapter extends StoreAdapter {
  constructor(config) {
    super({
      id: config.id,
      name: config.name,
      capabilities: [
        STORE_CAPABILITIES.SEARCH,
        STORE_CAPABILITIES.QUOTE,
        STORE_CAPABILITIES.ORDER_HISTORY,
        STORE_CAPABILITIES.DRAFT_CART,
      ],
    });
    this.config = structuredClone(config);
    this.draftCarts = [];
  }

  async searchProducts(query) {
    const term = query.trim().toLocaleLowerCase();
    return this.config.products
      .filter((product) =>
        [product.name, ...(product.tags ?? [])]
          .join(" ")
          .toLocaleLowerCase()
          .includes(term),
      )
      .map((product) => structuredClone(product));
  }

  async createQuote(request, now = new Date()) {
    const lineItems = request.items.map((requested) => {
      const product = this.config.products.find((item) => item.id === requested.productId);
      if (!product) throw new Error(`Unknown product: ${requested.productId}`);
      if (!product.available) throw new Error(`Product unavailable: ${product.id}`);
      const rowTotal = money(product.unitPrice * requested.quantity);
      return {
        needId: requested.needId,
        productId: product.id,
        name: product.name,
        quantity: requested.quantity,
        unitPrice: product.unitPrice,
        rowTotal,
        role: requested.role,
        healthScore: product.healthScore,
        scoreSource: product.scoreSource,
        voucherEligible: product.voucherEligible,
      };
    });

    const foodSubtotal = money(
      lineItems.filter((item) => item.voucherEligible).reduce((sum, item) => sum + item.rowTotal, 0),
    );
    const houseSubtotal = money(
      lineItems.filter((item) => !item.voucherEligible).reduce((sum, item) => sum + item.rowTotal, 0),
    );
    const deliveryFee = money(this.config.deliveryFee ?? 0);
    const serviceFee = money(this.config.serviceFee ?? 0);

    return {
      id: randomUUID(),
      adapterId: this.metadata.id,
      storeName: this.metadata.name,
      currency: this.config.currency ?? "EUR",
      priceBasis: this.config.priceBasis,
      capturedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (this.config.quoteTtlMinutes ?? 30) * 60_000).toISOString(),
      lineItems,
      totals: {
        foodSubtotal,
        houseSubtotal,
        deliveryFee,
        serviceFee,
        grandTotal: money(foodSubtotal + houseSubtotal + deliveryFee + serviceFee),
      },
      payment: {
        minimumFoodSubtotal: this.config.minimumFoodSubtotal ?? 0,
        maxVouchers: this.config.maxVouchers ?? 0,
        voucherProvider: this.config.voucherProvider ?? null,
      },
      source: {
        kind: "fixture",
        reference: this.config.sourceReference,
      },
    };
  }

  async getOrderHistory() {
    return structuredClone(this.config.orderHistory ?? []);
  }

  async createDraftCart(proposal, approvalReceipt, now = new Date()) {
    verifyCartApproval(proposal, approvalReceipt, now);
    const draft = {
      id: randomUUID(),
      adapterId: this.metadata.id,
      status: "draft",
      proposalId: proposal.id,
      items: structuredClone(proposal.items),
      total: proposal.total,
      currency: proposal.currency,
      checkoutPerformed: false,
    };
    this.draftCarts.push(draft);
    return structuredClone(draft);
  }
}
