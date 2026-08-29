import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateDocument } from "./validation.js";

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function buildInitialDocuments(options = {}) {
  const cycleWeeks = options.cycleWeeks ?? 4;
  const cashPerWeek = options.cashPerWeek ?? 10;
  const healthEnabled = options.healthEnabled ?? true;
  return {
    household: {
      schemaVersion: 1,
      id: options.id ?? "my-household",
      location: {
        country: options.country ?? "IT",
        deliveryArea: options.deliveryArea ?? "set-me",
      },
      cycleWeeks,
      budget: {
        cashPerWeek,
        cashPerCycle: roundMoney(options.cashPerCycle ?? cashPerWeek * cycleWeeks),
        rolling: true,
      },
      vouchers: {
        provider: options.voucherProvider ?? null,
        values: [...(options.voucherValues ?? [])],
      },
      health: {
        enabled: healthEnabled,
        provider: healthEnabled ? (options.healthProvider ?? "manual-or-open") : null,
        thresholds: {
          core: options.coreThreshold ?? 71,
          flex: options.flexThreshold ?? 50,
        },
        unknownCore: "block",
      },
      discountPolicy: {
        minimumComparableShare: 0.7,
        minimumSavingsEuro: 5,
        minimumSavingsRate: 0.05,
        maxQuoteAgeHours: 24,
        unknownMarkup: "block",
      },
      excludedCategories: [...(options.excludedCategories ?? ["fresh-fruit", "fresh-vegetables"])],
    },
    needs: {
      schemaVersion: 1,
      cycleWeeks,
      notes: "Add recurring needs without addresses, credentials or payment identifiers.",
      needs: [],
    },
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeInitialDocuments(outputDirectory, options = {}) {
  const documents = buildInitialDocuments(options);
  await Promise.all([
    validateDocument("household", documents.household),
    validateDocument("needs", documents.needs),
  ]);

  const directory = resolve(outputDirectory);
  const householdPath = resolve(directory, "household.json");
  const needsPath = resolve(directory, "recurring-needs.json");
  const occupied = await Promise.all([exists(householdPath), exists(needsPath)]);
  if (!options.force && occupied.some(Boolean)) {
    throw new Error(`Profile already exists in ${directory}. Use --force to replace it.`);
  }

  await mkdir(directory, { recursive: true });
  const flag = options.force ? "w" : "wx";
  await Promise.all([
    writeFile(householdPath, `${JSON.stringify(documents.household, null, 2)}\n`, { flag }),
    writeFile(needsPath, `${JSON.stringify(documents.needs, null, 2)}\n`, { flag }),
  ]);
  return { directory, householdPath, needsPath, documents };
}

