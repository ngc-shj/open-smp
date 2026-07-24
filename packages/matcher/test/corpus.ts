import type { AccountView, IdentityView, LinkResult } from '../src/index.js';

export type CorpusCase = {
  name: string;
  identities: IdentityView[];
  accounts: AccountView[];
  expected: Array<Pick<LinkResult, 'saasAccountId' | 'status'>>;
  knownGap?: boolean;
};

function identity(overrides: Partial<IdentityView> & { id: string; primaryEmail: string }): IdentityView {
  return {
    secondaryEmails: [],
    displayName: 'Unnamed Person',
    status: 'active',
    leftAt: null,
    ...overrides,
  };
}

function account(overrides: Partial<AccountView> & { id: string; email: string }): AccountView {
  return {
    displayName: 'Unnamed Person',
    accountStatus: 'active',
    ...overrides,
  };
}

// Each case is a fully isolated identities/accounts universe so that expected
// per-account statuses are unambiguous and independent of other cases.
export const corpus: CorpusCase[] = [
  // --- exact-email matches ---
  {
    name: 'exact email match, active identity',
    identities: [identity({ id: 'i1', primaryEmail: 'alice@example.com', displayName: 'Alice Smith' })],
    accounts: [account({ id: 'a1', email: 'alice@example.com', displayName: 'Alice Smith' })],
    expected: [{ saasAccountId: 'a1', status: 'matched' }],
  },
  {
    name: 'exact email match is case-insensitive',
    identities: [identity({ id: 'i2', primaryEmail: 'bob@example.com', displayName: 'Bob Lee' })],
    accounts: [account({ id: 'a2', email: 'BOB@EXAMPLE.COM', displayName: 'Bob Lee' })],
    expected: [{ saasAccountId: 'a2', status: 'matched' }],
  },
  {
    name: 'exact email match, mixed case on both sides',
    identities: [identity({ id: 'i3', primaryEmail: 'Carol.King@Example.com', displayName: 'Carol King' })],
    accounts: [account({ id: 'a3', email: 'carol.king@example.com', displayName: 'Carol King' })],
    expected: [{ saasAccountId: 'a3', status: 'matched' }],
  },

  // --- alias-normalized: +tag ---
  {
    name: '+tag stripped, generic domain',
    identities: [identity({ id: 'i4', primaryEmail: 'dave@example.com', displayName: 'Dave Chen' })],
    accounts: [account({ id: 'a4', email: 'dave+saas@example.com', displayName: 'Dave Chen' })],
    expected: [{ saasAccountId: 'a4', status: 'matched' }],
  },
  {
    name: '+tag stripped, gmail domain',
    identities: [identity({ id: 'i5', primaryEmail: 'erin@gmail.com', displayName: 'Erin Wu' })],
    accounts: [account({ id: 'a5', email: 'erin+newsletter@gmail.com', displayName: 'Erin Wu' })],
    expected: [{ saasAccountId: 'a5', status: 'matched' }],
  },

  // --- alias-normalized: gmail dot-stripping ---
  {
    name: 'gmail dot-stripping matches dotted vs undotted local part',
    identities: [identity({ id: 'i6', primaryEmail: 'frank.moore@gmail.com', displayName: 'Frank Moore' })],
    accounts: [account({ id: 'a6', email: 'frankmoore@gmail.com', displayName: 'Frank Moore' })],
    expected: [{ saasAccountId: 'a6', status: 'matched' }],
  },
  {
    name: 'googlemail.com dot-stripping also applies',
    identities: [identity({ id: 'i7', primaryEmail: 'g.race.hall@googlemail.com', displayName: 'Grace Hall' })],
    accounts: [account({ id: 'a7', email: 'gracehall@googlemail.com', displayName: 'Grace Hall' })],
    expected: [{ saasAccountId: 'a7', status: 'matched' }],
  },
  {
    name: 'dot-stripping does NOT apply outside gmail/googlemail (stays orphan)',
    // Display names deliberately differ so the name-domain rule cannot
    // accidentally match this pair; this case isolates alias-normalized only.
    identities: [identity({ id: 'i8', primaryEmail: 'h.enry.ford@example.com', displayName: 'Henry Ford' })],
    accounts: [account({ id: 'a8', email: 'henryford@example.com', displayName: 'H. Ford (SaaS)' })],
    expected: [{ saasAccountId: 'a8', status: 'orphan' }],
  },
  {
    name: 'gmail dot-stripping plus +tag combined',
    identities: [identity({ id: 'i9', primaryEmail: 'i.v.y.chen@gmail.com', displayName: 'Ivy Chen' })],
    accounts: [account({ id: 'a9', email: 'ivychen+work@gmail.com', displayName: 'Ivy Chen' })],
    expected: [{ saasAccountId: 'a9', status: 'matched' }],
  },

  // --- secondary-email matches (aliases on file, renamed domains, shared inbox handoff) ---
  {
    name: 'secondary email match (alias domain on file)',
    identities: [
      identity({
        id: 'i10',
        primaryEmail: 'jane.doe@example.com',
        secondaryEmails: ['jane.doe@old-example.com'],
        displayName: 'Jane Doe',
      }),
    ],
    accounts: [account({ id: 'a10', email: 'jane.doe@old-example.com', displayName: 'Jane Doe' })],
    expected: [{ saasAccountId: 'a10', status: 'matched' }],
  },
  {
    name: 'secondary email match, normalized comparison (gmail alias in secondary list)',
    identities: [
      identity({
        id: 'i11',
        primaryEmail: 'kyle.park@example.com',
        secondaryEmails: ['kyle.park@gmail.com'],
        displayName: 'Kyle Park',
      }),
    ],
    accounts: [account({ id: 'a11', email: 'kylepark+saas@gmail.com', displayName: 'Kyle Park' })],
    expected: [{ saasAccountId: 'a11', status: 'matched' }],
  },

  // --- old-surname cases (T7-A labeling rule) ---
  {
    name: 'old-surname case WITH old address in secondary_emails -> matched',
    identities: [
      identity({
        id: 'i12',
        primaryEmail: 'lisa.nguyen@example.com',
        secondaryEmails: ['lisa.tran@example.com'],
        displayName: 'Lisa Nguyen',
      }),
    ],
    accounts: [account({ id: 'a12', email: 'lisa.tran@example.com', displayName: 'Lisa Tran' })],
    expected: [{ saasAccountId: 'a12', status: 'matched' }],
  },
  {
    name: 'old-surname case with NO secondary email on file -> orphan (known MVP gap)',
    identities: [
      identity({
        id: 'i13',
        primaryEmail: 'megan.oconnor@example.com',
        secondaryEmails: [],
        displayName: 'Megan OConnor',
      }),
    ],
    accounts: [account({ id: 'a13', email: 'megan.brooks@example.com', displayName: 'Megan Brooks' })],
    expected: [{ saasAccountId: 'a13', status: 'orphan' }],
    knownGap: true,
  },
  {
    name: 'second old-surname case with no secondary email on file -> orphan (known MVP gap)',
    identities: [
      identity({
        id: 'i14',
        primaryEmail: 'nora.kim@example.com',
        secondaryEmails: [],
        displayName: 'Nora Kim',
      }),
    ],
    accounts: [account({ id: 'a14', email: 'nora.singh@example.com', displayName: 'Nora Singh' })],
    expected: [{ saasAccountId: 'a14', status: 'orphan' }],
    knownGap: true,
  },

  // --- renamed accounts (display name changed, email unchanged -> still exact/alias match) ---
  {
    name: 'renamed account display name does not block exact-email match',
    identities: [identity({ id: 'i15', primaryEmail: 'oscar.diaz@example.com', displayName: 'Oscar Diaz' })],
    accounts: [account({ id: 'a15', email: 'oscar.diaz@example.com', displayName: 'O. Diaz (renamed)' })],
    expected: [{ saasAccountId: 'a15', status: 'matched' }],
  },

  // --- retired employees (ghost: rule hit + left + account active) ---
  {
    name: 'retired employee, account still active -> ghost',
    identities: [
      identity({
        id: 'i16',
        primaryEmail: 'paul.evans@example.com',
        displayName: 'Paul Evans',
        status: 'left',
        leftAt: '2026-01-15',
      }),
    ],
    accounts: [account({ id: 'a16', email: 'paul.evans@example.com', displayName: 'Paul Evans', accountStatus: 'active' })],
    expected: [{ saasAccountId: 'a16', status: 'ghost' }],
  },
  {
    name: 'retired employee, account suspended -> matched (already offboarded)',
    identities: [
      identity({
        id: 'i17',
        primaryEmail: 'quinn.baker@example.com',
        displayName: 'Quinn Baker',
        status: 'left',
        leftAt: '2026-02-01',
      }),
    ],
    accounts: [account({ id: 'a17', email: 'quinn.baker@example.com', displayName: 'Quinn Baker', accountStatus: 'suspended' })],
    expected: [{ saasAccountId: 'a17', status: 'matched' }],
  },
  {
    name: 'retired employee, account archived -> matched (already offboarded)',
    identities: [
      identity({
        id: 'i18',
        primaryEmail: 'ray.foster@example.com',
        displayName: 'Ray Foster',
        status: 'left',
        leftAt: '2026-03-10',
      }),
    ],
    accounts: [account({ id: 'a18', email: 'ray.foster@example.com', displayName: 'Ray Foster', accountStatus: 'archived' })],
    expected: [{ saasAccountId: 'a18', status: 'matched' }],
  },
  {
    name: 'retired employee matched via alias-normalized rule, account active -> ghost',
    identities: [
      identity({
        id: 'i19',
        primaryEmail: 'sara.diaz@gmail.com',
        displayName: 'Sara Diaz',
        status: 'left',
        leftAt: '2026-04-01',
      }),
    ],
    accounts: [account({ id: 'a19', email: 'sara.diaz+old@gmail.com', displayName: 'Sara Diaz', accountStatus: 'active' })],
    expected: [{ saasAccountId: 'a19', status: 'ghost' }],
  },
  {
    name: 'retired employee matched via secondary-email rule, account active -> ghost',
    identities: [
      identity({
        id: 'i20',
        primaryEmail: 'tom.reilly@example.com',
        secondaryEmails: ['tom.reilly@old-example.com'],
        displayName: 'Tom Reilly',
        status: 'left',
        leftAt: '2026-05-05',
      }),
    ],
    accounts: [account({ id: 'a20', email: 'tom.reilly@old-example.com', displayName: 'Tom Reilly', accountStatus: 'active' })],
    expected: [{ saasAccountId: 'a20', status: 'ghost' }],
  },

  // --- shared mailboxes (no HR identity owns them -> orphan) ---
  {
    name: 'shared mailbox with no matching identity -> orphan',
    identities: [identity({ id: 'i21', primaryEmail: 'uma.watts@example.com', displayName: 'Uma Watts' })],
    accounts: [account({ id: 'a21', email: 'support@example.com', displayName: 'Support Team' })],
    expected: [{ saasAccountId: 'a21', status: 'orphan' }],
  },
  {
    name: 'shared mailbox billing@ with no matching identity -> orphan',
    identities: [identity({ id: 'i22', primaryEmail: 'victor.hale@example.com', displayName: 'Victor Hale' })],
    accounts: [account({ id: 'a22', email: 'billing@example.com', displayName: 'Billing' })],
    expected: [{ saasAccountId: 'a22', status: 'orphan' }],
  },

  // --- duplicate HR rows (two identities pointing at overlapping emails -> ambiguous) ---
  {
    name: 'duplicate HR rows produce equal-confidence exact-email hits -> ambiguous',
    identities: [
      identity({ id: 'i23a', primaryEmail: 'wendy.moss@example.com', displayName: 'Wendy Moss' }),
      identity({ id: 'i23b', primaryEmail: 'wendy.moss@example.com', displayName: 'Wendy Moss (dup HR row)' }),
    ],
    accounts: [account({ id: 'a23', email: 'wendy.moss@example.com', displayName: 'Wendy Moss' })],
    expected: [{ saasAccountId: 'a23', status: 'ambiguous' }],
  },
  {
    name: 'duplicate HR rows via alias-normalized rule -> ambiguous',
    identities: [
      identity({ id: 'i24a', primaryEmail: 'xavier.lund@gmail.com', displayName: 'Xavier Lund' }),
      identity({ id: 'i24b', primaryEmail: 'x.avier.lund@gmail.com', displayName: 'Xavier Lund (dup HR row)' }),
    ],
    accounts: [account({ id: 'a24', email: 'xavierlund@gmail.com', displayName: 'Xavier Lund' })],
    expected: [{ saasAccountId: 'a24', status: 'ambiguous' }],
  },
  {
    name: 'duplicate HR rows via secondary-email rule -> ambiguous',
    identities: [
      identity({
        id: 'i25a',
        primaryEmail: 'yara.hunt@example.com',
        secondaryEmails: ['yara.h@old-example.com'],
        displayName: 'Yara Hunt',
      }),
      identity({
        id: 'i25b',
        primaryEmail: 'yara.hunt.hr2@example.com',
        secondaryEmails: ['yara.h@old-example.com'],
        displayName: 'Yara Hunt (dup HR row)',
      }),
    ],
    accounts: [account({ id: 'a25', email: 'yara.h@old-example.com', displayName: 'Yara Hunt' })],
    expected: [{ saasAccountId: 'a25', status: 'ambiguous' }],
  },

  // --- name-domain rule (0.5, requires unique candidate) ---
  {
    name: 'name-domain match: same display name and email domain, different local part, unique candidate',
    identities: [identity({ id: 'i26', primaryEmail: 'zack.ellis@example.com', displayName: 'Zack Ellis' })],
    accounts: [account({ id: 'a26', email: 'z.ellis.saas@example.com', displayName: 'Zack Ellis' })],
    expected: [{ saasAccountId: 'a26', status: 'matched' }],
  },
  {
    name: 'name-domain rule requires unique candidate: two identities share name+domain -> orphan (no fallback rule)',
    identities: [
      identity({ id: 'i27a', primaryEmail: 'amy.roth@example.com', displayName: 'Amy Roth' }),
      identity({ id: 'i27b', primaryEmail: 'amy.roth2@example.com', displayName: 'Amy Roth' }),
    ],
    accounts: [account({ id: 'a27', email: 'amyroth.saas@example.com', displayName: 'Amy Roth' })],
    expected: [{ saasAccountId: 'a27', status: 'orphan' }],
  },
  {
    name: 'name-domain match on a left identity with active account -> ghost',
    identities: [
      identity({
        id: 'i28',
        primaryEmail: 'ben.foley@example.com',
        displayName: 'Ben Foley',
        status: 'left',
        leftAt: '2026-06-01',
      }),
    ],
    accounts: [account({ id: 'a28', email: 'benfoley.tools@example.com', displayName: 'Ben Foley', accountStatus: 'active' })],
    expected: [{ saasAccountId: 'a28', status: 'ghost' }],
  },
  {
    name: 'name-domain does not match across differing domains -> orphan',
    identities: [identity({ id: 'i29', primaryEmail: 'cara.nash@example.com', displayName: 'Cara Nash' })],
    accounts: [account({ id: 'a29', email: 'cara.nash@othercorp.com', displayName: 'Cara Nash' })],
    expected: [{ saasAccountId: 'a29', status: 'orphan' }],
  },

  // --- rule precedence: higher-priority rule wins over a lower one that would also match ---
  {
    name: 'exact-email takes precedence over name-domain when both would match',
    identities: [identity({ id: 'i30', primaryEmail: 'dan.silva@example.com', displayName: 'Dan Silva' })],
    accounts: [account({ id: 'a30', email: 'dan.silva@example.com', displayName: 'Dan Silva' })],
    expected: [{ saasAccountId: 'a30', status: 'matched' }],
  },
  {
    name: 'alias-normalized takes precedence over secondary-email when both would match',
    identities: [
      identity({
        id: 'i31',
        primaryEmail: 'ella.chan@gmail.com',
        secondaryEmails: ['ella.chan+saas@gmail.com'],
        displayName: 'Ella Chan',
      }),
    ],
    accounts: [account({ id: 'a31', email: 'ellachan+saas@gmail.com', displayName: 'Ella Chan' })],
    expected: [{ saasAccountId: 'a31', status: 'matched' }],
  },
  {
    name: 'secondary-email takes precedence over name-domain when both would match',
    identities: [
      identity({
        id: 'i32',
        primaryEmail: 'finn.osei@example.com',
        secondaryEmails: ['finn.legacy@example.com'],
        displayName: 'Finn Osei',
      }),
    ],
    accounts: [account({ id: 'a32', email: 'finn.legacy@example.com', displayName: 'Finn Osei' })],
    expected: [{ saasAccountId: 'a32', status: 'matched' }],
  },

  // --- no match at all ---
  {
    name: 'completely unrelated account -> orphan',
    identities: [identity({ id: 'i33', primaryEmail: 'gina.patel@example.com', displayName: 'Gina Patel' })],
    accounts: [account({ id: 'a33', email: 'random.user@unrelated.com', displayName: 'Random User' })],
    expected: [{ saasAccountId: 'a33', status: 'orphan' }],
  },
  {
    name: 'empty identity roster -> orphan',
    identities: [],
    accounts: [account({ id: 'a34', email: 'hank.diaz@example.com', displayName: 'Hank Diaz' })],
    expected: [{ saasAccountId: 'a34', status: 'orphan' }],
  },

  // --- multi-account universes exercising several rules together ---
  {
    name: 'mixed universe: exact, alias, secondary, name-domain, ambiguous, orphan all in one run',
    identities: [
      identity({ id: 'i35a', primaryEmail: 'ida.brooks@example.com', displayName: 'Ida Brooks' }),
      identity({
        id: 'i35b',
        primaryEmail: 'jon.pierce@gmail.com',
        displayName: 'Jon Pierce',
      }),
      identity({
        id: 'i35c',
        primaryEmail: 'kim.oakes@example.com',
        secondaryEmails: ['kim.oakes@old-example.com'],
        displayName: 'Kim Oakes',
      }),
      identity({ id: 'i35d', primaryEmail: 'liam.ward@example.com', displayName: 'Liam Ward' }),
      identity({ id: 'i35e', primaryEmail: 'mira.solis@example.com', displayName: 'Mira Solis' }),
      identity({ id: 'i35f', primaryEmail: 'mira.solis2@example.com', displayName: 'Mira Solis' }),
    ],
    accounts: [
      account({ id: 'a35-1', email: 'ida.brooks@example.com', displayName: 'Ida Brooks' }),
      account({ id: 'a35-2', email: 'jonpierce+work@gmail.com', displayName: 'Jon Pierce' }),
      account({ id: 'a35-3', email: 'kim.oakes@old-example.com', displayName: 'Kim Oakes' }),
      account({ id: 'a35-4', email: 'l.ward.saas@example.com', displayName: 'Liam Ward' }),
      account({ id: 'a35-5', email: 'mirasolis.tools@example.com', displayName: 'Mira Solis' }),
      account({ id: 'a35-6', email: 'no.one@nowhere.com', displayName: 'No One' }),
    ],
    expected: [
      { saasAccountId: 'a35-1', status: 'matched' },
      { saasAccountId: 'a35-2', status: 'matched' },
      { saasAccountId: 'a35-3', status: 'matched' },
      { saasAccountId: 'a35-4', status: 'matched' },
      { saasAccountId: 'a35-5', status: 'orphan' },
      { saasAccountId: 'a35-6', status: 'orphan' },
    ],
  },
  {
    name: 'suspended account with active identity -> matched (not ghost; status only downgrades for left identities)',
    identities: [identity({ id: 'i36', primaryEmail: 'nate.frey@example.com', displayName: 'Nate Frey' })],
    accounts: [account({ id: 'a36', email: 'nate.frey@example.com', displayName: 'Nate Frey', accountStatus: 'suspended' })],
    expected: [{ saasAccountId: 'a36', status: 'matched' }],
  },
  {
    name: 'archived account with active identity -> matched',
    identities: [identity({ id: 'i37', primaryEmail: 'opal.reid@example.com', displayName: 'Opal Reid' })],
    accounts: [account({ id: 'a37', email: 'opal.reid@example.com', displayName: 'Opal Reid', accountStatus: 'archived' })],
    expected: [{ saasAccountId: 'a37', status: 'matched' }],
  },
  {
    name: 'third old-surname case with no secondary email on file -> orphan (known MVP gap)',
    identities: [
      identity({
        id: 'i38',
        primaryEmail: 'priya.rao@example.com',
        secondaryEmails: [],
        displayName: 'Priya Rao',
      }),
    ],
    accounts: [account({ id: 'a38', email: 'priya.varma@example.com', displayName: 'Priya Varma' })],
    expected: [{ saasAccountId: 'a38', status: 'orphan' }],
    knownGap: true,
  },
  {
    name: 'two identities share display name but only one shares the account domain -> unique name-domain match',
    identities: [
      identity({ id: 'i39a', primaryEmail: 'quincy.tate@example.com', displayName: 'Quincy Tate' }),
      identity({ id: 'i39b', primaryEmail: 'quincy.tate@othercorp.com', displayName: 'Quincy Tate' }),
    ],
    accounts: [account({ id: 'a39', email: 'q.tate.saas@example.com', displayName: 'Quincy Tate' })],
    expected: [{ saasAccountId: 'a39', status: 'matched' }],
  },
  {
    name: 'secondary email list with multiple entries, only one matches',
    identities: [
      identity({
        id: 'i40',
        primaryEmail: 'rosa.kane@example.com',
        secondaryEmails: ['rosa.old1@example.com', 'rosa.old2@example.com'],
        displayName: 'Rosa Kane',
      }),
    ],
    accounts: [account({ id: 'a40', email: 'rosa.old2@example.com', displayName: 'Rosa Kane' })],
    expected: [{ saasAccountId: 'a40', status: 'matched' }],
  },
  {
    name: 'fourth old-surname case with no secondary email on file -> orphan (known MVP gap)',
    identities: [
      identity({
        id: 'i41',
        primaryEmail: 'sam.dela@example.com',
        secondaryEmails: [],
        displayName: 'Sam Dela',
      }),
    ],
    accounts: [account({ id: 'a41', email: 'sam.cruz@example.com', displayName: 'Sam Cruz' })],
    expected: [{ saasAccountId: 'a41', status: 'orphan' }],
    knownGap: true,
  },
  {
    name: 'left identity matched via name-domain rule, account suspended -> matched (offboarded)',
    identities: [
      identity({
        id: 'i42',
        primaryEmail: 'tara.voss@example.com',
        displayName: 'Tara Voss',
        status: 'left',
        leftAt: '2026-07-01',
      }),
    ],
    accounts: [account({ id: 'a42', email: 't.voss.tools@example.com', displayName: 'Tara Voss', accountStatus: 'suspended' })],
    expected: [{ saasAccountId: 'a42', status: 'matched' }],
  },
];

export const knownGapCount = corpus.filter((c) => c.knownGap === true).length;
export const knownGapRatio = knownGapCount / corpus.length;
