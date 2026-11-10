import { assetsOf } from '../../engine/assets';
import { sha256Id } from '../../hex';
import { isFrame, joinOriginal, standIn, stoodFor } from '../../engine/import/original';
import type { PresetRead } from '../../engine/import/preset';
import { readFromSillyTavern } from '../../engine/import/convert';
import { PLAIN_LUA, type Card, type Imported, type ImportedModule, type Pack, type RegexScript, type Trigger } from '../../engine/import/types';
import { grouped } from '../../model/fields';
import type { Stored } from '../../model/kinds';
import type { Asset, Original } from '../../model/library';
import type { Prompt } from '../../model/prompt';
import { accountSettings, changeSettings } from '../account-settings';
import type { ApiResult } from '../api';
import { saveAssets } from '../library/characters';
import type { Files } from '../files/files';
import { ImportWorker } from './client';
import { ImportReadError } from './protocol';
import type { Write } from '../store/object-writes';
import type { ObjectStore } from '../store/store';

type Owner = Stored<'character'> | Stored<'module'> | Stored<'prompt'>;
type Read = { card: Imported } | { module: ImportedModule } | { preset: PresetRead };
// edited: the scripts it left because the user may have changed what the import made of them.
type Step = (store: ObjectStore, files: Files, owner: Owner, read: Read, pieces: Map<string, Original>) => Promise<ApiResult<{ edited: number }>>;

const done = (edited = 0): ApiResult<{ edited: number }> => ({ ok: true, data: { edited } });
const after = (written: ApiResult<unknown>, edited = 0) => (written.ok ? done(edited) : written);

type Scripts = Pick<Pack, 'regex' | 'triggers'>;
const regexKey = ({ name, find, replace, stage, flags }: RegexScript) => JSON.stringify([name, find, replace, stage, flags]);
// What the import kept of a Lua trigger before 2026-11-09, which upgrade.ts luaSteps gave PLAIN_LUA's steps.
const keptKey = (trigger: Trigger) => JSON.stringify([trigger.name, trigger.kind === 'lua' && trigger.code, trigger.off ?? false]);
const triggerKey = (trigger: Trigger) => JSON.stringify([keptKey(trigger), trigger.on, trigger.conditions, trigger.effects]);
const plainLua = (trigger: Trigger) => trigger.kind === 'lua' && trigger.on === PLAIN_LUA.on && !trigger.conditions.length && !trigger.effects.length;

// A Lua trigger takes the steps read again only where it is still exactly what the old import made of one: the one
// stored and the one read each alone under its name and code. A translation-stage script, which no import kept before,
// joins the end, as its stage runs apart from the others. changed false: nothing to write.
function addedScripts(stored: Scripts, read: Scripts): Scripts & { changed: boolean; edited: number } {
  const plain = grouped(stored.triggers.filter(plainLua), keptKey);
  const held = new Set(stored.triggers.map(triggerKey));
  const restored = new Map<string, Trigger>();
  let edited = 0;
  for (const [key, richer] of grouped(read.triggers.filter((trigger) => trigger.kind === 'lua' && !plainLua(trigger)), keptKey)) {
    const [only] = plain.get(key) ?? [];
    if (richer.length === 1 && only && plain.get(key)!.length === 1) restored.set(only.id, { ...only, on: richer[0]!.on, conditions: richer[0]!.conditions, effects: richer[0]!.effects });
    else edited += richer.filter((trigger) => !held.has(triggerKey(trigger))).length;
  }
  const scripts = new Set(stored.regex.map(regexKey));
  const translation = read.regex.filter((script) => script.stage === 'translation' && !scripts.has(regexKey(script))).map((script) => ({ ...script, id: crypto.randomUUID() }));
  return {
    regex: [...stored.regex, ...translation],
    triggers: stored.triggers.map((trigger) => restored.get(trigger.id) ?? trigger),
    changed: restored.size > 0 || translation.length > 0,
    edited,
  };
}

