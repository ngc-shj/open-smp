import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONNECTOR_APP_KEYS } from '../src/lib/api-types';
import { MESSAGES } from '../src/lib/i18n/messages';
import {
  CREDENTIAL_FIELDS,
  DEFAULT_CONNECTOR_APP_KEY,
  credentialFieldsFor,
  rejectCredentials,
} from '../src/lib/connector-credentials';

// SC2/C3. The form's credential contract, which has TWO ends and a type system
// that connects neither of them:
//
//   left  — what the form posts, from CREDENTIAL_FIELDS[key][].name
//   right — what apps/worker/src/connectors.ts reads out of `credentials`
//
// A name that disagrees produces a registration the operator completes and a
// sync that fails with `<key> credentials require …` — a message that reaches
// them as an audit row rather than as a form error, on a credential they cannot
// see to re-check.
//
// This is family (b) of the control taxonomy: it derives a domain and compares
// it against a second declaration in another package. The addition-guard in
// package-test-parity.test.ts is mechanical for family (a) only, so this file
// is listed there by hand.

const API_SAAS_APPS = path.join(
  import.meta.dirname,
  '..',
  '..',
  'api',
  'src',
  'routes',
  'saas-apps.ts',
);

const WORKER_CONNECTORS = path.join(
  import.meta.dirname,
  '..',
  '..',
  'worker',
  'src',
  'connectors.ts',
);

