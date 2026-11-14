import { BASE, type Theme } from '../foundation/theme';
import { claude } from './claude';
import { discord } from './discord';
import { kakaotalk } from './kakaotalk';
import { slack } from './slack';

// By id, in the order they are offered.
export const THEMES = { base: BASE, claude, discord, slack, kakaotalk } satisfies Record<string, Theme>;
export type ThemeId = keyof typeof THEMES;
