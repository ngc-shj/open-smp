// Relative imports, not the `@/` alias: this module is unit-tested and the root
// vitest project resolves no alias. Same reason as label-kinds.ts and
// label-filters.ts.
import { CONNECTOR_APP_KEYS, type ConnectorAppKey } from './api-types';
import type { MessageKey } from './i18n/messages';

// SC2/C3. What each connector asks an operator for.
//
// A `Record<ConnectorAppKey, …>` and not a lookup with a fallback: a connector
// added to the key set with no credential shape is then a COMPILE error rather
// than a registration form that posts `credentials: {}` and fails at the worker
// with `<key> credentials require …` — a message that reaches the operator as
// an audit row rather than as a form error.
//
// The field `name` is the credential key posted to `POST /saas-apps` and read
// by `apps/worker/src/connectors.ts`. Nothing in the type system connects the
// two sides, so the unit test asserts the names against that module.

export type CredentialFieldKind = 'text' | 'email' | 'multiline' | 'secret';

export type CredentialField = {
  /** The key inside the posted `credentials` object, and the input's DOM id. */
  readonly name: string;
  readonly labelKey: MessageKey;
  /**
   * The label in the REPLACE flow, where the box is empty and the stored value
   * is not shown. Without the distinction "Service account JSON" over an empty
   * field reads as "the current value is empty" rather than "type the new one".
   * Omitted where the wording does not change.
   */
  readonly replaceLabelKey?: MessageKey;
  readonly kind: CredentialFieldKind;
  readonly required: boolean;
};

export const CREDENTIAL_FIELDS: Record<ConnectorAppKey, readonly CredentialField[]> = {
  'google-workspace': [
    {
      name: 'serviceAccountJson',
      labelKey: 'field.serviceAccountJson',
      replaceLabelKey: 'saasapp.newServiceAccountJson',
      kind: 'multiline',
      required: true,
    },
    {
      name: 'impersonateAdminEmail',
      labelKey: 'field.adminEmail',
      kind: 'email',
      required: true,
    },
    {
      name: 'customerId',
      labelKey: 'saasapp.customerId',
      kind: 'text',
      required: false,
    },
  ],
  slack: [
    // `secret`, so it renders as a password input. The service-account JSON is a
    // visible textarea because it is a multi-line document an operator needs to
    // see they pasted whole; a single-line bearer token has no such need, and
    // hiding it removes it from screenshots and screen shares. Same direction as
    // the SEC-F2/SEC-F7 rule this file's consumers carry.
    {
      name: 'botToken',
      labelKey: 'saasapp.botToken',
      replaceLabelKey: 'saasapp.newBotToken',
      kind: 'secret',
      required: true,
    },
  ],
};

/**
 * The connector a fresh registration form starts on.
 *
 * The FIRST member of the key set, deliberately rather than a separate
 * constant: reordering the array then changes the default, and three E2E specs
 * fill the Google fields on first render and would red. A default that can move
 * silently is the thing being avoided; this one cannot.
 */
export const DEFAULT_CONNECTOR_APP_KEY: ConnectorAppKey = CONNECTOR_APP_KEYS[0];

export type CredentialRejection = 'invalidJson' | 'missingFields' | 'invalidToken' | 'invalidEmail';

const REJECTORS: Record<
  ConnectorAppKey,
  (values: Readonly<Record<string, string>>) => CredentialRejection | null
> = {
  'google-workspace': (values) =>
    rejectServiceAccountJson(values.serviceAccountJson ?? '') ??
    // The manager's inputs sit outside a `<form>` behind a `type="button"`, so
    // their `type="email"` and `required` attributes never trigger constraint
    // validation — review found the register form's browser-side check had no
    // counterpart there, and a malformed address reached storage and failed as
    // an audit row. Checked here, where both surfaces reach it.
    rejectAdminEmail(values.impersonateAdminEmail ?? ''),
  slack: (values) => rejectBotToken(values.botToken ?? ''),
};

