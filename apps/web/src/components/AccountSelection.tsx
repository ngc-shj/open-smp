'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
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
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error('AccountSelectCheckbox must be rendered inside AccountSelectionProvider');
  }

  return (
    <input
      type="checkbox"
      aria-label={`Select ${accountId}`}
      checked={context.selected.has(accountId)}
      onChange={() => context.toggle(accountId)}
      className="h-3.5 w-3.5 rounded border-neutral-300"
    />
  );
}
