// Shared page size for every list surface (accounts, events, identity detail).
// Previously duplicated as a literal in each route; a single constant keeps the
// three in step, since a divergence would silently change what "one page"
// means depending on which endpoint the client asked.
export const PAGE_SIZE = 50;
