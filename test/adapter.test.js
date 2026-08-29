import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { MockStoreAdapter } from "../src/adapters/mock-store-adapter.js";
import { quoteToDiscountInput } from "../src/contracts/store-adapter.js";
import { InMemoryProfileStore } from "../src/contracts/profile-store.js";
import { analyzePlan, evaluateDiscountQuote } from "../src/engine.js";
import {
  approveCartProposal,
  createCartProposal,
  verifyCartApproval,
  verifyProposalIntegrity,
} from "../src/approval.js";

const here = dirname(fileURLToPath(import.meta.url));
const example = resolve(here, "../examples/sample-household");
const readJson = async (name) => JSON.parse(await readFile(resolve(example, name), "utf8"));

const requestedItems = [
  { needId: "milk", productId: "milk-basic", quantity: 8, role: "core" },
  { needId: "eggs", productId: "eggs-basic", quantity: 4, role: "core" },
  { needId: "protein", productId: "protein-basic", quantity: 3, role: "core" },
  { needId: "pasta", productId: "pasta-basic", quantity: 4, role: "core" },
];

async function acceptedProposal(now = new Date("2026-08-29T10:00:00Z")) {
  const household = await readJson("household.json");
  const baseline = analyzePlan(household, await readJson("baseline-plan.json"));
  const adapter = new MockStoreAdapter(await readJson("mock-store.json"));
  const quote = await adapter.createQuote({ items: requestedItems }, now);
  const input = quoteToDiscountInput(
    quote,
    {
      comparableNeedShare: 1,
      replacesOrderIds: ["w1-primary"],
      baselineEquivalentCost: 42.5,
      voucherValues: [7, 7, 7, 6, 6],
    },
    household,
  );
  const evaluation = evaluateDiscountQuote(household, baseline, input, now);
  return { adapter, quote, evaluation, proposal: createCartProposal(quote, evaluation), now };
}

test("un adapter espone preventivi strutturati senza checkout", async () => {
  const adapter = new MockStoreAdapter(await readJson("mock-store.json"));
  const results = await adapter.searchProducts("milk");
  assert.equal(results.length, 1);
  assert.equal(typeof adapter.checkout, "undefined");

  const quote = await adapter.createQuote(
    { items: requestedItems },
    new Date("2026-08-29T10:00:00Z"),
  );
  assert.equal(quote.totals.foodSubtotal, 33);
  assert.equal(quote.totals.grandTotal, 33);
  assert.equal(quote.priceBasis, "same_as_store_verified");
});

test("la bozza carrello richiede valutazione e approvazione corrispondenti", async () => {
  const { adapter, evaluation, proposal, now } = await acceptedProposal();
  assert.equal(evaluation.accepted, true);

  await assert.rejects(adapter.createDraftCart(proposal, null, now), /Approval does not match/);

  const receipt = approveCartProposal(proposal, { actor: "sample-user", now });
  const draft = await adapter.createDraftCart(proposal, receipt, now);
  assert.equal(draft.status, "draft");
  assert.equal(draft.checkoutPerformed, false);
  assert.equal(draft.proposalId, proposal.id);
});

test("una modifica successiva invalida l'approvazione", async () => {
  const { proposal } = await acceptedProposal();
  const tampered = { ...proposal, total: proposal.total + 1 };
  assert.throws(() => verifyProposalIntegrity(tampered), /changed after evaluation/);
});

test("una decisione accettata per un altro preventivo non crea una proposta", async () => {
  const { quote, evaluation } = await acceptedProposal();
  assert.throws(
    () => createCartProposal({ ...quote, id: "different-quote" }, evaluation),
    /does not belong to this retailer quote/,
  );
  assert.throws(
    () => createCartProposal(quote, { ...evaluation, economicCost: evaluation.economicCost - 1 }),
    /evaluated cost does not match/,
  );
});

test("un'approvazione scaduta non può creare il carrello", async () => {
  const { proposal, now } = await acceptedProposal();
  const receipt = approveCartProposal(proposal, { actor: "sample-user", now, ttlMinutes: 1 });
  const later = new Date(now.getTime() + 2 * 60_000);
  assert.throws(() => verifyCartApproval(proposal, receipt, later), /approval expired/i);
});

test("una ricevuta d'approvazione modificata viene respinta", async () => {
  const { proposal, now } = await acceptedProposal();
  const receipt = approveCartProposal(proposal, { actor: "sample-user", now });
  const tampered = { ...receipt, actor: "different-user" };
  assert.throws(() => verifyCartApproval(proposal, tampered, now), /receipt changed/i);
});

test("la memoria strutturata rileva aggiornamenti concorrenti", async () => {
  const store = new InMemoryProfileStore({ needs: [] });
  const first = await store.read();
  await store.replace(first.version, { needs: [{ id: "milk" }] });
  await assert.rejects(store.replace(first.version, { needs: [] }), /Profile conflict/);
  const latest = await store.read();
  assert.equal(latest.version, 2);
  assert.deepEqual(latest.profile.needs, [{ id: "milk" }]);
});
