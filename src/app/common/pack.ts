import type { Pack } from '../../engine/import/types';
import { isToggle } from '../../model/prompt';
import { ASSET, SCRIPTS } from './words';

export const counted = (counts: [string, number][]) => counts.flatMap(([label, count]) => (count > 0 ? [`${label} ${count}개`] : []));
const scriptCounts = ({ regex, triggers }: { regex: number; triggers: number }) => counted([[SCRIPTS.regex, regex], [SCRIPTS.triggers, triggers]]);

export const scriptHolds = ({ regex, triggers }: Pick<Pack, 'regex' | 'triggers'>): string => scriptCounts({ regex: regex.length, triggers: triggers.length }).join(' · ');

export type PackParts = { lore: number; regex: number; triggers: number; toggles: number; assets: number; style: boolean };

// A pack's lorebook and assets are stored apart from it, so their counts are given.
export const packParts = (pack: Pack, lore: number, assets: number): PackParts => ({
  lore,
  regex: pack.regex.length,
  triggers: pack.triggers.length,
  toggles: pack.toggles.filter(isToggle).length,
  assets,
  style: !!pack.background,
});

export function holdsLine({ lore, regex, triggers, toggles, assets, style }: PackParts): string {
  const held = [...counted([['로어북', lore]]), ...scriptCounts({ regex, triggers }), ...counted([['토글', toggles], [ASSET, assets]]), ...(style ? ['스타일'] : [])];
  return held.length > 0 ? held.join(' · ') : '안에 담긴 항목이 없어요';
}

export const packHolds = (pack: Pack, lore: number, assets: number): string => holdsLine(packParts(pack, lore, assets));
