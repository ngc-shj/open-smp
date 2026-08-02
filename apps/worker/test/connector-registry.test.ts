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

  it.each([...CONNECTOR_APP_KEYS])('builds a working connector for %s', (key) => {
    // It used to assert `toBeTypeOf('function')` on the factory — implied by
    // `Map<string, ConnectorFactory>` and by the key-equality test above, so no
    // type-correct edit could red it. Measured in review: making
    // buildSlackConnector throw unconditionally left all three tests green.
    //
    // The factory is CALLED, with credentials that satisfy every connector's
    // validation, and the result is checked for the interface it must provide.
    const connector = createConnectorRegistry().get(key)!({
      serviceAccountJson: '{}',
      impersonateAdminEmail: 'a@b.example',
      botToken: 'xoxb-not-real',
    });

    expect(connector.id, `${key} builds a connector declaring a different id`).toBe(key);
    expect(connector.listUsers).toBeTypeOf('function');
  });

  it.each([...CONNECTOR_APP_KEYS])('%s rejects credentials it cannot use', (key) => {
    // The paired deny side. A factory that ignored its input would satisfy the
    // allow case above while accepting an empty credential set and failing at
    // the provider instead — which reaches the operator as an audit row.
    expect(() => createConnectorRegistry().get(key)!({})).toThrow();
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
