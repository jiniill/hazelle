import { ChangeSignal } from '../change-signal';
import type { Inlay, TextFile } from '../model/library';
import type { ApiFailure } from './api';

// A picture put in the composer (runtime/attachments addDraftPicture), its file saved as soon as it is put there. url:
// what the composer shows it by, revoked when it is removed or sent (release). state: its inlay once the file is saved,
// the failure otherwise, refused for a file the server refused (Files.save); saved, the state it settles on.
export type PictureState = { kind: 'saving' } | { kind: 'saved'; value: Inlay } | { kind: 'failed'; failure: ApiFailure | 'refused' };
export type DraftPicture = { kind: 'picture'; name: string; url: string; state: PictureState; saved: Promise<Exclude<PictureState, { kind: 'saving' }>> };
// A text file put in the composer (runtime/attachments addDraftFile), whole in page memory until its row is written.
export type DraftFile = { kind: 'file'; value: TextFile };
export type DraftAttachment = DraftPicture | DraftFile;
const NONE: readonly DraftAttachment[] = [];
export const attachmentName = (attachment: DraftAttachment) => (attachment.kind === 'picture' ? attachment.name : attachment.value.name);

// Unsent text per chat, kept in page memory until the vault closes: it outlives the chat's screen and the session, and a reply that
// fails after its screen is gone still hands its text back. A chat not saved yet has no id to keep it under, so its
// text is kept per character (draftKey) and moved under the chat's id once it is saved. Its attachments go with it.
export const draftKey = (chat: string | null, character: string | null) => chat ?? (character ? `new-${character}` : 'new');

export class Drafts {
  private readonly texts = new Map<string, string>();
  private readonly held = new Map<string, readonly DraftAttachment[]>();
  private readonly changes = new ChangeSignal();

  readonly subscribe = this.changes.subscribe;

  text(key: string): string {
    return this.texts.get(key) ?? '';
  }

  set(key: string, text: string) {
    if (text) this.texts.set(key, text);
    else this.texts.delete(key);
    this.changes.notify();
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
    this.texts.delete(key);
    this.setAttachments(key, NONE);
    return taken;
  }

  move(from: string, to: string) {
    const text = this.text(from);
    const attachments = this.attachments(from);
    this.texts.delete(from);
    this.held.delete(from);
    if (text) this.set(to, text);
    if (attachments.length) this.setAttachments(to, [...this.attachments(to), ...attachments]);
  }

  // Text a send took and its chat did not keep goes before what was typed since: neither replaces the other. So do its
  // attachments.
  putBack(key: string, text: string, attachments: readonly DraftAttachment[] = NONE) {
    const typed = this.text(key);
    if (text) this.set(key, typed ? `${text}\n${typed}` : text);
    if (attachments.length) this.setAttachments(key, [...attachments, ...this.attachments(key)]);
  }

  close() {
    for (const attachments of this.held.values()) this.release(attachments);
    this.texts.clear();
    this.held.clear();
  }
}
