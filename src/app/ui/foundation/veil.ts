import { createContext, useContext, useSyncExternalStore } from 'react';
import { ChangeSignal } from '../../../change-signal';

// An empty data: address, which a browser fetches nothing for, and the story takes as the app's own.
const UNREAD = 'data:,';
// A veiled picture's address in a story: its own once read, and until then one that loads nothing. Either ends in the
// picture's key, so the veil knows the picture whatever its address is then.
export const veiledSource = (key: string, url: string | undefined) => `${url ?? UNREAD}#${key}`;
export const unread = (source: string) => source.startsWith(`${UNREAD}#`);
const keyOf = (source: string) => ((unread(source) || source.startsWith('blob:')) && source.includes('#') ? source.slice(source.indexOf('#') + 1) : source);

// Which pictures were tapped open, for this veil only: turned on again, 이미지 가리기 covers everything again.
export class Veil {
  private readonly opened = new Set<string>();
  private readonly changes = new ChangeSignal();
  private taps = 0;

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.taps;

  shows(source: string) {
    return this.opened.has(keyOf(source));
  }

  open(source: string) {
    const key = keyOf(source);
    if (this.opened.has(key)) return;
    this.opened.add(key);
    this.tapped();
  }

  cover(source: string) {
    if (this.opened.delete(keyOf(source))) this.tapped();
  }

  private tapped() {
    this.taps++;
    this.changes.notify();
  }
}

// Null shows pictures.
export const VeilContext = createContext<Veil | null>(null);

export const useVeil = () => useContext(VeilContext);

const never = () => () => {};
const none = () => 0;

// The veil, drawn again with each picture opened or covered; taps moves with them, for what depends on which are open.
export function useVeilTaps() {
  const veil = useVeil();
  const taps = useSyncExternalStore(veil?.subscribe ?? never, veil?.snapshot ?? none, veil?.snapshot ?? none);
  return { veil, taps };
}
