import type { InspectedVariable, VariableWriter } from '../../../engine/render';
import type { CodeDoc, CodeItem } from '../../ui';
import { shownValue } from '../HookDetail';
import { UNKNOWN } from '../words';

export type Defaults = readonly (readonly [string, string])[];

// A chat's variables as 시험해 보기 read them, by name. partial: the read stopped short or the chat holds more than were read, so a name missing
// here may still be set.
export type ChatVariables = { label: string; values: ReadonlyMap<string, InspectedVariable>; partial: boolean };

export type Variables = { defaults: Defaults; chat: ChatVariables | null };

const SCRIPT_STAGE = { input: '입력', output: '출력', greeting: '첫 메시지', staged: '대기 중인 메시지' } as const;

export function writerName(writer: VariableWriter): string {
  switch (writer.kind) {
    case 'card':
      return '캐릭터 기본값';
    case 'chat':
      return '채팅에 저장된 값';
    case 'pending':
      return '이번 전송';
    case 'script':
      return `${writer.index + 1}번째 메시지 · 스크립트`;
    case 'cbs':
      return `${writer.index + 1}번째 메시지 · ${SCRIPT_STAGE[writer.stage]} CBS`;
    case 'hand':
      return `${writer.index + 1}번째 메시지 · 직접 수정`;
  }
}

// The chat's variable of that name: null when the chat has none, undefined when it was not read or may be past what was.
export function chatVariable({ chat }: Variables, name: string): InspectedVariable | null | undefined {
  const found = chat?.values.get(name);
  return found ?? (chat && !chat.partial ? null : undefined);
}

// stored: the name the chat keeps it under, when the code names it otherwise (Lua's getState adds `__`).
export function variableDoc(name: string, variables: Variables, stored = name): CodeDoc {
  const fallback = variables.defaults.find(([known]) => known === stored)?.[1];
  const facts: [string, string][] = [['기본 변수', fallback ?? '없음']];
  if (variables.chat) {
    const found = chatVariable(variables, stored);
    facts.push(['채팅', variables.chat.label], ['지금 값', found ? shownValue(found.last.value, found.last.truncated) : found === null ? '없음' : UNKNOWN]);
    if (found) facts.push(['정한 곳', writerName(found.last.writer)]);
  }
  return { form: name, text: '채팅 변수예요.', facts };
}

// written: the names the text itself uses, after the 기본 변수 and the chat's. prefix: the part of the stored name the
// code leaves out, whose names alone are offered.
export function variableItems(variables: Variables, written: Iterable<string>, prefix = ''): CodeItem[] {
  const stored = [...variables.defaults.map(([name]) => name), ...(variables.chat?.values.keys() ?? [])];
  const names = new Set([...stored.flatMap((name) => (name.startsWith(prefix) && name !== prefix ? [name.slice(prefix.length)] : [])), ...written]);
  return [...names].map((name) => {
    const found = chatVariable(variables, prefix + name);
    const detail = found ? shownValue(found.last.value, found.last.truncated) : variables.defaults.find(([known]) => known === prefix + name)?.[1];
    return { label: name, kind: 'variable', detail, doc: variableDoc(name, variables, prefix + name) };
  });
}
