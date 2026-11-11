import { list, text } from '../../connectors/values';
import { isRecord } from '../../record';
import type { StatusApp, StatusBlock, StatusDefinition, StatusField, StatusFrame, StatusGroup, StatusItem, StatusLog, StatusMood, StatusTone, StatusView } from '../../model/status';
import { finite, record, strings, type Json } from './convert';

// A 상태 definition as a file of this app's holds it (engine/import/hazelle), read part by part: a file is not this
// build's to trust. What has no id, or is of a kind this build does not know, is left out; a 틀, a 분위기 and an app's
// picture are kept as written, since what draws them stands in for one it does not know (app/common/statusView).

const TONES = new Set<unknown>(['accent', 'warm', 'cool', 'fresh'] satisfies StatusTone[]);
const FIELD_LOOKS = new Set<unknown>(['bar', 'segments', 'ring', 'hearts', 'stars', 'thought', 'scale'] satisfies NonNullable<Extract<StatusBlock, { kind: 'field' }>['look']>[]);
const RECORD_LOOKS = new Set<unknown>(['cards', 'rows', 'table'] satisfies NonNullable<Extract<StatusBlock, { kind: 'records' }>['look']>[]);

const named = (raw: Json) => ({ id: text(raw.id), name: text(raw.name) });
const all = <T>(raw: unknown, read: (raw: Json) => T | undefined): T[] => list(raw).flatMap((each) => read(record(each)) ?? []);

const items = (raw: unknown): StatusItem[] => all(raw, (item) => (typeof item.text === 'string' ? { text: item.text, ...(item.done === true && { done: true as const }) } : undefined));

function field(raw: Json): StatusField | undefined {
  const common = { ...named(raw), ...(raw.main === true && { main: true as const }), ...(TONES.has(raw.tone) && { tone: raw.tone as StatusTone }) };
  if (!common.id) return undefined;
  const numeric = { ...(finite(raw.start) !== null && { start: raw.start as number }), ...(raw.change === true && { change: true as const }), ...(typeof raw.unit === 'string' && raw.unit && { unit: raw.unit }) };
  const start = typeof raw.start === 'string' ? { start: raw.start } : {};
  switch (raw.kind) {
    case 'gauge': {
      const min = finite(raw.min);
      const max = finite(raw.max);
      return min === null || max === null ? undefined : { ...common, kind: 'gauge', min, max, ...numeric };
    }
    case 'number':
      return { ...common, kind: 'number', ...numeric };
    case 'text':
      return { ...common, kind: 'text', ...start };
    case 'stage':
      return { ...common, kind: 'stage', labels: strings(raw.labels), ...start };
    case 'list':
      return { ...common, kind: 'list', ...(raw.checked === true && { checked: true as const }), ...(Array.isArray(raw.start) && { start: items(raw.start) }) };
    default:
      return undefined;
  }
}

function group(raw: Json): StatusGroup | undefined {
  const { id, name } = named(raw);
  const follows = record(raw.follows).folder;
  return id
    ? { id, name, fields: all(raw.fields, field), members: all(raw.members, (member) => (text(member.id) ? named(member) : undefined)), ...(raw.open === true && { open: true as const }), ...(typeof follows === 'string' && { follows: { folder: follows } }) }
    : undefined;
}

function log(raw: Json): StatusLog | undefined {
  const { id, name } = named(raw);
  return id ? { id, name, fields: all(raw.fields, field) } : undefined;
}

function block(raw: Json): StatusBlock | undefined {
  switch (raw.kind) {
    case 'head':
    case 'radar':
      return { kind: raw.kind, fields: strings(raw.fields) };
    case 'field':
      return { kind: 'field', field: text(raw.field), ...(FIELD_LOOKS.has(raw.look) && { look: raw.look as NonNullable<Extract<StatusBlock, { kind: 'field' }>['look']> }) };
    case 'records':
      return { kind: 'records', group: text(raw.group), ...(RECORD_LOOKS.has(raw.look) && { look: raw.look as NonNullable<Extract<StatusBlock, { kind: 'records' }>['look']> }) };
    case 'log':
      return { kind: 'log', log: text(raw.log), ...(raw.all === true && { all: true as const }), ...(raw.look === 'feed' && { look: 'feed' as const }) };
    case 'chat': {
      const mine = record(raw.mine);
      return {
        kind: 'chat',
        log: text(raw.log),
        by: text(raw.by),
        ...(typeof raw.from === 'string' && { from: raw.from }),
        ...(typeof mine.field === 'string' && typeof mine.is === 'string' && { mine: { field: mine.field, is: mine.is } }),
        ...(typeof raw.reply === 'string' && { reply: raw.reply }),
      };
    }
    case 'choices':
      return { kind: 'choices', field: text(raw.field) };
    case 'section':
      return { kind: 'section', name: text(raw.name), blocks: all(raw.blocks, block) };
    case 'tabs':
      return { kind: 'tabs', tabs: all(raw.tabs, (tab) => (text(tab.id) ? { ...named(tab), blocks: all(tab.blocks, block) } : undefined)) };
    default:
      return undefined;
  }
}

function view(raw: Json): StatusView | undefined {
  const { id, name } = named(raw);
  return id ? { id, name, frame: text(raw.frame) as StatusFrame, mood: text(raw.mood) as StatusMood, blocks: all(raw.blocks, block), ...(typeof raw.app === 'string' && { app: raw.app as StatusApp }) } : undefined;
}

// undefined: no definition is there, or what is there has no id to keep its values by.
export function readStatus(raw: unknown): StatusDefinition | undefined {
  if (!isRecord(raw) || !text(raw.id)) return undefined;
  const views = all(raw.views, view);
  return { ...named(raw), writer: raw.writer === 'with' ? 'with' : 'after', fields: all(raw.fields, field), groups: all(raw.groups, group), logs: all(raw.logs, log), ...(views.length > 0 && { views }) };
}

// In a file a 묶음's followed folder is named by its place among its pack's folders, as a lore entry's is: a folder's
// id is made anew where the file is read. One that is not among them is followed no more.
function refolded<P extends { status?: StatusDefinition }>(pack: P, to: (folder: string) => string | undefined): P {
  if (!pack.status?.groups.some(({ follows }) => follows)) return pack;
  const groups = pack.status.groups.map(({ follows, ...group }) => {
    const folder = follows && to(follows.folder);
    return folder === undefined ? group : { ...group, follows: { folder } };
  });
  return { ...pack, status: { ...pack.status, groups } };
}

// folders: the pack's folder ids, in order.
export const filed = <P extends { status?: StatusDefinition }>(pack: P, folders: readonly string[]) => refolded(pack, (id) => (folders.includes(id) ? `${folders.indexOf(id)}` : undefined));
export const unfiled = <P extends { status?: StatusDefinition }>(pack: P, folders: readonly string[]) => refolded(pack, (at) => (/^\d+$/u.test(at) ? folders[Number(at)] : undefined));
