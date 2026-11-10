import type { BackupCatalog } from '../../engine/import/types';
import type { MovePick, MoveStep } from '../../runtime/import/move';

export type Ticks = { characters: boolean[]; personas: boolean[]; presets: boolean[]; modules: boolean[] };
export type Have = { characters: ReadonlySet<string>; modules: ReadonlySet<string> };

export const hasModule = (have: Have, risu: string | null): boolean => risu !== null && have.modules.has(risu);

// What can be ticked, which is also what starts ticked: a character or module already brought from Risu and a preset
// the importer refused cannot.
export function tickable(backup: BackupCatalog, have: Have): Ticks {
  return {
    characters: backup.characters.map((character) => !have.characters.has(character.id)),
    personas: backup.personas.map(() => true),
    presets: backup.presets.map((preset) => preset.failure === null),
    modules: backup.modules.map((module) => !hasModule(have, module.risu)),
  };
}

export function toPick(backup: BackupCatalog, ticks: Ticks): MovePick {
  return {
    characters: backup.characters.filter((_, index) => ticks.characters[index]),
    personas: backup.personas.filter((_, index) => ticks.personas[index]),
    presets: backup.presets.filter((_, index) => ticks.presets[index]),
    modules: backup.modules.filter((_, index) => ticks.modules[index]),
  };
}

export const tickCount = (ticks: Ticks): number => Object.values(ticks).flat().filter(Boolean).length;

// The steps a pick runs, in the move's order (runtime/import/move): a kind with nothing picked never reports. inlays: whether
// the inlay export came with the backups, whose pictures the chats then bring.
export function stepsOf({ characters, personas, presets, modules }: MovePick, inlays: boolean): MoveStep['kind'][] {
  const pictures = [...modules, ...characters].some(({ assetCount }) => assetCount > 0) || (inlays && characters.some(({ inlayCount }) => inlayCount > 0));
  return [
    ...(personas.length ? ['personas' as const] : []),
    ...(modules.length ? ['modules' as const] : []),
    ...(presets.length ? ['prompts' as const] : []),
    ...(characters.length ? ['characters' as const] : []),
    ...(characters.some(({ chatCount }) => chatCount > 0) ? ['chats' as const] : []),
    ...(pictures ? ['pictures' as const] : []),
  ];
}
