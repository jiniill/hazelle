import { useState } from 'react';
import { TextField } from '../ui';
import { filled, typedText } from './typed';
import { FIELD_ERRORS } from './words';

type Identity = { name: string; alias: string };

// A character's or persona's 이름 and 별명. A blank name is shown with its error and never saved, so the stored one stays.
// focus: the name takes the focus as it appears, selected to type over, as on a thing just made.
export function useIdentityFields({ name, alias, nameHelp, aliasExample, focus, onChange }: Identity & { nameHelp?: string; aliasExample: string; focus?: boolean; onChange: (patch: Partial<Identity>, valid?: boolean) => void }) {
  const [typed, setTyped] = useState<string>();
  const shown = typedText(typed, filled, name, String);
  const fields = (
    <>
      <TextField
        label="이름"
        focus={focus && 'select'}
        value={shown}
        help={nameHelp}
        error={shown.trim() ? undefined : FIELD_ERRORS.name}
        onChange={(value) => {
          setTyped(value);
          onChange({ name: value }, !!value.trim());
        }}
      />
      <TextField label="별명" value={alias} placeholder={`예: ${aliasExample}`} help="나만 볼 수 있는 이름이에요." onChange={(value) => onChange({ alias: value })} />
    </>
  );
  return { name: shown, fields };
}
