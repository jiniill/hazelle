import type { RisuScan, ToolManifest } from '../../tool-api/manifest';
import { RISU_DECLINED } from '../../tool-api/risu-methods';
import type { ToolImport } from '../../runtime/tools/store';
import type { PresetRead } from '../../engine/import/preset';
import type { Imported, ImportedModule, ImportedPersona, Unsupported } from '../../engine/import/types';
import { isToggle } from '../../model/prompt';
import type { Tool } from '../../model/tool';
import { unused } from '../../engine/pipeline';
import type { ImportedCharacter } from '../../runtime/characters';
import type { ModulePlace } from '../../runtime/modules';
import type { Stored } from '../../model/kinds';
import { aliased } from '../common/alias';
import { packHolds } from '../common/pack';
import { describeUnused } from '../common/unused';
import { ALWAYS, DEFAULT_VARIABLES, inSettings, moduleName, NO_CHARACTER, promptName, RISU_PLUGIN, SCRIPTS, toolVersion } from '../common/words';
import { cardMissed, missedLines, presetMissed } from './missed';

// Never retain asset readers/source bytes in previews or outcomes: closures would keep entire archives alive.
// Previews describe parsed content; outcomes add save-only facts. placed records activation/destination.
export type ImportKind = 'character' | 'module' | 'plugin' | 'prompt' | 'persona' | 'chat';
// title: the thing's own name, its kind said apart.
export type Preview = { kind: ImportKind; title: string; holds: string; verdict: Line | null; placed: Line | null; missed: string[]; unused: string | null };
// A chat's id is null when the file held several.
export type ImportOutcome = { file: string; title: string; lines: Line[]; missed: string[] } & ({ kind: Exclude<ImportKind, 'chat'>; id: string } | { kind: 'chat'; id: string | null });
export type Line = { text: string; failed: boolean; help?: { label: string; text: string } };
// at: where it was dropped (design §6.5), null where nothing takes it. failure: why turning it on there failed.
export type Placement = { at: ModulePlace['kind'] | null; failure: string | null };
// prompts: the names of the prompts whose preset named the module, turned on there. failure: why that failed.
type Pairing = { prompts: string[]; failure: string | null };
// names: the older versions' names. places: how many places they were on in, where it now is.
export type Replacing = { names: string[]; places: number; failure: string | null };

const PLACES: Record<ModulePlace['kind'], string> = { character: '이 캐릭터에', prompt: '이 프롬프트에', persona: '이 페르소나에', always: ALWAYS };

const preview = (kind: ImportKind, title: string, holds: string, fields: Partial<Omit<Preview, 'kind' | 'title' | 'holds'>> = {}): Preview => ({ kind, title, holds, verdict: null, placed: null, missed: [], unused: null, ...fields });
const willPlace = (at: ModulePlace['kind'] | null): Line | null => at === null ? null : { text: `${PLACES[at]} 켜요.`, failed: false };

export function characterPreview({ card, lore, assets, report }: Imported): Preview {
  const holds = [
    `첫인사 ${card.greetings.length}개`,
    lore.length > 0 && `로어북 ${lore.length}개`,
    card.regex.length > 0 && `${SCRIPTS.regex} ${card.regex.length}개`,
    card.variables.length > 0 && `${DEFAULT_VARIABLES} ${card.variables.length}개`,
    card.toggles.some(isToggle) && '토글',
    assets.length > 0 && `에셋 ${assets.length}개`,
  ].filter(Boolean).join(' · ');
  return preview('character', card.name, holds, { missed: missedLines(report.unsupported), unused: describeUnused(unused(card)) });
}

export const modulePreview = (module: ImportedModule, at: ModulePlace['kind'] | null): Preview =>
  preview('module', moduleName(module.name), packHolds(module.pack, module.lore.length, module.assets.length), { placed: willPlace(at), missed: missedLines(module.unsupported) });

const putInto = (character: string | null, verb: string) => character === null ? `${NO_CHARACTER} ${verb}` : `${character}에 ${verb}`;

// character: the name of the one they go to, null for 캐릭터 없이, undefined while the user picks it.
export const chatPreview = (file: string, count: number, missed: string[], character: string | null | undefined): Preview =>
  preview('chat', file, `채팅 ${count}개`, { placed: character === undefined ? null : { text: putInto(character, '넣어요.'), failed: false }, missed });

export function promptPreview({ prompt, unsupported }: PresetRead): Preview {
  const toggles = prompt.toggles.filter(isToggle).length;
  return preview('prompt', promptName(prompt.name), [`블록 ${prompt.blocks.length}개`, toggles > 0 && `토글 ${toggles}개`, prompt.authorNote.trim() && '기본 노트'].filter(Boolean).join(' · '), { missed: presetMissed(unsupported) });
}

// The picture is the PNG itself, so every persona file holds one.
export const personaPreview = ({ name, alias }: Pick<ImportedPersona, 'name' | 'alias'>): Preview =>
  preview('persona', aliased(name, alias), ['설명', alias && '별명', '이미지'].filter(Boolean).join(' · '));

// previous: the tool of the same identity already here, which this version replaces where it is on.
export const toolPreview = (manifest: ToolManifest, previous: Tool | null, at: ModulePlace['kind'] | null): Preview =>
  preview(
    'plugin',
    manifest.displayName,
    !previous ? `버전 ${toolVersion(manifest.version)}`
      : previous.manifest.version === manifest.version ? '같은 버전을 다시 가져와요'
      : `버전을 바꿔요 · ${toolVersion(previous.manifest.version)} → ${toolVersion(manifest.version)}`,
    { verdict: manifest.risu ? risuVerdict(manifest.risu) : null, placed: previous ? null : willPlace(at) },
  );

