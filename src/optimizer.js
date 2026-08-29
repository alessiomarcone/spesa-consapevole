import { analyzePlan } from "./engine.js";
import { summarizeQuoteHealth } from "./contracts/store-adapter.js";

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const toCents = (value) => Math.round(value * 100);
const fromCents = (value) => roundMoney(value / 100);

const FREQUENCY_WEEKS = {
  "twice-weekly": "all",
  weekly: "all",
  fortnightly: "alternate",
  monthly: "first",
  "monthly-stock": "first",
};

export class PlanningError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "PlanningError";
    this.details = details;
  }
}

function distributeQuantity(quantity, candidateWeeks) {
  const selectedWeeks =
    quantity >= candidateWeeks.length
      ? candidateWeeks
      : candidateWeeks.filter((_, index) => index % Math.ceil(candidateWeeks.length / quantity) === 0).slice(0, quantity);
  const base = Math.floor(quantity / selectedWeeks.length);
  const remainder = quantity % selectedWeeks.length;
  return selectedWeeks.map((week, index) => ({
    week,
    quantity: base + (index < remainder ? 1 : 0),
  }));
}

export function scheduleNeeds(needs, cycleWeeks, excludedCategories = []) {
  const excluded = new Set(excludedCategories);
  const weeks = Array.from({ length: cycleWeeks }, () => []);
  for (const need of needs) {
    if (need.category && excluded.has(need.category)) continue;
    const mode = FREQUENCY_WEEKS[need.frequency];
    const candidateWeeks =
      mode === "all"
        ? Array.from({ length: cycleWeeks }, (_, index) => index + 1)
        : mode === "alternate"
          ? Array.from({ length: cycleWeeks }, (_, index) => index + 1).filter((week) => week % 2 === 1)
          : [1];
    for (const scheduled of distributeQuantity(need.quantityPerCycle, candidateWeeks)) {
      weeks[scheduled.week - 1].push({ need, quantity: scheduled.quantity });
    }
  }
  return weeks;
}

function offerAllowed(household, need, offer, quantity) {
  if (!offer.available || offer.needId !== need.id || offer.unit !== need.unit) return false;
  if (offer.unitPrice > need.maxUnitPrice) return false;
  if (Number.isInteger(offer.stockUnits) && offer.stockUnits < quantity) return false;
  if (!household.health.enabled || !["core", "flex"].includes(need.role)) return true;
  if (typeof offer.healthScore !== "number") return false;
  return offer.healthScore >= household.health.thresholds[need.role];
}

function comparableOffers(household, stores, need, quantity) {
  return stores
    .flatMap((store) =>
      store.offers
        .filter((offer) => offerAllowed(household, need, offer, quantity))
        .map((offer) => ({ store, offer })),
    )
    .sort(
      (left, right) =>
        left.offer.unitPrice - right.offer.unitPrice ||
        (right.offer.healthScore ?? -1) - (left.offer.healthScore ?? -1) ||
        left.store.id.localeCompare(right.store.id),
    );
}

function alternativesFor(allOffers, selected) {
  return allOffers
    .filter(
      (candidate) =>
        candidate.store.id !== selected.store.id || candidate.offer.productId !== selected.offer.productId,
    )
    .slice(0, 1)
    .map(({ store, offer }) => ({
      storeId: store.id,
      storeName: store.name,
      productId: offer.productId,
      name: offer.name,
      unit: offer.unit,
      unitPrice: offer.unitPrice,
      healthScore: offer.healthScore,
      scoreSource: offer.scoreSource,
    }));
}

function buildWeekCandidate(household, week, scheduledNeeds, selectedStores, allStores) {
  const assignments = [];
  for (const scheduled of scheduledNeeds) {
    const candidates = comparableOffers(household, selectedStores, scheduled.need, scheduled.quantity);
    if (candidates.length === 0) return null;
    const selected = candidates[0];
    const allOffers = comparableOffers(household, allStores, scheduled.need, scheduled.quantity);
    assignments.push({
      store: selected.store,
      item: {
        needId: scheduled.need.id,
        productId: selected.offer.productId,
        name: selected.offer.name,
        unit: selected.offer.unit,
        quantity: scheduled.quantity,
        unitPrice: selected.offer.unitPrice,
        rowTotal: roundMoney(selected.offer.unitPrice * scheduled.quantity),
        role: scheduled.need.role,
        healthScore: selected.offer.healthScore,
        scoreSource: selected.offer.scoreSource,
        voucherEligible: selected.offer.voucherEligible,
        alternatives: alternativesFor(allOffers, selected),
      },
    });
  }

  const orders = [];
  for (const store of selectedStores) {
    const items = assignments.filter((assignment) => assignment.store.id === store.id).map(({ item }) => item);
    if (items.length === 0) continue;
    const foodSubtotal = roundMoney(
      items.filter((item) => item.role !== "house").reduce((sum, item) => sum + item.rowTotal, 0),
    );
    const voucherEligibleFoodSubtotal = roundMoney(
      items.filter((item) => item.role !== "house" && item.voucherEligible).reduce((sum, item) => sum + item.rowTotal, 0),
    );
    const houseSubtotal = roundMoney(
      items.filter((item) => item.role === "house").reduce((sum, item) => sum + item.rowTotal, 0),
    );
    if (foodSubtotal < store.minimumFoodSubtotal) return null;
    orders.push({
      id: `w${week}-${store.id}`,
      week,
      store: store.name,
      storeId: store.id,
      foodSubtotal,
      voucherEligibleFoodSubtotal,
      houseSubtotal,
      deliveryFee: store.deliveryFee,
      serviceFee: store.serviceFee,
      acceptsVouchers: store.acceptsVouchers,
      voucherValues: [],
      maxVouchers: store.acceptsVouchers ? store.maxVouchers : 0,
      health: summarizeQuoteHealth(items, household.health.thresholds),
      items,
    });
  }
  const economicCost = roundMoney(
    orders.reduce(
      (sum, order) => sum + order.foodSubtotal + order.houseSubtotal + order.deliveryFee + order.serviceFee,
      0,
    ),
  );
  const voucherCapacity = roundMoney(
    orders.filter((order) => order.acceptsVouchers).reduce((sum, order) => sum + order.voucherEligibleFoodSubtotal, 0),
  );
  return { week, orders, economicCost, voucherCapacity };
}