// The text and 시작 전 설문 the card has none of, then its scripts.
function addedCard(card: Card, read: Card): { card: Card; changed: boolean; edited: number } {
  const text = card.additionalText === '' && read.additionalText !== '';
  const onboarding = card.onboarding === undefined && read.onboarding !== undefined;
  const { changed, edited, ...scripts } = addedScripts(card, read);
  return {
    card: { ...card, ...scripts, ...(text && { additionalText: read.additionalText }), ...(onboarding && { onboarding: read.onboarding }) },
    changed: changed || text || onboarding,
    edited,
  };
}

// A background whose file the character has as one already is there. A picture read as its stand-in is fetched from
// the piece it stands for.
async function addBackgrounds(store: ObjectStore, files: Files, owner: string, read: Imported, pieces: Map<string, Original>): Promise<ApiResult<null>> {
  const have = new Set(assetsOf(store.children('asset', owner).map(({ value }) => value), 'background').map(({ file }) => file.id));
  const fetched: Imported['assets'] = [];
  for (const asset of assetsOf(read.assets, 'background')) {
    const bytes = await asset.read();
    const piece = bytes && stoodFor(bytes);
    const kept = piece === null ? null : pieces.get(piece)!.file;
    if (kept && have.has(kept.id)) continue;
    const got = kept ? await files.read(kept, { bulk: true }) : { ok: true as const, data: bytes };
    if (!got.ok) return got;
    fetched.push({ ...asset, read: async () => got.data });
  }
  const saved = await saveAssets(files, fetched, () => {});
  if (!saved.ok) return saved;
  const added: Asset[] = [];
  for (const asset of saved.data.kept) {
    if (have.has(asset.file.id)) continue;
    have.add(asset.file.id);
    added.push(asset);
  }
  if (!added.length) return { ok: true, data: null };
  // Derived, so two devices adding one picture at once write one asset, the later refused as a conflict.
  const writes = await Promise.all(added.map(async (value: Asset): Promise<Write> => ({ type: 'create', kind: 'asset', id: await sha256Id(`${owner}/${value.file.id}`), parent: owner, value })));
  return store.batch(writes);
}

// The kinds read since 2026-11-09: a character's backgrounds, additionalText and onboarding, a pack's Lua steps and
// translation-stage scripts, and a preset's templateDefaultVariables.
const since1109: Step = async (store, files, owner, read, pieces) => {
  if (owner.kind === 'character' && 'card' in read) {
    const backgrounds = await addBackgrounds(store, files, owner.id, read.card, pieces);
    if (!backgrounds.ok) return backgrounds;
    const { changed, edited } = addedCard(owner.value.card, read.card.card);
    if (!changed) return done(edited);
    return after(await store.update('character', owner.id, (current) => ({ ...current, card: addedCard(current.card, read.card.card).card })), edited);
  }
  if (owner.kind === 'module' && 'module' in read) {
    const { changed, edited } = addedScripts(owner.value, read.module.pack);
    if (!changed) return done(edited);
    const written = await store.update('module', owner.id, (current) => {
      const { regex, triggers } = addedScripts(current, read.module.pack);
      return { ...current, regex, triggers };
    });
    return after(written, edited);
  }
  if (owner.kind === 'prompt' && 'preset' in read) {
    const { variables } = read.preset.prompt;
    const takes = (prompt: Prompt) => prompt.task === undefined && !prompt.variables?.length;
    if (!variables?.length || !takes(owner.value)) return done();
    return after(await store.update('prompt', owner.id, (current) => (takes(current) ? { ...current, variables } : current)));
  }
  return done();
};

// A card's SillyTavern regex scripts, read since 2026-11-09, join the end of its scripts; regex itself when it has them all.
function addedSillyTavern(regex: RegexScript[], read: RegexScript[]): RegexScript[] {
  const held = new Set(regex.map(regexKey));
  const added = read.filter((script) => readFromSillyTavern(script) && !held.has(regexKey(script))).map((script) => ({ ...script, id: crypto.randomUUID() }));
  return added.length ? [...regex, ...added] : regex;
}

