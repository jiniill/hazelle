import { readToolFile } from '../../engine/import/risu-plugin';
import { TOOL_FILE_BYTES } from '../../engine/import/tool';
import { readBackup } from '../../engine/import/backup';
import { unpackZip } from '../../engine/import/archive';
import { importCard, importRisum } from '../../engine/import/card';
import { importPreset, isPresetFile, presetJson, type PresetResult } from '../../engine/import/preset';
import { risuChatFile } from '../../engine/import/risu-character';
import { originalParts, risumParts, type Part } from '../../engine/import/original';
import { fileSource } from '../../engine/import/source';
import { readChatFile } from '../chat-file';
import type { Imported, ImportedModule, Picture, RisuBackup, RisuChat } from '../../engine/import/types';
import { MESSAGE_BYTES, MESSAGE_PAGE, type AssetRead, type CardData, type Method, type ModuleData, type PartRead, type Replies, type Request } from './protocol';


// Its other failures go as details, which the app's DETAIL_FAILURE words.
const presetReply = (read: PresetResult): Replies['card'] =>
  read.ok ? { ok: true, preset: { prompt: read.prompt, regex: read.regex, unsupported: read.unsupported } } : { ok: false, failure: read.failure.kind === 'unreadable' ? { kind: 'unreadable', detail: read.failure.detail } : { kind: 'unreadable', detail: read.failure.kind } };

// A JSON read by its shape, as a file of chats or a preset; null for any other, which importCard then reads as a card,
// parsing it again.
function shapedJson(bytes: Uint8Array<ArrayBuffer>): Replies['card'] | null {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const read = readChatFile(json);
  if (read.ok) return { ok: true, chat: read.file };
  if (read.error === 'other-version') return { ok: false, failure: { kind: 'unreadable', detail: read.error } };
  const risu = risuChatFile(json);
  if (risu) return { ok: true, risuChats: risu.chats, missed: risu.missed };
  const preset = presetJson(json);
  return preset && presetReply(preset);
}

export class ImportReader {
  private backup: RisuBackup | null = null;
  private chats: RisuChat[] = [];
  private next = 0;
  private assets = new Map<number, Imported['assets'][number]['read']>();
  private pictures = new Map<number, () => Promise<Picture | null>>();
  // The last card file, for its original: a .risum is read in slices, any other file is held whole by its reads.
  private opened: (() => Promise<Part[]>) | null = null;

  async handle(request: Request): Promise<Replies[Method]> {
    switch (request.kind) {
      case 'backup': {
        this.clear();
        this.backup = null;
        const result = await readBackup(request.files.map(fileSource));
        if (!result.ok) return result;
        this.backup = result.backup;
        return { ok: true, catalog: result.backup.catalog };
      }
      case 'card': {
        this.clear();
        this.backup = null;
        if (request.file.name.toLowerCase().endsWith('.risum')) {
          const source = fileSource(request.file);
          this.opened = () => risumParts(source);
          const result = await importRisum(source);
          return result.ok ? { ok: true, module: this.module(result.module) } : result;
        }
        const tool = request.file.name.toLowerCase().endsWith('.js');
        if (tool && request.file.size > TOOL_FILE_BYTES) return { ok: false, failure: { kind: 'unreadable', detail: 'tool-too-large' } };
        const bytes = new Uint8Array(await request.file.arrayBuffer());
        if (tool) return readToolFile(bytes);
        this.opened = async () => originalParts(bytes);
        if (isPresetFile(request.file.name)) return presetReply(await importPreset(request.file.name, bytes));
        const shaped = request.file.name.toLowerCase().endsWith('.json') ? shapedJson(bytes) : null;
        if (shaped) return shaped;
        const result = importCard(request.file.name, bytes, request.asModule);
        if (!result.ok) return result;
        if ('persona' in result) return { ok: true, persona: { ...result.persona, picture: this.picture(result.persona.picture) } };
        return 'card' in result ? { ok: true, card: this.card(result.card) } : { ok: true, module: this.module(result.module) };
      }
      case 'zip': {
        const unpacked = unpackZip(request.file.name, new Uint8Array(await request.file.arrayBuffer()));
        return unpacked.ok ? { ...unpacked, files: unpacked.files.map(({ name, bytes }) => new File([bytes], name)) } : unpacked;
      }
      case 'character': {
        this.clear();
        const { chats, avatar, assets, ...character } = await this.backup!.character(request.key);
        this.chats = chats;
        return { ...character, chatCount: chats.length, avatar: this.picture(avatar), assets: this.reads(assets) };
      }
      case 'persona': {
        this.clear();
        const { picture, module, ...persona } = await this.backup!.persona(request.key);
        return { ...persona, picture: this.picture(picture), module: module && this.module(module) };
      }
      case 'preset':
        this.clear();
        return this.backup!.preset(request.key);
      case 'module':
        this.clear();
        return this.module(await this.backup!.module(request.key));
      case 'chat': {
        const { messages, ...header } = this.chats[request.index]!;
        return { header, messages: messages.length };
      }
      case 'messages': {
        const source = this.chats[request.index]!.messages;
        const messages: Replies['messages']['messages'] = [];
        let bytes = 0;
        let next = request.from;
        while (next < source.length && messages.length < MESSAGE_PAGE) {
          const message = source[next]!;
          const size = 64 + 2 * (message.text.length + (message.reasoning?.length ?? 0));
          // A single oversized message must still advance, as the object writer's own size check decides its fate.
          if (messages.length && bytes + size > MESSAGE_BYTES) break;
          messages.push(message);
          bytes += size;
          // Paging only advances. Release transferred messages without shifting every remaining array element.
          delete source[next++];
        }
        return { messages, next };
      }
      case 'release':
        this.chats = [];
        return null;
      case 'original':
        return (await this.opened!()).map(({ path, read }): PartRead => ({ path, handle: this.read(read) }));
      case 'asset': {
        const bytes = await this.assets.get(request.handle)!();
        // A reader can return a view into the archive. Transferring it would detach other pictures and retries.
        return bytes && new Uint8Array(bytes);
      }
      case 'picture': {
        const picture = await this.pictures.get(request.handle)!();
        return picture && { type: picture.type, bytes: new Uint8Array(picture.bytes) };
      }
    }
  }

  private clear() {
    this.opened = null;
    this.chats = [];
    this.assets.clear();
    this.pictures.clear();
  }

  private reads(assets: Imported['assets']): AssetRead[] {
    return assets.map(({ name, read }) => ({ name, handle: this.read(read) }));
  }

  private read(read: Imported['assets'][number]['read']): number {
    const handle = ++this.next;
    this.assets.set(handle, read);
    return handle;
  }

  private picture(read: () => Promise<Picture | null>): number {
    const handle = ++this.next;
    this.pictures.set(handle, read);
    return handle;
  }

  private card({ avatar, assets, bundled, ...card }: Imported): CardData {
    return { ...card, avatar: avatar ? this.picture(async () => avatar) : null, assets: this.reads(assets), bundled: bundled.map((module) => this.module(module)) };
  }

  private module<M extends ImportedModule>({ assets, ...module }: M): Omit<M, 'assets'> & ModuleData {
    return { ...module, assets: this.reads(assets) };
  }
}