/** The body of the factory the registry binds to `key`, located through the map. */
async function factoryBody(key: string): Promise<string> {
  const source = await readFile(WORKER_CONNECTORS, 'utf8');
  const builders = new Map(
    [...source.matchAll(/\[\s*'([^']+)'\s*,\s*(\w+)\s*\]/g)].map((m) => [m[1]!, m[2]!] as const),
  );
  const builder = builders.get(key);
  expect(builder, `no registry entry for ${key}`).toBeDefined();

  const start = source.indexOf(`function ${builder}(`);
  expect(start, `no body for ${builder}`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  expect(end, `no closing brace for ${builder}`).toBeGreaterThan(start);
  const body = source.slice(start, end);
  // The guards above make a MISSING body loud; a TRUNCATED one was silent. If
  // the locator stops early the extracted text simply shrinks, the read set
  // narrows, and the anti-vacuity floor below is still satisfied by the first
  // line — so a credential read after the truncation point (Google's optional
  // `customerId` is one) drops out of the derivation with no assertion
  // changing. The factory's return is the last statement in every one of them.
  expect(body, `body for ${builder} is truncated`).toMatch(/return new \w+Connector/);
  return body;
}

/** The credential names the API refuses to accept blank, read from its own declaration. */
async function apiRequiredCredentials(): Promise<Map<string, readonly string[]>> {
  const source = await readFile(API_SAAS_APPS, 'utf8');
  const start = source.indexOf('const REQUIRED_CREDENTIAL_FIELDS');
  expect(start, 'no REQUIRED_CREDENTIAL_FIELDS declaration in the API route').toBeGreaterThan(-1);
  const end = source.indexOf('\n};', start);
  expect(end, 'REQUIRED_CREDENTIAL_FIELDS is not closed').toBeGreaterThan(start);
  const body = source.slice(start, end);

  return new Map(
    [...body.matchAll(/'?([\w-]+)'?\s*:\s*\[([^\]]*)\]/g)].map(
      (m) =>
        [m[1]!, [...m[2]!.matchAll(/'([^']+)'/g)].map((n) => n[1]!)] as [string, readonly string[]],
    ),
  );
}

describe('every connector declares the credentials its factory reads', () => {
  it('covers the whole key set', () => {
    // `Record<ConnectorAppKey, …>` makes this a compile error too. Asserted
    // anyway, because the compile-time half lives in one type annotation and a
    // later `Partial<>` or index signature would erase it silently.
    expect(Object.keys(CREDENTIAL_FIELDS).sort()).toEqual([...CONNECTOR_APP_KEYS].sort());
  });

  it.each([...CONNECTOR_APP_KEYS])("declares every credential %s's factory reads", async (key) => {
    // Both directions are now per connector and share one locator. The previous
    // form flattened the declared names across connectors and applied a single
    // global anti-vacuity floor, so moving `botToken` into the Google array —
    // or a routine `const { botToken } = credentials` refactor in the worker —
    // passed every test.
    const body = await factoryBody(key);
    const read = [...body.matchAll(/credentials\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!);

    expect(read.length, `no credential reads found for ${key}`).toBeGreaterThan(0);

    const declared = new Set(CREDENTIAL_FIELDS[key].map((f) => f.name));
    expect(
      [...new Set(read)].filter((name) => !declared.has(name)),
      `read by ${key}'s factory, offered by no field of ${key}`,
    ).toEqual([]);
  });

  it('agrees with the API about which credentials cannot be blank', async () => {
    // The THIRD end of this contract, added in review round 6. `credentials` was
    // a bare string record on the API, so `PATCH {"credentials":{}}` encrypted an
    // empty object over a working credential and returned 200 — the browser's
    // `required` flags were the only enforcement anywhere. The API now has its
    // own declaration, and `@open-smp/api-types` may not host a shared one (C39
    // permits only frozen string arrays and `is*` guards), so the two are pinned
    // to each other here rather than derived from one another.
    const api = await apiRequiredCredentials();

    expect([...api.keys()].sort(), 'the API declares a different key set').toEqual(
      [...CONNECTOR_APP_KEYS].sort(),
    );

    for (const key of CONNECTOR_APP_KEYS) {
      const declared = CREDENTIAL_FIELDS[key]
        .filter((f) => f.required)
        .map((f) => f.name)
        .sort();
      // Non-vacuity: every connector has at least one credential it cannot work
      // without, so an empty side here is a parse failure rather than a fact.
      expect(declared.length, `${key} declares no required field`).toBeGreaterThan(0);
      expect([...(api.get(key) ?? [])].sort(), `${key}: form and API disagree`).toEqual(declared);
    }
  });

  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'offers no credential fields for an app named %s',
    (key) => {
      // The sibling lookup, which had no observer because it lived inline in a
      // component. `CREDENTIAL_FIELDS['constructor']` is `Object` — a function,
      // so a `?? []` fallback never fires and `Object.length === 1` made the
      // replace-credentials panel render and then throw during the render.
      expect(credentialFieldsFor(key)).toEqual([]);
    },
  );

  it.each([...CONNECTOR_APP_KEYS])('offers %s the fields it declares', (key) => {
    // The allow side: a guard that returned [] for everything would satisfy the
    // cell above and hide every connector's form.
    expect(credentialFieldsFor(key)).toBe(CREDENTIAL_FIELDS[key]);
  });

  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'returns no rejection for an app named %s',
    (key) => {
      // `app.key` is arbitrary tenant-supplied DB text — POST /contract-import
      // writes it from a CSV cell — and `REJECTORS` is an object literal, so a
      // bare index resolved these to inherited Object.prototype functions and
      // CALLED them. The result was typed `CredentialRejection` and set as the
      // panel's error, where its ERROR_KEYS lookup yields undefined.
      expect(rejectCredentials(key, {})).toBeNull();
    },
  );

  it.each([
    ['an underscore in the domain', 'admin@corp_internal'],
    ['a trailing dot', 'admin@corp.example.'],
    ['a hyphen-terminated label', 'admin@corp-.example'],
    ['no domain at all', 'admin@'],
    ['surrounding whitespace', ' admin@corp.example '],
  ])('rejects an admin email with %s', (_label, value) => {
    // THE STRICTER ADJUDICATOR, restored. The register form used to run
    // `input[type=email]`'s WHATWG check as well as this function, and the
    // manager ran only this one; round 6 unified them by deleting the stricter
    // side, so every address here went from rejected-on-one-surface to accepted
    // on both, with no server-side format check to compensate (R43). This
    // function now IS the WHATWG production, so the two surfaces agree at the
    // stricter reading rather than the looser one.
    expect(
      rejectCredentials('google-workspace', {
        serviceAccountJson: JSON.stringify({ client_email: 'a@b.example', private_key: 'k' }),
        impersonateAdminEmail: value,
      }),
    ).toBe('invalidEmail');
  });

  it.each(['admin@corp.example', 'a.b+c@sub.corp.example', "o'brien@x.co"])(
    'accepts the valid address %s',
    (value) => {
      // The allow side (RT10). Without it the tightening above is satisfiable by
      // a predicate that rejects everything, which is the worse direction this
      // check's own header warns about.
      expect(
        rejectCredentials('google-workspace', {
          serviceAccountJson: JSON.stringify({ client_email: 'a@b.example', private_key: 'k' }),
          impersonateAdminEmail: value,
        }),
      ).toBeNull();
    },
  );

  it('resolves every label through a message the dictionary carries', () => {
    // A mistyped key renders as the marker rather than throwing, so without this
    // a credential field ships labelled ⟨saasapp.botToken⟩ and only a human
    // looking at the page would notice.
    const keys = Object.values(CREDENTIAL_FIELDS).flatMap((fields) =>
      fields.flatMap((f) => [f.labelKey, ...(f.replaceLabelKey ? [f.replaceLabelKey] : [])]),
    );

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !(k in MESSAGES.en))).toEqual([]);
  });

  it('starts a fresh form on a connector that has fields', () => {
    // Three E2E specs fill the Google fields on first render. The default is the
    // first member of the key set rather than a separate constant precisely so
    // that a reorder reds them rather than moving quietly.
    expect(DEFAULT_CONNECTOR_APP_KEY).toBe(CONNECTOR_APP_KEYS[0]);
    expect(CREDENTIAL_FIELDS[DEFAULT_CONNECTOR_APP_KEY].length).toBeGreaterThan(0);
  });
});

