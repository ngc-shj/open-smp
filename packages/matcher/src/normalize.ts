const DOT_STRIPPED_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Lowercases a raw email. This is the sole sanctioned way to lowercase a raw
 * email outside normalizeEmail() itself — routing every raw-email lowercasing
 * through here keeps normalization single-sourced (see C4 forbidden patterns).
 */
export function lowerEmail(email: string): string {
  return email.toLowerCase();
}

/**
 * Normalizes an email for alias-insensitive comparison:
 * lowercase -> strip "+tag" from the local part -> provider-aware
 * dot-stripping (Gmail/Googlemail only) in the local part.
 */
export function normalizeEmail(email: string): string {
  const lowered = lowerEmail(email);
  const atIndex = lowered.lastIndexOf('@');
  if (atIndex === -1) {
    return lowered;
  }

  const local = lowered.slice(0, atIndex);
  const domain = lowered.slice(atIndex + 1);

  const plusIndex = local.indexOf('+');
  const untagged = plusIndex === -1 ? local : local.slice(0, plusIndex);

  const normalizedLocal = DOT_STRIPPED_DOMAINS.has(domain)
    ? untagged.replaceAll('.', '')
    : untagged;

  return `${normalizedLocal}@${domain}`;
}
