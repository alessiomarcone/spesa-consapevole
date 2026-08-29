#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  analyzePlan,
  assessChannel,
  evaluateDiscountQuote,
  formatEuro,
} from "./engine.js";
import { MockStoreAdapter } from "./adapters/mock-store-adapter.js";
import { quoteToDiscountInput } from "./contracts/store-adapter.js";
import { approveCartProposal, createCartProposal } from "./approval.js";
import { writeInitialDocuments } from "./onboarding.js";
import { createOptimizedPlan } from "./optimizer.js";
import { validateDocument } from "./validation.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const example = resolve(root, "examples/sample-household");
const optimizerExample = resolve(root, "examples/optimizer-demo");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function valueOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return args[index + 1];
}

function pathOption(args, name, fallback) {
  const value = valueOption(args, name, null);
  return value === null ? fallback : resolve(value);
}

function numberOption(args, name, fallback) {
  const value = valueOption(args, name, null);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return parsed;
}

function csvOption(args, name, fallback = []) {
  const value = valueOption(args, name, null);
  return value === null
    ? fallback
    : value.split(",").map((item) => item.trim()).filter(Boolean);
}

function printPlan(analysis) {
  console.log("Spesa Consapevole · ciclo di 4 settimane\n");
  for (const order of analysis.orders) {
    console.log(
      `W${order.week} · ${order.store}: ${formatEuro(order.economicCost)} ` +
        `(${formatEuro(order.voucherValue)} ticket + ${formatEuro(order.cash)} carta)`,
    );
  }
  console.log("\nTotali");
  console.log(`  Alimenti:  ${formatEuro(analysis.totals.food)}`);
  console.log(`  Casa:      ${formatEuro(analysis.totals.house)}`);
  console.log(`  Consegne:  ${formatEuro(analysis.totals.fees)}`);
  console.log(`  Economico: ${formatEuro(analysis.totals.economicCost)}`);
  console.log(`  Ticket:    ${formatEuro(analysis.totals.vouchers)}`);
  console.log(`  Carta:     ${formatEuro(analysis.totals.cash)}`);
  console.log(`  Margine:   ${formatEuro(analysis.cashMargin)}`);
  console.log(`\nEsito: ${analysis.valid ? "PIANO VALIDO" : "PIANO NON VALIDO"}`);
  for (const issue of analysis.issues) console.log(`  - ${issue}`);
}

async function loadBase(args) {
  const householdPath = pathOption(args, "--household", resolve(example, "household.json"));
  const planPath = pathOption(args, "--plan", resolve(example, "baseline-plan.json"));
  const [household, plan] = await Promise.all([readJson(householdPath), readJson(planPath)]);
  await Promise.all([validateDocument("household", household), validateDocument("plan", plan)]);
  return { household, plan, analysis: analyzePlan(household, plan) };
}

function printOptimized(result) {
  console.log(`Spesa Consapevole · piano ottimizzato${result.plan.simulation ? " · SIMULAZIONE" : ""}\n`);
  const weeks = [...new Set(result.plan.orders.map((order) => order.week))].sort((a, b) => a - b);
  for (const week of weeks) {
    console.log(`Settimana ${week}`);
    for (const order of result.analysis.orders.filter((item) => item.week === week)) {
      console.log(
        `  ${order.store}: ${formatEuro(order.economicCost)} ` +
          `(${formatEuro(order.voucherValue)} ticket + ${formatEuro(order.cash)} carta)`,
      );
      for (const item of order.items ?? []) {
        const score = typeof item.healthScore === "number" ? `salute ${item.healthScore}` : "salute n/d";
        const alternative = item.alternatives?.[0];
        const alternativeText = alternative
          ? ` · alternativa ${alternative.storeName}: ${formatEuro(alternative.unitPrice)}`
          : "";
        console.log(
          `    [ ] ${item.name} · ${item.quantity} × ${item.unit} · ${formatEuro(item.unitPrice)} · ${score}${alternativeText}`,
        );
      }
    }
    console.log("");
  }
  console.log(`Totale economico: ${formatEuro(result.analysis.totals.economicCost)}`);
  console.log(`Ticket: ${formatEuro(result.analysis.totals.vouchers)}`);
  console.log(`Carta: ${formatEuro(result.analysis.totals.cash)}`);
  if (result.diagnostics.excludedNeeds.length > 0) {
    console.log(`Esclusi dal profilo: ${result.diagnostics.excludedNeeds.join(", ")}`);
  }
}

