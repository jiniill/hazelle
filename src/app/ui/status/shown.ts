// What a 상태 view is drawn from: the values already read and written out, so the kit knows no definition and no state.
export type StatusFrame = 'card' | 'hud' | 'diary' | 'line';
export type StatusMood = 'hazelle' | 'own' | 'paper' | 'neon' | 'forest' | 'rose' | 'terminal';
export type StatusTone = 'accent' | 'warm' | 'cool' | 'fresh';
export type MeterLook = 'bar' | 'segments' | 'ring' | 'hearts' | 'stars';

// The picture an app stands under on the 휴대폰's home, and what one is called before it has a name of its own.
export type StatusApp = 'messages' | 'contacts' | 'feed' | 'notes' | 'calendar' | 'map' | 'bag' | 'tasks' | 'money' | 'stats';
export const STATUS_APP: Record<StatusApp, string> = { messages: '메신저', contacts: '연락처', feed: 'SNS', notes: '메모', calendar: '달력', map: '지도', bag: '가방', tasks: '할 일', money: '지갑', stats: '능력치' };

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

// Where a value stands: a field of the definition, or of one record of a 묶음.
export type ShownPlace = { field: string; member?: { group: string; id: string } };
// Values that are edited by hand: label names the press on a field, by the field's name.
export type StatusEdit = { label: (name: string) => string; onEdit: (place: ShownPlace) => void };

// A 기록's row as a post: who wrote it, what it says, and the rest beside the name.
export type ShownPost = { lead: string; meta: string[]; body: string };
// A conversation of a 기록, its messages oldest first. mine: the reader sent it. from: who sent it, where that is not
// the conversation's own name. fresh: the latest reply added it. reply: what answering puts into the composer.
export type ShownMessage = { text: string; mine?: boolean; from?: string; meta: string[]; fresh?: boolean };
export type ShownThread = Named & { fresh: number; reply?: string; messages: ShownMessage[] };

export type ShownBlock =
  | { block: 'field'; field: ShownField }
  | { block: 'head'; id: string; items: (Named & { value: string })[] }
  | { block: 'radar'; id: string; axes: (Named & { share: number; value: string })[] }
  | { block: 'records'; id: string; name: string; look: 'cards' | 'rows' | 'table'; columns: Named[]; members: ShownRecord[] }
  | { block: 'log'; id: string; name: string; columns: Named[]; rows: string[][] }
  | { block: 'feed'; id: string; name: string; posts: ShownPost[] }
  | { block: 'chat'; id: string; name: string; threads: ShownThread[] }
  | { block: 'choices'; id: string; name: string; items: string[] }
  | { block: 'section'; id: string; name: string; blocks: ShownBlock[] }
  | { block: 'tabs'; id: string; tabs: (Named & { blocks: ShownBlock[] })[] };

// A field as a few words, where it has a cell or a line's room.
export function shortOf(field: ShownField): string {
  if (field.kind === 'list') return field.items.map(({ text }) => text).join(', ');
  return field.value;
}
