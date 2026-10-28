import { ChangeSignal } from '../change-signal';
import { pictureRef, type PictureKind, type PictureUrl } from '../engine/assets';
import { toBase64 } from '../vault/aead';
import { PERMANENT, type Files } from './files';
import type { ObjectStore } from './store';

const INACTIVE_BYTES = 32 * 1024 * 1024;
type Cached = { url: string | null; bytes: number; owners: Set<string>; removed: boolean };
// url is undefined until read, and for a picture that is gone or unreadable.
type AssetView = { url: PictureUrl; hold: () => () => void };

const KINDS = new Set<string>(['asset', 'inlay', 'illustration', 'avatar'] satisfies PictureKind[]);

// Mounted views pin their pictures. Only inactive URLs compete for the byte-bounded LRU; a large currently visible
// picture must never disappear just because another picture was read.
export class AssetUrls {
  // Null while reading, and for a permanent failure. A transient failure is forgotten so the next draw retries it.
  private readonly urls = new Map<string, Cached>();
  // By pictureRef: the file each stored picture showed.
  private readonly sources = new Map<string, string>();
  private readonly pins = new Map<string, number>();
  private readonly inactive = new Map<string, Cached>();
  private inactiveBytes = 0;
  private readonly changes = new ChangeSignal();
  private readonly unsubscribe: () => void;
  private version = 0;
  private closed = false;

  constructor(
    private readonly store: Pick<ObjectStore, 'get' | 'subscribe'>,
    private readonly files: Pick<Files, 'read'>,
    private readonly budget = INACTIVE_BYTES,
  ) {
    this.unsubscribe = store.subscribe((changes) => {
      let changed = false;
      for (const { kind, id } of changes) {
        if (!KINDS.has(kind)) continue;
        const ref = pictureRef(kind as PictureKind, id);
        const file = this.sources.get(ref);
        if (!file || store.get(kind as PictureKind, id)?.value.file.id === file) continue;
        this.sources.delete(ref);
        const cached = this.urls.get(file)!;
        cached.owners.delete(ref);
        if (!cached.owners.size) {
          cached.removed = true;
          // Removal invalidates new lookups immediately, but a mounted view keeps its old URL until it leaves.
          if (!this.pins.has(file)) this.evict(file, cached);
        }
        changed = true;
      }
      if (changed) this.changed();
    });
  }

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.version;

  // Render-time views hold nothing until committed mount; cleanup releases resolved files.
  // Allow reactivation because StrictMode replays mount effects.
  view(): AssetView {
    const files = new Set<string>();
    let held = false;
    let generation = 0;
    return {
      url: (kind, id) => this.lookup(kind, id, (file) => {
        if (files.has(file)) return;
        files.add(file);
        if (held) this.pin(file);
      }),
      hold: () => {
        const mounting = ++generation;
        if (!held && !this.closed) {
          held = true;
          for (const file of files) this.pin(file);
        }
        return () => {
          // New owners and StrictMode's replay must hold before any old owner can revoke a shared URL.
          queueMicrotask(() => {
            if (!held || mounting !== generation) return;
            held = false;
            for (const file of files) this.release(file);
          });
        };
      },
    };
  }

  private lookup(kind: PictureKind, id: string, named: (file: string) => void): string | undefined {
    if (this.closed) return undefined;
    const picture = this.store.get(kind, id)?.value;
    if (!picture) return undefined;
    const { file, type } = picture;
    const ref = pictureRef(kind, id);
    named(file.id);
    let cached = this.urls.get(file.id);
    if (!cached) {
      cached = { url: null, bytes: 0, owners: new Set(), removed: false };
      this.urls.set(file.id, cached);
      const loading = cached;
      void this.files.read(file).then((read) => {
        if (this.closed || this.urls.get(file.id) !== loading) return;
        if (!read.ok) {
          if (!PERMANENT.has(read.error)) this.evict(file.id, loading);
          return;
        }
        loading.url = URL.createObjectURL(new Blob([read.data], { type }));
        loading.bytes = read.data.byteLength;
        if (!this.pins.has(file.id)) this.rest(file.id, loading);
        this.changed();
      });
    }
    cached.removed = false;
    cached.owners.add(ref);
    this.sources.set(ref, file.id);
    if (this.inactive.delete(file.id)) this.inactive.set(file.id, cached);
    return cached.url ?? undefined;
  }

  private pin(file: string) {
    const count = this.pins.get(file) ?? 0;
    this.pins.set(file, count + 1);
    if (count === 0) this.wake(file);
  }

  private release(file: string) {
    const count = this.pins.get(file);
    if (count === undefined) return;
    if (count > 1) return void this.pins.set(file, count - 1);
    this.pins.delete(file);
    const cached = this.urls.get(file);
    if (cached) this.rest(file, cached);
  }

  private wake(file: string) {
    const cached = this.inactive.get(file);
    if (!cached) return;
    this.inactiveBytes -= cached.bytes;
    this.inactive.delete(file);
  }

  private rest(file: string, cached: Cached) {
    if (cached.removed) return this.evict(file, cached);
    if (!cached.url || this.inactive.has(file)) return;
    this.inactive.set(file, cached);
    this.inactiveBytes += cached.bytes;
    while (this.inactiveBytes > this.budget) {
      const [oldest, entry] = this.inactive.entries().next().value!;
      this.evict(oldest, entry);
    }
  }

  private evict(file: string, cached: Cached) {
    this.wake(file);
    this.urls.delete(file);
    for (const ref of cached.owners) if (this.sources.get(ref) === file) this.sources.delete(ref);
    if (cached.url) URL.revokeObjectURL(cached.url);
  }

  private changed() {
    this.version++;
    this.changes.notify();
  }

  close() {
    this.closed = true;
    this.unsubscribe();
    for (const [file, cached] of this.urls) this.evict(file, cached);
    this.pins.clear();
    this.changes.clear();
  }
}

const NONE: ReadonlySet<string> = new Set();

// The asset names the open chats' displays found no picture for, by the chat's character, as this session met them. Not
// stored: a name is met again when its chat is shown.
export class UnfoundAssets {
  private readonly names = new Map<string, ReadonlySet<string>>();
  private readonly changes = new ChangeSignal();

  readonly subscribe = this.changes.subscribe;

  add(character: string, names: readonly string[]) {
    const held = this.names.get(character) ?? NONE;
    const fresh = names.filter((name) => !held.has(name));
    if (!fresh.length) return;
    this.names.set(character, new Set([...held, ...fresh]));
    this.changes.notify();
  }

  readonly of = (character: string): ReadonlySet<string> => this.names.get(character) ?? NONE;
}

// Each picture's file as a data: URL by its pictureRef, for a page that outlives this one's blob: URLs. missing: pictures
// gone or unreadable.
export async function assetDataUrls(store: Pick<ObjectStore, 'get'>, files: Pick<Files, 'read'>, pictures: Iterable<{ kind: PictureKind; id: string }>): Promise<{ urls: Map<string, string>; missing: number }> {
  const urls = new Map<string, string>();
  let missing = 0;
  for (const { kind, id } of pictures) {
    const picture = store.get(kind, id)?.value;
    const read = picture && (await files.read(picture.file));
    if (picture && read?.ok) urls.set(pictureRef(kind, id), `data:${picture.type};base64,${toBase64(read.data)}`);
    else missing++;
  }
  return { urls, missing };
}
