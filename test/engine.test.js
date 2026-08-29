import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { analyzePlan, assessChannel, evaluateDiscountQuote } from "../src/engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const example = resolve(here, "../examples/sample-household");
const readJson = async (name) => JSON.parse(await readFile(resolve(example, name), "utf8"));

test("il piano corrente rispetta €40 di carta", async () => {
  const household = await readJson("household.json");
  const plan = await readJson("baseline-plan.json");
  const result = analyzePlan(household, plan);

  assert.equal(result.valid, true);
  assert.equal(result.totals.economicCost, 169.26);
  assert.equal(result.totals.vouchers, 130);
  assert.equal(result.totals.cash, 39.26);
  assert.equal(result.cashMargin, 0.74);
});

test("un budget settimanale non rolling viene applicato a ogni settimana", async () => {
  const household = await readJson("household.json");
  household.budget.rolling = false;
  const result = analyzePlan(household, await readJson("baseline-plan.json"));
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.startsWith("Settimana 2:")));
});

test("i ticket non possono coprire alimenti dichiarati non eleggibili", async () => {
  const household = await readJson("household.json");
  const result = analyzePlan(household, {
    schemaVersion: 1,
    id: "voucher-eligibility-test",
    currency: "EUR",
    orders: [
      {
        id: "w1-test",
        week: 1,
        store: "Test store",
        foodSubtotal: 10,
        voucherEligibleFoodSubtotal: 5,
        houseSubtotal: 0,
        deliveryFee: 0,
        serviceFee: 0,
        voucherValues: [6],
        maxVouchers: 8,
        health: { corePassing: 0, coreTotal: 0, flexPassing: 0, flexTotal: 0, unknownFood: 0 },
      },
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.includes("alimentari eleggibili")));
});

test("un marketplace discount resta discovery-only se il prezzo online non è verificato", async () => {
  const household = await readJson("household.json");
  const plan = analyzePlan(household, await readJson("baseline-plan.json"));
  const channels = await readJson("discount-channels.json");
  const result = assessChannel(household, plan, channels[0]);

  assert.equal(result.mode, "discovery_only");
  assert.equal(result.theoreticalMaximumSavings, 1.67);
  assert.ok(result.reasons.includes("ONLINE_PRICE_NOT_VERIFIED"));
  assert.ok(result.reasons.includes("STRUCTURAL_SAVINGS_TOO_LOW"));
});

test("un preventivo non verificato non può entrare nel piano", async () => {
  const household = await readJson("household.json");
  const plan = analyzePlan(household, await readJson("baseline-plan.json"));
  const quote = await readJson("discount-quote.unverified.json");
  const result = evaluateDiscountQuote(household, plan, quote, new Date("2026-08-28T12:00:00+02:00"));

  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes("ONLINE_PRICE_NOT_VERIFIED"));
  assert.ok(result.reasons.includes("QUOTE_DATE_MISSING"));
  assert.ok(result.reasons.includes("COMPARABILITY_TOO_LOW"));
});

test("anche un preventivo sano viene respinto se il risparmio è sotto €5", async () => {
  const household = await readJson("household.json");
  const plan = analyzePlan(household, await readJson("baseline-plan.json"));
  const quote = {
    store: "Discount dimostrativo",
    capturedAt: "2026-08-28T10:00:00+02:00",
    priceBasis: "live_online",
    comparableNeedShare: 1,
    replacesOrderIds: ["w1-primary", "w2-local"],
    baselineEquivalentCost: 84.66,
    order: {
      foodSubtotal: 80,
      houseSubtotal: 0,
      deliveryFee: 2.99,
      serviceFee: 0,
      minimumFoodSubtotal: 80,
      maxVouchers: 8,
      voucherValues: [7, 7, 7, 7, 6, 6, 6, 6]
    },
    health: { corePassing: 10, coreTotal: 10, flexPassing: 4, flexTotal: 4, unknownFood: 0 }
  };
  const result = evaluateDiscountQuote(household, plan, quote, new Date("2026-08-28T12:00:00+02:00"));

  assert.equal(result.accepted, false);
  assert.equal(result.savingsEuro, 1.67);
  assert.ok(result.reasons.includes("SAVINGS_EURO_TOO_LOW"));
  assert.ok(result.reasons.includes("SAVINGS_RATE_TOO_LOW"));
});

test("un discount entra solo con risparmio netto, salute e budget verificati", async () => {
  const household = await readJson("household.json");
  const plan = analyzePlan(household, await readJson("baseline-plan.json"));
  const quote = {
    store: "Discount dimostrativo",
    capturedAt: "2026-08-28T10:00:00+02:00",
    priceBasis: "live_online",
    comparableNeedShare: 1,
    replacesOrderIds: ["w1-primary"],
    baselineEquivalentCost: 42.5,
    order: {
      foodSubtotal: 33,
      houseSubtotal: 0,
      deliveryFee: 0,
      serviceFee: 0,
      minimumFoodSubtotal: 0,
      maxVouchers: 8,
      voucherValues: [7, 7, 7, 6, 6]
    },
    health: { corePassing: 20, coreTotal: 20, flexPassing: 8, flexTotal: 8, unknownFood: 0 }
  };
  const result = evaluateDiscountQuote(household, plan, quote, new Date("2026-08-28T12:00:00+02:00"));

  assert.equal(result.accepted, true);
  assert.equal(result.savingsEuro, 9.5);
  assert.ok(result.projectedCycleCash <= 40);
});
