import { BASE, type Theme } from '../foundation/theme';
import { channel } from './channel';
import { work } from './work';

// By id, in the order they are offered.
export const THEMES = { base: BASE, channel, work } satisfies Record<string, Theme>;
export type ThemeId = keyof typeof THEMES;
