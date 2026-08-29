import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createOptimizedPlan, PlanningError } from "../src/optimizer.js";

const example = resolve("examples/optimizer-demo");
const readJson = async (name) => JSON.parse(await readFile(resolve(example, name), "utf8"));

async function inputs() {
  return {
    household: await readJson("household.json"),
    needs: await readJson("recurring-needs.json"),
    catalog: await readJson("catalog.json"),
  };
}

test("genera quattro liste minimizzando costo completo e carta", async () => {
  const { household, needs, catalog } = await inputs();
  const result = createOptimizedPlan(household, needs, catalog);
  assert.equal(result.analysis.valid, true);
  assert.equal(result.plan.orders.length, 4);
  assert.equal(result.analysis.totals.economicCost, 37.5);
  assert.equal(result.analysis.totals.vouchers, 28);
  assert.equal(result.analysis.totals.cash, 9.5);
  assert.ok(result.plan.orders.every((order) => order.storeId === "value-store"));
  assert.deepEqual(result.diagnostics.excludedNeeds, ["fresh-fruit"]);
  assert.equal(result.plan.orders[0].items[0].alternatives.length, 1);
});

test("il prezzo civetta non vince quando consegna e commissioni annullano il risparmio", async () => {
  const { household, needs, catalog } = await inputs();
  const result = createOptimizedPlan(household, needs, catalog);
  const milk = result.plan.orders[0].items.find((item) => item.needId === "milk");
  assert.equal(milk.unitPrice, 1.1);
  assert.equal(milk.alternatives[0].unitPrice, 0.99);
});

test("un prodotto ricorrente sotto soglia rende il bisogno scoperto", async () => {
  const { household, needs, catalog } = await inputs();
  for (const store of catalog.stores) {
    store.offers.find((offer) => offer.needId === "protein").healthScore = 60;
  }
  assert.throws(
    () => createOptimizedPlan(household, needs, catalog),
    (error) => error instanceof PlanningError && error.details.includes("protein"),
  );
});

test("un catalogo live scaduto non può alimentare un piano", async () => {
  const { household, needs, catalog } = await inputs();
  catalog.sourceType = "live";
  assert.throws(
    () => createOptimizedPlan(household, needs, catalog, new Date("2026-08-30T10:00:00Z")),
    /stale or not yet valid/,
  );
});