const outcome = (lines: (Line | null)[]) => lines.filter((line): line is Line => line !== null);

export const characterOutcome = (file: string, title: string, { id, unsupported, faceless }: ImportedCharacter): ImportOutcome =>
  ({ kind: 'character', file, id, title, lines: [], missed: cardMissed(unsupported, faceless) });

export const quoted = (names: string[]) => names.map((name) => `'${name}'`).join(', ');

// unsupported: what the store refused; what the file itself lacked was in its preview.
export function moduleOutcome(file: string, title: string, id: string, unsupported: Unsupported, placement: Placement, { prompts, failure }: Pairing, replacing: Replacing | null): ImportOutcome {
  const paired = failure !== null ? { text: `프롬프트에 켜지 못했어요. ${failure}`, failed: true } : prompts.length > 0 ? { text: `${quoted(prompts)} 프롬프트에 켰어요.`, failed: false } : null;
  const replaced = replacing && (replacing.failure !== null ? { text: `이전 버전과 바꾸지 못했어요. ${replacing.failure}`, failed: true }
    : { text: `${quoted(replacing.names)} 모듈을 바꿨어요.${replacing.places > 0 ? ' 원래 켜져 있던 위치에 그대로 적용했어요.' : ''}`, failed: false });
  const elsewhere = (paired !== null && !paired.failed) || (replacing !== null && replacing.failure === null && replacing.places > 0);
  // On for a prompt, or where the version it replaced was, it is not "on nowhere".
  const placed = placement.at === null && elsewhere ? null : placedLine('modules', placement);
  return { kind: 'module', file, id, title, lines: outcome([replaced, placed, paired]), missed: missedLines(unsupported) };
}

// character: the name of the one they went to, null for 캐릭터 없이.
export const chatOutcome = (file: string, ids: string[], character: string | null, missed: string[]): ImportOutcome =>
  ({ kind: 'chat', file, id: ids.length === 1 ? ids[0]! : null, title: file, lines: [{ text: putInto(character, '넣었어요.'), failed: false }], missed });

// modules: the names of the modules its preset named that were here, turned on for it. waiting: the names it gave that
// no module answered, as written.
export function promptOutcome(file: string, title: string, id: string, modules: string[], waiting: string[]): ImportOutcome {
  const paired = modules.length > 0 ? { text: [`${quoted(modules)} 모듈을 이 프롬프트에 켰어요.`, waiting.length > 0 && `${quoted(waiting)} 모듈은 가져오면 켜져요.`].filter(Boolean).join(' '), failed: false }
    : waiting.length > 0 ? { text: `${quoted(waiting)} 모듈은 가져오면 이 프롬프트에 켜져요.`, failed: false } : null;
  return { kind: 'prompt', file, id, title, lines: outcome([paired]), missed: [] };
}

export const personaOutcome = (file: string, title: string, { id, value }: Stored<'persona'>): ImportOutcome =>
  ({ kind: 'persona', file, id, title, lines: [], missed: cardMissed([], value.picture === null) });

const placedLine = (page: 'modules' | 'plugins', { at, failure }: Placement): Line => at === null
      ? { text: `아직 어디에도 켜지 않았어요. ${inSettings(page)}에서 켤 수 있어요.`, failed: false }
      : failure === null ? { text: `${PLACES[at]} 켰어요.`, failed: false } : { text: `${PLACES[at]} 켜지 못했어요. ${failure}`, failed: true };

export const toolOutcome = (file: string, title: string, saved: ToolImport, placement: Placement): ImportOutcome =>
  ({ kind: 'plugin', file, id: saved.id, title, lines: saved.previous ? [] : [placedLine('plugins', placement)], missed: [] });

// Keyed by every name in RISU_DECLINED.
export const DECLINED_WORDS: Record<string, string> = {
  'getRootDocument:page': '앱 화면 직접 바꾸기',
  addProvider: '모델 제공자 추가',
  registerBodyIntercepter: '모델 요청 내용 변경',
  unregisterBodyIntercepter: '모델 요청 내용 변경',
  addPluginChannelListener: '다른 플러그인과 주고받기',
  postPluginChannelMessage: '다른 플러그인과 주고받기',
};

// Names not mapped yet stay as the plugin writes them: the set is open (any upstream name), so no wording covers it.
function risuVerdict({ verdict, missing }: RisuScan): Line {
  const never = [...new Set(missing.filter((name) => RISU_DECLINED.has(name)).map((name) => DECLINED_WORDS[name]!))];
  const later = missing.filter((name) => !RISU_DECLINED.has(name));
  const listed = [never.length > 0 && `앞으로도 지원하지 않아요: ${never.join(', ')}.`, later.length > 0 && `아직 지원하지 않아요: ${later.join(', ')}.`].filter(Boolean).join(' ');
  switch (verdict) {
    case 'all': return { text: `이 ${RISU_PLUGIN}이 사용하는 기능을 모두 지원해요.`, failed: false };
    case 'partial': return { text: `이 ${RISU_PLUGIN}이 사용하는 기능 중 일부는 지원하지 않아요.`, failed: true, help: { label: '빠지는 기능', text: listed } };
    case 'unread': return { text: `이 ${RISU_PLUGIN}이 사용하는 기능을 모두 지원하는지 확인하지 못했어요.`, failed: true, help: { label: '확인하지 못한 이유', text: ['사용 중 일부 기능이 정상적으로 작동하지 않을 수 있어요.', listed].filter(Boolean).join(' ') } };
  }
}
