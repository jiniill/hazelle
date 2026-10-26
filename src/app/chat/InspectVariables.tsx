import { useEffect, useMemo, useState } from 'react';
import { VARIABLE_LIMITS, type InspectedVariable, type VariableInspection } from '../../engine/render';
import { shown } from '../../model/chat';
import { inspectToggles } from '../../runtime/chat-context';
import { setVariableByHand } from '../../runtime/chat-log';
import type { Sending } from '../../runtime/turn-context';
import { writerName } from '../common/code/variables';
import { shownValue } from '../common/HookDetail';
import { useSearch } from '../common/useSearch';
import { UNKNOWN } from '../common/words';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Button, Empty, List, ListItem, Row, Section, Stack, Text, TextField } from '../ui';

// version: the last message's shown one, where the edit lands; undefined when the chat has no message. A value 점검
// shows cut is not edited: its draft would save the cut.
function ValueEditor({ chat, version, busy, variable, onDone }: { chat: string; version: string | undefined; busy: boolean; variable: InspectedVariable; onDone: () => void }) {
  const { store } = useSession();
  const toast = useToast();
  const [draft, setDraft] = useState(variable.last.value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const why = busy ? '응답을 생성하는 중에는 고칠 수 없어요.' : version === undefined ? '첫 메시지를 보내면 고칠 수 있어요.' : variable.nameTruncated || variable.last.truncated ? '값이 너무 길어서 여기서는 고칠 수 없어요.' : null;
  if (why || version === undefined) return <Text variant="note">{why}</Text>;
  const save = async () => {
    setSaving(true);
    const saved = await setVariableByHand(store, chat, version, variable.name, draft);
    setSaving(false);
    if (saved.ok) onDone();
    else if (saved.error === 'too-long') setError(`${VARIABLE_LIMITS.value}자까지 저장할 수 있어요.`);
    else toast.failed(saved);
  };
  return (
    <Stack gap="related">
      <TextField label="값" showLabel={false} value={draft} onChange={(value) => { setDraft(value); setError(null); }} lines={variable.last.value.includes('\n') ? 4 : undefined} error={error ?? undefined} />
      <Row kind="actions">
        <Button size="sm" busy={saving} disabled={draft === variable.last.value} onClick={() => void save()}>저장</Button>
        <Button variant="secondary" size="sm" onClick={onDone}>취소</Button>
      </Row>
    </Stack>
  );
}


export function Variables({ chat, sending, busy }: { chat: string; sending: Sending | null | undefined; busy: boolean }) {
  const { store, read } = useSession();
  const last = read.chat(chat).snapshot()?.messages.at(-1);
  const [inspected, setInspected] = useState<VariableInspection | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!sending || busy) return;
    const controller = new AbortController();
    store.evaluation.variables({ asker: 'view', chat }, sending.turn.scope, '', controller.signal).then(
      (result) => !controller.signal.aborted && setInspected(result),
      () => !controller.signal.aborted && setInspected(null),
    );
    return () => controller.abort();
  }, [chat, sending, busy]);
  const toggles = useMemo(() => (sending ? inspectToggles(store, sending.turn.chat) : []), [sending]);
  const variables = inspected?.variables ?? [];
  const search = useSearch(variables, '변수 검색', ({ name, last }) => [name, last.value]);
  return (
    <Stack gap="section">
      <Section title="변수" help="직접 수정한 변수 값은 마지막 메시지를 다시 생성하면 사라져요.">
        {inspected === undefined ? (
          <Text variant="note">읽는 중…</Text>
        ) : inspected === null ? (
          <Empty variant="section">변수를 읽지 못했어요.</Empty>
        ) : variables.length === 0 ? (
          <Empty variant="section">이 채팅에는 변수가 없어요.</Empty>
        ) : (
          <Stack gap="related">
            {search.field}
            {search.none ?? (
              <List label="변수">
                {search.found.map((variable) => (
                  <ListItem
                    key={variable.name}
                    title={variable.name}
                    description={shownValue(variable.last.value, variable.last.truncated)}
                    note={writerName(variable.last.writer)}
                    expanded={open === variable.name}
                    onClick={() => setOpen(open === variable.name ? null : variable.name)}
                    detail={
                      open === variable.name && (
                        <Stack gap="related">
                          <ValueEditor chat={chat} version={last && shown(last).id} busy={busy} variable={variable} onDone={() => setOpen(null)} />
                          <List label={`${variable.name} 기록`}>
                            {[...variable.history].reverse().map((write, index) => (
                              <ListItem key={index} title={shownValue(write.value, write.truncated)} note={writerName(write.writer)} />
                            ))}
                          </List>
                        </Stack>
                      )
                    }
                  />
                ))}
              </List>
            )}
            {inspected.omitted > 0 && <Text variant="note">{`변수 ${inspected.omitted}개는 너무 많아서 보여 주지 않아요.`}</Text>}
          </Stack>
        )}
      </Section>
      {toggles.length > 0 && (
        <Section title="토글" help="봇이 toggle_이라는 이름으로 읽는 값이에요.">
          <List label="토글">
            {toggles.map(({ declaration, value }) => (
              <ListItem key={declaration.key} title={declaration.label || declaration.key} code={`toggle_${declaration.key}`} note={value === null ? UNKNOWN : shownValue(value, false)} />
            ))}
          </List>
        </Section>
      )}
    </Stack>
  );
}
