const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const sum = (values) => roundMoney(values.reduce((total, value) => total + value, 0));

function countValues(values) {
  return values.reduce((counts, value) => {
    const key = String(value);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function voucherInventoryIssues(available, used) {
  const availableCounts = countValues(available);
  const usedCounts = countValues(used);
  return Object.entries(usedCounts)
    .filter(([value, count]) => count > (availableCounts[value] ?? 0))
    .map(([value, count]) =>
      `Servono ${count} ticket da €${value}, disponibili ${availableCounts[value] ?? 0}.`,
    );
}

export function analyzePlan(household, plan) {
  const issues = [];
  const orders = plan.orders.map((order) => {
    const food = roundMoney(order.foodSubtotal);
    const voucherEligibleFood = roundMoney(order.voucherEligibleFoodSubtotal ?? food);
    const house = roundMoney(order.houseSubtotal ?? 0);
    const fees = roundMoney((order.deliveryFee ?? 0) + (order.serviceFee ?? 0));
    const economicCost = sum([food, house, fees]);
    const voucherValue = sum(order.voucherValues ?? []);
    const cash = roundMoney(economicCost - voucherValue);
    const maxVouchers = order.maxVouchers ?? 8;

    if ((order.voucherValues ?? []).length > maxVouchers) {
      issues.push(`${order.id}: più di ${maxVouchers} ticket.`);
    }
    if (voucherValue > voucherEligibleFood) {
      issues.push(`${order.id}: i ticket superano gli alimentari eleggibili.`);
    }
    if (cash < 0) {
      issues.push(`${order.id}: quota carta negativa.`);
    }

    const health = order.health ?? {};
    if (household.health.enabled) {
      if ((health.corePassing ?? 0) < (health.coreTotal ?? 0)) {
        issues.push(`${order.id}: almeno un prodotto ricorrente non supera la soglia salute.`);
      }
      if ((health.flexPassing ?? 0) < (health.flexTotal ?? 0)) {
        issues.push(`${order.id}: almeno un prodotto flessibile non raggiunge la soglia salute.`);
      }
      if ((health.unknownFood ?? 0) > 0) {
        issues.push(`${order.id}: contiene prodotti alimentari con qualità sconosciuta.`);
      }
    }

    return {
      ...order,
      foodSubtotal: food,
      voucherEligibleFoodSubtotal: voucherEligibleFood,
      houseSubtotal: house,
      fees,
      economicCost,
      voucherValue,
      cash,
    };
  });

  const usedVouchers = orders.flatMap((order) => order.voucherValues ?? []);
  issues.push(...voucherInventoryIssues(household.vouchers.values, usedVouchers));

  const totals = {
    food: sum(orders.map((order) => order.foodSubtotal)),
    house: sum(orders.map((order) => order.houseSubtotal)),
    fees: sum(orders.map((order) => order.fees)),
    economicCost: sum(orders.map((order) => order.economicCost)),
    vouchers: sum(orders.map((order) => order.voucherValue)),
    cash: sum(orders.map((order) => order.cash)),
  };

  if (!household.budget.rolling) {
    for (let week = 1; week <= household.cycleWeeks; week += 1) {
      const weeklyCash = sum(orders.filter((order) => order.week === week).map((order) => order.cash));
      if (weeklyCash > household.budget.cashPerWeek) {
        issues.push(
          `Settimana ${week}: carta €${weeklyCash.toFixed(2)} oltre il budget di €${household.budget.cashPerWeek.toFixed(2)}.`,
        );
      }
    }
  }

  if (totals.cash > household.budget.cashPerCycle) {
    issues.push(
      `Carta €${totals.cash.toFixed(2)} oltre il budget di €${household.budget.cashPerCycle.toFixed(2)}.`,
    );
  }

  return {
    valid: issues.length === 0,
    issues,
    orders,
    totals,
    cashMargin: roundMoney(household.budget.cashPerCycle - totals.cash),
  };
}

export function assessChannel(household, planAnalysis, channel) {
  const reasons = [];
  const replacedOrders = planAnalysis.orders.filter((order) =>
    channel.candidateReplacementOrderIds.includes(order.id),
  );
  const replacedCost = sum(replacedOrders.map((order) => order.economicCost));
  const minimumChannelCost = sum([
    channel.minimumSubtotal ?? 0,
    channel.deliveryFeeFrom ?? 0,
    channel.serviceFeeFrom ?? 0,
  ]);
  const theoreticalMaximumSavings = roundMoney(replacedCost - minimumChannelCost);

  if (channel.coverageStatus !== "verified") reasons.push("COVERAGE_NOT_VERIFIED");
  if (channel.priceBasis === "unknown") reasons.push("ONLINE_PRICE_NOT_VERIFIED");
  if (channel.paymentStatus !== "verified") reasons.push("PAYMENT_NOT_VERIFIED");
  if (theoreticalMaximumSavings < household.discountPolicy.minimumSavingsEuro) {
    reasons.push("STRUCTURAL_SAVINGS_TOO_LOW");
  }

  return {
    id: channel.id,
    name: channel.name,
    mode: reasons.length === 0 ? "quote_required" : "discovery_only",
    reasons,
    replacedCost,
    minimumChannelCost,
    theoreticalMaximumSavings,
    note: channel.note,
  };
}

export function evaluateDiscountQuote(household, planAnalysis, quote, now = new Date()) {
  const reasons = [];
  const policy = household.discountPolicy;
  const replacedOrders = planAnalysis.orders.filter((order) =>
    quote.replacesOrderIds.includes(order.id),
  );

  if (!["live_online", "same_as_store_verified"].includes(quote.priceBasis)) {
    reasons.push("ONLINE_PRICE_NOT_VERIFIED");
  }

  const capturedAt = quote.capturedAt ? new Date(quote.capturedAt) : null;
  if (!capturedAt || Number.isNaN(capturedAt.getTime())) {
    reasons.push("QUOTE_DATE_MISSING");
  } else {
    const ageHours = (now.getTime() - capturedAt.getTime()) / 3_600_000;
    if (ageHours < 0 || ageHours > policy.maxQuoteAgeHours) reasons.push("QUOTE_STALE");
  }

  if ((quote.comparableNeedShare ?? 0) < policy.minimumComparableShare) {
    reasons.push("COMPARABILITY_TOO_LOW");
  }

  const order = quote.order;
  const food = roundMoney(order.foodSubtotal ?? 0);
  const voucherEligibleFood = roundMoney(order.voucherEligibleFoodSubtotal ?? food);
  const house = roundMoney(order.houseSubtotal ?? 0);
  const fees = roundMoney((order.deliveryFee ?? 0) + (order.serviceFee ?? 0));
  const economicCost = sum([food, house, fees]);
  const voucherValue = sum(order.voucherValues ?? []);
  const cash = roundMoney(economicCost - voucherValue);

  if (food < (order.minimumFoodSubtotal ?? 0)) reasons.push("MINIMUM_ORDER_NOT_MET");
  if ((order.voucherValues ?? []).length > (order.maxVouchers ?? 8)) {
    reasons.push("TOO_MANY_VOUCHERS");
  }
  if (voucherValue > voucherEligibleFood) reasons.push("VOUCHERS_EXCEED_ELIGIBLE_FOOD");

  if (household.health.enabled) {
    const health = quote.health ?? {};
    if ((health.corePassing ?? 0) < (health.coreTotal ?? 0)) reasons.push("CORE_HEALTH_FAIL");
    if ((health.flexPassing ?? 0) < (health.flexTotal ?? 0)) reasons.push("FLEX_HEALTH_FAIL");
    if ((health.unknownFood ?? 0) > 0) reasons.push("UNKNOWN_FOOD_QUALITY");
  }

  const baselineEquivalentCost = roundMoney(
    quote.baselineEquivalentCost ?? sum(replacedOrders.map((item) => item.economicCost)),
  );
  const savingsEuro = roundMoney(baselineEquivalentCost - economicCost);
  const savingsRate = baselineEquivalentCost > 0 ? savingsEuro / baselineEquivalentCost : 0;
  if (savingsEuro < policy.minimumSavingsEuro) reasons.push("SAVINGS_EURO_TOO_LOW");
  if (savingsRate < policy.minimumSavingsRate) reasons.push("SAVINGS_RATE_TOO_LOW");

  const remainingOrders = planAnalysis.orders.filter(
    (order) => !quote.replacesOrderIds.includes(order.id),
  );
  const projectedCash = roundMoney(sum(remainingOrders.map((order) => order.cash)) + cash);
  if (projectedCash > household.budget.cashPerCycle) reasons.push("CASH_BUDGET_EXCEEDED");

  const projectedVouchers = [
    ...remainingOrders.flatMap((item) => item.voucherValues ?? []),
    ...(order.voucherValues ?? []),
  ];
  if (voucherInventoryIssues(household.vouchers.values, projectedVouchers).length > 0) {
    reasons.push("VOUCHER_INVENTORY_EXCEEDED");
  }

  return {
    schemaVersion: 1,
    quoteId: quote.quoteId ?? null,
    accepted: reasons.length === 0,
    reasons,
    store: quote.store,
    baselineEquivalentCost,
    economicCost,
    savingsEuro,
    savingsRate,
    voucherValue,
    cash,
    projectedCycleCash: projectedCash,
  };
}

export const formatEuro = (value) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
