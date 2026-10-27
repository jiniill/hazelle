import { ChangeSignal } from '../change-signal';
import type { InputPicture } from '../connectors/types';
import { artistTags, picturePrompt } from '../engine/import/picture-prompt';
import { artistOf, importedPortraits, likenessRequest, parseLikeness, rebuiltPortraits, sample, SAMPLE_MOST, SHOWN_MOST, sourcesOf, type LikenessInvalid } from '../engine/likeness';
import type { Chat, Receipt } from '../model/chat';
import type { Stored } from '../model/kinds';
import { live, type Asset } from '../model/library';
import { likenessId, PORTRAITS_MOST, type Likeness, type Portrait } from '../model/likeness';
import type { IllustratePrompt } from '../model/prompt';
import type { ApiFailure, ApiResult } from './api';
import type { RouteFailure } from './assignment';
import { illustrateSwitches } from './characters';
import { packsOf } from './chat-context';
import { chatPersona } from './personas';
import { seesPicturesNow } from './connections';
import { PERMANENT } from './files';
import { shownPicture } from './picture';
import { taskWriter } from './profiles';
import { illustrationPrompt } from './prompts';
import type { Session } from './session';
import type { ObjectStore } from './store';
import { pageAnswer } from './talk';
import { keepRow } from './usage';
import { fromBase64 } from '../vault/aead';

// Owns likeness writes except restores/copies. Build only on first needed draw or explicit regeneration;
// undrawn packs must cost nothing.

// unread: a picture could not be fetched, so nothing is written and the next draw tries again. gone: the pack was
// deleted.
export type LikenessFailure =
  | RouteFailure
  | { kind: 'prompt-missing'; own: boolean }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'unread'; failure: ApiFailure }
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'invalid'; receipt: Receipt; reason: LikenessInvalid }
  | { kind: 'unsaved'; failure: ApiFailure }
  | { kind: 'gone' };

// By pack. A failure stays for the session, until the next try.
type LikenessRun = { stage: 'building' } | { stage: 'failed'; failure: LikenessFailure };
export type LikenessRuns = ReadonlyMap<string, LikenessRun>;

type Stopped = { kind: 'stopped' };
type Deps = Pick<Session, 'tokens' | 'store' | 'credentials' | 'log' | 'files' | 'catalogs'>;
type Picture = Pick<Asset, 'name' | 'type' | 'file'> & { avatar: boolean };
type Held = { name: string; type: string; avatar: boolean; bytes: Uint8Array<ArrayBuffer> };
// files: pictures still to read; held: one already in the owner's value, a persona's thumb.
type Material = { name: string; user: boolean; texts: { label: string; text: string }[]; lore: { name: string; keys: string[]; content: string }[]; files: Picture[]; held: Held[] };

// value: the pack's first likeness; change: what is written over one there, or over another device's met in a conflict.
async function writeLikeness(store: ObjectStore, owner: string, value: Likeness, change: (current: Likeness) => Likeness): Promise<ApiResult<Stored<'likeness'>>> {
  const id = likenessId(owner);
  if (!store.get('likeness', id)) {
    const created = await store.create('likeness', value, { id, parent: owner });
    if (created.ok || created.error !== 'conflict' || !store.get('likeness', id)) return created;
  }
  return store.update('likeness', id, change);
}

// A portrait by its place and the name it had when shown, so an edit never lands on another one moved there ('gone').
type PortraitAt = { index: number; name: string };

// Any edit makes the portrait the user's, which 다시 만들기 keeps.
export function editPortrait(store: ObjectStore, owner: string, at: PortraitAt, edit: Partial<Omit<Portrait, 'source'>>): Promise<ApiResult<Stored<'likeness'>>> {
  return store.update('likeness', likenessId(owner), (current) => {
    const portrait = current.portraits[at.index];
    return portrait?.name === at.name ? { ...current, portraits: current.portraits.with(at.index, { ...portrait, ...edit, source: 'user' }) } : null;
  });
}

// Into profiles already made: a pack given its first portrait by hand would get none built by the next 삽화.
export function addPortrait(store: ObjectStore, owner: string): Promise<ApiResult<Stored<'likeness'>>> {
  const added: Portrait = { name: '', aliases: [], look: '', outfits: [], artist: '', source: 'user' };
  return store.update('likeness', likenessId(owner), (current) => (current.portraits.length < PORTRAITS_MOST ? { ...current, portraits: [...current.portraits, added] } : null));
}

// Deletion returns undo state. Removing one portrait does not regenerate it; removing all profiles enables next-draw build.
export async function removePortrait(store: ObjectStore, owner: string, at: PortraitAt): Promise<ApiResult<Stored<'likeness'>>> {
  const before = store.get('likeness', likenessId(owner));
  if (!before) return { ok: false, error: 'gone' };
  const removed = await store.update('likeness', before.id, (current) =>
    current.portraits[at.index]?.name === at.name ? { ...current, portraits: current.portraits.toSpliced(at.index, 1) } : null,
  );
  return removed.ok ? { ok: true, data: before } : removed;
}

