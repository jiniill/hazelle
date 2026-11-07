import type { Stored } from '../../model/kinds';
import { groupCopies, latestFirst, type Copied, type Grouped } from './copies';
import type { PromptUse } from './usePromptUse';

// Only conversation prompts are filed (user ruling, 2026-10-17): the other kinds stay flat.
export const promptFolder = ({ value }: Stored<'prompt'>) => (value.task === undefined ? (value.folder ?? null) : null);

export const byPromptName = (a: Stored<'prompt'>, b: Stored<'prompt'>) => a.value.name.localeCompare(b.value.name, 'ko');

const PROMPT: Copied<Stored<'prompt'>> = { id: (prompt) => prompt.id, origin: (prompt) => prompt.value.origin?.id, folder: promptFolder };

// A prompt's copies stand under it by name.
export function groupPrompts(prompts: readonly Stored<'prompt'>[]): Grouped<Stored<'prompt'>> {
  const grouped = groupCopies(prompts, PROMPT);
  for (const group of grouped.copies.values()) group.sort(byPromptName);
  return grouped;
}

// The unused go last by name.
export function byLastUse(uses: ReadonlyMap<string, PromptUse>, copies: ReadonlyMap<string, readonly Stored<'prompt'>[]>) {
  const latest = latestFirst(PROMPT, (prompt) => uses.get(prompt.id)?.at ?? null, copies);
  return (a: Stored<'prompt'>, b: Stored<'prompt'>) => latest(a, b) || byPromptName(a, b);
}
