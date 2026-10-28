import { draftEncryptionKey, openDraft, sealDraft } from '../vault/drafts';
import type { VaultKey } from '../vault/keys';
import { draftCache } from './device-cache';

export class DeviceDrafts {
  readonly ready: Promise<void>;
  private readonly cache;
  private readonly key: Promise<CryptoKey>;
  private readonly dirty = new Set<string>();
  private readonly unreadable = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing = Promise.resolve();
  private loaded = false;

  constructor(private readonly account: string, vaultKey: VaultKey, private readonly texts: ReadonlyMap<string, string>, restore: (key: string, text: string) => void) {
    this.cache = draftCache(account);
    this.key = draftEncryptionKey(vaultKey);
    this.ready = Promise.all([this.key, this.cache.read()]).then(async ([key, rows]) => {
      for (const [id, body] of rows) {
        const text = await openDraft(key, account, id, body);
        if (text === null) this.unreadable.add(id);
        else restore(id, text);
      }
      this.loaded = true;
    }).catch(() => {});
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    for (const key of texts.keys()) this.changed(key);
  }

  changed(key: string) {
    this.dirty.add(key);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 500);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.writing = this.writing.then(async () => {
      // Loading must merge before a write snapshots text typed while the read was pending.
      await this.ready;
      if (!this.loaded || this.cache.forgotten) return;
      const key = await this.key;
      const rows = [...this.dirty].filter((id) => !this.unreadable.has(id)).map(async (id) => {
        const text = this.texts.get(id);
        return [id, text ? await sealDraft(key, this.account, id, text) : null] as const;
      });
      this.dirty.clear();
      if (rows.length) await this.cache.write(await Promise.all(rows));
    }).catch(() => {});
    return this.writing;
  }

  close(): Promise<void> {
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    return this.flush();
  }

  private readonly onPageHide = () => { void this.flush(); };
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void this.flush();
  };
}