type PortraitsImported = { before: Stored<'likeness'> | null; replaced: number };

// Reject oversized imports before any write; merge by name and retain before for undo.
// Even an empty-profile pack given imported profiles must not auto-build afterward.
export async function importPortraits(store: ObjectStore, owner: string, portraits: readonly Portrait[]): Promise<ApiResult<PortraitsImported> | { ok: false; error: 'too-many'; count: number }> {
  const before = store.get('likeness', likenessId(owner));
  const merged = importedPortraits(before?.value.portraits ?? [], portraits);
  if (merged.portraits.length > PORTRAITS_MOST) return { ok: false, error: 'too-many', count: merged.portraits.length };
  const written = await writeLikeness(store, owner, { portraits: merged.portraits, at: Date.now(), receipt: null }, (current) => ({ ...current, portraits: importedPortraits(current.portraits, portraits).portraits }));
  return written.ok ? { ok: true, data: { before, replaced: merged.replaced } } : written;
}

export const removeLikeness = (store: ObjectStore, owner: string) => store.take('likeness', likenessId(owner));

export const restoreLikeness = (store: ObjectStore, before: Stored<'likeness'>) => store.restore(before);

// One build per pack at a time: a draw that needs a pack being built waits for that build.
export class Likenesses {
  private closed = false;
  private state: LikenessRuns = new Map();
  private readonly building = new Map<string, Promise<void>>();
  private readonly closing = new AbortController();
  private readonly changes = new ChangeSignal();

  constructor(private readonly deps: Deps) {}

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.state;

  private change(owner: string, run: LikenessRun | null) {
    const next = new Map(this.state);
    if (run) next.set(owner, run);
    else next.delete(owner);
    this.state = next;
    this.changes.notify();
  }

  // Build missing profiles first in pack → cast → persona order; failures omit that owner, never the picture.
  // The selected illustration prompt supplies the profile-writing model.
  async portraits(chat: Chat, prompt: IllustratePrompt, signal: AbortSignal): Promise<Portrait[]> {
    const { store } = this.deps;
    // A 등장인물 is drawn from its own card's portraits, after the packs, as its lorebook and pictures are read.
    const cast = (chat.cast ?? []).filter((member) => live(store.get('character', member)));
    const persona = chatPersona(store, chat);
    const owners = [...new Set([...packsOf(store, chat).map(({ id }) => id), ...cast, ...(persona.kind === 'persona' ? [persona.persona.id] : [])])];
    await Promise.all(owners.filter((owner) => !store.get('likeness', likenessId(owner))).map((owner) => this.start(owner, chat, prompt, signal)));
    return owners.flatMap((owner) => store.get('likeness', likenessId(owner))?.value.portraits ?? []);
  }

  // Regenerate using new-chat settings, preserving user portraits. Do not duplicate an active build.
  // Return the replaced state for undo, null if unchanged.
  async rebuild(owner: string): Promise<Stored<'likeness'> | null> {
    const { store } = this.deps;
    const character = live(store.get('character', owner)) ? owner : null;
    const persona = live(store.get('persona', owner)) ? { persona: owner } : {};
    const prompt = illustrationPrompt(store, illustrateSwitches(store, character).prompt);
    if (prompt.kind === 'missing') {
      this.change(owner, { stage: 'failed', failure: { kind: 'prompt-missing', own: prompt.own } });
      return null;
    }
    const before = store.get('likeness', likenessId(owner));
    await this.start(owner, { title: null, character, models: {}, ...persona }, prompt.prompt.value, this.closing.signal);
    return before && store.get('likeness', likenessId(owner))?.value !== before.value ? before : null;
  }

  close() {
    this.closed = true;
    this.closing.abort();
  }

  // signal: the draw's that asked first; a draw joining it goes on without the pack's portraits if it stops.
  private start(owner: string, chat: Chat, prompt: IllustratePrompt, signal: AbortSignal): Promise<void> {
    const running = this.building.get(owner);
    if (running || this.closed) return running ?? Promise.resolve();
    this.change(owner, { stage: 'building' });
    const run = this.build(owner, chat, prompt, AbortSignal.any([signal, this.closing.signal]))
      .then(
        (outcome) => this.change(owner, outcome === null || outcome.kind === 'stopped' ? null : { stage: 'failed', failure: outcome }),
        (error: unknown) => {
          this.change(owner, null);
          throw error;
        },
      )
      .finally(() => this.building.delete(owner));
    this.building.set(owner, run);
    return run;
  }

