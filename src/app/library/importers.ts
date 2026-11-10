import { FileText, MessageSquare, Package, Puzzle, UserRound, type LucideIcon } from 'lucide-react';
import { live } from '../../model/library';
import type { ApiFailure } from '../../runtime/api';
import type { Progress } from '../../runtime/library/characters';
import { importChat } from '../../runtime/chat/chat-log';
import type { Files } from '../../runtime/files/files';
import type { ImportWorker } from '../../runtime/import/client';
import { chatDestination, saveCharacter, saveModule, savePersona, savePrompt, saveTool, type Undo } from '../../runtime/import/save';
import { sameNamespace, type ModulePlace } from '../../runtime/library/modules';
import { fillPictures, importRisuChats, risuMatch } from '../../runtime/import/move';
import type { OriginalFile } from '../../runtime/import/originals';
import type { ObjectStore } from '../../runtime/store/store';
import { sameTool } from '../../runtime/tools/store';
import { aliased } from '../common/alias';
import { BIN, moduleName, namedObject, promptName, THINGS, TOOL } from '../common/words';
import type { Route } from '../shell/routes';
import { characterOutcome, characterPreview, chatOutcome, chatPreview, failureOf, moduleOutcome, modulePreview, personaOutcome, personaPreview, placement, promptOutcome, promptPreview, toolOutcome, toolPreview, unsaved, withOriginal, type ImportKind, type ImportOutcome, type Line, type Preview } from './importOutcome';
import { chatMissed, missedLines, moveMissed } from './missed';

export type Parsed = Exclude<Awaited<ReturnType<ImportWorker['card']>>, { ok: false }>;
// fill targets a moved character's pictures; replace selects old module versions. For chat destinations,
// picked null means 캐릭터 없이; asked requests a user choice, with name retaining the file's character name.
export type Choice = { kind: 'fill'; into: string; on: boolean } | { kind: 'replace'; olds: string[]; on: boolean } | { kind: 'character'; asked: boolean; name: string | null; picked: string | null };
// Where a file of chats goes: a character's id, null for 캐릭터 없이, undefined where the way in names none.
export type Target = string | null | undefined;
export type Result = ImportOutcome | { kind: 'filled'; file: string; title: string; lines: Line[]; missed: string[] } | { kind: 'failed'; file: string; failure: string };
// What one file brought, offered back with its 되돌리기.
export type Offer = { message: string; run: Undo };

export const failed = (file: string, failure: string): Result => ({ kind: 'failed', file, failure });
const notSaved = (file: string, failure: ApiFailure): Result => failed(file, unsaved(failure));
const offered = (name: string, noun: string, run: Undo): Offer => ({ message: `${namedObject(name, noun)} 가져왔어요.`, run });

const nameOf = (store: ObjectStore, id: string | null) => {
  const shown = id === null ? null : store.get('character', id)!.value;
  return shown && aliased(shown.card.name, shown.alias);
};

// file: the file's name.
type PreviewAt = { store: ObjectStore; file: string; target: Target; place: ModulePlace | null };
type SaveAt = { sink: { store: ObjectStore; files: Files }; file: string; title: string; choice: Choice | null; place: ModulePlace | null; original: () => Promise<OriginalFile>; step: Progress; offer: (offer: Offer) => void };
// A string says why the file cannot come in.
type Previewed = { preview: Preview; choice: Choice | null } | string;
// opens: where a lone one opens from the done dialog, by a button with icon; the card offers a new chat there instead.
// icon: also on its row, unless the row shows the thing's own name (a card's, a persona's).
type Shown = { icon: LucideIcon; opens: { label: string; route: (id: string) => Route } } | { icon: null; opens: null };
// of: the part of a parsed file this kind reads, null for another kind's file.
type Reader<T> = { of: (parsed: Parsed) => T | null; preview: (part: T, at: PreviewAt) => Previewed; save: (part: T, at: SaveAt) => Promise<Result> };
type Reading = { preview: (at: PreviewAt) => Previewed; save: (at: SaveAt) => Promise<Result> };
type Importer = Shown & { read: (parsed: Parsed) => Reading | null };

// Closes over the part its kind read, so every kind sits in one table.
const importer = <T>(shown: Shown, { of, preview, save }: Reader<T>): Importer => ({
  ...shown,
  read: (parsed) => {
    const part = of(parsed);
    return part === null ? null : { preview: (at) => preview(part, at), save: (at) => save(part, at) };
  },
});