/**
 * Rejects credentials the browser can already tell are wrong.
 *
 * This is not defence — `POST`/`PATCH /saas-apps` reject a blank required field
 * and the worker validates again. It is what keeps a wrong paste from being
 * SENT: four E2E specs assert zero requests to `/api/saas-apps` on a malformed
 * input, because credential material that never leaves the page cannot be logged
 * by anything in between.
 *
 * The API half of that sentence was untrue until review round 6 — `credentials`
 * was an unbounded string record with no field check, so this function was the
 * only enforcement anywhere and a direct call bypassed it (R49). The
 * server-side declaration is `REQUIRED_CREDENTIAL_FIELDS` in
 * apps/api/src/routes/saas-apps.ts, and the unit test below pins the two to
 * each other.
 *
 * A `Record<ConnectorAppKey, …>` like `CREDENTIAL_FIELDS`, and for the same
 * reason the header gives. This was an `if (key === 'google-workspace') … else`
 * — so a third connector silently inherited Slack's whitespace check, and every
 * app key that is NOT a connector key (`POST /contract-import` creates those
 * from CSV, and the seed ships `notion`) reached the same branch and was told
 * its credentials did not look like a bot token. Found in review.
 *
 * `null` for a key with no rejector: an application whose connector this
 * product does not have declares no credential fields either, so there is
 * nothing to reject and the caller renders no form.
 *
 * Every branch classifies and returns a symbol. Caught values are never read
 * for their text — `JSON.parse` echoes input snippets in its message, and a
 * pasted private key must not reach a React error overlay or a support
 * screenshot. See the header of SaasAppForm.tsx.
 */
export function rejectCredentials(
  key: string,
  values: Readonly<Record<string, string>>,
): CredentialRejection | null {
  // `Object.hasOwn`, not a bare index. `key` widened from `ConnectorAppKey` to
  // `string` when non-connector apps started reaching here, and an object
  // literal's members include `Object.prototype`'s — so `constructor`,
  // `toString` and `valueOf` all resolved to truthy inherited functions and were
  // CALLED. `app.key` is arbitrary tenant-supplied DB text (POST
  // /contract-import writes it from a CSV cell), so an application named
  // `constructor` was enough to reach it.
  const reject = Object.hasOwn(REJECTORS, key) ? REJECTORS[key as ConnectorAppKey] : undefined;
  return reject ? reject(values) : null;
}

function rejectServiceAccountJson(raw: string): CredentialRejection | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'invalidJson';
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return 'invalidJson';
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.client_email !== 'string' || typeof record.private_key !== 'string') {
    return 'missingFields';
  }
  return null;
}

/**
 * Whitespace, not a prefix.
 *
 * `xoxb-` is the bot-token prefix today, and checking it would catch the common
 * mistake of pasting a user (`xoxp-`) or app-level (`xapp-`) token. It is not
 * checked, because enumerating a vendor's token spellings is the surface-form
 * adjudication this repository keeps paying for (R47/SC60): Slack has changed
 * token formats before, and a rejected VALID token is a feature that cannot be
 * used, with the operator told their correct credential is wrong.
 *
 * What is checked is the failure a browser can decide on its own: a paste that
 * carried a newline or a surrounding space. That is a real and common error, and
 * it is decidable without knowing anything about the format.
 */
function rejectBotToken(raw: string): CredentialRejection | null {
  if (raw.trim() === '' || /\s/.test(raw)) {
    return 'invalidToken';
  }
  return null;
}

/**
 * The loosest check that catches a paste error without adjudicating an address.
 *
 * Deliberately not an RFC 5322 attempt: enumerating what an address may look
 * like is the surface-form problem `rejectBotToken` refuses for tokens, and a
 * rejected VALID address is the worse direction. One `@`, something either
 * side, and no whitespace.
 */
function rejectAdminEmail(raw: string): CredentialRejection | null {
  // The RAW value, not `raw.trim()`. Both forms post what the field holds, so
  // validating a trimmed copy accepted ' admin@corp.example ' and stored it —
  // and it is then the JWT subject, failing at Google as the audit row this
  // check exists to prevent. Its sibling `rejectBotToken` already refuses any
  // whitespace; the two now agree on which string is judged.
  return /^[^\s@]+@[^\s@]+$/.test(raw) ? null : 'invalidEmail';
}