  // A persona has no lorebook and one picture, the small copy its value holds.
  private material(owner: string): Material | null {
    const { store } = this.deps;
    const persona = live(store.get('persona', owner));
    if (persona) {
      const { name, description, picture } = persona.value;
      const [, type, data] = (picture && /^data:([^;,]+);base64,(.*)$/.exec(picture)) || [];
      return { name, user: true, texts: [{ label: 'Description', text: description }], lore: [], files: [], held: type && data ? [{ name: '', type, avatar: true, bytes: fromBase64(data) }] : [] };
    }
    const character = live(store.get('character', owner));
    const module = character ? null : live(store.get('module', owner));
    if (!character && !module) return null;
    const card = character?.value.card;
    const texts = card
      ? [{ label: 'Description', text: card.description }, { label: 'Personality', text: card.personality }, { label: 'Scenario', text: card.scenario }]
      : [{ label: 'Description', text: module!.value.description }];
    const lore = store.children('lore', owner).flatMap(({ value }) => (value.enabled ? [{ name: value.name, keys: value.keys, content: value.content }] : []));
    const avatar = store.children('avatar', owner)[0]?.value;
    const files: Picture[] = [
      ...(avatar ? [{ name: '', type: avatar.type, file: avatar.file, avatar: true }] : []),
      ...sample(store.children('asset', owner).flatMap(({ value }) => (value.type.startsWith('image/') ? [{ ...value, avatar: false }] : [])), SAMPLE_MOST - (avatar ? 1 : 0)),
    ];
    return { name: card?.name ?? module!.value.name, user: false, texts, lore, files, held: [] };
  }

  // Use NovelAI metadata, vision if supported, then owner text/lore.
  // With no material, call/save nothing so later-added descriptions can still trigger the first build.
  private async build(owner: string, chat: Chat, prompt: IllustratePrompt, signal: AbortSignal): Promise<LikenessFailure | Stopped | null> {
    const { store, files } = this.deps;
    const material = this.material(owner);
    if (!material) return { kind: 'gone' };
    const { texts, lore } = material;
    const save = async (value: Likeness) => {
      // Over what is there, the user's portraits stay: 다시 만들기, or another device's build met in a conflict.
      const saved = await writeLikeness(store, owner, value, (current) => ({ ...value, portraits: rebuiltPortraits(current.portraits, value.portraits, PORTRAITS_MOST) }));
      if (saved.ok && value.receipt) await keepRow(store, value.receipt, value.at, { chat: null, character: store.get('character', owner) ? owner : null });
      return saved.ok ? null : { kind: 'unsaved' as const, failure: saved };
    };
    const empty = { portraits: [], at: Date.now(), receipt: null };
    if (!material.files.length && !material.held.length && !texts.some(({ text }) => text.trim()) && !lore.some(({ content }) => content.trim())) return null;
    const writer = taskWriter(store, chat, prompt.model);
    if ('kind' in writer) return writer;

    const read = await Promise.all(material.files.map(async (picture) => ({ picture, read: await files.read(picture.file, { signal }) })));
    // A file gone or not opening is left out; any other failure ends the build.
    const failed = read.find(({ read }) => !read.ok && !PERMANENT.has(read.error))?.read;
    if (failed && !failed.ok) return failed.error === 'stopped' ? { kind: 'stopped' } : { kind: 'unread', failure: failed };
    const held: Held[] = [...material.held, ...read.flatMap(({ picture, read }) => (read.ok ? [{ ...picture, bytes: read.data }] : []))];
    const prompts = held.flatMap(({ bytes }) => picturePrompt(bytes) ?? []);
    const shown = (await seesPicturesNow(this.deps, writer.route)) ? await shownPictures(held.slice(0, SHOWN_MOST)) : [];
    const input = { name: material.name, user: material.user, texts, lore, prompts, pictures: shown.map(({ shown }) => shown), avatar: shown[0]?.avatar === true, most: PORTRAITS_MOST };
    const sources = sourcesOf(input);
    if (!sources.length) return save(empty);

    const answer = await pageAnswer(this.deps, writer, 'likeness', null, likenessRequest(input), signal);
    if ('kind' in answer) return answer;
    const { receipt } = answer;
    const parsed = parseLikeness(answer.text, { sources, artist: artistOf(prompts.map(({ prompt }) => artistTags(prompt))), most: PORTRAITS_MOST });
    return parsed.ok ? save({ portraits: parsed.portraits, at: Date.now(), receipt }) : { kind: 'invalid', receipt, reason: parsed.reason };
  }
}

// A picture the browser cannot draw is left out.
async function shownPictures(pictures: Held[]): Promise<{ shown: InputPicture; avatar: boolean }[]> {
  const shown = await Promise.all(pictures.map(({ bytes, type, avatar }) => shownPicture({ bytes, type }).then((picture) => ({ shown: picture, avatar }), () => null)));
  return shown.filter((each) => each !== null);
}