// The parsed shapes are disjoint by key, so the order here is the done dialog's order of buttons; the card comes last, as
// the file that is none of the others.
export const IMPORTERS: Record<ImportKind, Importer> = {
  chat: importer({ icon: MessageSquare, opens: { label: '열기', route: (id) => ({ kind: 'chat', id }) } }, {
    of: (parsed) => ('chat' in parsed || 'risuChats' in parsed ? parsed : null),
    preview: (chats, { store, file, target, place }) => {
      const destination = chatDestination(store, chats, target, place);
      const titles = 'chat' in chats ? [chats.chat.chat.value.title] : chats.risuChats.map(({ title }) => title);
      return { preview: chatPreview(file, titles, 'chat' in chats ? [] : moveMissed(chats.missed), destination.asked ? undefined : nameOf(store, destination.picked)), choice: { kind: 'character', ...destination } };
    },
    save: async (chats, { sink, file, title, choice }) => {
      const character = choice?.kind === 'character' ? choice.picked : null;
      if ('chat' in chats) {
        const saved = await importChat(sink, chats.chat, character);
        return saved.ok ? chatOutcome(file, title, [saved.data.id], nameOf(sink.store, character), chatMissed(saved.data.dropped)) : notSaved(file, saved);
      }
      const saved = await importRisuChats(sink.store, character, chats.risuChats);
      return saved.ok ? chatOutcome(file, title, saved.data, nameOf(sink.store, character), []) : notSaved(file, saved);
    },
  }),
  module: importer({ icon: Package, opens: { label: `${THINGS.module.noun} 보기`, route: (id) => ({ kind: 'module', id, pane: null }) } }, {
    of: (parsed) => ('module' in parsed ? parsed.module : null),
    preview: (module, { store, place }) => {
      const olds = module.namespace === null ? [] : sameNamespace(store, module.namespace).map(({ value }) => moduleName(value.name));
      return { preview: modulePreview(module, place?.kind ?? null), choice: olds.length > 0 ? { kind: 'replace', olds, on: true } : null };
    },
    save: async (module, { sink, file, title, choice, place, original, step, offer }) => {
      const saved = await saveModule(sink, module, choice?.kind === 'replace' && choice.on, place, original, step);
      if (!saved.ok) return notSaved(file, saved);
      const { id, unsupported, placed, replaced, paired, kept, undo } = saved.data;
      offer(offered(moduleName(module.name), THINGS.module.noun, undo));
      const replacing = replaced && { names: replaced.olds.map(({ value }) => moduleName(value.name)), places: replaced.places.ok ? replaced.places.data : 0, failure: failureOf(replaced.places) };
      const pairing = { prompts: paired.ok ? paired.data.map((prompt) => promptName(prompt.value.name)) : [], failure: failureOf(paired) };
      return withOriginal(moduleOutcome(file, title, id, unsupported, placement(place, placed), pairing, replacing), kept);
    },
  }),
  plugin: importer({ icon: Puzzle, opens: { label: `${TOOL} 보기`, route: (id) => ({ kind: 'plugin', id }) } }, {
    of: (parsed) => ('tool' in parsed ? parsed.tool : null),
    preview: (tool, { store, place }) => {
      const previous = sameTool(store, tool.manifest);
      // importTool refuses an identity whose module is in 휴지통 rather than revive it or keep a second copy.
      if (previous && !live(store.get('module', previous.parent!))) return `${BIN}에 같은 ${TOOL}이 있어요. 복원한 뒤에 다시 가져와 주세요.`;
      return { preview: toolPreview(tool.manifest, previous?.value ?? null, place?.kind ?? null), choice: null };
    },
    save: async (tool, { sink, file, title, place, offer }) => {
      const saved = await saveTool(sink, tool, place);
      if (!saved.ok) return notSaved(file, saved);
      if (saved.data.undo) offer(offered(tool.manifest.displayName, TOOL, saved.data.undo));
      return toolOutcome(file, title, saved.data.saved, placement(place, saved.data.placed));
    },
  }),
  prompt: importer({ icon: FileText, opens: { label: `${THINGS.prompt.noun} 보기`, route: (id) => ({ kind: 'prompt', id, pane: null }) } }, {
    of: (parsed) => ('preset' in parsed ? parsed.preset : null),
    preview: (preset) => ({ preview: promptPreview(preset), choice: null }),
    save: async (preset, { sink, file, title, original, step, offer }) => {
      const saved = await savePrompt(sink, preset, original, step);
      if (!saved.ok) return notSaved(file, saved);
      const { id, paired, waiting, kept, undo } = saved.data;
      offer(offered(promptName(preset.prompt.name), THINGS.prompt.noun, undo));
      return withOriginal(promptOutcome(file, title, id, paired.map((each) => moduleName(sink.store.get('module', each)!.value.name)), waiting), kept);
    },
  }),
  persona: importer({ icon: UserRound, opens: { label: `${THINGS.persona.noun} 보기`, route: (id) => ({ kind: 'persona', id }) } }, {
    of: (parsed) => ('persona' in parsed ? parsed.persona : null),
    preview: (persona) => ({ preview: personaPreview(persona), choice: null }),
    save: async (persona, { sink, file, title, offer }) => {
      const saved = await savePersona(sink.store, persona);
      if (!saved.ok) return notSaved(file, saved);
      offer(offered(aliased(persona.name, persona.alias), THINGS.persona.noun, saved.data.undo));
      return personaOutcome(file, title, saved.data.saved);
    },
  }),
  character: importer({ icon: null, opens: null }, {
    of: (parsed) => ('card' in parsed ? parsed.card : null),
    preview: (card, { store }) => {
      const into = card.assets.length > 0 ? risuMatch(store, card.card.name) : null;
      return { preview: characterPreview(card), choice: into === null ? null : { kind: 'fill', into, on: false } };
    },
    save: async (card, { sink, file, title, choice, original, step, offer }) => {
      if (choice?.kind === 'fill' && choice.on) {
        step({ kind: 'picture' });
        const filled = await fillPictures(sink.store, sink.files, { kind: 'asset', parent: choice.into }, card.assets);
        if (!filled.ok) return notSaved(file, filled);
        return { kind: 'filled', file, title, lines: [{ text: `이미지 ${filled.data.kept.length}개를 가져왔어요.`, failed: false }], missed: missedLines(filled.data.unsupported) };
      }
      const saved = await saveCharacter(sink, card, original, step);
      if (!saved.ok) return notSaved(file, saved);
      offer(offered(card.card.name, THINGS.character.noun, saved.data.undo));
      return withOriginal(characterOutcome(file, title, saved.data.saved), saved.data.kept);
    },
  }),
};

export function readingOf(parsed: Parsed): Reading {
  for (const each of Object.values(IMPORTERS)) {
    const reading = each.read(parsed);
    if (reading) return reading;
  }
  throw new Error('a parsed file no importer reads');
}
