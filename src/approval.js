import { createHash } from "node:crypto";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function proposalPayload(proposal) {
  return {
    adapterId: proposal.adapterId,
    quoteId: proposal.quoteId,
    quoteExpiresAt: proposal.quoteExpiresAt,
    currency: proposal.currency,
    total: proposal.total,
    items: proposal.items,
  };
}

export function createCartProposal(quote, evaluation) {
  if (!evaluation?.accepted) {
    throw new Error("A cost and policy evaluation must accept the quote first.");
  }
  if (evaluation.quoteId !== quote.id) {
    throw new Error("The evaluation does not belong to this retailer quote.");
  }
  if (evaluation.economicCost !== quote.totals.grandTotal) {
    throw new Error("The evaluated cost does not match the retailer quote total.");
  }
  const proposal = {
    adapterId: quote.adapterId,
    quoteId: quote.id,
    quoteExpiresAt: quote.expiresAt,
    currency: quote.currency,
    total: quote.totals.grandTotal,
    items: quote.lineItems.map(({ productId, name, quantity, unitPrice, rowTotal }) => ({
      productId,
      name,
      quantity,
      unitPrice,
      rowTotal,
    })),
    status: "awaiting_approval",
  };
  return Object.freeze({ ...proposal, id: digest(proposalPayload(proposal)) });
}

export function approveCartProposal(proposal, options = {}) {
  const actor = options.actor ?? "local-user";
  const now = options.now ?? new Date();
  const ttlMinutes = options.ttlMinutes ?? 15;
  if (typeof actor !== "string" || actor.trim() === "") {
    throw new TypeError("An approving actor is required.");
  }
  verifyProposalIntegrity(proposal);
  const approvedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
  const receipt = {
    proposalId: proposal.id,
    quoteId: proposal.quoteId,
    actor,
    scope: "cart:draft",
    approvedAt,
    expiresAt,
  };
  return Object.freeze({ ...receipt, id: digest(receipt) });
}

export function verifyProposalIntegrity(proposal) {
  if (!proposal?.id || proposal.id !== digest(proposalPayload(proposal))) {
    throw new Error("The cart proposal changed after evaluation.");
  }
  return true;
}

export function verifyCartApproval(proposal, receipt, now = new Date()) {
  verifyProposalIntegrity(proposal);
  if (!receipt?.id) {
    throw new Error("Approval does not match this cart proposal.");
  }
  const { id: receiptId, ...receiptPayload } = receipt;
  if (receiptId !== digest(receiptPayload)) {
    throw new Error("The approval receipt changed after it was issued.");
  }
  if (!receipt || receipt.proposalId !== proposal.id || receipt.quoteId !== proposal.quoteId) {
    throw new Error("Approval does not match this cart proposal.");
  }
  if (receipt.scope !== "cart:draft") {
    throw new Error("Approval scope does not allow draft-cart creation.");
  }
  if (new Date(receipt.expiresAt).getTime() < now.getTime()) {
    throw new Error("Cart approval expired.");
  }
  if (new Date(proposal.quoteExpiresAt).getTime() < now.getTime()) {
    throw new Error("The retailer quote expired.");
  }
  return true;
}
