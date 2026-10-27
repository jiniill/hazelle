import type { Stored } from '../../model/kinds';

export function aliased(name: string, alias: string | undefined): string {
  const note = alias?.trim();
  return note ? `${name} · ${note}` : name;
}

type Named = { name: string; alias?: string };

// One order wherever personas are faces to pick from, so each keeps its place.
const byName = (a: Named, b: Named) => a.name.localeCompare(b.name, 'ko') || (a.alias ?? '').localeCompare(b.alias ?? '', 'ko');

// The line under a face: its 별명, or, when another shares its name, that it has none, since the 별명 is what tells them
// apart.
function aliasNotes(people: readonly Named[]): { note: string; faint: boolean }[] {
  const counts = new Map<string, number>();
  for (const { name } of people) counts.set(name, (counts.get(name) ?? 0) + 1);
  return people.map(({ name, alias }) => {
    const note = alias?.trim();
    if (note) return { note, faint: false };
    return counts.get(name)! > 1 ? { note: '별명 없음', faint: true } : { note: '', faint: false };
  });
}

export type PersonaFace = { persona: Stored<'persona'>; note: string; faint: boolean };

export function personaFaces(personas: readonly Stored<'persona'>[]): PersonaFace[] {
  const sorted = personas.toSorted((a, b) => byName(a.value, b.value));
  const notes = aliasNotes(sorted.map(({ value }) => value));
  return sorted.map((persona, index) => ({ persona, ...notes[index]! }));
}

export const personaTexts = ({ persona: { value } }: PersonaFace) => [value.name, value.alias ?? ''];
