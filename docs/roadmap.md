# Roadmap

## Why this file exists

Nothing in this repository decided what to build next. The MVP plan's scope contract
deferred eleven items to "future plan `<name>`" and none of those plans were ever
written; asked when the browser extension or i18n would land, the repository had no
artifact that could answer, and three cycles of work went into test and CI
infrastructure instead. That is not an argument against the infrastructure — it is an
argument that the ordering was never written down anywhere it could be challenged.

**This file states order, not dates.** One contributor, no external commitment, no
release train: a date here would be invented, and an invented fact written where
nothing observes it is the exact defect `SC65` records — `ci.yml` claimed for three
cycles that CI had never run, and the claim was load-bearing until someone measured it.

## Where the product is, measured

Read from the schema, the connector source and the route/page listings rather than
from the README:

| layer | what exists |
|---|---|
| tables | `tenants` `users` `sessions` `identities` `saas_apps` `saas_accounts` `account_links` `account_labels` `discovery_events` |
| connector | Google Workspace only, and within it only `admin.directory.user.readonly` / `users.list` |
| worker | `sync`, `match`, `rotate-credentials` |
| API | login/logout, accounts, identities, saas-apps, account-labels (+bulk), events (+cursor), hr-import, sync-match |
| web | login, home, accounts, apps, events, identity detail, import |

`saas_accounts` carries `account_status`, `is_admin` and `last_activity_at`.
`saas_apps` carries `key`, `display_name` and encrypted credentials — **no plan, no
seat count, no price, no contract dates**. The cost half of the product has no place
to put its data yet.

So what is built is the **inventory and identity-matching substrate**: who exists in
HR, what accounts exist in the connected tenant, which of them belong to nobody, and
an append-only record of how that was decided.

## What the category treats as core

| capability | Admina | Josys | Torii / Zluri | open-smp |
|---|---|---|---|---|
| account / identity inventory and matching | yes | yes | yes | **built** |
| discovery of unmanaged apps (multi-route) | yes — accounting/ERP, extension | yes | yes — Zluri claims 9 routes | none |
| **cost and licence optimisation** | yes | yes — unused/duplicate licences surfaced | yes, and it is the headline | **no columns exist** |
| **lifecycle automation (grant / revoke on leave)** | yes — offboard in a few clicks | yes, and it is the selling point | yes | **detects, cannot act** |
| connector breadth | 200+ | many | many | **1** |
| device management | — | yes (specific to the JP market) | — | out of scope here |

Sources: [Admina](https://admina.moneyforward.com/us),
[Josys features (NRI aslead)](https://aslead.nri.co.jp/products/josys/function/),
[Josys profile (ITreview)](https://www.itreview.jp/products/joshisu/profile),
[Torii vs Zluri](https://www.siit.io/tools/comparison/torii-vs-zluri).

The category exists to answer two questions. *What are we paying for that nobody
uses?* and *did the leaver actually lose access?* This product can answer neither
today, and everything already built is the substrate both answers stand on.

## Order

**SC5 → SC3 → SC2 → SC4.** Peripheral work waits behind all four.

1. **SC5 — licence and cost.** Turns an accurate inventory into a decision. It is the
   only item on the list that adds no external write scope and no new external
   integration: contract and seat data can enter the same way HR data already does,
   through the CSV path `hr-import` established. Needs new tables (`licenses` /
   `entitlements`, deliberately absent from the MVP), plan and price on `saas_apps`,
   and a join against `last_activity_at`. That column is populated end to end today
   — the connector maps Google's `lastLoginTime` (nulling the epoch sentinel), `sync`
   writes it, the accounts and identity APIs return it — but it is **last login to
   Google Workspace, not per-application usage**. Read as "unused licence" evidence
   for any other application it would be wrong, and SC5 has to state which of the two
   questions it is answering before it writes a single query.
2. **SC3 — OAuth token audit.** The cheapest route into discovery: `admin.directory
   .tokens.list` on the connector that is already wired, writing into
   `discovery_events`, which is already append-only. Converts "accounts we know
   about" into "applications nobody registered", which is the discovery half of the
   category, without the MV3 build and distribution chain the browser extension
   would add.
3. **SC2 — a second connector.** The reason it is third rather than first is argued
   below, because it is the one place this ordering is genuinely contestable.
4. **SC4 — lifecycle automation.** Last because it is the only item that writes to a
   customer's identity provider. It needs write scopes, a confirmation and audit
   path, and a failure model for partial revocation — and it is worth far more once
   SC5 can say which access costs money and SC3 can say which applications exist.

### The alternative, and what it silently satisfies

**Doing SC2 first is a real argument, not a strawman.** `packages/connectors/core`
defines the connector interface and exactly one implementation has ever been written
against it. An abstraction validated by a single implementation is not validated, and
every feature added on top of it raises the cost of correcting it later. That is the
thing the chosen order does not satisfy: it spends SC5 and SC3 on an interface whose
shape is still an assumption.

It is third anyway because SC3 exercises that interface on a second *capability*
(tokens rather than users) inside the connector that exists, which surfaces
interface defects at a fraction of a second connector's cost, and because a second
connector multiplies inventory the product still cannot price or act on.

**Trigger that flips this order:** if SC5 or SC3 turns out to need a change to the
connector interface itself — not an addition to it — stop and do SC2 first, because
that is the evidence the interface is being designed against one example.

## Deliberately not next

- **Browser extension (SC1)** — one discovery route among several, and the most
  expensive: a separate MV3 build, a separate distribution channel, and a separate
  security review. SC3 buys discovery first at a fraction of the cost.
- **i18n** — recorded nowhere in the repository until now and not deferred by any
  scope contract; UI strings are English literals in JSX. Cheapest while the UI is
  small, which is an argument for doing it early and not an argument for doing it
  before the product answers its category's questions.
- **Hierarchical tenants (SC6)**, **OIDC/Keycloak SSO for the app itself (SC7)**,
  **connection pooler support (SC9)**, **`discovery_events` retention (SC10)** — all
  still deferred on their original terms.

## How to use this file

An item moves only by writing its plan under `docs/archive/review/<name>-plan.md` and
putting it through the review the others had. This file records the order and the
reason; it is not itself a decision to start.
