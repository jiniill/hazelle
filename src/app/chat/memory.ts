import { isChapter, type RecordStatus, type Staleness } from '../../engine/memory';
import type { Chapter, Fact, Memory, MemoryRecord, Source, Written } from '../../model/memory';
import type { LogEntry } from '../../runtime/models/request-log';
import type { MemoryFailure } from '../../runtime/tasks/memory';
import type { MemoryView } from '../../runtime/tasks/memory-view';
import type { GapCause } from '../../contracts/auto-diagnosis';
import { CHAPTER, MEMORY_BUDGET, MEMORY_GAP, MEMORY_WORKING } from '../common/words';

export const STALE = '원문 바뀜';

// Why messages leave a request, as leavingCauses names it: the composer's note shows the first cause's words and every
// cause's sentence; the memory panel says the over one beside its records.
export const LEAVING: Record<GapCause, { words: string; why: string }> = {
  working: { words: MEMORY_WORKING, why: '장기 기억을 정리하는 중이에요.' },
  failed: { words: '기억 정리 실패', why: '장기 기억 정리가 실패해서 멈췄어요. 눌러서 다시 시도할 수 있어요.' },
  tool: { words: '플러그인 응답 전', why: '장기 기억을 맡은 플러그인이 아직 응답하지 않아서 보내기 전에는 정확한 수를 알 수 없어요.' },
  off: { words: '장기 기억 꺼짐', why: '컨텍스트 한도에 맞추느라 오래된 메시지가 빠지는데, 장기 기억이 꺼져 있어요.' },
  'no-slot': { words: '프롬프트에 기억 없음', why: '기록은 있지만 프롬프트에 장기 기억 블록이 없거나 토글로 꺼져 있어서 보내지 않아요.' },
  stale: { words: STALE, why: '원문 메시지가 수정되거나 삭제된 기록은 다시 만들 때까지 보내지 않아요.' },
  over: { words: '기록 한도 넘음', why: '기록이 이 요청의 한도를 넘어서 오래된 기록부터 빠져요. 컨텍스트 길이가 짧은 모델이면 한도도 줄어요.' },
  forgotten: { words: '기록 삭제됨', why: '삭제한 기록의 메시지는 요청에도 기억에도 없어요.' },
  unrecorded: { words: '기록에서 빠짐', why: '이미 정리된 구간 사이에 넣은 메시지는 장기 기억에 들어가지 않아요.' },
  'no-room': { words: '컨텍스트 부족', why: '컨텍스트 한도에 맞추느라 오래된 메시지가 빠지는데, 아직 장기 기억에 없어요.' },
  unknown: { words: MEMORY_GAP, why: '오래된 메시지가 요청에서 빠지는데, 장기 기억에도 없어요.' },
};

// What the panel says of the records a request leaves out for the budget, those under a chapter left out among them;
// null when nothing is left out, when the pinned ones take the whole budget (said apart) or when no memory is sent.
// Raising 기록 is offered only while the setting, not the model's room, is what binds.
export function overNote(memory: Memory, view: Pick<MemoryView, 'records' | 'slot' | 'crowded' | 'tokens' | 'setup'>): string | null {
  const count = memory.records.filter(({ id }) => view.records.get(id) === 'over').length;
  if (!count || !view.slot || view.crowded) return null;
  const raise = view.tokens.budget < view.setup.budget ? '' : ` 아래 설정의 ${MEMORY_BUDGET}에서 한도를 늘릴 수 있어요.`;
  return `기록 ${count}개를 보내지 않아요. ${LEAVING.over.why}${raise}`;
}

// The failure the panel says as the job's own: under the chat's verdict a refusal is the verdict's, which its notice says once.
export const ownFailure = (failure: MemoryFailure | undefined, stuck: boolean) => (stuck && failure?.kind === 'unsaved' && failure.refused ? undefined : failure);

// The call a failed memory job made, while the request log still holds its answer to show; null otherwise.
export function answeredCall(failure: MemoryFailure, entries: readonly LogEntry[]): string | null {
  const call = 'receipt' in failure ? failure.receipt?.id : undefined;
  return entries.some(({ receipt, response }) => receipt.id === call && response !== null) ? call! : null;
}

const STATUS_WORDS: Record<RecordStatus, string> = { sent: '보냄', stale: STALE, over: '한도 넘음', forgotten: '삭제됨', chaptered: `${CHAPTER}로 보냄`, 'recall-over': '기록으로 보냄' };

export const statusWord = (status: RecordStatus | undefined, stale: Staleness | undefined) =>
  status === 'sent' && stale ? [stale === 'rendered' ? '원문 불일치' : STATUS_WORDS.stale] : status === undefined || status === 'sent' ? [] : [status === 'stale' && stale === 'records' ? '기록 바뀜' : STATUS_WORDS[status]];

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
