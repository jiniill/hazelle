import { CountedField } from './CountedFields';
import type { Write } from './saveQueue';
import { useAutosave } from './useAutosave';
import { NOTE_PLACEHOLDER, TRANSLATOR_NOTE } from './words';

type Props = { saveKey: string; stored: string | undefined; write: (note: string) => ReturnType<Write<{ note: string }>>; help: string; error?: string };

export function TranslatorNoteField({ saveKey, stored, write, help, error }: Props) {
  const save = useAutosave<{ note: string }>(saveKey, ({ note = '' }) => write(note));
  return <CountedField label={TRANSLATOR_NOTE} lines={6} value={save.unsaved.note ?? stored ?? ''} onChange={(note) => save.change({ note })} placeholder={NOTE_PLACEHOLDER} help={help} error={error} />;
}
