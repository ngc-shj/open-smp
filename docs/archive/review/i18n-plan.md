# Plan: i18n

Cycle 8. `docs/roadmap.md` lists i18n under **"Deliberately not next"**, and this
plan does not overrule that — it makes the decision answerable with numbers
instead of impressions, and states the one condition under which the order
should change.

Revision 5 — **C2 drained, and C1 given parameters.** The remainder is 0. What
made that necessary rather than optional is C3: a switch that reaches a
half-English app turns an invisible debt into a visible defect, in one click.

Revision 4 — **C3 built.** The switch exists, and the `ja` dictionary is
reachable without hand-editing a cookie. The remainder is unchanged at 128
across 14 files: the control introduces no copy of its own, which is the ratchet
reporting rather than a claim.

Revision 3 — **C2's detector built, and the remainder ratcheted.** 128 strings
across 14 files remain; four components are migrated to prove the ratchet moves.
C3 is not built.

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

### C2 — the strings — BUILT (detector, ratchet, and the drain)

- 92 sites, and the risk is not the count but the **silent partial migration**:
  a page half-extracted looks finished and reads correctly in English.
  The contract needs a mechanical check that no user-facing literal remains,
  and that check is the hard part — the same "surface-form adjudication" problem
  the repository has hit repeatedly. A grep over JSX text nodes is a starting
  filter, not a gate.
- The two `toLocaleString('en-US')` calls become locale-dependent. VE3 already
  records that currency rendering is locale-dependent and asserted on the
  emitted string; the same rule applies to these.

### C3 — the switch, and the second locale — BUILT

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

## What C2's detector cost to get right

**It found its own false positives twice.** `>` and `<` are also TypeScript
generics and comparisons, so the text-node regex matched across
`useState<Status>('idle')` and `a.n > 0 && a.n < 9` and reported the code
between them as copy — inflating the first count from 128 to 147.

The discriminator is deliberately **one rule** — copy contains a run of two or
more letters — rather than a list of operators to exclude. That list grows with
every new expression shape, and **a filter whose exclusion list keeps acquiring
members is at the wrong level**; `SC60` is where this repository paid for that
lesson the first time. Its paired direction is asserted: `"(1 left, 1 unknown)"`
is real copy with punctuation, and a discriminator wide enough to remove the
false positives by excluding punctuation would drop it silently.

**The remainder is asserted in both directions.** Over budget fails, and *under*
budget fails too — a budget that has gone slack stops resisting the next literal
added to that file. An entry reaching zero is deleted rather than left at 0.

**The addition-guard caught the new test**: it reads repository files and was not
listed as a control. Family (a) working exactly as designed, in the same session
that extended family (b) by hand (`SC61`).

### C2's mutations

| mutation | result |
|---|---|
| a budget is loosened | reds |
| the detector stops reading copy attributes | reds |
| the word rule is widened to a single letter | reds |
| the allowlist swallows real copy | reds |

Suite state: unit 478 green (39 files), integration 227 green, E2E 53 green,
lint and typecheck clean.

## What execution added to C3

**The cookie name had to leave `server.ts`.** That module reaches
`next/headers`, so a client component importing the name from it pulls
`next/headers` into the browser bundle. Writer and reader would otherwise have
spelled `'locale'` twice, and the day they disagree the switch appears to do
nothing with no error anywhere. It now lives in `lib/i18n/cookie.ts`, which both
sides import — and a mutation renaming it there is a **declared survivor**,
because a rename that reds would mean a second spelling had appeared.

**The write is `document.cookie`, not a server action.** The value is a display
preference the server does not act on, and the read path already treats it as
untrusted — `getLocale` falls back on anything unrecognised, which an E2E
asserts. A server action would have added a POST surface to defend for a string
nothing decides on, and this repository has no server actions to follow.

**`router.refresh()` updates `<html lang>`.** Asserted rather than assumed: the
locale is resolved by the root layout, so the open question was whether
re-fetching the route's server render reaches the `<html>` element or only the
components below it. It reaches it, and the E2E pins that.

**The option labels are endonyms, not message keys.** A picker names each
language in that language, because the reader who needs it is the one who cannot
read the language currently showing — translating them would render 日本語 as
"Japanese" to exactly that person.

### `path=/` had a failing state, and it took two wrong claims to find it

The mutation dropping `path=/` **survived twice**, and each survival killed a
claim rather than a test.

| claim | measured |
|---|---|
| "switching on `/accounts` leaves `/licenses` in the old language" | false — a one-segment URL's default path is already `/` |
| "reaching `/identities/<id>` fixes that" | false — a `<Link>` is a pushState, and Chrome derives the default from the URL the document was **loaded** at |
| a document **load** at `/identities/<id>` | true — cookie path is `/identities`, and `/licenses` comes back `lang="en"` |

Both survivals were the same shape as cycle 8's conclusion: *a mutation with no
seed case that refutes it is not a passing test, it is a branch nobody is
looking at.* The correction that mattered was not to the assertion — the unit
test asserted the attribute directly and redded every time — but to the **E2E
case**, which had no arrangement under which the attribute could matter. The
attribute's real user is someone who reloaded or bookmarked an identity page and
switched language there.

