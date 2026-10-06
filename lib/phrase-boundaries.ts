// Adapted from Paper Voice, commit 66d5dc1b7eb41bab93d4480a06535bd869ffb1af.
// Copyright (c) 2026 Yuan-Sen Ting. MIT; see THIRD_PARTY_NOTICES.md.
export function endsSentence(value: string): boolean {
  const text = value.trim().replace(/[”’"')\]]+$/, "");
  if (!/[.!?]$/.test(text)) return false;
  if (/[!?]$/.test(text)) return true;
  if (
    /(?:\b(?:e\.g|i\.e|et\s+al|figs?|eqs?|secs?|dr|mr|mrs|ms|prof|vs|cf|approx|nos?|vol|pp|refs?)|\b[A-Z]|\b(?:[A-Za-z]\.)+[A-Za-z])\.$/i.test(
      text,
    )
  )
    return false;
  return true;
}
