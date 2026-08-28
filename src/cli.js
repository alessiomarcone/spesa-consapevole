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

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const example = resolve(root, "examples/sample-household");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? resolve(args[index + 1]) : fallback;
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
  const householdPath = option(args, "--household", resolve(example, "household.json"));
  const planPath = option(args, "--plan", resolve(example, "baseline-plan.json"));
  const [household, plan] = await Promise.all([readJson(householdPath), readJson(planPath)]);
  return { household, plan, analysis: analyzePlan(household, plan) };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "plan";
  const { household, plan, analysis } = await loadBase(args);

  if (command === "plan") {
    const quotePath = option(args, "--discount-quote", null);
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
    const channelsPath = option(args, "--channels", resolve(example, "discount-channels.json"));
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
    const needsPath = option(args, "--needs", resolve(example, "recurring-needs.json"));
    const data = await readJson(needsPath);
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

  console.error(`Comando sconosciuto: ${command}`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