Measured with a throwaway probe spec that printed `context.cookies()`, deleted
after; the mechanism was not derivable from the RFC text alone, because the
soft-navigation behaviour is Chrome's and not the RFC's.

### C3's mutations

Unit tier, via `scripts/mutate.mjs` — seven red, two declared survivors:

| mutation | result |
|---|---|
| the cookie is scoped to the current directory instead of the site | reds |
| the cookie is scoped to a directory rather than deleted | reds — **added after review**, see below |
| max-age is set to a value that expires immediately | reds — **added after review** |
| the choice becomes a session cookie | reds |
| the writer names a cookie the reader does not read | reds |
| the writer ignores which locale was chosen | reds |
| both options are labelled the same | reds |
| the cookie is renamed at its single source | SURVIVED (declared — single-source, so a rename is behaviour-preserving) |
| SameSite is tightened to `strict` | SURVIVED (declared — nothing asserts SameSite; `strict` would drop the cookie on a cross-site entry into the app) |

E2E tier, driven by hand because the harness runs vitest only and the control has
no unit observer — each mutation pays for a rebuild of the web image:

| mutation | result |
|---|---|
| the switch writes the cookie but nothing re-renders | reds |
| the control always shows English regardless of the locale in effect | reds |
| the cookie is scoped to the current directory instead of the site | reds — **after** the spec was corrected twice above |

### What review found that the mutation run had not

**A substring cannot tell absence from narrowing.** The `path=/` assertion was
`expect(localeCookie('ja')).toContain('path=/')`, and `path=/identities`
satisfies it — the exact value the attribute exists to rule out. The mutation
run had only *deleted* the attribute, so it redded and the blind spot stayed
invisible. The assertions now split the assignment into attributes and compare
values; `max-age` is compared against its constant rather than to `> 0`, which
`max-age=1` satisfied.

This is the same shape as the two survivals above, one level up: **a mutation
set that only removes things cannot see a check that is blind to changing
them.** Both new mutants are in the table.

**CS4-A was overstated, and this cycle is what made it so.** `api-server.ts`
forwards only the `session` cookie by name and says over-forwarding "would leak
any future first-party cookie to the API host". `locale` is that first cookie —
and browser-side `fetch('/api/...')` reaches the API through `next.config.ts`'s
rewrite, which proxies the whole `Cookie` header, so the narrowing holds for
server-side calls only. Nothing leaks that matters (`en`/`ja`), and the comment
now says what the control covers. An overstated control is how a later cycle
skips the real one.

Suite state after C3: unit 485 green (39 files), integration 227 green, E2E 54
green against the compose stack, lint and typecheck clean, and the CI-only
"every assigned test file is inside a typecheck program" gate clean.

## What C2's drain found

The plan sized C2 at "the remaining strings". That was the detector's number,
and the detector says in its own header what it cannot see. The drain found
three things the count did not contain.

**Most of what was left was not a literal — it was a sentence with a value in
it.** `{n} selected`, `Labeled {n} accounts.`, `Row {n}: {message}`, `{imported}
imported, {skipped} skipped`, every `UPLOAD_ERROR_MESSAGES` entry. C1's lookup
took no parameters, so the only way to render these with a dictionary was
`t(a) + n + t(b)` — and **that shape cannot be translated at all**, because the
number and the noun do not sit where English puts them. `t(key, params)` is
therefore not a convenience added to C1; it is the difference between C2 being
finishable and not.

Two guards came with it, and each answers a failure the other cannot see:

- a placeholder nobody supplied is marked **where it stands**, so the rest of
  the sentence still reads;
- the locales are asserted to carry the **same placeholder set** per key. A
  translation that drops `{count}` has nothing to substitute and nothing to
  mark — the number simply never appears, and only a comparison across locales
  can see it.

**Pluralisation is one key per form.** `account{n === 1 ? '' : 's'}` is English
grammar written into code, and Japanese does not pluralise. The count picks the
message instead. The residue is stated: nothing tests the *selection* at the two
call sites, because there is no jsdom project here and neither component can be
rendered in a unit test.

**The label vocabulary lives outside `.tsx`, which is why this reached two pure
modules and two control tests.** `LABEL_KIND_NAMES` was a `Record` in a plain
`.ts` module, read by six sites, by `label-filters.ts`, and by
`audit-transition.ts` — a pure, unit-tested function. The detector sees none of
it, so the ratchet reaching zero would have left the whole vocabulary English
with every gate green. That is the ratchet's own residue, and it is the reason
"BUDGET is empty" must not be read as "the UI is translated".

Three decisions kept the controls at full strength rather than merely passing:

- `LABEL_KIND_NAMES` → `LABEL_KIND_KEYS`, values typed `MessageKey`. The map is
  the only thing making a fourth kind a compile error, and it still is.
