// iOS Safari offers the user's contact card on a field whose label or placeholder it reads as their details (메시지
// does) and ignores autocomplete=off for it; a field named search is the one it leaves alone.
export const NO_AUTOFILL = { autoComplete: 'off', name: 'search' } as const;
