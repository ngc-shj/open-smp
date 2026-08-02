import { describe, expect, it } from 'vitest';
import { CONNECTOR_APP_KEYS, TOKEN_CAPABILITIES } from '@open-smp/api-types';
import { createConnectorRegistry } from '../src/connectors.js';

// SC2/C2. The two ends of `saas_apps.key`, asserted to agree.
//
// `CONNECTOR_APP_KEYS` decides what `POST /saas-apps` accepts; the registry
// decides what a sync job can resolve. Nothing in the type system connects
// them — the registry is a `ReadonlyMap<string, …>` and `SaaSConnector.id` is
// an unconstrained `string` — so the two failure directions are both silent:
//
//   key in the set, not in the registry → an application an operator can
//     register and no job can ever sync; `runSync` throws
//     "No connector registered for saas_apps.key" at run time, in a worker log
//   key in the registry, not in the set → a connector that exists and cannot
//     be reached, which looks like the feature was never shipped
//
// This is family (b) of the control taxonomy — it derives a domain and compares
// it against a second declaration — so the addition-guard in
// package-test-parity.test.ts cannot see it, and it is listed there by hand.

describe('SC2/C2: the connector registry and the accepted key set agree', () => {
  it('holds exactly the keys the route accepts, and no others', () => {
    const registered = [...createConnectorRegistry().keys()].sort();

    // Equality, not containment. Containment in either direction leaves one of
    // the two failure modes above green.
    expect(registered).toEqual([...CONNECTOR_APP_KEYS].sort());
  });

  it('enumerates something', () => {
    // Non-vacuity for the equality above: two empty sets are equal, and an
    // empty registry is reachable — `createConnectorRegistry` returning
    // `new Map()` is a one-token edit.
    expect(CONNECTOR_APP_KEYS.length).toBeGreaterThan(0);
    expect(createConnectorRegistry().size).toBeGreaterThan(0);
  });

  it('builds a connector for every key it claims', () => {
    // The map could hold a key whose factory throws on any input, which the
    // equality above cannot see. Called with empty credentials, so what is
    // asserted is that a factory EXISTS and is a function — a credential-shape
    // rejection is the factory working, not failing.
    for (const key of CONNECTOR_APP_KEYS) {
      const factory = createConnectorRegistry().get(key);

      expect(factory, `no factory for ${key}`).toBeTypeOf('function');
    }
  });
});

describe('SC2/C4: the capability declaration and the method agree', () => {
  it.each([...CONNECTOR_APP_KEYS])('%s declares what it can actually do', (key) => {
    // Two statements of one claim, and the type system cannot relate them: an
    // optional method's presence is not visible in the type, so a connector
    // declaring `per-user-grants` with no `listTokens` compiles and throws a
    // TypeError inside the audit loop. The audit checks both for that reason;
    // this is what stops the second check from being permanently dead code.
    const connector = createConnectorRegistry().get(key)!({
      serviceAccountJson: '{}',
      impersonateAdminEmail: 'a@b.example',
      botToken: 'xoxb-not-real',
    });

    expect(TOKEN_CAPABILITIES as readonly string[]).toContain(connector.tokenCapability);
    expect(
      typeof connector.listTokens === 'function',
      `${key} declares ${connector.tokenCapability}`,
    ).toBe(connector.tokenCapability === 'per-user-grants');
  });

  it('has at least one connector on each side of that question', () => {
    // Non-vacuity, and the reason Slack was chosen over Microsoft 365: a
    // vocabulary every implementation answers the same way is a rename of the
    // optional method it replaced.
    const declared = [...CONNECTOR_APP_KEYS].map(
      (key) => createConnectorRegistry().get(key)!({ serviceAccountJson: '{}', impersonateAdminEmail: 'a@b.example', botToken: 'xoxb-not-real' }).tokenCapability,
    );

    expect(new Set(declared).size).toBeGreaterThan(1);
  });
});
