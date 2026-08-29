import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readFile as readFixture } from "node:fs/promises";
import { validateDocument, SchemaValidationError } from "../src/validation.js";
import { writeInitialDocuments } from "../src/onboarding.js";

const optimizerExample = resolve("examples/optimizer-demo");
const readJson = async (path) => JSON.parse(await readFixture(path, "utf8"));

test("gli esempi pubblici rispettano i contratti JSON v1", async () => {
  await Promise.all([
    validateDocument("household", await readJson(resolve(optimizerExample, "household.json"))),
    validateDocument("needs", await readJson(resolve(optimizerExample, "recurring-needs.json"))),
    validateDocument("catalog", await readJson(resolve(optimizerExample, "catalog.json"))),
    validateDocument("plan", await readJson(resolve("examples/sample-household/baseline-plan.json"))),
  ]);
});

test("un budget negativo viene respinto prima del calcolo", async () => {
  const household = await readJson(resolve(optimizerExample, "household.json"));
  household.budget.cashPerWeek = -1;
  await assert.rejects(validateDocument("household", household), SchemaValidationError);
});

test("l'onboarding scrive in una directory scelta e non sovrascrive per default", async (context) => {
  const temporary = await mkdtemp(resolve(tmpdir(), "spesa-onboarding-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = resolve(temporary, "profile");
  const created = await writeInitialDocuments(destination, {
    id: "test-household",
    voucherProvider: "test-vouchers",
    voucherValues: [7, 6],
  });
  const household = JSON.parse(await readFile(created.householdPath, "utf8"));
  const needs = JSON.parse(await readFile(created.needsPath, "utf8"));
  assert.equal(household.budget.cashPerCycle, 40);
  assert.deepEqual(household.vouchers.values, [7, 6]);
  assert.deepEqual(needs.needs, []);
  await assert.rejects(writeInitialDocuments(destination), /already exists/);
});

