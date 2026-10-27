import type { CSSProperties } from 'react';

// kind: the metrics a face reads at (ChatFrame.module.css) and its heading in the picker.
export type FontKind = 'serif' | 'sans' | 'hand';
export const FONT_KIND: Record<FontKind, string> = { serif: '명조', sans: '고딕', hand: '손글씨' };

type Font = { label: string; kind: FontKind; load?: () => Promise<unknown> };

// Keep stored serif/sans ids mapped to 고운바탕/IBM Plex, never reinterpret as kinds.
// Each id needs --font-<id> in tokens.css; only bundled/default faces load eagerly.
export const FONTS = {
  serif: { label: '고운바탕', kind: 'serif' },
  'nanum-myeongjo': { label: '나눔명조', kind: 'serif', load: () => Promise.all([import('@fontsource/nanum-myeongjo/400.css'), import('@fontsource/nanum-myeongjo/700.css')]) },
  'noto-serif': { label: '노토 세리프', kind: 'serif', load: () => Promise.all([import('@fontsource/noto-serif-kr/400.css'), import('@fontsource/noto-serif-kr/700.css')]) },
  hahmlet: { label: '함렛', kind: 'serif', load: () => Promise.all([import('@fontsource/hahmlet/400.css'), import('@fontsource/hahmlet/700.css')]) },
  sans: { label: 'IBM 플렉스', kind: 'sans' },
  pretendard: { label: '프리텐다드', kind: 'sans', load: () => import('pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css') },
  'noto-sans': { label: '노토 산스', kind: 'sans', load: () => Promise.all([import('@fontsource/noto-sans-kr/400.css'), import('@fontsource/noto-sans-kr/700.css')]) },
  'gowun-dodum': { label: '고운돋움', kind: 'sans', load: () => import('@fontsource/gowun-dodum/400.css') },
  system: { label: '기기 글꼴', kind: 'sans' },
  'nanum-pen': { label: '나눔 펜', kind: 'hand', load: () => import('@fontsource/nanum-pen-script/400.css') },
  gaegu: { label: '개구', kind: 'hand', load: () => Promise.all([import('@fontsource/gaegu/400.css'), import('@fontsource/gaegu/700.css')]) },
} satisfies Record<string, Font>;

export type FontId = keyof typeof FONTS;
export const FONT_IDS = Object.keys(FONTS) as FontId[];

const fetched = new Set<FontId>();

export function loadFont(id: FontId) {
  const { load } = FONTS[id] as Font;
  if (!load || fetched.has(id)) return;
  fetched.add(id);
  load().catch(() => fetched.delete(id));
}

// --prose-font on the element whose text reads in the face, and --prose-grow for a hand face drawn small at its size
// (tokens.css --font-<id>-grow). A render may call it: loading once is all it does.
export function faceStyle(id: FontId): CSSProperties {
  loadFont(id);
  return { '--prose-font': `var(--font-${id})`, '--prose-grow': `var(--font-${id}-grow, 0px)` } as CSSProperties;
}
