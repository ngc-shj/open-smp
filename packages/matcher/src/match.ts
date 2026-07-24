import type { AccountView, IdentityView, LinkResult, MatchRule } from './types.js';

type RuleHit = {
  identity: IdentityView;
  confidence: number;
};

function deriveStatus(
  identity: IdentityView,
  account: AccountView,
): 'matched' | 'ghost' {
  if (identity.status === 'active') {
    return 'matched';
  }
  // identity.status === 'left'
  return account.accountStatus === 'active' ? 'ghost' : 'matched';
}

function matchAccount(
  account: AccountView,
  identities: IdentityView[],
  rules: MatchRule[],
): LinkResult {
  for (const rule of rules) {
    const hits: RuleHit[] = [];
    for (const identity of identities) {
      const outcome = rule.match(identity, account);
      if (outcome !== null) {
        hits.push({ identity, confidence: outcome.confidence });
      }
    }

    if (hits.length === 0) {
      continue;
    }

    // name-domain requires a unique candidate: a rule that fires for
    // multiple identities without ranking among them is not a "hit" here,
    // so control falls through to the next rule (there is none after
    // name-domain, so this yields orphan).
    if (rule.id === 'name-domain' && hits.length > 1) {
      continue;
    }

    if (hits.length >= 2) {
      const candidates = hits.map((hit) => ({
        identityId: hit.identity.id,
        displayName: hit.identity.displayName,
      }));
      return {
        saasAccountId: account.id,
        identityId: null,
        status: 'ambiguous',
        confidence: 0,
        ruleId: null,
        evidence: { rule: rule.id, matchedValue: account.email, candidates },
      };
    }

    const [hit] = hits;
    if (hit === undefined) {
      continue;
    }
    const status = deriveStatus(hit.identity, account);
    return {
      saasAccountId: account.id,
      identityId: hit.identity.id,
      status,
      confidence: hit.confidence,
      ruleId: rule.id,
      evidence: { rule: rule.id, matchedValue: account.email },
    };
  }

  return {
    saasAccountId: account.id,
    identityId: null,
    status: 'orphan',
    confidence: 0,
    ruleId: null,
    evidence: null,
  };
}

export function matchAccounts(
  identities: IdentityView[],
  accounts: AccountView[],
  rules: MatchRule[],
): LinkResult[] {
  return accounts.map((account) => matchAccount(account, identities, rules));
}
