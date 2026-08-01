# Plan: i18n

Cycle 8. `docs/roadmap.md` lists i18n under **"Deliberately not next"**, and this
plan does not overrule that — it makes the decision answerable with numbers
instead of impressions, and states the one condition under which the order
should change.

Revision 2 — **C1 built and executed**, with `NavBar` as its first consumer so
the dictionary is not a shape nobody renders. C2 (the remaining 85 strings) and
C3 (the switch control) are not built.

Revision 1 — written from measurement. Nothing is built.

## The ordering question, stated honestly

The roadmap's order is **SC5 → SC3 → SC2 → SC4**, with peripheral work behind all
four, and its reason for deferring i18n is: *"cheapest while the UI is small,
which is an argument for doing it early and not an argument for doing it before
the product answers its category's questions."*

Two of the three clauses have moved since:

- **The UI grew.** SC5 added `/licenses` and an upload form; SC3 added
  `/discovery`. Measured now: **92 user-facing strings across 17 files** — 10
  pages and 7 components. Every cycle that ships a screen raises this number and
  none lowers it.
- **One category question is answered.** `/licenses` reports what is paid for
  and what is reclaimable; `/discovery` narrows the second from "cannot detect"
  to "detects one route". The deferral's premise is weaker than when written.

What has **not** changed is that i18n answers neither question. So this plan does
not claim i18n has earned its way past SC2 and SC4 on merit.

**The condition that would change the order**: SC2 needs a product decision
nothing in this repository can make — *which* second connector — and it is
blocked on that input rather than on effort. i18n is blocked on nothing. If SC2
is waiting for a provider choice, i18n is the work that can proceed meanwhile;
if a provider is chosen, SC2 goes first and this plan waits. **That is the
decision to take, and it belongs to the operator, not to this document.**

## Measured current state

| | measured |
|---|---|
| user-facing strings | **92**, across 17 files |
| pages / components | 10 / 7 |
| locale-dependent formatting already present | **2** — both `toLocaleString('en-US')`, both pinned deliberately |
| E2E spec files asserting English UI text | **11** |
| how `page-spec-membership` derives a route | `dir.split(path.sep)[0]` |

Largest per file: `accounts` (14), `identities/[identityId]` (13), `import`
(12), `licenses` (11).

## The approach, decided by what it costs here

**Locale from a cookie, not from the URL.** Next.js's idiomatic form is sub-path
routing (`/en/accounts`, `/ja/accounts`), and it is the wrong trade for this
repository — measured, not asserted:

- every page moves under `app/[locale]/`, so
  `page-spec-membership.test.ts`'s route derivation (`dir.split(sep)[0]`) yields
  `[locale]` for **every** page and the gate stops meaning anything
- **11 E2E spec files** navigate by bare path (`goto('/accounts')`) and would all
  need rewriting
- what it buys is per-locale URLs that are shareable and indexable — and this is
  an authenticated internal tool with no public surface, so it buys nothing here

A cookie-selected locale leaves every URL, every E2E navigation and the page
gate untouched, and the dictionary lookup is the same either way.

**Default `en`.** Not a preference: the 11 E2E spec files assert English, so any
other default turns this into an i18n change plus an E2E rewrite, and the two
would land in one unreviewable diff. `ja` arrives as the second locale, with one
new spec that switches and asserts a translated string — that spec is the only
place the switch is actually exercised.

## Contracts

### C1 — the dictionary and its lookup — BUILT (`apps/web/src/lib/i18n/`)

- **One key space, and a missing key must be loud.** A lookup returning the key
  itself on a miss is the common design and it ships English keys into a
  Japanese UI silently. Decide between throwing and rendering a visible marker,
  and make the choice testable.
- **The type must make a missing translation a typecheck error**, or the
  dictionary drifts the first time a string is added to one locale only. That is
  what a `Record<Key, string>` per locale buys and a loose object does not.
- No new dependency unless one earns it. 92 strings and two locales is a
  `Record` and a hook; `next-intl` brings routing this plan has just decided
  against.

### C2 — the strings — NOT BUILT

- 92 sites, and the risk is not the count but the **silent partial migration**:
  a page half-extracted looks finished and reads correctly in English.
  The contract needs a mechanical check that no user-facing literal remains,
  and that check is the hard part — the same "surface-form adjudication" problem
  the repository has hit repeatedly. A grep over JSX text nodes is a starting
  filter, not a gate.
- The two `toLocaleString('en-US')` calls become locale-dependent. VE3 already
  records that currency rendering is locale-dependent and asserted on the
  emitted string; the same rule applies to these.

### C3 — the switch, and the second locale — NOT BUILT

- The cookie, its default, and a control to change it.
- One E2E spec that switches to `ja` and asserts a translated string. Without
  it, the `ja` dictionary is data nothing reads.

## Considerations

- **Nothing here is a security boundary**, which is why this plan is shorter
  than the ones around it. The failure mode is an untranslated or wrong string,
  not a cross-tenant read.
- **The API is not translated.** Error strings from `apps/api` are keys the web
  app maps to copy (`UPLOAD_ERROR_MESSAGES` already works this way), and the two
  existing maps are the pattern C2 should follow rather than replace.
- **`SCL15` becomes relevant**: those maps are keyed off constants the routes
  interpolate, and a translated map has to keep that keying or the friendly copy
  silently falls back — in the one place that exists to explain a refusal.

## What execution added to C1

**The locale could not be resolved per component.** `/import` and `/login` are
client pages, and a client component cannot render an async server one — which
is what a `next/headers` lookup inside `NavBar` would have made it. Measured
when `NavBar` was first written as an async server component and `/import`
stopped compiling. The root layout is the only server-side wrapper around
everything, so it resolves once and hands the locale down through context.

**`<html lang>` was hardcoded to `en`.** It now follows the locale. That
attribute is a claim a screen reader acts on, so under `ja` it was going to be a
lie the moment the second dictionary landed.

**`NavBar` carries a `data-testid`.** `/accounts` has a second `<nav>` for its
status tabs, so `getByRole('navigation')` is ambiguous there — found by the E2E
failing in strict mode, and only on the assertion that scopes to the whole nav
rather than to one link inside it.

### C1's mutations

Four run, four red.

| mutation | result |
|---|---|
| a miss renders the key instead of a marker | reds |
| an empty message is rendered as empty | reds |
| `isLocale` accepts anything string-shaped | reds |
| the `ja` dictionary carries the English through | reds |

The last is the non-vacuity guard for every other assertion in the file: two
dictionaries with identical values satisfy the key-set and non-empty checks
while translating nothing.

Suite state after C1: unit 468 green (38 files), integration 227 green, E2E 53
green against the compose stack, lint and typecheck clean.
