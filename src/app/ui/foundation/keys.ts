// Unspecified modifiers are ignored except Alt, which is always explicit so AltGr cannot trigger Ctrl shortcuts.
export type Chord = { key: string; shift?: boolean; mod?: boolean; alt?: boolean };

type KeyState = { isComposing: boolean; keyCode: number };
type Press = { key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; nativeEvent: KeyState };

// Never intercept IME composition keys: Enter/Esc belongs to the unfinished syllable, not send/close.
export const isComposing = (event: KeyState) => event.isComposing || event.keyCode === 229;

// A letter chord is written lower case and matches the letter typed or the key it sits on, so Shift (Z), a Korean
// input mode (ㅋ) and other layouts all reach it.
const LETTER = /^[a-z]$/;
const sameKey = (event: Press, key: string) =>
  LETTER.test(key) ? event.key.toLowerCase() === key || event.code === `Key${key.toUpperCase()}` : event.key === key;

const matches = (event: Press, { key, shift, mod, alt = false }: Chord) =>
  sameKey(event, key) && (shift === undefined || shift === event.shiftKey) && (mod === undefined || mod === (event.ctrlKey || event.metaKey)) && alt === event.altKey;

export function pressedKey(event: Press, chords: readonly Chord[]): number {
  if (isComposing(event.nativeEvent)) return -1;
  return chords.findIndex((chord) => matches(event, chord));
}

export const pressed = (event: Press, chords: readonly Chord[]) => pressedKey(event, chords) !== -1;

const NAMES: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

export const keyCaps = ({ key, shift, mod, alt }: Chord) => [...(mod ? ['Ctrl'] : []), ...(alt ? ['Alt'] : []), ...(shift ? ['Shift'] : []), NAMES[key] ?? (LETTER.test(key) ? key.toUpperCase() : key)];

export const formatKeys = (chords: readonly Chord[]) => chords.map((chord) => keyCaps(chord).join('+')).join(' ');
