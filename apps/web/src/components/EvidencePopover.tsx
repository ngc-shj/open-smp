import type { AccountLink } from '@/lib/api-types';

// AMBIGUOUS links never resolve to a single identity (C1 CHECK, C4 F2) — the
// evidence renders the tied candidate list only, never link.identityName.
export function EvidencePopover({ link }: { link: AccountLink | null }) {
  if (!link || !link.evidence) {
    return <span className="text-xs text-neutral-400">—</span>;
  }

  const { evidence, status } = link;

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-neutral-600 hover:text-neutral-900">
        {link.ruleId ?? evidence.rule}
      </summary>
      <div className="mt-1 max-w-xs rounded-md border border-neutral-200 bg-white p-2 shadow-sm">
        <dl className="space-y-1">
          <div>
            <dt className="inline font-medium text-neutral-700">rule: </dt>
            <dd className="inline text-neutral-600">{evidence.rule}</dd>
          </div>
          {status === 'ambiguous' ? (
            <div>
              <dt className="font-medium text-neutral-700">candidates:</dt>
              <dd>
                <ul className="list-inside list-disc text-neutral-600">
                  {(evidence.candidates ?? []).map((candidate) => (
                    <li key={candidate}>{candidate}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : (
            <div>
              <dt className="inline font-medium text-neutral-700">matched: </dt>
              <dd className="inline text-neutral-600">{evidence.matchedValue}</dd>
            </div>
          )}
        </dl>
      </div>
    </details>
  );
}
