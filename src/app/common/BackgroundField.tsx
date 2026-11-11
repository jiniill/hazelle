import type { PackOwner } from '../../model/library';
import { setBackground } from '../../runtime/library/pack';
import { useStore } from '../session';
import { SHORTCUTS } from '../shortcuts';
import type { CodeLanguage } from '../ui';
import { CountedField } from './CountedFields';
import { useAutosave } from './useAutosave';
import { BACKGROUND_HTML } from './words';

// A character's or a module's 배경 HTML (Risu's backgroundHTML), as a card brought from Risu holds it (design §6.4).
export function BackgroundField({ owner, html, language }: { owner: PackOwner; html: string | undefined; language: CodeLanguage }) {
  const store = useStore();
  const save = useAutosave<{ html: string }>(`background:${owner.kind}:${owner.id}`, ({ html = '' }) => setBackground(store, owner, html));
  return (
    <CountedField
      label={BACKGROUND_HTML}
      lines={6}
      expand={SHORTCUTS.bigEdit.keys}
      language={language}
      value={save.unsaved.html ?? html ?? ''}
      onChange={(next) => save.change({ html: next })}
      help="<style>은 채팅 메시지에만 적용되고, 나머지 HTML은 채팅 화면 뒤에 표시돼요."
    />
  );
}
