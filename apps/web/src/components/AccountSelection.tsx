'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslator } from '@/lib/i18n/locale-context';
import { BulkLabelBar } from './BulkLabelBar';

type SelectionContextValue = {
  selected: ReadonlySet<string>;
  toggle: (accountId: string) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

/**
 * The accounts page is a server component, so selection state lives in this
 * client wrapper: the page renders rows inside it and each row's checkbox
 * reads the shared set through context. Keeping the table server-rendered
 * matters — it is what lets the label filter stay a plain URL parameter.
 */
export function AccountSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((accountId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(() => ({ selected, toggle }), [selected, toggle]);
  const selectedIds = useMemo(() => [...selected], [selected]);

  return (
    <SelectionContext.Provider value={value}>
      <div className="mb-4">
        <BulkLabelBar selectedIds={selectedIds} onApplied={clear} />
      </div>
      {children}
    </SelectionContext.Provider>
  );
}

export function AccountSelectCheckbox({ accountId }: { accountId: string }) {
  const t = useTranslator();
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error('AccountSelectCheckbox must be rendered inside AccountSelectionProvider');
  }

  return (
    <input
      type="checkbox"
      // A PARAMETERISED KEY, not `t('table.select') + ' ' + accountId`: a
      // sentence assembled from fragments is what the dictionary exists to
      // avoid, and it does not survive a language whose word order differs.
      //
      // This was the one copy attribute of twelve that never reached `t()`, and
      // C2's ratchet could not report it — the attribute scan matches a quoted
      // literal, and a JSX expression attribute never matches. Under `ja` a
      // screen-reader user got "Select <uuid>" on every row of the page the
      // plan measured as the largest copy surface.
      aria-label={t('table.selectAccount', { account: accountId })}
      checked={context.selected.has(accountId)}
      onChange={() => context.toggle(accountId)}
      className="h-3.5 w-3.5 rounded border-neutral-300"
    />
  );
}
