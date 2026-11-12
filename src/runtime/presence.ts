import { grouped } from '../model/fields';
import { counts, marked, MINUTE, minuteOf, monthOf } from '../model/presence';
import { SETTINGS_ID } from '../model/settings';
import type { ObjectStore } from './store/store';

const LOOK_EVERY = 15_000;
const WRITE_EVERY = 5 * MINUTE;
const USES = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll'] as const;

// The presence object this device writes, so its tabs and visits share one a month instead of making one each.
export type PresenceMemory = { read: () => string | null; write: (id: string) => void };

// Storage refused keeps the id for this page only.
export function devicePresence(account: string): PresenceMemory {
  const key = `risu-alpha:presence:${account}`;
  let last: string | null = null;
  return {
    read: () => {
      try { return localStorage.getItem(key); } catch { return last; }
    },
    write: (id) => {
      last = id;
      try { localStorage.setItem(key, id); } catch { /* kept in last */ }
    },
  };
}

// Each write ORs into the copy the store holds and a conflict applies it again, so tabs writing one object at once lose
// no minute and count none twice.
export async function savePresence(store: ObjectStore, memory: PresenceMemory, minutes: readonly number[]): Promise<boolean> {
  for (const [start, those] of grouped(minutes, monthOf)) {
    const id = memory.read();
    const held = id ? store.get('presence', id) : null;
    let saved;
    if (held?.value.start === start) saved = await store.update('presence', held.id, (current) => marked(start, current, those));
    else {
      const made = crypto.randomUUID();
      memory.write(made);
      saved = await store.create('presence', marked(start, null, those), { id: made, parent: SETTINGS_ID });
    }
    if (!saved.ok) return false;
  }
  return true;
}

// Counts the minutes this page is visible and was used in the last five, and writes them every five minutes and when
// the page is hidden; minutes a write could not save wait for the next. Answers the stop.
export function recordPresence(store: ObjectStore, memory: PresenceMemory): () => void {
  const kept = new Set<number>();
  let used = -Infinity;
  let written = Date.now();
  let writing = false;
  const look = () => {
    const now = Date.now();
    if (counts(now, used, document.visibilityState === 'visible')) kept.add(minuteOf(now));
  };
  const use = () => {
    used = Date.now();
    look();
  };
  const write = () => {
    written = Date.now();
    if (writing || !kept.size) return;
    writing = true;
    const minutes = [...kept];
    void savePresence(store, memory, minutes).then((saved) => {
      if (saved) for (const minute of minutes) kept.delete(minute);
    }).finally(() => { writing = false; });
  };
  const tick = () => {
    look();
    if (Date.now() - written >= WRITE_EVERY) write();
  };
  const hidden = () => {
    if (document.visibilityState === 'hidden') write();
  };
  const timer = setInterval(tick, LOOK_EVERY);
  for (const name of USES) document.addEventListener(name, use, { capture: true, passive: true });
  document.addEventListener('visibilitychange', hidden);
  return () => {
    clearInterval(timer);
    for (const name of USES) document.removeEventListener(name, use, { capture: true });
    document.removeEventListener('visibilitychange', hidden);
  };
}