describe('rejectCredentials keeps a wrong paste from being sent', () => {
  const VALID_SA = JSON.stringify({ client_email: 'a@b.example', private_key: '-----KEY-----' });

  it.each([
    ['unparseable JSON', '{"client_email":', 'invalidJson'],
    ['a JSON scalar', '"just a string"', 'invalidJson'],
    ['JSON missing private_key', JSON.stringify({ client_email: 'a@b.example' }), 'missingFields'],
  ])('rejects %s', (_label, serviceAccountJson, expected) => {
    expect(rejectCredentials('google-workspace', { serviceAccountJson })).toBe(expected);
  });

  it.each([
    ['an address with no @', 'nonsense'],
    ['an address with whitespace', 'a b@x.example'],
    ['an empty address', ''],
    ['a padded address', ' admin@corp.example '],
  ])('rejects %s for the admin email', (_label, impersonateAdminEmail) => {
    // The manager's inputs sit outside a <form> behind a type="button", so
    // their `type="email"` never triggers constraint validation — the register
    // form's browser-side check had no counterpart there and a malformed
    // address reached storage, failing as an audit row.
    expect(
      rejectCredentials('google-workspace', {
        serviceAccountJson: VALID_SA,
        impersonateAdminEmail,
      }),
    ).toBe('invalidEmail');
  });

  it('accepts a well-formed service account', () => {
    // RT10's allow side. A classifier that rejected everything satisfies every
    // assertion above and makes registration impossible.
    expect(
      rejectCredentials('google-workspace', {
        serviceAccountJson: VALID_SA,
        impersonateAdminEmail: 'admin@corp.example',
      }),
    ).toBeNull();
  });

  it.each([
    ['an empty token', ''],
    ['whitespace only', '   '],
    ['a token with a trailing newline', 'xoxb-123-abc\n'],
    ['a token with an inner space', 'xoxb-123 abc'],
  ])('rejects %s', (_label, botToken) => {
    expect(rejectCredentials('slack', { botToken })).toBe('invalidToken');
  });

  it('accepts a bot token, and does not adjudicate its prefix', () => {
    expect(rejectCredentials('slack', { botToken: 'xoxb-123-abc' })).toBeNull();
    // The deliberate non-check. A user token is WRONG and this returns null,
    // because enumerating a vendor's token spellings is the surface-form
    // adjudication this repository keeps paying for — and rejecting a valid
    // token an operator holds is the worse direction. The API and the worker
    // are where a wrong token is found out.
    expect(rejectCredentials('slack', { botToken: 'xoxp-123-abc' })).toBeNull();
  });

  it.each([...CONNECTOR_APP_KEYS])(
    '%s refuses every one of its required fields when blank',
    (key) => {
      // The invariant that lets SaasAppManager carry no separate required-blank
      // guard: the classifier already answers every blank required field. A new
      // connector whose rejector skipped one would store an unusable credential
      // whose failure reaches the operator as an audit row — so the property is
      // asserted here rather than duplicated as a UI check that never fires.
      // Every non-target field carries a value ITS OWN rejector accepts. Filling
      // them all with `'placeholder'` made this pass for the wrong reason:
      // `'placeholder'` is unparseable JSON, so the service-account arm
      // short-circuited and the email arm was never reached — measured, a
      // rejector that stopped refusing a blank email left this green.
      const ACCEPTABLE: Record<string, string> = {
        serviceAccountJson: VALID_SA,
        impersonateAdminEmail: 'admin@corp.example',
        customerId: 'C0123',
        botToken: 'xoxb-123-abc',
      };

      for (const field of CREDENTIAL_FIELDS[key].filter((f) => f.required)) {
        const values = Object.fromEntries(
          CREDENTIAL_FIELDS[key].map((f) => [
            f.name,
            f.name === field.name ? '' : (ACCEPTABLE[f.name] ?? ''),
          ]),
        );

        // Non-vacuity: with NOTHING blank the same values must be accepted, or
        // the rejection below could be coming from any of them.
        expect(
          rejectCredentials(
            key,
            Object.fromEntries(
              CREDENTIAL_FIELDS[key].map((f) => [f.name, ACCEPTABLE[f.name] ?? '']),
            ),
          ),
          `${key}: the acceptable filler is not actually accepted`,
        ).toBeNull();
        expect(rejectCredentials(key, values), `${key}.${field.name} blank`).not.toBeNull();
      }
    },
  );

  it('returns null for an application no connector handles', () => {
    // `saas_apps.key` is free text — POST /contract-import writes it from a CSV
    // cell and the seed ships `notion`. Before the dispatch became a Record,
    // every such key fell through to the bot-token check and the operator was
    // told their credentials did not look like a bot token, on a panel with no
    // inputs. Restoring that fallthrough passed all fifteen tests.
    expect(rejectCredentials('notion', {})).toBeNull();
    expect(rejectCredentials('notion', { serviceAccountJson: 'anything' })).toBeNull();
  });

  it.each([...CONNECTOR_APP_KEYS])('%s requires no field its own factory ignores', async (key) => {
    // Scoped to THIS connector's factory. The first version swept the whole
    // worker module, so `botToken` declared required on google-workspace passed
    // — which is the failure the name describes: a required input that gates
    // the replace flow and that no factory ever reads.
    const body = await factoryBody(key);
    const read = new Set([...body.matchAll(/credentials\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!));

    expect(read.size, `no credential reads found for ${key}`).toBeGreaterThan(0);
    expect(
      CREDENTIAL_FIELDS[key].filter((f) => f.required && !read.has(f.name)).map((f) => f.name),
      `${key} requires a field its factory ignores`,
    ).toEqual([]);
  });

  it("does not accept one connector by supplying the other one's field", () => {
    // The dispatch is on the KEY, not on which values happen to be present. A
    // classifier that looked at the values would pass a Slack registration
    // carrying a service account and post it as `credentials.serviceAccountJson`
    // under `key: 'slack'`.
    expect(rejectCredentials('slack', { serviceAccountJson: VALID_SA })).toBe('invalidToken');
    expect(rejectCredentials('google-workspace', { botToken: 'xoxb-123-abc' })).toBe('invalidJson');
  });
});
