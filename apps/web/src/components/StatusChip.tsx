const CHIP_CLASSES: Record<string, string> = {
  orphan: 'status-chip status-chip-orphan',
  ghost: 'status-chip status-chip-ghost',
  matched: 'status-chip status-chip-matched',
  ambiguous: 'status-chip status-chip-ambiguous',
};

export function StatusChip({ status }: { status: string }) {
  const className = CHIP_CLASSES[status] ?? 'status-chip bg-neutral-100 text-neutral-700';
  return <span className={className}>{status}</span>;
}