- `auditTransition` takes the translator as a **parameter**. Resolving a request
  locale inside it would have made a pure module a server one, with the events
  page as its only possible caller and a request needed to test it.
- `label-filters.test.ts` asserts the **pair** — the key in the option and the
  English it resolves to. Pinning only the key would have stayed green while the
  bar read "Any label" where it used to read "All", which is exactly what that
  control exists to catch.

### The drain's mutations

Unit tier — eight red, one declared survivor:

| mutation | result |
|---|---|
| interpolation is dropped and the message renders with its braces | reds |
| a translation drops its placeholder | reds |
| a missing placeholder takes the whole message down | reds |
| the plural forms are made identical | reds |
| two label kinds resolve to the same copy | reds (filters **and** audit) |
| the filter bar loses the option that clears it | reds |
| a withheld snapshot renders as a genuine absent label | reds |
| a translated heading is written back as a literal | reds the ratchet |
| the Japanese plural forms are made identical | SURVIVED (declared — Japanese does not pluralise, so the two forms are correctly identical there) |

E2E tier — the only place a page BODY can be observed:

| mutation | result |
|---|---|
| a page heading falls back to English under `ja` | reds |
| a column heading is left in English under `ja` | reds |

### Residue, stated rather than discovered later

- **`app/discovery/page.tsx` keeps a budget of 1.** It is not copy: the detector
  matches `) : app.anonymous ? (`, the middle of a three-way ternary sitting
  between a `</span>` and a `<span`, with two identifiers long enough to satisfy
  the word rule. Kept as a budget rather than moved to the allowlist, because
  the allowlist is keyed by TEXT — exempting that string globally would exempt
  it everywhere, while the budget still reds on a real literal added to that
  file (2 > 1).
- **Number and currency formatting is still pinned to `en-US`.** Both import
  forms and `formatMoney` render figures locale-independently. `VE3` and
  `licenses-format.test.ts` pin that decision, and moving it is its own slice.
  Trigger: the first locale whose grouping differs from `en-US`, or a currency
  the `ja` UI must render differently.
- **`IDENTITY_ACCOUNTS_SHOWN = 50` is hand-synced.** The API's `PAGE_SIZE` lives
  in `apps/api/src/page-size.ts`, which `apps/web` cannot import. Naming the
  constant is better than the figure being buried in a sentence, and it is still
  a copy. Trigger: any change to that cap, or the constant moving into
  `@open-smp/api-types`.
- **One branch of the plural selection is unobserved** at `BulkLabelBar` and
  `SaasAppManager`. Corrected in review round 1: the earlier wording said the
  selection was untested, and both call sites are in fact exercised end to end —
  `labeling.spec.ts:200` pins `.one`, `apps.spec.ts:213` pins `.other`. What is
  unobserved is the other branch at each site, one axis and one side each
  (RT10). Trigger: either branch changing, or a jsdom project arriving for an
  unrelated reason.
- **`SEEDED_ACCOUNTS.chip` is apps/web copy inside a seed mirror.** The file
  documents itself as a mirror of `apps/api/src/seed.ts`, and `chip` has no
  counterpart there — it is the `en` dictionary value for the row's link status,
  kept in the fixture because `e2e/package.json` declares only
  `@playwright/test` and a spec cannot import the dictionary. Duplicating at the
  outermost tier is deliberate: an assertion that derives its expectation from
  the dictionary the page renders from asserts nothing. It is en-only, and
  `apps/web/test/link-statuses.test.ts` now reads the fixture as text and
  compares each `chip` against `translate('en', …)`, so the two cannot drift.
  Trigger: a spec needing the `ja` chip, which would need a second field.
- **`accountStatus` stays English** in the accounts and identity tables.
  Reported in review round 1 alongside the link-status vocabulary, which WAS
  converted. This one is not, and the reason is the boundary rather than the
  effort: `AccountLink.accountStatus` is a bare `string` on the wire, so
  `apps/web` has no closed domain to key a `Record` by. The producing union
  lives in `packages/connectors/core`, which apps/web may not import (C8: the
  API is the only data path), so converting it means adding the domain to
  `@open-smp/api-types` — a second declaration of the connector's union with
  nothing in the type system connecting them, which is its own contract.
  Trigger: `accountStatus` gaining a domain in `@open-smp/api-types`.
- **`→` and `—` stay literals** in `auditTransition`, on the ground the detector
  actually applies: it skips any text with no letter, so a glyph never reaches
  the allowlist at all. Corrected in review round 1 — the earlier wording cited
  the allowlist, and those glyphs sat there as entries that could never fire;
  they were removed with the eight other unreachable ones.
- **The app name in the delete confirmation lost its bold.** An interpolated
  value cannot carry markup, and splitting the sentence to keep it is the
  fragment shape the dictionary exists to avoid. The rendered text is unchanged.
- **Raw API error strings are still shown untranslated** beneath the friendly
  copy, deliberately, for support.

Suite state after C2: unit 491 green (39 files), integration 227 green, E2E 56
green against the compose stack, lint and typecheck clean.
