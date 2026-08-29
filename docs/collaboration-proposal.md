# Collaboration proposal: grocery-agent × Spesa Consapevole

## Short version

`grocery-agent` already demonstrates the interaction and execution layer:
conversation, preferences, order history, store search, cart creation and
proactive notifications. Spesa Consapevole focuses on a complementary decision
layer: total cost, multi-store comparison, meal-voucher allocation, product
quality policies and explainable approval gates.

The proposal is not to replace or duplicate either project. It is to define a
small common contract between an agent shell and a cost-first planner.

## Proposed boundary

```text
grocery-agent or another agent shell
  conversation · memory · scheduling · notifications
                         ↓ typed requests
Spesa Consapevole
  budget · vouchers · quality policy · retailer comparison
                         ↓ accepted proposal
Store adapter
  search · quote · order history · draft cart
                         ↓ explicit approval
Retailer cart — no automated payment
```

## First collaboration milestone

1. Agree on a provider-neutral JSON quote format.
2. Map the existing Magento GraphQL client to four typed operations:
   `searchProducts`, `createQuote`, `getOrderHistory`, `createDraftCart`.
3. Pass the quote through the cost-first evaluator.
4. Bind approval to the exact quote, items, quantities and total.
5. Create a draft cart only after approval; leave checkout to the user.
6. Add mocked integration tests so contributors need no retailer credentials.

Spesa Consapevole now contains a working fixture of this flow via:

```bash
npm run store:demo
npm run store:demo -- --approve
```

## What each project contributes

| grocery-agent | Spesa Consapevole |
| --- | --- |
| Agent orchestration and skills | Deterministic economic policy |
| Store and order-history integration | Multi-store quote comparison |
| Persistent conversational preferences | Versioned structured profile contract |
| Scheduler and Telegram delivery | Voucher and cash-budget constraints |
| Agent evaluation patterns | Approval binding and discount gate |

## Design principles

- Cost is the primary optimization target after hard constraints.
- An LLM can suggest matches but cannot invent price, stock or quality data.
- Adapters expose typed operations, not arbitrary retailer queries.
- Product and retailer providers remain replaceable.
- A draft cart is reversible; checkout and payment remain human actions.
- Local execution is the default; cloud and notification providers are optional.

## Licensing and attribution

`grocery-agent` is Apache-2.0 and Spesa Consapevole is AGPL-3.0. No upstream
source has been copied in the current implementation. If code is ported later,
Apache copyright and license notices will be retained, modified files will be
identified and third-party notices will accompany the combined distribution.

## Message draft

> Ciao Elia — il tuo `grocery-agent` mi ha ispirato a lavorare sul problema da
> un'altra angolazione. Ho creato `spesa-consapevole`, un piccolo motore
> cost-first che valuta budget, buoni pasto, qualità e convenienza reale fra
> negozi. Guardando il tuo progetto mi sembra che le due parti siano molto
> complementari: il tuo agente è già forte su conversazione, memoria, store API
> e carrello; il nostro nucleo prova a decidere se quel carrello conviene prima
> di crearlo. Ho preparato un contratto tipizzato e una demo con approvazione
> esplicita, senza copiare il tuo codice. Ti andrebbe di confrontarci su un
> piccolo formato comune `search → quote → evaluate → approve → draft cart`, e
> magari provare ad adattare il tuo client Magento come primo provider?

Repository: https://github.com/alessiomarcone/spesa-consapevole
