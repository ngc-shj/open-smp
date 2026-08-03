import type { AccountStatus, LinkStatus } from '@open-smp/api-types';

export type IdentityView = {
  id: string;
  primaryEmail: string;
  secondaryEmails: string[];
  displayName: string;
  status: 'active' | 'left';
  leftAt: string | null;
};

export type AccountView = {
  id: string;
  email: string;
  displayName: string;
  accountStatus: AccountStatus;
};

export type MatchRule = {
  id: string; // 'exact-email' | 'alias-normalized' | 'secondary-email' | 'name-domain'
  match(identity: IdentityView, account: AccountView): { confidence: number } | null;
};

export type LinkResult = {
  saasAccountId: string;
  identityId: string | null; // ALWAYS null for status 'orphan' and 'ambiguous'
  status: LinkStatus;
  confidence: number; // 0 when orphan
  ruleId: string | null;
  evidence: {
    rule: string;
    matchedValue: string;
    candidates?: { identityId: string; displayName: string }[];
  } | null;
};
