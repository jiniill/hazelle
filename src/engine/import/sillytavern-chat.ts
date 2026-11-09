import { count, isRecord, jsonObject, list } from '../../connectors/values';
import { add, counted, record, text, type Json, type Tally } from './convert';
import type { RisuChats } from './risu-character';
import { MOVE_UNSUPPORTED_KINDS, type MoveUnsupportedKind, type RisuMessage, type Said } from './types';

export const SILLYTAVERN_CHAT = '.jsonl';

// SillyTavern's chat file (.jsonl): a header line (user_name, character_name, chat_metadata), then one message a line.
// title: the file's name, which is the chat's name in SillyTavern. null for any other text.
export function sillyTavernChat(file: string, title: string): RisuChats | null {
  const [header, ...rows] = file.split('\n').filter((line) => line.trim()).map(jsonObject);
  if (!header || typeof header.user_name !== 'string' || typeof header.character_name !== 'string' || 'mes' in header) return null;
  if (!rows.every((row) => row !== null && typeof row.mes === 'string')) return null;
  const messages = rows as Json[];
  const missed: Tally<MoveUnsupportedKind> = new Map();
  // The character's opening message is the greeting it chose, one of the card's, which the card draws here; its swipes
  // are the card's greetings in order.
  const opening = messages[0] && messages[0].is_user !== true && messages[0].is_system !== true && !narrated(messages[0]) ? messages[0] : null;
  let at = sentAt(header.create_date) ?? 0;
  const said = (mes: unknown, date: unknown, extra: Json): Said => {
    at = sentAt(date) ?? at;
    const reasoning = text(extra.reasoning);
    return { text: text(mes), at, ...(reasoning && { reasoning }) };
  };
  const line = (opening ? messages.slice(1) : messages).map((row): RisuMessage => {
    const extra = record(row.extra);
    // SillyTavern leaves a hidden message, a comment or a notice of its own out of the prompt.
    if (row.is_system === true) add(missed, 'hidden-message');
    // A narrator's message goes to the model as system, a role a message here does not have.
    else if (narrated(row)) add(missed, 'system-message');
    add(missed, 'inlay', list(extra.media).length + (text(extra.image) ? 1 : 0));
    add(missed, 'attachment', list(extra.files).length + (isRecord(extra.file) ? 1 : 0));
    const role = row.is_user === true ? 'user' : 'assistant';
    const swipes = list(row.swipes);
    const selected = count(row.swipe_id);
    if (swipes.length < 2 || selected === null || selected >= swipes.length) return { role, ...said(row.mes, row.send_date, extra) };
    // The shown swipe is the message itself; its place in swipes may be stale.
    const info = list(row.swipe_info);
    const [first, ...later] = swipes.map((swipe, index) => {
      const each = record(info[index]);
      return index === selected ? said(row.mes, row.send_date, extra) : said(swipe, each.send_date, record(each.extra));
    });
    return { role, ...first!, versions: { later, selected } };
  });
  const variables = Object.entries(record(record(header.chat_metadata).variables)).map(([name, value]): [string, string] => [name, typeof value === 'string' ? value : JSON.stringify(value)]);
  const note = text(record(header.chat_metadata).note_prompt);
  return {
    chats: [{ title, note: note.trim() ? note : null, persona: null, greeting: (opening && count(opening.swipe_id)) ?? 0, variables, inlays: [], messages: line, lore: [], loreFolders: [], memory: [], folder: null }],
    missed: counted(MOVE_UNSUPPORTED_KINDS, missed),
  };
}

const narrated = (row: Json) => record(row.extra).type === 'narrator';

const MONTHS = 'janfebmaraprmayjunjulaugsepoctnovdec';

// SillyTavern's send_date: ISO in current files; milliseconds, "June 19, 2023 2:20pm" (local time) or
// "2024-7-12@01h31m37s123ms" (UTC, spaced in some versions) in older ones.
function sentAt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const date = text(value);
  if (/^\d+$/.test(date)) return Number(date);
  const humanized = /(\d{4})-(\d{1,2})-(\d{1,2}) ?@(\d{1,2})h ?(\d{1,2})m ?(\d{1,2})s(?: ?(\d{1,3})ms)?/.exec(date);
  if (humanized) {
    const [year, month, day, hour, minute, second, ms] = humanized.slice(1).map((part) => Number(part ?? 0));
    return Date.UTC(year!, month! - 1, day, hour, minute, second, ms);
  }
  const meridiem = /([a-z]+)\s(\d{1,2}),\s(\d{4})\s(\d{1,2}):(\d{1,2})(am|pm)/i.exec(date);
  const month = meridiem ? MONTHS.indexOf(meridiem[1]!.slice(0, 3).toLowerCase()) : -1;
  if (meridiem && month % 3 === 0) {
    const [, , day, year, hour, minute, half] = meridiem;
    return new Date(Number(year), month / 3, Number(day), (Number(hour) % 12) + (half!.toLowerCase() === 'pm' ? 12 : 0), Number(minute)).getTime();
  }
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? null : parsed;
}
