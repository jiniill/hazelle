import { useState } from 'react';
import { detect } from '../../connectors/registry';
import type { ConnectionType, KeyParts } from '../../connectors/types';
import { ACTS, importOf, newOf } from '../common/acts';
import { Callout, Disclosure, FileButton, Link, Stack, TextField } from '../ui';
import { KEY_OPTIONAL } from './connect';

// type null: a 직접 연결, which may need no key and takes any.
export function KeyField({ type, value, onChange }: { type: ConnectionType | null; value: string; onChange: (key: string) => void }) {
  const form = type?.keyForm;
  const other = type && detect(value.trim());
  const elsewhere = other?.kind === 'key' && other.type !== type ? other.type : null;
  return (
    <Stack>
      <TextField
        label={form?.label ?? 'API 키'}
        kind="key"
        lines={form?.lines}
        placeholder={form?.placeholder}
        value={value}
        onChange={onChange}
        help="키는 암호화해서 저장하고, 서버에는 남기지 않아요."
        hint={type ? undefined : KEY_OPTIONAL}
        action={
          form && (
            <FileButton accept={form.accept} size="sm" icon={ACTS.import.icon} onFiles={([file]) => void file!.text().then(onChange)}>
              {importOf('파일')}
            </FileButton>
          )
        }
      />
      {form?.parts && <PartFields parts={form.parts} onChange={onChange} />}
      {type?.keyPage && <Link href={type.keyPage}>{new URL(type.keyPage).host}에서 키 만들기</Link>}
      {elsewhere && <Callout tone="warn">{elsewhere.label} 키 같아요. {newOf('연결')}에서 다시 선택해 주세요.</Callout>}
    </Stack>
  );
}

// Typing here makes the key above anew, so the values stand in for whatever was pasted there.
function PartFields({ parts, onChange }: { parts: KeyParts; onChange: (key: string) => void }) {
  const [values, setValues] = useState(() => Object.fromEntries(parts.fields.map(({ id }) => [id, ''])));
  function change(id: string, value: string) {
    const next = { ...values, [id]: value };
    setValues(next);
    onChange(parts.join(next));
  }
  return (
    <Disclosure label={parts.label}>
      <Stack>
        {parts.fields.map((field) => (
          <TextField key={field.id} label={field.label} kind="key" lines={field.lines} placeholder={field.placeholder} help={field.help} value={values[field.id]!} onChange={(value) => change(field.id, value)} />
        ))}
      </Stack>
    </Disclosure>
  );
}
