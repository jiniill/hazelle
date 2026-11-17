import { describe, expect, it } from 'vitest';
import type { Receipt } from '../../model/chat';
import type { Memory, MemoryRecord } from '../../model/memory';
import type { LogEntry } from '../../runtime/models/request-log';
import type { MemoryFailure } from '../../runtime/tasks/memory';
import { answeredCall, factGroups, MessagePositions, overNote, ownFailure, spanOf } from './memory';

const source = (message: string) => ({ message, version: `${message}-v` });
const messages = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

describe('a record in the memory panel', () => {
  it('names its messages by their place now, counting the deleted ones apart', () => {
    const index = new MessagePositions();
    const positions = index.read(messages);
    expect(spanOf([source('b'), source('c')], positions)).toEqual({ words: '메시지 2~3', there: ['b', 'c'] });
    expect(spanOf([source('x'), source('d')], positions)).toEqual({ words: '4번째 메시지 · 삭제된 메시지 1개', there: ['d'] });
    expect(spanOf([source('x'), source('y')], positions)).toEqual({ words: '삭제된 메시지 2개', there: [] });
    expect(index.read(messages)).toBe(positions);
    expect(index.read(messages.map(({ id }) => ({ id, text: 'streamed text', version: 'changed' })))).toBe(positions);
    const reordered = index.read([{ id: 'd' }, { id: 'b' }, { id: 'e' }]);
    expect(reordered).not.toBe(positions);
    expect(spanOf([source('b'), source('c'), source('d')], reordered)).toEqual({ words: '메시지 1~2 · 삭제된 메시지 1개', there: ['b', 'd'] });
    const replaced = index.read([{ id: 'd' }, { id: 'b' }, { id: 'c' }]);
    expect(replaced).not.toBe(reordered);
    expect(spanOf([source('e'), source('c')], replaced)).toEqual({ words: '3번째 메시지 · 삭제된 메시지 1개', there: ['c'] });
  });

  it('groups the state by whom it concerns, in first appearance order', () => {
    const fact = (about: string, field: string) => ({ about, field, value: '', record: null });
    expect(factGroups([fact('하나', '나이'), fact('둘', '사는 곳'), fact('하나', '말투')]).map(({ about, facts }) => [about, facts.map(({ field }) => field)])).toEqual([
      ['하나', ['나이', '말투']],
      ['둘', ['사는 곳']],
    ]);
  });
});

describe('the memory panel over the budget and after a failure', () => {
  it('counts the records the budget leaves out, offers raising 기록 only while the setting binds, and says nothing when no memory is sent', () => {
    const memory = { records: ['r1', 'r2', 'r3'].map((id) => ({ id }) as MemoryRecord), chapters: [], state: [], threads: [] } as Memory;
    const records = new Map([['r1', 'over'], ['r2', 'over'], ['r3', 'sent'], ['c1', 'over']] as const);
    const view = { records, slot: true, crowded: false, tokens: { budget: 25_000 }, setup: { budget: 25_000 } } as unknown as Parameters<typeof overNote>[1];
    expect(overNote(memory, view)).toMatch(/^기록 2개를 보내지 않아요\. .* 아래 '기록' 설정에서 한도를 늘릴 수 있어요\.$/);
    expect(overNote(memory, { ...view, tokens: { ...view.tokens, budget: 16_000 } })).not.toContain('한도를 늘릴');
    expect(overNote(memory, { ...view, slot: false })).toBeNull();
    expect(overNote(memory, { ...view, crowded: true })).toBeNull();
    expect(overNote(memory, { ...view, records: new Map() })).toBeNull();
  });

  it("names a failed job's call only while the request log holds that call's answer", () => {
    const receipt = { id: 'call' } as Receipt;
    const entry = (response: string | null) => ({ receipt, response }) as LogEntry;
    const invalid = { kind: 'invalid', receipt, reason: 'unreadable' } as MemoryFailure;
    expect(answeredCall(invalid, [entry('{"chapter": ')])).toBe('call');
    expect(answeredCall(invalid, [entry(null)])).toBeNull();
    expect(answeredCall(invalid, [])).toBeNull();
    expect(answeredCall({ kind: 'tokenizer' }, [entry('{')])).toBeNull();
  });

  it("leaves a refusal to the verdict's notice while the verdict stands, and says it as the job's once it is lifted", () => {
    const refused = { kind: 'unsaved', failure: { ok: false, error: 'bot-stuck' }, refused: true } as MemoryFailure;
    const silent = { ...refused, refused: false } as MemoryFailure;
    expect([ownFailure(refused, true), ownFailure(refused, false), ownFailure(silent, true), ownFailure(undefined, true)]).toEqual([undefined, refused, silent, undefined]);
  });
});