function weekCandidates(household, week, scheduledNeeds, stores) {
  if (scheduledNeeds.length === 0) return [{ week, orders: [], economicCost: 0, voucherCapacity: 0 }];
  const candidates = new Map();
  const subsetCount = 2 ** stores.length;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    const selectedStores = stores.filter((_, index) => mask & (1 << index));
    const candidate = buildWeekCandidate(household, week, scheduledNeeds, selectedStores, stores);
    if (!candidate) continue;
    const signature = candidate.orders
      .flatMap((order) => order.items.map((item) => `${order.storeId}:${item.needId}:${item.productId}`))
      .sort()
      .join("|");
    if (!candidates.has(signature)) candidates.set(signature, candidate);
  }
  return [...candidates.values()]
    .sort(
      (left, right) =>
        left.economicCost - right.economicCost ||
        right.voucherCapacity - left.voucherCapacity ||
        left.orders.length - right.orders.length,
    )
    .slice(0, 12);
}

function denominationInventory(values) {
  const counts = new Map();
  for (const value of values) {
    const cents = toCents(value);
    counts.set(cents, (counts.get(cents) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => right - left)
    .map(([value, count]) => ({ value, count }));
}

function voucherOptions(order, denominations) {
  if (!order.acceptsVouchers || order.maxVouchers === 0) {
    return [{ counts: denominations.map(() => 0), total: 0, values: [] }];
  }
  const capacity = toCents(order.voucherEligibleFoodSubtotal);
  const options = [];
  function visit(index, slotsLeft, valueLeft, counts, values) {
    if (index === denominations.length) {
      options.push({ counts: [...counts], total: values.reduce((sum, value) => sum + value, 0), values: [...values] });
      return;
    }
    const denomination = denominations[index];
    const maximum = Math.min(denomination.count, slotsLeft, Math.floor(valueLeft / denomination.value));
    for (let count = 0; count <= maximum; count += 1) {
      counts.push(count);
      visit(
        index + 1,
        slotsLeft - count,
        valueLeft - count * denomination.value,
        counts,
        [...values, ...Array(count).fill(denomination.value)],
      );
      counts.pop();
    }
  }
  visit(0, order.maxVouchers, capacity, [], []);
  return options.sort((left, right) => right.total - left.total);
}

function addCounts(left, right) {
  return left.map((value, index) => value + right[index]);
}

function withinInventory(counts, denominations) {
  return counts.every((count, index) => count <= denominations[index].count);
}

function weekVoucherOptions(orders, denominations, cashPerWeek) {
  let states = [{ counts: denominations.map(() => 0), total: 0, allocations: {} }];
  for (const order of orders) {
    const next = new Map();
    for (const state of states) {
      for (const option of voucherOptions(order, denominations)) {
        const counts = addCounts(state.counts, option.counts);
        if (!withinInventory(counts, denominations)) continue;
        const key = counts.join(",");
        if (!next.has(key)) {
          next.set(key, {
            counts,
            total: state.total + option.total,
            allocations: { ...state.allocations, [order.id]: option.values },
          });
        }
      }
    }
    states = [...next.values()];
  }
  const economic = toCents(
    orders.reduce(
      (sum, order) => sum + order.foodSubtotal + order.houseSubtotal + order.deliveryFee + order.serviceFee,
      0,
    ),
  );
  const cashLimit = toCents(cashPerWeek);
  return states.filter((state) => economic - state.total <= cashLimit);
}

function allocateVouchers(household, orders) {
  const denominations = denominationInventory(household.vouchers.values);
  const weeks = Array.from({ length: household.cycleWeeks }, (_, index) => index + 1);
  let states = [{ counts: denominations.map(() => 0), total: 0, allocations: {} }];
  for (const week of weeks) {
    const options = weekVoucherOptions(
      orders.filter((order) => order.week === week),
      denominations,
      household.budget.rolling ? Number.POSITIVE_INFINITY : household.budget.cashPerWeek,
    );
    const next = new Map();
    for (const state of states) {
      for (const option of options) {
        const counts = addCounts(state.counts, option.counts);
        if (!withinInventory(counts, denominations)) continue;
        const key = counts.join(",");
        const candidate = {
          counts,
          total: state.total + option.total,
          allocations: { ...state.allocations, ...option.allocations },
        };
        if (!next.has(key) || candidate.total > next.get(key).total) next.set(key, candidate);
      }
    }
    states = [...next.values()];
  }
  const economic = toCents(
    orders.reduce(
      (sum, order) => sum + order.foodSubtotal + order.houseSubtotal + order.deliveryFee + order.serviceFee,
      0,
    ),
  );
  const cycleLimit = toCents(household.budget.cashPerCycle);
  const best = states
    .filter((state) => economic - state.total <= cycleLimit)
    .sort((left, right) => right.total - left.total)[0];
  if (!best) return null;
  return orders.map((order) => ({
    ...order,
    voucherValues: (best.allocations[order.id] ?? []).map(fromCents),
  }));
}

function combineWeeks(candidatesByWeek) {
  let combinations = [{ orders: [], economicCost: 0 }];
  for (const candidates of candidatesByWeek) {
    combinations = combinations.flatMap((combination) =>
      candidates.map((candidate) => ({
        orders: [...combination.orders, ...candidate.orders],
        economicCost: roundMoney(combination.economicCost + candidate.economicCost),
      })),
    );
    if (combinations.length > 50_000) {
      combinations = combinations.sort((left, right) => left.economicCost - right.economicCost).slice(0, 50_000);
    }
  }
  return combinations.sort((left, right) => left.economicCost - right.economicCost);
}

function assertCatalogFresh(household, catalog, now) {
  if (catalog.sourceType === "fixture") return;
  const capturedAt = new Date(catalog.capturedAt);
  const expiresAt = new Date(catalog.expiresAt);
  const ageHours = (now.getTime() - capturedAt.getTime()) / 3_600_000;
  if (ageHours < 0 || ageHours > household.discountPolicy.maxQuoteAgeHours || expiresAt < now) {
    throw new PlanningError("Retailer catalogue is stale or not yet valid.");
  }
}

export function createOptimizedPlan(household, needsDocument, catalog, now = new Date()) {
  if (household.cycleWeeks !== needsDocument.cycleWeeks) {
    throw new PlanningError("Household and needs use different cycle lengths.");
  }
  assertCatalogFresh(household, catalog, now);
  const storeIds = catalog.stores.map((store) => store.id);
  if (new Set(storeIds).size !== storeIds.length) throw new PlanningError("Store ids must be unique.");
  const needIds = needsDocument.needs.map((need) => need.id);
  if (new Set(needIds).size !== needIds.length) throw new PlanningError("Need ids must be unique.");

  const schedule = scheduleNeeds(
    needsDocument.needs,
    household.cycleWeeks,
    household.excludedCategories,
  );
  const uncovered = schedule
    .flat()
    .filter(
      ({ need, quantity }) => comparableOffers(household, catalog.stores, need, quantity).length === 0,
    )
    .map(({ need }) => need.id);
  if (uncovered.length > 0) {
    throw new PlanningError("No admissible offer covers every scheduled need.", [...new Set(uncovered)]);
  }

  const candidatesByWeek = schedule.map((scheduledNeeds, index) =>
    weekCandidates(household, index + 1, scheduledNeeds, catalog.stores),
  );
  if (candidatesByWeek.some((candidates) => candidates.length === 0)) {
    throw new PlanningError("Fees or minimum orders make at least one week infeasible.");
  }

  let best = null;
  for (const combination of combineWeeks(candidatesByWeek)) {
    if (best && combination.economicCost > best.economicCost) break;
    const orders = allocateVouchers(household, combination.orders);
    if (!orders) continue;
    const plan = {
      schemaVersion: 1,
      id: "optimized-cycle-plan",
      currency: catalog.currency,
      generatedAt: now.toISOString(),
      simulation: catalog.sourceType === "fixture",
      orders,
    };
    const analysis = analyzePlan(household, plan);
    if (!analysis.valid) continue;
    if (!best || combination.economicCost < best.economicCost || analysis.totals.cash < best.analysis.totals.cash) {
      best = { plan, analysis, economicCost: combination.economicCost };
    }
  }
  if (!best) {
    throw new PlanningError("No plan satisfies weekly cash, voucher, health and store constraints.");
  }
  return {
    plan: best.plan,
    analysis: best.analysis,
    diagnostics: {
      candidatesPerWeek: candidatesByWeek.map((candidates) => candidates.length),
      excludedNeeds: needsDocument.needs
        .filter((need) => need.category && household.excludedCategories.includes(need.category))
        .map((need) => need.id),
    },
  };
}
