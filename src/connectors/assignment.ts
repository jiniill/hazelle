import { entryKey, type Model, type Modality, type Starred } from './types';

// Role fallbacks end at chat except embeddings, which are global-only to keep vectors comparable.
// Task prompts own their model choice and otherwise use auxiliary.
export type Role = 'main' | 'aux' | 'embed';

export const ROLES: Record<Role, { needs: Modality; fallsBackTo: Role | null }> = {
  main: { needs: 'text', fallsBackTo: null },
  aux: { needs: 'text', fallsBackTo: 'main' },
  embed: { needs: 'embedding', fallsBackTo: null },
};

// model: the entry's key (types entryKey), not the id the provider is sent.
export type ModelRef = { connection: string; model: string };
export type Assignment = Partial<Record<Role, ModelRef>>;

export const refOf = (connection: string, model: Starred): ModelRef => ({ connection, model: entryKey(model) });

export const sameModelRef = (a: ModelRef, b: ModelRef): boolean => a.connection === b.connection && a.model === b.model;

export const rolesOf = (assignment: Assignment, ref: ModelRef): Role[] => (Object.keys(ROLES) as Role[]).filter((role) => assignment[role] && sameModelRef(assignment[role], ref));

// Resolve every layer for a role before falling back to another role; global auxiliary outranks chat-local chat.
export function resolveRole(role: Role, layers: Assignment[]): ModelRef | null {
  for (const layer of layers) {
    const choice = layer[role];
    if (choice) return choice;
  }
  const next = ROLES[role].fallsBackTo;
  return next ? resolveRole(next, layers) : null;
}

// A model whose output the catalog does not describe is offered: unknown is not "no".
export function fitsRole(model: Model, role: Role): boolean {
  return model.output === null || model.output.includes(ROLES[role].needs);
}
