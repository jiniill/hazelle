import { vaultSubkey } from '../vault/aead';
import type { VaultKey } from '../vault/keys';
import { openObject, sealObject } from '../vault/objects';
import type { BrowserLogCache, LogWrite } from './device-cache';
import { PAGE_BUILD } from './installation';
import type { LogEntry } from './request-log';

// Across the account's chats; each chat's own bound is RequestLog's.
export const DEVICE_LOG_ENTRIES = 200;

const address = (chat: string, call: string) => ({ id: call, kind: 'request-log', parent: chat });

// This device's copy of the request log, sealed under a key of its own and never sent anywhere. A build reads only the
// rows its own build wrote: an entry's shape follows the code, so a row of another build is gone, never upgraded. Writes
// wait out a burst (a reply's record, then its attachments); a page that closes within it loses that call.
export class DeviceLog {
  private readonly key: Promise<CryptoKey>;
  private readonly dirty = new Map<string, { chat: string; call: string; entry: LogEntry | null }>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing = Promise.resolve();

  constructor(private readonly account: string, vaultKey: VaultKey, private readonly cache: BrowserLogCache) {
    this.key = vaultSubkey(vaultKey, 'risu-alpha request log v1');
  }

  // Oldest first; a row that cannot be read is left out.
  async read(chat: string): Promise<LogEntry[]> {
    const [key, rows] = await Promise.all([this.key, this.cache.read(chat)]);
    const opened = await Promise.all(rows.filter(([, row]) => row.build === PAGE_BUILD).map(([call, row]) => openObject(key, this.account, address(chat, call), row.body)));
    return (opened.filter((entry) => entry !== undefined) as LogEntry[]).sort((a, b) => a.at - b.at);
  }

  put(chat: string, entry: LogEntry) {
    this.mark(chat, entry.receipt.id, entry);
  }

  drop(chat: string, call: string) {
    this.mark(chat, call, null);
  }

  private mark(chat: string, call: string, entry: LogEntry | null) {
    this.dirty.set(JSON.stringify([chat, call]), { chat, call, entry });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 500);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    const rows = [...this.dirty.values()];
    this.dirty.clear();
    if (!rows.length) return this.writing;
    this.writing = this.writing.then(async () => {
      const key = await this.key;
      const writes = await Promise.all(rows.map(async ({ chat, call, entry }): Promise<LogWrite> => ({
        chat,
        call,
        row: entry && { account: this.account, at: entry.at, build: PAGE_BUILD, body: await sealObject(key, this.account, address(chat, call), entry) },
      })));
      await this.cache.write(writes, DEVICE_LOG_ENTRIES);
    }).catch(() => {});
    return this.writing;
  }

  close(): Promise<void> {
    return this.flush();
  }
}
