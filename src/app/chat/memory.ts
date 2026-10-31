import { isChapter, type RecordStatus, type Staleness } from '../../engine/memory';
import type { Chapter, Fact, Memory, MemoryRecord, Source, Written } from '../../model/memory';
import { CHAPTER } from '../common/words';

const STATUS_WORDS: Record<RecordStatus, string> = { sent: '보냄', stale: '원문 바뀜', over: '한도 넘음', forgotten: '삭제됨', chaptered: `${CHAPTER}로 보냄`, 'recall-over': '요약 보냄' };

export const statusWord = (status: RecordStatus | undefined, stale: Staleness | undefined) =>
  status === 'sent' && stale === 'rendered' ? ['원문 불일치'] : status === undefined || status === 'sent' ? [] : [status === 'stale' && stale === 'records' ? '기록 바뀜' : STATUS_WORDS[status]];

export const recordTitle = (item: MemoryRecord | Chapter) => item.what.trim() || (isChapter(item) ? `내용 없는 ${CHAPTER}` : '내용 없는 기록');

export const recordScene = (item: Written) => [item.when, item.where].filter(Boolean).join(' · ');

// The 기록 list in chat order: a chapter in its first record's place, its records only on its page.
export function memoryRows(memory: Memory): (MemoryRecord | Chapter)[] {
  const holder = new Map(memory.chapters.flatMap((chapter) => chapter.records.map(({ id }) => [id, chapter] as const)));
  return memory.records.flatMap((record): (MemoryRecord | Chapter)[] => {
    const chapter = holder.get(record.id);
    return !chapter ? [record] : chapter.records[0]!.id === record.id ? [chapter] : [];
  });
}

export class MessagePositions {
  private messages: readonly { id: string }[] | undefined;
  private places: ReadonlyMap<string, number> = new Map();

  read(messages: readonly { id: string }[]): ReadonlyMap<string, number> {
    if (messages === this.messages) return this.places;
    this.messages = messages;
    // Streamed text and version changes do not move a source; only message identity and order invalidate the index.
    if (messages.length !== this.places.size || messages.some(({ id }, at) => this.places.get(id) !== at)) {
      this.places = new Map(messages.map(({ id }, at) => [id, at]));
    }
    return this.places;
  }
}

// A record's messages as the chat shows them now, counted from 1: the ones still there, to jump to, and how many are
// gone, which a deletion leaves until the user decides.
export function spanOf(sources: readonly Source[], positions: ReadonlyMap<string, number>): { words: string; there: string[] } {
  const there: string[] = [];
  let from = Infinity;
  let to = -Infinity;
  for (const { message } of sources) {
    const at = positions.get(message);
    if (at === undefined) continue;
    there.push(message);
    from = Math.min(from, at + 1);
    to = Math.max(to, at + 1);
  }
  const gone = sources.length - there.length;
  if (there.length === 0) return { words: `삭제된 메시지 ${gone}개`, there };
  const span = from === to ? `${from}번째 메시지` : `메시지 ${from}~${to}`;
  return { words: gone ? `${span} · 삭제된 메시지 ${gone}개` : span, there };
}

export function factGroups(state: readonly Fact[]): { about: string; facts: Fact[] }[] {
  const groups = new Map<string, Fact[]>();
  for (const fact of state) {
    const facts = groups.get(fact.about);
    if (facts) facts.push(fact);
    else groups.set(fact.about, [fact]);
  }
  return [...groups].map(([about, facts]) => ({ about, facts }));
}