function printHelp() {
  console.log(`Spesa Consapevole

Usage:
  spesa plan [--household FILE] [--plan FILE] [--json]
  spesa optimize [--household FILE] [--needs FILE] [--catalog FILE] [--json]
  spesa init [--output DIR] [--cash-week N] [--voucher-values CSV]
  spesa needs [--needs FILE] [--json]
  spesa channels [--channels FILE] [--json]
  spesa store-demo [--approve] [--json]

The optimize command previews a plan. The store demo creates at most a mock
draft cart after --approve; checkout and payment are never performed.`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "plan";

  if (["help", "--help", "-h"].includes(command)) {
    printHelp();
    return;
  }

  if (command === "init") {
    const voucherValues = csvOption(args, "--voucher-values").map(Number);
    if (voucherValues.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error("--voucher-values must be a comma-separated list of positive numbers.");
    }
    const result = await writeInitialDocuments(
      pathOption(args, "--output", resolve(root, "data/private/default")),
      {
        id: valueOption(args, "--id", "my-household"),
        country: valueOption(args, "--country", "IT").toUpperCase(),
        deliveryArea: valueOption(args, "--delivery-area", "set-me"),
        cycleWeeks: numberOption(args, "--cycle-weeks", 4),
        cashPerWeek: numberOption(args, "--cash-week", 10),
        cashPerCycle: numberOption(args, "--cash-cycle", undefined),
        voucherProvider: valueOption(args, "--voucher-provider", null),
        voucherValues,
        healthEnabled: valueOption(args, "--health", "on") !== "off",
        coreThreshold: numberOption(args, "--core-threshold", 71),
        flexThreshold: numberOption(args, "--flex-threshold", 50),
        excludedCategories: csvOption(args, "--exclude", ["fresh-fruit", "fresh-vegetables"]),
        force: args.includes("--force"),
      },
    );
    console.log(`Profilo creato in ${result.directory}`);
    console.log(`  ${result.householdPath}`);
    console.log(`  ${result.needsPath}`);
    return;
  }

  if (command === "optimize") {
    const household = await readJson(
      pathOption(args, "--household", resolve(optimizerExample, "household.json")),
    );
    const needs = await readJson(
      pathOption(args, "--needs", resolve(optimizerExample, "recurring-needs.json")),
    );
    const catalog = await readJson(
      pathOption(args, "--catalog", resolve(optimizerExample, "catalog.json")),
    );
    await Promise.all([
      validateDocument("household", household),
      validateDocument("needs", needs),
      validateDocument("catalog", catalog),
    ]);
    const result = createOptimizedPlan(household, needs, catalog);
    await validateDocument("plan", result.plan);
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else printOptimized(result);
    return;
  }

  const { household, plan, analysis } = await loadBase(args);

  if (command === "plan") {
    const quotePath = pathOption(args, "--discount-quote", null);
    const output = { plan: analysis };
    if (quotePath) output.discount = evaluateDiscountQuote(household, analysis, await readJson(quotePath));
    if (args.includes("--json")) console.log(JSON.stringify(output, null, 2));
    else {
      printPlan(analysis);
      if (output.discount) {
        console.log(`\nDiscount: ${output.discount.accepted ? "AMMESSO" : "ESCLUSO"}`);
        console.log(`  Risparmio: ${formatEuro(output.discount.savingsEuro)}`);
        console.log(`  Carta ciclo: ${formatEuro(output.discount.projectedCycleCash)}`);
        for (const reason of output.discount.reasons) console.log(`  - ${reason}`);
      }
    }
    return;
  }

  if (command === "channels") {
    const channelsPath = pathOption(args, "--channels", resolve(example, "discount-channels.json"));
    const channels = await readJson(channelsPath);
    const results = channels.map((channel) => assessChannel(household, analysis, channel));
    if (args.includes("--json")) console.log(JSON.stringify(results, null, 2));
    else {
      console.log("Valutazione canali discount\n");
      for (const result of results) {
        console.log(`${result.name}: ${result.mode === "quote_required" ? "PREVENTIVO RICHIESTO" : "SOLO SCOPERTA"}`);
        console.log(`  Costo sostituito: ${formatEuro(result.replacedCost)}`);
        console.log(`  Minimo canale:    ${formatEuro(result.minimumChannelCost)}`);
        console.log(`  Risparmio teorico massimo: ${formatEuro(result.theoreticalMaximumSavings)}`);
        for (const reason of result.reasons) console.log(`  - ${reason}`);
        console.log("");
      }
    }
    return;
  }

  if (command === "needs") {
    const needsPath = pathOption(args, "--needs", resolve(example, "recurring-needs.json"));
    const data = await readJson(needsPath);
    await validateDocument("needs", data);
    if (args.includes("--json")) console.log(JSON.stringify(data, null, 2));
    else {
      console.log("Bisogni ricorrenti · checklist grezza\n");
      for (const need of data.needs) {
        const quantity = need.frequency === "discovery" ? `target ${need.targetQuantity}` : need.quantityPerCycle;
        console.log(`[ ] ${need.label} · ${quantity} × ${need.unit} · ${need.frequency} · max ${formatEuro(need.maxUnitPrice)}`);
      }
    }
    return;
  }

  if (command === "store-demo") {
    const storePath = pathOption(args, "--store", resolve(example, "mock-store.json"));
    const adapter = new MockStoreAdapter(await readJson(storePath));
    const now = new Date();
    const quote = await adapter.createQuote(
      {
        items: [
          { needId: "milk", productId: "milk-basic", quantity: 8, role: "core" },
          { needId: "eggs", productId: "eggs-basic", quantity: 4, role: "core" },
          { needId: "protein", productId: "protein-basic", quantity: 3, role: "core" },
          { needId: "pasta", productId: "pasta-basic", quantity: 4, role: "core" },
        ],
      },
      now,
    );
    const evaluationInput = quoteToDiscountInput(
      quote,
      {
        comparableNeedShare: 1,
        replacesOrderIds: ["w1-primary"],
        baselineEquivalentCost: 42.5,
        voucherValues: [7, 7, 7, 6, 6],
      },
      household,
    );
    const evaluation = evaluateDiscountQuote(household, analysis, evaluationInput, now);
    await Promise.all([
      validateDocument("store-quote", quote),
      validateDocument("decision", evaluation),
    ]);
    const proposal = createCartProposal(quote, evaluation);
    const output = { adapter: adapter.metadata, quote, evaluation, proposal };

    if (args.includes("--approve")) {
      const receipt = approveCartProposal(proposal, { actor: "cli-user", now });
      output.approval = receipt;
      output.draftCart = await adapter.createDraftCart(proposal, receipt, now);
    }

    if (args.includes("--json")) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(`Store adapter: ${adapter.metadata.name}`);
      console.log(`Quote: ${formatEuro(quote.totals.grandTotal)} · ${evaluation.accepted ? "ACCEPTED" : "REJECTED"}`);
      console.log(`Proposal: ${proposal.status} · ${proposal.id.slice(0, 12)}`);
      if (output.draftCart) {
        console.log(`Draft cart: ${output.draftCart.id} · checkout ${output.draftCart.checkoutPerformed ? "done" : "not performed"}`);
      } else {
        console.log("No cart created. Re-run with --approve to simulate explicit approval.");
      }
    }
    return;
  }

  console.error(`Comando sconosciuto: ${command}`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
