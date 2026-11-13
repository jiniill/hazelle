export type Mode = 'dark' | 'light';
export type Bg = 'base' | 'gray' | 'blue' | 'green' | 'brown';
export type Ink = 'base' | 'bright' | 'soft';
export type Accent = 'base' | 'rose' | 'blue' | 'green' | 'violet';
export type Dialogue = 'base' | 'plain' | 'sky' | 'rose' | 'lime';

export const MODE: Record<Mode, string> = { dark: '어둡게', light: '밝게' };
// Each pick has a color per mode in tokens.css (--color-pick-*); base keeps the mode's own.
export const BG: Record<Bg, string> = { base: '기본', gray: '회색', blue: '파랑', green: '초록', brown: '갈색' };
export const INK: Record<Ink, string> = { base: '기본', bright: '선명하게', soft: '부드럽게' };
export const ACCENT: Record<Accent, string> = { base: '기본', rose: '분홍', blue: '파랑', green: '초록', violet: '보라' };
export const DIALOGUE: Record<Dialogue, string> = { base: '기본', plain: '무채색', sky: '하늘', rose: '분홍', lime: '연두' };

export type Scheme = { mode: Mode; bg: Bg; ink: Ink; accent: Accent; dialogue: Dialogue };

// tokens.css turns its color tokens by these, on the document or on an element drawn in another scheme.
export const schemeAttributes = ({ mode, bg, ink, accent, dialogue }: Scheme) => ({ 'data-mode': mode, 'data-bg': bg, 'data-ink': ink, 'data-accent': accent, 'data-dialogue': dialogue });

export function applyScheme(scheme: Scheme) {
  for (const [name, value] of Object.entries(schemeAttributes(scheme))) document.documentElement.setAttribute(name, value);
}
