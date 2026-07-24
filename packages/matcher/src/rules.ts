import { lowerEmail, normalizeEmail } from './normalize.js';
import type { AccountView, IdentityView, MatchRule } from './types.js';

function emailDomain(email: string): string {
  const lowered = lowerEmail(email);
  const atIndex = lowered.lastIndexOf('@');
  return atIndex === -1 ? '' : lowered.slice(atIndex + 1);
}

/** Case-insensitive exact match on the raw email, no alias stripping. */
export const exactEmailRule: MatchRule = {
  id: 'exact-email',
  match(identity: IdentityView, account: AccountView) {
    return lowerEmail(identity.primaryEmail) === lowerEmail(account.email)
      ? { confidence: 1.0 }
      : null;
  },
};

/** Match after alias normalization: +tag stripped, provider-aware dot-stripping. */
export const aliasNormalizedRule: MatchRule = {
  id: 'alias-normalized',
  match(identity: IdentityView, account: AccountView) {
    return normalizeEmail(identity.primaryEmail) === normalizeEmail(account.email)
      ? { confidence: 0.9 }
      : null;
  },
};

/** Match the account email against any of the identity's secondary emails. */
export const secondaryEmailRule: MatchRule = {
  id: 'secondary-email',
  match(identity: IdentityView, account: AccountView) {
    const normalizedAccountEmail = normalizeEmail(account.email);
    const hit = identity.secondaryEmails.some(
      (secondary) => normalizeEmail(secondary) === normalizedAccountEmail,
    );
    return hit ? { confidence: 0.85 } : null;
  },
};

/**
 * Match by display name plus matching email domain. Uniqueness (requiring
 * exactly one candidate identity) is enforced by the caller (matchAccounts),
 * since a single rule's pairwise match() cannot see the full candidate set.
 */
export const nameDomainRule: MatchRule = {
  id: 'name-domain',
  match(identity: IdentityView, account: AccountView) {
    const sameName = identity.displayName === account.displayName;
    const sameDomain = emailDomain(identity.primaryEmail) === emailDomain(account.email);
    return sameName && sameDomain ? { confidence: 0.5 } : null;
  },
};

export const defaultRules: MatchRule[] = [
  exactEmailRule,
  aliasNormalizedRule,
  secondaryEmailRule,
  nameDomainRule,
];
