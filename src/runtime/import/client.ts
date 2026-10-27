import type { PresetRead } from '../../engine/import/preset';
import type { ImportedTool } from '../../engine/import/tool';
import type { BackupResult, Imported, ImportedModule, ImportResult, RisuCharacter, RisuChat } from '../../engine/import/types';
import { ImportReadError, ImportStuck, type AssetRead, type ChatsRead, type Down, type Method, type ModuleData, type Replies, type Request, type Up } from './protocol';
import { PendingRequests } from '../pending-requests';
import { Heartbeat, moduleWorker } from '../worker';
import workerUrl from './worker?worker&url';

// STUCK_MS bounds one progress unit (parse/unpack), not a whole large file read.
// Use LOAD_MS before the worker first answers; reads answer pings between units.
const STUCK_MS = 8_000;
const LOAD_MS = 20_000;

export class ImportWorker {
  private worker: Worker | null = null;
  private closed = false;
  private limit = LOAD_MS;
  private readonly pending = new PendingRequests<Replies[Method]>();
  private readonly heart = new Heartbeat(() => this.worker?.postMessage({ ping: true } satisfies Down), () => this.end(new ImportStuck('stuck')));

  async card(file: File, asModule: boolean): Promise<ImportResult | ChatsRead | { ok: true; tool: ImportedTool } | { ok: true; preset: PresetRead }> {
    const result = await this.ask({ kind: 'card', file, asModule });
    if (!result.ok || 'tool' in result || 'preset' in result || 'chat' in result || 'risuChats' in result) return result;
    if ('module' in result) return { ok: true, module: this.module(result.module) };
    if ('persona' in result) {
      const { picture, ...persona } = result.persona;
      return { ok: true, persona: { ...persona, picture: () => this.ask({ kind: 'picture', handle: picture }) } };
    }
    const { avatar, assets, bundled, ...card } = result.card;
    return { ok: true, card: { ...card, avatar: avatar === null ? null : await this.ask({ kind: 'picture', handle: avatar }), assets: this.assets(assets), bundled: bundled.map((module) => this.module(module)) } };
  }

  async backup(files: File[]): Promise<BackupResult> {
    const result = await this.ask({ kind: 'backup', files });
    if (!result.ok) return result;
    return { ok: true, backup: {
      catalog: result.catalog,
      character: (key) => this.character(key),
      persona: async (key) => {
        const { picture, module, ...persona } = await this.ask({ kind: 'persona', key });
        return { ...persona, picture: () => this.ask({ kind: 'picture', handle: picture }), module: module && this.module(module) };
      },
      preset: (key) => this.ask({ kind: 'preset', key }),
      module: async (key) => this.module(await this.ask({ kind: 'module', key })),
    } };
  }

  close() {
    this.end(new ImportReadError('closed'));
  }

  private async character(key: number): Promise<RisuCharacter> {
    const { avatar, assets, chatCount, ...character } = await this.ask({ kind: 'character', key });
    const chats: RisuChat[] = [];
    try {
      for (let index = 0; index < chatCount; index++) {
        const { header, messages: count } = await this.ask({ kind: 'chat', index });
        const messages: RisuChat['messages'] = [];
        for (let from = 0; from < count; ) {
          const page = await this.ask({ kind: 'messages', index, from });
          messages.push(...page.messages);
          from = page.next;
        }
        chats.push({ ...header, messages });
      }
    } finally {
      if (!this.closed) await this.ask({ kind: 'release' });
    }
    return { ...character, chats, avatar: () => this.ask({ kind: 'picture', handle: avatar }), assets: this.assets(assets) };
  }

  private assets(reads: AssetRead[]): Imported['assets'] {
    return reads.map(({ name, handle }) => ({ name, read: () => this.ask({ kind: 'asset', handle }) }));
  }

  private module<M extends ModuleData>({ assets, ...module }: M): Omit<M, 'assets'> & Pick<ImportedModule, 'assets'> {
    return { ...module, assets: this.assets(assets) };
  }

  private ask<K extends Method>(request: Request<K>): Promise<Replies[K]> {
    if (this.closed) return Promise.reject(new ImportReadError('closed'));
    const { id, promise } = this.pending.add();
    try {
      this.open().postMessage({ id, request } satisfies Down<K>);
      this.heart.start(this.limit);
    } catch (error) {
      this.end(new ImportReadError(error instanceof Error ? error.message : String(error)));
    }
    return promise as Promise<Replies[K]>;
  }

  private open(): Worker {
    if (this.worker) return this.worker;
    const worker = moduleWorker(workerUrl);
    worker.onmessage = ({ data }: MessageEvent<Up>) => {
      this.limit = STUCK_MS;
      this.heart.answered();
      if ('error' in data) this.pending.take(data.id)?.reject(new ImportReadError(data.error));
      else if ('result' in data) this.pending.take(data.id)?.resolve(data.result);
      if (this.pending.size) this.heart.start(this.limit);
      else this.heart.rest();
    };
    worker.onerror = (error) => this.end(new ImportReadError(error.message));
    worker.onmessageerror = () => this.end(new ImportReadError('unreadable worker message'));
    this.worker = worker;
    return worker;
  }

  private end(error: ImportReadError) {
    this.closed = true;
    this.heart.rest();
    this.worker?.terminate();
    this.worker = null;
    this.pending.rejectAll(() => error);
  }
}
