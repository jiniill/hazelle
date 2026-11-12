import { useState, type ReactNode } from 'react';
import { fieldValue } from '../../engine/import/tool';
import { setToolSettings } from '../../runtime/tools/store';
import type { Settings, ToolField } from '../../tool-api/manifest';
import { useSession } from '../session';
import { ChoiceGroup, NumberInput, SettingRow, Switch, TextField } from '../ui';
import { typedText } from './typed';
import { readTyped } from './typedNumber';
import { useAutosave } from './useAutosave';
import { TOOL_FIELD_CHANGED, FIELD_ERRORS } from './words';

const readNumber = (text: string) => {
  const typed = readTyped(text, false);
  return typed.ok ? typed.value : null;
};
type SettingProps = { module: string; field: ToolField; value: Settings[string] | undefined };

export function ToolSetting({ module, field, value: stored }: SettingProps) {
  const session = useSession();
  const save = useAutosave<{ value: Settings[string] }>(`tool-setting:${module}:${field.key}`, ({ value }) => setToolSettings(session, module, { [field.key]: value! }));
  const [typed, setTyped] = useState<string>();
  const value = save.unsaved.value ?? stored;
  const changedType = value !== undefined && !fieldValue(field, value);
  const row = (control: ReactNode, error: string | undefined, wide?: boolean) => <SettingRow label={field.label} wide={wide} error={error} note={error ? undefined : save.words} control={control} />;
  if (field.type === 'number') {
    const text = typedText<Settings[string] | undefined>(typed, readNumber, value, (current) => current === undefined ? '' : String(current));
    const invalid = (typed !== undefined || value !== undefined) && readNumber(text) === null;
    return row(<NumberInput label={field.label} value={text} invalid={invalid} onChange={(text) => {
      setTyped(text);
      const number = readNumber(text);
      save.change({ value: number ?? text }, number !== null);
    }} />, invalid ? FIELD_ERRORS.number : undefined);
  }
  const error = changedType ? TOOL_FIELD_CHANGED : undefined;
  if (field.type === 'text') return row(<TextField label={field.label} showLabel={false} value={value === undefined ? '' : String(value)} onChange={(value) => save.change({ value })} />, error, true);
  if (field.type === 'switch') return row(<Switch label={field.label} checked={value === true} onChange={(value) => void save.save({ value })} />, error);
  return row(<ChoiceGroup layout="fit" label={field.label} options={(field.options ?? []).map((option) => ({ value: option, label: option }))} value={typeof value === 'string' ? value : null} onChange={(value) => void save.save({ value })} />, error);
}
