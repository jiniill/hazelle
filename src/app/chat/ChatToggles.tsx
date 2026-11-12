import { Pin } from 'lucide-react';
import { useState } from 'react';
import type { Toggle } from '../../model/prompt';
import { pinToggle } from '../../runtime/library/characters';
import { ToggleFlip } from '../common/ToggleChoice';
import { ToggleList } from '../common/ToggleList';
import { useAutosave } from '../common/useAutosave';
import { useSearch } from '../common/useSearch';
import { onOff, PAGES, RESET, EMPTY_VALUE, searchOf } from '../common/words';
import { useSettings, useStore } from '../session';
import { ChoiceGroup, Empty, IconButton, MenuItem, MoreMenu, Section, SettingRow, SidePanel, Stack, TextField } from '../ui';
import { TogglePresets } from './TogglePresets';
import { shownRows, toggleSaveKey, type ToggleRow, type ToggleSection } from './toggles';
import type { OpenChat } from './useChat';

const defaultOf = (toggle: Toggle) =>
  `기본값: ${toggle.kind === 'check' ? onOff(toggle.default === '1') : toggle.kind === 'choice' ? (toggle.options[Number(toggle.default)] ?? toggle.default) : toggle.default || EMPTY_VALUE}`;

const FROM: Record<ToggleSection['from'], string> = { prompt: '프롬프트', card: '캐릭터', module: PAGES.modules };

type Props = Pick<OpenChat, 'card' | 'toggles' | 'toggleOwner'> & {
  onFlip: OpenChat['actions']['flip'];
  onWrite: OpenChat['actions']['writeToggle'];
  onReset: () => void;
  onPreset: OpenChat['actions']['pickPreset'];
  sectionNow: OpenChat['actions']['sectionNow'];
  onEdit: (section: ToggleSection) => void;
  onClose: () => void;
};

export function ChatToggles({ card, toggles, toggleOwner, onFlip, onWrite, onReset, onPreset, sectionNow, onEdit, onClose }: Props) {
  const store = useStore();
  const pinned = new Set(useSettings().pinnedToggles);
  const [filter, setFilter] = useState<'all' | 'changed'>('all');
  const all = toggles.sections.flatMap((section) => section.rows);
  const changedKeys = () => new Set(all.filter((row) => row.changed).map((row) => row.toggle.key));
  const [first, setFirst] = useState(changedKeys);
  const search = useSearch(all, searchOf('토글'), (row) => [row.toggle.label]);
  const found = new Set(search.found);
  const laying = filter === 'all' && !search.words;
  const visible = toggles.sections
    .map((section) => ({ ...section, shown: shownRows(section.rows, found, filter === 'changed', first) }))
    .filter((section) => section.shown.length > 0);

  function show(next: typeof filter) {
    setFilter(next);
    setFirst(changedKeys());
  }

  const row = ({ toggle, value, changed }: ToggleRow) => (
    <SettingRow
      key={toggle.key}
      label={toggle.label}
      changed={changed}
      description={changed ? defaultOf(toggle) : undefined}
      wide={toggle.kind === 'text'}
      action={toggle.kind !== 'text' && <IconButton icon={Pin} size="sm" label="입력창에 고정" pressed={pinned.has(toggle.key)} onClick={() => void pinToggle(store, toggle.key, !pinned.has(toggle.key))} />}
      control={
        toggle.kind === 'text' ? (
          <TextToggle toggle={toggle} value={value} owner={toggleOwner} write={onWrite} />
        ) : (
          <ToggleFlip toggle={toggle} value={value} onFlip={onFlip} />
        )
      }
    />
  );
  return (
    <SidePanel
      title="토글"
      description={all.length > 0 ? (card ? `${card.name}의 모든 채팅에 적용` : '캐릭터 없이 대화하는 모든 채팅에 적용') : undefined}
      actions={
        toggles.changed > 0 && (
          <MoreMenu of="토글">
            <MenuItem label={RESET} description={`변경 ${toggles.changed}개`} onClick={onReset} />
          </MoreMenu>
        )
      }
      onClose={onClose}
    >
      {all.length === 0 ? (
        <Empty variant="section">{card ? '이 채팅의 프롬프트와 캐릭터에는 토글이 없어요.' : '이 채팅의 프롬프트에는 토글이 없어요.'}</Empty>
      ) : (
        <>
          {search.field && (
            <Stack gap="related">
              {search.field}
              <ChoiceGroup
                label="보기"
                layout="segmented"
                options={[
                  { value: 'all', label: '전체', tag: String(all.length) },
                  { value: 'changed', label: '변경', tag: String(toggles.changed) },
                ]}
                value={filter}
                onChange={show}
              />
            </Stack>
          )}
          {visible.map((section, index) => (
            <Section
              key={index}
              level={3}
              title={section.name}
              tag={{ label: FROM[section.from], tone: 'plain' }}
              note={String(section.rows.length)}
              action={<TogglePresets section={section} onPick={(preset) => onPreset(section, preset)} now={() => sectionNow(section.id)} onEdit={() => onEdit(section)} />}
            >
              {laying ? <ToggleList owner={section.id} items={section.items} row={row} /> : section.shown.map(row)}
            </Section>
          ))}
          {visible.length === 0 && <Empty variant="section">{search.none ?? '바꾼 토글이 없어요.'}</Empty>}
        </>
      )}
    </SidePanel>
  );
}

function TextToggle({ toggle, value, owner, write }: { toggle: Extract<Toggle, { kind: 'text' }>; value: string; owner: string | null; write: Props['onWrite'] }) {
  const autosave = useAutosave<{ value: string }>(toggleSaveKey(owner, toggle.key), (patch) => write(toggle.key, patch.value!));
  return (
    <TextField
      label={toggle.label}
      showLabel={false}
      value={'value' in autosave.unsaved ? autosave.unsaved.value! : value}
      lines={toggle.lines ? 3 : undefined}
      onChange={(next) => autosave.change({ value: next })}
    />
  );
}
