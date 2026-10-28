import { useState } from 'react';
import { compileRule } from '../../engine/protect';
import { EntryList } from '../common/EntryList';
import { Disclosure, Hint, Stack, TextField } from '../ui';

const HELP = { translate: '정규식에 맞는 부분은 번역하지 않고 그대로 둬요.', agent: '정규식과 일치하는 부분은 수정하지 않고 유지해요.' };
const ALWAYS = '코드 블록, HTML 주석, 이미지 태그는 항상 보호돼요.';

type Props = { task: keyof typeof HELP; rules: readonly string[]; onChange: (rules: string[] | undefined) => void };

// The rows are saved only while every one reads as a pattern, so a prompt never stores one the translation would
// refuse; blank rows are left out.
export function ProtectRules({ task, rules, onChange }: Props) {
  const [rows, setRows] = useState(() => [...rules]);
  const [open, setOpen] = useState(rules.length > 0);
  const change = (next: string[]) => {
    setRows(next);
    const kept = next.filter((row) => row !== '');
    if (kept.every(compileRule)) onChange(kept.length ? kept : undefined);
  };
  const count = rows.filter((row) => row !== '').length;
  return (
    <Disclosure label={count ? `보호 패턴 · ${count}개` : '보호 패턴'} open={open} onOpen={setOpen} menu={<Hint label="보호 패턴">{`${HELP[task]} ${ALWAYS}`}</Hint>}>
      <Stack gap="related">
        <EntryList entries={rows} onChange={change} name={(index) => `패턴 ${index + 1}`} blank="" addLabel="패턴 추가" removed={(index) => `${index + 1}번째 패턴을 삭제했어요.`}>
          {({ value, name, set, remove }) => <TextField label={name} kind="key" value={value} onChange={set} error={value && !compileRule(value) ? '정규식 형식이 올바르지 않아요. 수정할 때까지 저장되지 않아요.' : undefined} action={remove} />}
        </EntryList>
      </Stack>
    </Disclosure>
  );
}
