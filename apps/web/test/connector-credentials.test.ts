import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONNECTOR_APP_KEYS } from '../src/lib/api-types';
import { MESSAGES } from '../src/lib/i18n/messages';
import {
  CREDENTIAL_FIELDS,
  DEFAULT_CONNECTOR_APP_KEY,
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

const WORKER_CONNECTORS = path.join(
  import.meta.dirname,
  '..',
  '..',
  'worker',
  'src',
  'connectors.ts',
);

describe('every connector declares the credentials its factory reads', () => {
  it('covers the whole key set', () => {
    // `Record<ConnectorAppKey, …>` makes this a compile error too. Asserted
    // anyway, because the compile-time half lives in one type annotation and a
    // later `Partial<>` or index signature would erase it silently.
    expect(Object.keys(CREDENTIAL_FIELDS).sort()).toEqual([...CONNECTOR_APP_KEYS].sort());
  });

  it('names every required field the worker factory demands', async () => {
    // The worker reads `credentials.<name>` and throws when it is absent. Every
    // such read must correspond to a field the form actually renders — the
    // direction that catches a rename on the worker side.
    const source = await readFile(WORKER_CONNECTORS, 'utf8');
    const read = [...source.matchAll(/credentials\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!);

    expect(read.length, 'no credential reads found — the detector stopped matching').toBeGreaterThan(0);

    const declared = new Set(
      Object.values(CREDENTIAL_FIELDS).flatMap((fields) => fields.map((f) => f.name)),
    );

    expect([...new Set(read)].filter((name) => !declared.has(name)), 'read by the worker, offered by no form').toEqual([]);
  });

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

  it('accepts a well-formed service account', () => {
    // RT10's allow side. A classifier that rejected everything satisfies every
    // assertion above and makes registration impossible.
    expect(rejectCredentials('google-workspace', { serviceAccountJson: VALID_SA })).toBeNull();
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

  it('does not accept one connector by supplying the other one\'s field', () => {
    // The dispatch is on the KEY, not on which values happen to be present. A
    // classifier that looked at the values would pass a Slack registration
    // carrying a service account and post it as `credentials.serviceAccountJson`
    // under `key: 'slack'`.
    expect(rejectCredentials('slack', { serviceAccountJson: VALID_SA })).toBe('invalidToken');
    expect(rejectCredentials('google-workspace', { botToken: 'xoxb-123-abc' })).toBe('invalidJson');
  });
});