const sillyTavernScripts: Step = async (store, _files, owner, read) => {
  if (owner.kind !== 'character' || !('card' in read)) return done();
  const { regex } = read.card.card;
  if (addedSillyTavern(owner.value.card.regex, regex) === owner.value.card.regex) return done();
  return after(await store.update('character', owner.id, (current) => ({ ...current, card: { ...current.card, regex: addedSillyTavern(current.card.regex, regex) } })));
};

// In the order the parser changes came; settings.reread counts those every original has had. Each only adds, or fills
// what is still as the old parser left it, so one run again after a stop lands the same. A later parser change that
// reads a kind it counted adds a step: one applied again would bring back what the user has removed since.
const STEPS: Step[] = [since1109, sillyTavernScripts];

function ownerOf(store: ObjectStore, id: string): Owner | null {
  const owner = store.get('character', id) ?? store.get('module', id) ?? store.get('prompt', id);
  return owner && !owner.value.purging ? owner : null;
}

// The original joined again, its pictures as stand-ins, read by the import's own reader as the owner's kind; null for
// one that does not read again as what it made.
async function readAgain(worker: ImportWorker, files: Files, owner: Owner, pieces: Original[], signal: AbortSignal): Promise<ApiResult<Read | null>> {
  const parts = new Map<string, Uint8Array<ArrayBuffer>>();
  const reads = await Promise.all(pieces.map(({ path, file }) => (isFrame(path) ? files.read(file, { signal, bulk: true }) : ({ ok: true, data: standIn(path) } as const))));
  for (const [index, bytes] of reads.entries()) {
    if (!bytes.ok) return bytes;
    parts.set(pieces[index]!.path, bytes.data);
  }
  const read = await worker.card(new File([await joinOriginal(parts)], pieces[0]!.name), owner.kind === 'module');
  if (!read.ok) return { ok: true, data: null };
  const fits = (owner.kind === 'character' && 'card' in read) || (owner.kind === 'module' && 'module' in read) || (owner.kind === 'prompt' && 'preset' in read);
  return { ok: true, data: fits ? (read as Read) : null };
}

// Every owner kept with its original reads it again with today's parser and takes what the steps it has not had add
// (docs/roadmap/import-originals.md). A failed read or write ends the run until the next, the mark unmoved; an owner
// whose file does not read again is left. Owners imported before originals were kept have none and are left too.
export async function rereadOriginals(store: ObjectStore, files: Files, signal: AbortSignal): Promise<ApiResult<{ edited: number }>> {
  const due = STEPS.slice(accountSettings(store).reread ?? 0);
  if (!due.length) return done();
  const kept: { parent: string; value: Original }[] = [];
  const scanned = await store.pinned((pin) => store.scan({ kind: 'original' }, ({ parent }, value) => void kept.push({ parent: parent!, value: value as Original }), pin, signal), signal);
  if (scanned) return scanned;
  const worker = new ImportWorker();
  let edited = 0;
  try {
    for (const [parent, rows] of grouped(kept, ({ parent }) => parent)) {
      if (signal.aborted) return { ok: false, error: 'stopped' };
      const owner = ownerOf(store, parent);
      if (!owner) continue;
      const pieces = rows.map(({ value }) => value);
      const read = await readAgain(worker, files, owner, pieces, signal);
      if (!read.ok) return read;
      if (!read.data) continue;
      for (const step of due) {
        // As the step before left it.
        const current = ownerOf(store, parent);
        if (!current) break;
        const applied = await step(store, files, current, read.data, new Map(pieces.map((piece) => [piece.path, piece])));
        if (!applied.ok) return applied;
        edited += applied.data.edited;
      }
    }
  } catch (error) {
    if (error instanceof ImportReadError) return { ok: false, error: 'unreadable' };
    throw error;
  } finally {
    worker.close();
  }
  const marked = await changeSettings(store, (settings) => ({ ...settings, reread: STEPS.length }));
  return after(marked, edited);
}
