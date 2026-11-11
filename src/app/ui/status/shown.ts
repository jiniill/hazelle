// What a 상태 view is drawn from: the values already read and written out, so the kit knows no definition and no state.
export type StatusFrame = 'card' | 'hud' | 'diary' | 'line';
export type StatusMood = 'hazelle' | 'own' | 'paper' | 'neon' | 'forest' | 'rose' | 'terminal';
export type StatusTone = 'accent' | 'warm' | 'cool' | 'fresh';
export type MeterLook = 'bar' | 'segments' | 'ring' | 'hearts' | 'stars';

export const STATUS_FRAME: Record<StatusFrame, string> = { card: '카드', hud: '게임 HUD', diary: '일기장', line: '한 줄' };
export const STATUS_MOOD: Record<StatusMood, string> = { hazelle: '헤이젤', own: '내 색', paper: '종이', neon: '네온', forest: '숲', rose: '장미', terminal: '단말기' };

// What the latest reply moved a number by, written with its sign.
export type StatusDelta = { text: string; down: boolean };

type Named = { id: string; name: string };
// main (대표): drawn large. A value of '' is one not set yet.
type Common = Named & { main?: boolean; tone?: StatusTone; delta?: StatusDelta };
// share: where the value stands in its range, 0 to 1. zero: where 0 stands in a range across it; the fill then runs
// from there. steps: how many cells a look of cells draws.
export type ShownField = Common &
  (
    | { kind: 'gauge'; look: MeterLook; share: number; zero?: number; steps: number; value: string; max: string }
    | { kind: 'number'; value: string }
    | { kind: 'text'; value: string; thought?: boolean }
    | { kind: 'stage'; value: string; labels: string[]; scale?: boolean }
    | { kind: 'list'; items: { text: string; done?: boolean }[]; checked?: boolean }
  );

export type ShownRecord = Named & { fields: ShownField[] };

export type ShownBlock =
  | { block: 'field'; field: ShownField }
  | { block: 'head'; id: string; items: (Named & { value: string })[] }
  | { block: 'radar'; id: string; axes: (Named & { share: number; value: string })[] }
  | { block: 'records'; id: string; name: string; look: 'cards' | 'rows' | 'table'; columns: Named[]; members: ShownRecord[] }
  | { block: 'log'; id: string; name: string; columns: Named[]; rows: string[][] }
  | { block: 'choices'; id: string; name: string; items: string[] }
  | { block: 'section'; id: string; name: string; blocks: ShownBlock[] }
  | { block: 'tabs'; id: string; tabs: (Named & { blocks: ShownBlock[] })[] };

// A field as a few words, where it has a cell or a line's room.
export function shortOf(field: ShownField): string {
  if (field.kind === 'list') return field.items.map(({ text }) => text).join(', ');
  return field.value;
}
