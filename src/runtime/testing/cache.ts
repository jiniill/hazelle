import type { SealedChange } from '../../contracts/objects';
import { adoptable, cacheNewer, cacheRaises, cacheScope, GenerationChanged, REVISION_FIELDS, sameGeneration, type CacheRevisions, type CacheState, type CacheWrite, type DeviceCache, type Generation } from '../store/object-cache';

// The browser cache's compares, one synchronous step per operation as one IndexedDB transaction is.
export class MemoryCache implements DeviceCache {
  readonly rows = new Map<string, SealedChange>();
  readonly states = new Map<string, CacheState>();
  readonly revisions = { heads: new Map<string, number>(), revisions: new Map<string, number>() };
  generation: Generation | undefined;

  async open() {
    if (!this.generation) {
      this.wipe();
      this.generation = { id: crypto.randomUUID(), timeline: null };
    }
    const state = this.generation.timeline === null ? undefined : this.states.get('');
    const revisions: CacheRevisions = { heads: [...this.revisions.heads], revisions: [...this.revisions.revisions] };
    return structuredClone({ generation: this.generation, saved: state ? { state, changes: this.scope(''), revisions } : null });
  }

  async read(generation: Generation, chat: string) {
    if (!sameGeneration(this.generation, generation)) throw new GenerationChanged();
    const state = this.states.get(chat);
    return state ? structuredClone({ state, changes: this.scope(chat) }) : null;
  }

  async scopes(generation: Generation) {
    if (!sameGeneration(this.generation, generation)) throw new GenerationChanged();
    return structuredClone(new Map([...this.states].filter(([chat]) => chat !== '')));
  }

  async write(generation: Generation, write: CacheWrite) {
    if (!sameGeneration(this.generation, generation)) throw new GenerationChanged();
    const { changes, feed, raised, scopes } = structuredClone(write);
    for (const row of changes) if (cacheNewer(this.rows.get(row.id), row)) this.rows.set(row.id, row);
    if (feed) this.states.set('', feed);
    for (const field of REVISION_FIELDS) {
      for (const [key, rev] of raised[field]) if (cacheRaises(this.revisions[field].get(key), rev)) this.revisions[field].set(key, rev);
    }
    for (const scope of scopes ?? []) this.states.set(scope.chat, scope.state);
  }

  async clear(generation: Generation) {
    if (this.generation?.id !== generation.id) throw new GenerationChanged();
    this.wipe();
    this.generation = { id: crypto.randomUUID(), timeline: null };
    return { ...this.generation };
  }

  async adopt(generation: Generation, timeline: string) {
    if (!adoptable(this.generation, generation, timeline)) throw new GenerationChanged();
    this.generation = { id: generation.id, timeline };
    return { ...this.generation };
  }

  async forget() {
    this.wipe();
    this.generation = undefined;
  }

  private scope(chat: string) {
    return [...this.rows.values()].filter((row) => cacheScope(row) === chat);
  }

  private wipe() {
    this.rows.clear();
    this.states.clear();
    this.revisions.heads.clear();
    this.revisions.revisions.clear();
  }
}

// Two tabs' cache operations interleaved as a restore interleaves them, with what each one did. MemoryCache and the
// browser's IndexedDB cache (e2e/timeline.spec.ts) must both answer GENERATION_STEPS.
export async function generationSteps(cache: DeviceCache): Promise<string[]> {
  const said: string[] = [];
  const row = (id: string, rev: number): SealedChange => ({ id, kind: 'connection', parent: null, rev, body: 'sealed' });
  const feed = (cursor: number): CacheState => ({ cursor, complete: true, until: null, limits: null });
  const none: CacheRevisions = { heads: [], revisions: [] };
  const listed = (rows: [string, number][]) => `[${rows.map(([key, rev]) => `${key}=${rev}`).join(',')}]`;
  const opened = async (name: string) => {
    const { generation, saved } = await cache.open();
    const revisions = saved ? ` heads ${listed(saved.revisions.heads)} revisions ${listed(saved.revisions.revisions)}` : '';
    said.push(`${name}: ${generation.timeline ?? 'none'} [${saved?.changes.map(({ id }) => id).join(',') ?? ''}]${revisions}`);
    return generation;
  };
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      await run();
      said.push(`${name}: done`);
    } catch (error) {
      said.push(`${name}: ${error instanceof GenerationChanged ? 'changed' : 'failed'}`);
    }
  };
  const first = await opened('open');
  const adopted = await cache.adopt(first, 't1');
  await step('write t1', () => cache.write(adopted, { changes: [row('a', 1)], feed: feed(1), raised: { heads: [['chat', 2]], revisions: [['list', 2]] } }));
  await step('another tab writes lower and higher revisions', () => cache.write(adopted, { changes: [], raised: { heads: [['chat', 1]], revisions: [['list', 3]] } }));
  await step('another tab adopts the same timeline', () => cache.adopt(first, 't1'));
  await step('another tab adopts another timeline', () => cache.adopt(first, 't2'));
  await step('a write stating no timeline', () => cache.write(first, { changes: [row('b', 2)], feed: feed(2), raised: none }));
  await opened('reopen');
  const cleared = await cache.clear(adopted);
  said.push(`clear: ${cleared.id === adopted.id ? 'same' : 'new'} ${cleared.timeline ?? 'none'}`);
  await step('a delayed clear', () => cache.clear(adopted));
  await step('a delayed adopt', () => cache.adopt(adopted, 't1'));
  await step('a delayed write', () => cache.write(adopted, { changes: [row('c', 3)], feed: feed(3), raised: { heads: [['chat', 3]], revisions: [] } }));
  await step('a delayed read', () => cache.read(adopted, ''));
  await opened('after the clear');
  const next = await cache.adopt(cleared, 't2');
  await step('write t2', () => cache.write(next, { changes: [row('d', 1)], feed: feed(1), raised: none }));
  said.push(`read t2: [${(await cache.read(next, ''))?.changes.map(({ id }) => id).join(',')}]`);
  await opened('reopen t2');
  await cache.forget();
  await opened('after forget');
  return said;
}

export const GENERATION_STEPS = [
  'open: none []',
  'write t1: done',
  'another tab writes lower and higher revisions: done',
  'another tab adopts the same timeline: done',
  'another tab adopts another timeline: changed',
  'a write stating no timeline: changed',
  'reopen: t1 [a] heads [chat=2] revisions [list=3]',
  'clear: new none',
  'a delayed clear: changed',
  'a delayed adopt: changed',
  'a delayed write: changed',
  'a delayed read: changed',
  'after the clear: none []',
  'write t2: done',
  'read t2: [d]',
  'reopen t2: t2 [d] heads [] revisions []',
  'after forget: none []',
];
