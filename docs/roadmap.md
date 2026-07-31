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
| tables | `tenants` `users` `sessions` `identities` `saas_apps` `saas_accounts` `account_links` `account_labels` `discovery_events` `saas_contracts` |
| connector | Google Workspace only, and within it only `admin.directory.user.readonly` / `users.list` |
| worker | `sync`, `match`, `rotate-credentials` |
| API | login/logout, accounts, identities, saas-apps, account-labels (+bulk), events (+cursor), hr-import, contract-import, licenses, sync-match |
| web | login, home, accounts, apps, events, identity detail, import, licenses |

Derived, not recalled: the tables from `CREATE TABLE` across the migrations, the API
from the exact-equality route sweep in `api.integration.test.ts` (which is asserted,
so it cannot drift from the app), the pages from `apps/web/src/app/**/page.tsx`.

`saas_accounts` carries `account_status`, `is_admin` and `last_activity_at`.
`saas_contracts` carries `plan_name`, `seats`, `unit_price numeric(14,2)`,
`currency`, `billing_cycle`, `term_start`, `term_end` — one current contract per
application, entered through the CSV path `hr-import` established.

So what is built is the **inventory and identity-matching substrate** — who exists in
HR, what accounts exist in the connected tenant, which of them belong to nobody, and
an append-only record of how that was decided — **plus the price attached to it**:
purchased against assigned, and the seats that are reclaimable because their holder
left or because nobody owns them.

What is still absent is any *derivation* of that price from usage. `last_activity_at`
is last login to Google Workspace, not per-application activity, so "this licence is
idle" remains unanswerable — recorded as `SCL6`/`SCL7` in the SC5 plan rather than
approximated.

## What the category treats as core

| capability | Admina | Josys | Torii / Zluri | open-smp |
|---|---|---|---|---|
| account / identity inventory and matching | yes | yes | yes | **built** |
| discovery of unmanaged apps (multi-route) | yes — accounting/ERP, extension | yes | yes — Zluri claims 9 routes | none |
| **cost and licence optimisation** | yes | yes — unused/duplicate licences surfaced | yes, and it is the headline | **built, from contracts** — not from usage |
| **lifecycle automation (grant / revoke on leave)** | yes — offboard in a few clicks | yes, and it is the selling point | yes | **detects, cannot act** |
| connector breadth | 200+ | many | many | **1** |
| device management | — | yes (specific to the JP market) | — | out of scope here |

Sources: [Admina](https://admina.moneyforward.com/us),
[Josys features (NRI aslead)](https://aslead.nri.co.jp/products/josys/function/),
[Josys profile (ITreview)](https://www.itreview.jp/products/joshisu/profile),
[Torii vs Zluri](https://www.siit.io/tools/comparison/torii-vs-zluri).

The category exists to answer two questions. *What are we paying for that nobody
uses?* and *did the leaver actually lose access?*

The first now has an answer, with a stated limit. `GET /licenses` reports, per
application, purchased against assigned and the seats that are reclaimable — held by
someone who left, or held by nobody — priced from the contract. What it does **not**
report is a seat nobody *uses*, because no per-application activity exists to derive
it from; SC5 cut that reason rather than approximating it from a Google Workspace
login timestamp.

The second cannot be answered at all: the product detects and cannot act.

## Order

**SC5 → SC3 → SC2 → SC4.** Peripheral work waits behind all four.

1. ~~**SC5 — licence and cost.**~~ **Done** — `docs/archive/review/saas-license-cost-plan.md`,
   revision 6; contracts C1–C6, shipped across #15, #16, #17 and #18.

   Two things it decided are worth carrying rather than re-deriving. It answered the
   question this entry told it to answer first: `last_activity_at` is last login to
   Google Workspace and not per-application usage, so the `idle` reclaimable reason
   was **cut** (`SCL7`) instead of being approximated from the wrong column — the
   product reports seats held by a leaver or by nobody, both derived from evidence it
   holds. And it took no new tables plural: one, `saas_contracts`, because contract
   history and tiered plans were scoped out (`SCL1`, `SCL2`) rather than designed for.

   It also held this entry's own promise: **no new external integration, no new OAuth
   scope, no write to any connected system, and no change to the connector
   interface** — so the order-flipping trigger below was never fired.
2. **SC3 — OAuth token audit.** *Next.* The cheapest route into discovery: `admin.directory
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

**One data point since, and it cuts weakly in favour of the order.** SC5 shipped
without touching `packages/connectors` at all — its NF1 forbade it and the constraint
never bound, because contract data enters by CSV. So SC5 added no cost to a later
interface correction. That is *not* evidence the interface is sound: SC5 never
exercised it. SC3 is the item that will, which is the argument for it being next.

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
- **i18n** — recorded nowhere in the repository until this file and not deferred by
  any scope contract; UI strings are English literals in JSX. Cheapest while the UI is
  small, which is an argument for doing it early and not an argument for doing it
  before the product answers its category's questions. It got one page, one upload
  form and one export more expensive with SC5, and half of that argument has now been
  answered — worth re-reading, not yet worth acting on.
- **Hierarchical tenants (SC6)**, **OIDC/Keycloak SSO for the app itself (SC7)**,
  **connection pooler support (SC9)**, **`discovery_events` retention (SC10)** — all
  still deferred on their original terms.

## How to use this file

An item moves only by writing its plan under `docs/archive/review/<name>-plan.md` and
putting it through the review the others had. This file records the order and the
reason; it is not itself a decision to start.

**Re-derive the measured section when an item lands.** No gate reads this file —
which is the exact condition `SC65` names, and it decayed in one cycle: SC5 shipped a
table, two routes and a page, and the section above went on saying "no plan, no seat
count, no price" and "**no columns exist**" while being the artifact that decides
what to build next. Recall is what produced that. Derive instead:

```bash
grep -rhoE 'CREATE TABLE [a-z_]+' packages/schema/migrations/*.sql | sort   # tables
sed -n '/expect(app.apiRoutes.map/,/^      ]);/p' \
  apps/api/test/api.integration.test.ts                                     # API (asserted exact)
find apps/web/src/app -name page.tsx                                        # pages
```

The API set comes from an exact-equality assertion rather than from the route files,
so it cannot drift from what the app registers — a route added without that list
being updated fails CI, which makes the list the measurement rather than a second
copy of it.
