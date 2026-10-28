import { ChangeSignal } from '../change-signal';
import type { Inlay, TextFile } from '../model/library';
import type { VaultKey } from '../vault/keys';
import type { ApiFailure } from './api';
import { DeviceDrafts } from './device-drafts';

// Save picture files on attachment; revoke preview URLs only on release. saved resolves to the settled inlay/failure state.
export type PictureState = { kind: 'saving' } | { kind: 'saved'; value: Inlay } | { kind: 'failed'; failure: ApiFailure | 'refused' };
export type DraftPicture = { kind: 'picture'; name: string; url: string; state: PictureState; saved: Promise<Exclude<PictureState, { kind: 'saving' }>> };
// A text file put in the composer (runtime/attachments addDraftFile), whole in page memory until its row is written.
export type DraftFile = { kind: 'file'; value: TextFile };
export type DraftAttachment = DraftPicture | DraftFile;
const NONE: readonly DraftAttachment[] = [];
export const attachmentName = (attachment: DraftAttachment) => (attachment.kind === 'picture' ? attachment.name : attachment.value.name);

// Vault-lifetime drafts outlive screens/sessions so failed background sends can return text.
// Unsaved chats key by character until first save; move their text and attachments together.
export const draftKey = (chat: string | null, character: string | null) => chat ?? (character ? `new-${character}` : 'new');
const prepend = (text: string, typed: string) => typed ? `${text}\n${typed}` : text;

export class Drafts {
  private texts = new Map<string, string>();
  private readonly held = new Map<string, readonly DraftAttachment[]>();
  private readonly changes = new ChangeSignal();
  private device: DeviceDrafts | undefined;

  readonly subscribe = this.changes.subscribe;

  persist(account: string, vaultKey: VaultKey): Promise<void> {
    const texts = this.texts;
    this.device ??= new DeviceDrafts(account, vaultKey, texts, (key, text) => {
      if (!text) return;
      texts.set(key, prepend(text, texts.get(key) ?? ''));
      if (this.texts === texts) this.changes.notify();
    });
    return this.device.ready;
  }

  flush(): Promise<void> {
    return this.device?.flush() ?? Promise.resolve();
  }

  text(key: string): string {
    return this.texts.get(key) ?? '';
  }

  set(key: string, text: string) {
    this.writeText(key, text);
    this.changes.notify();
  }

  private writeText(key: string, text: string) {
    if (text) this.texts.set(key, text);
    else this.texts.delete(key);
    this.device?.changed(key);
  }

  attachments(key: string): readonly DraftAttachment[] {
    return this.held.get(key) ?? NONE;
  }

  private setAttachments(key: string, attachments: readonly DraftAttachment[]) {
    if (attachments.length) this.held.set(key, attachments);
    else this.held.delete(key);
    this.changes.notify();
  }

  attach(key: string, attachment: DraftAttachment) {
    this.setAttachments(key, [...this.attachments(key), attachment]);
  }

  // Wherever the draft holding it is by now: a new chat's may have moved under its id meanwhile.
  settle(name: string, state: PictureState) {
    for (const [key, attachments] of this.held) {
      if (attachments.some((each) => each.kind === 'picture' && each.name === name)) this.setAttachments(key, attachments.map((each) => (each.kind === 'picture' && each.name === name ? { ...each, state } : each)));
    }
  }

  detach(key: string, name: string) {
    const attachments = this.attachments(key);
    this.release(attachments.filter((each) => attachmentName(each) === name));
    this.setAttachments(key, attachments.filter((each) => attachmentName(each) !== name));
  }

  release(attachments: readonly DraftAttachment[]) {
    for (const each of attachments) if (each.kind === 'picture') URL.revokeObjectURL(each.url);
  }

  // What a send takes: the text and the attachments leave the draft, the pictures' urls still standing for putBack.
  take(key: string): { text: string; attachments: readonly DraftAttachment[] } {
    const taken = { text: this.text(key), attachments: this.attachments(key) };
    this.writeText(key, '');
    this.setAttachments(key, NONE);
    return taken;
  }

  move(from: string, to: string) {
    const text = this.text(from);
    const attachments = this.attachments(from);
    this.writeText(from, '');
    this.held.delete(from);
    if (text) this.set(to, text);
    if (attachments.length) this.setAttachments(to, [...this.attachments(to), ...attachments]);
  }

  // Text a send took and its chat did not keep goes before what was typed since: neither replaces the other. So do its
  // attachments.
  putBack(key: string, text: string, attachments: readonly DraftAttachment[] = NONE) {
    const typed = this.text(key);
    if (text) this.set(key, prepend(text, typed));
    if (attachments.length) this.setAttachments(key, [...attachments, ...this.attachments(key)]);
  }

  close() {
    const flushed = this.device?.close() ?? Promise.resolve();
    this.device = undefined;
    for (const attachments of this.held.values()) this.release(attachments);
    // A pending load/flush still owns this map; clearing it would erase text during lock or unmount.
    this.texts = new Map();
    this.held.clear();
    return flushed;
  }
}
