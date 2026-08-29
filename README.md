# Spesa Consapevole

Local-first, open-source grocery planning with one dominant objective: **reduce
the real cost of a household basket** while respecting payment, nutrition and
delivery constraints.

The project does not assume that a discount store is cheaper, that a familiar
product is better, or that an online price matches the shelf price. Every option
must be supported by a comparable, time-stamped quote.

## Decision model

1. Reject plans that violate hard constraints: required products, health policy,
   voucher rules, minimum orders or cash budget.
2. Among valid plans, minimize merchandise, delivery and service costs.
3. Minimize cash outlay while accounting for the face value of vouchers.
4. Use health surplus and convenience only to break near-ties.

The sample configuration exposes 75/15/10 cost, health and convenience weights
for near-ties. A more expensive basket cannot win merely because it scores well
on a secondary dimension.

## Quick start

Node.js 20 or newer is required. Runtime input validation uses Ajv.

```bash
npm test
npm run plan
npm run optimize
npm run channels
npm run needs
npm run store:demo
```

`npm run optimize` is the first complete deterministic slice. It schedules
recurring needs across the cycle, compares compatible products, includes fees,
allocates the available voucher denominations and prints four detailed lists.
Its bundled catalogue is explicitly marked as a simulation.

Machine-readable output for agents and applications:

```bash
node src/cli.js plan --json
node src/cli.js channels --json
```

Evaluate a fresh retailer quote:

```bash
node src/cli.js plan \
  --discount-quote examples/sample-household/discount-quote.unverified.json
```

The bundled quote is deliberately incomplete and must be rejected. It documents
the safe default for missing prices, stale data and unknown product quality.

The adapter demo stops before changing even a mock cart. Explicitly approve the
exact evaluated proposal to create an in-memory draft:

```bash
npm run store:demo -- --approve
```

## Local onboarding

Create an untracked household profile without storing credentials or a street
address:

```bash
npm run profile:init -- \
  --output data/private/my-household \
  --cash-week 10 \
  --voucher-provider electronic-meal-vouchers \
  --voucher-values 7,7,7,6,6 \
  --core-threshold 71 \
  --flex-threshold 50
```

The command creates `household.json` and an empty `recurring-needs.json`. It
refuses to overwrite an existing profile unless `--force` is explicitly passed.
All inputs are checked against the versioned schemas in `schemas/v1/`.

## Generic household model

The engine works with configurable:

- cycle length and rolling cash budget;
- voucher provider, denominations and transaction limits;
- recurring needs, quantities and frequencies;
- core, flexible, household and unscored product roles;
- optional scoring providers and thresholds;
- delivery areas, retailer adapters and live quotes;
- minimum absolute and percentage savings for opening another store.

`examples/sample-household/` is a fictional fixture. It is not tied to a person,
city, retailer, diet or proprietary scoring service.

## Discount gate

A candidate store is admitted only when:

- its quote is recent and its online price basis is known;
- at least the configured share of needs is truly comparable;
- delivery, service fees and minimum-order effects are included;
- the complete cycle stays inside the cash budget;
- the savings exceed both an absolute and a percentage threshold;
- products satisfy the configured health policy.

For example, replacing €84.66 of existing orders with a channel requiring €80
plus €2.99 delivery has a theoretical ceiling of only €1.67 savings. With a €5
entry threshold, the engine rejects it before spending time on detailed product
matching. These are synthetic numbers used to test the rule.

See [the worked discount-gate example](docs/discount-gate-example.md).

## Chat and tool responsibilities

```text
Chat or app → household profile → deterministic cost engine → store adapters
            → explainable preview → explicit approval → checkout
```

An LLM may help interpret a rough list, suggest equivalences and explain a plan.
It cannot invent prices, quality scores or payment support. Checkout is a
separate adapter and remains human-approved.

Store adapters expose only typed capabilities: search, quote, order history and
draft-cart creation. They do not expose arbitrary retailer APIs or checkout.
Every cart proposal is bound to the evaluated quote; changing price, quantity or
items invalidates its approval.

Provider-neutral JSON contracts are available for household profiles, recurring
needs, comparable catalogues, store quotes, decisions and generated plans.

## Project structure

```text
src/                         engine and CLI
src/contracts/               agent-safe store and memory interfaces
src/adapters/                retailer adapter implementations
src/optimizer.js             deterministic scheduling and basket selection
schemas/v1/                  versioned interoperability contracts
examples/sample-household/   fictional configuration and fixtures
examples/optimizer-demo/     fictional end-to-end optimizer fixture
docs/                        architecture and decision records
test/                        economic and safety tests
```

## Data and scoring

Open Food Facts is a suitable open source for ingredients, nutrition, allergens
and computed attributes, subject to ODbL and attribution requirements. A
proprietary score can be entered manually or provided by an authorized adapter;
an independently calculated score must never be presented as the proprietary
provider's score.

Unknown product data is a state, not a zero. Depending on policy, it can block a
recurring product until a barcode, label or trusted source is available.

## Privacy

- Personal configurations belong in `data/private/`, which Git ignores.
- Credentials and browser sessions must never enter configuration files.
- Retailer prices require a timestamp, source and short cache lifetime.
- Retailer catalogues are not republished as permanent datasets by default.
- The current version previews plans and never performs payments.

## Roadmap

- interactive editing of recurring quantities and frequencies;
- Open Food Facts barcode enrichment;
- read-only retailer quotes with short-lived caches;
- assisted cart creation with explicit checkout approval;
- integrations with household and meal-planning tools;
- community-maintained adapters and anonymized fixtures.

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md),
[the architecture](docs/architecture.md) and [data notices](DATA-LICENSES.md).

## Inspiration

The agent interaction, persistent-preference and proactive-shopping patterns
were inspired by Elia Secchi's Apache-2.0 project
[`eliasecchig/grocery-agent`](https://github.com/eliasecchig/grocery-agent).
No upstream source code is currently vendored in this repository. See the
[collaboration proposal](docs/collaboration-proposal.md).
