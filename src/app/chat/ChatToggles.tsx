import { Pin } from 'lucide-react';
import { useState } from 'react';
import type { Toggle } from '../../model/prompt';
import { pinToggle } from '../../runtime/characters';
import { ToggleChoice } from '../common/ToggleChoice';
import { ToggleList } from '../common/ToggleList';
import { useAutosave } from '../common/useAutosave';
import { useSearch } from '../common/useSearch';
import { PAGES, RESET, scopeTag } from '../common/words';
import { useSettings, useStore } from '../session';
import { Button, Empty, IconButton, Row, Section, SettingRow, SidePanel, Switch, Tabs, TextField } from '../ui';
import { shownRows, toggleSaveKey, type ToggleRow, type ToggleSection } from './toggles';
import type { OpenChat } from './useChat';

const defaultOf = (toggle: Toggle) =>
  `기본값: ${toggle.kind === 'check' ? (toggle.default === '1' ? '켬' : '끔') : toggle.kind === 'choice' ? (toggle.options[Number(toggle.default)] ?? toggle.default) : toggle.default || '비어 있음'}`;

const FROM: Record<ToggleSection['from'], string> = { prompt: '프롬프트', card: '캐릭터', module: PAGES.modules };

type Props = Pick<OpenChat, 'card' | 'toggles' | 'toggleOwner'> & {
  onFlip: OpenChat['actions']['flip'];
  onWrite: OpenChat['actions']['writeToggle'];
  onReset: () => void;
  onEdit: (section: ToggleSection) => void;
  onClose: () => void;
};

export function ChatToggles({ card, toggles, toggleOwner, onFlip, onWrite, onReset, onEdit, onClose }: Props) {
  const store = useStore();
  const pinned = new Set(useSettings().pinnedToggles);
  const [filter, setFilter] = useState<'all' | 'changed'>('all');
  const all = toggles.sections.flatMap((section) => section.rows);
  const changedKeys = () => new Set(all.filter((row) => row.changed).map((row) => row.toggle.key));
  const [first, setFirst] = useState(changedKeys);
  const search = useSearch(all, '토글 검색', (row) => [row.toggle.label]);
  const found = new Set(search.found);
  const laying = filter === 'all' && !search.words;
  // Characterless values apply to all characterless chats, not a global layer.
  // Unchanged means declared defaults; the global layer declares no toggles and must not label them.
  const tag = toggles.changed === 0 ? ({ label: '기본값', tone: 'plain' } as const) : card ? scopeTag('character') : undefined;
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
      sub={changed ? defaultOf(toggle) : undefined}
      wide={toggle.kind === 'text'}
      action={toggle.kind !== 'text' && <IconButton icon={Pin} size="sm" label="입력창에 고정" pressed={pinned.has(toggle.key)} onClick={() => void pinToggle(store, toggle.key, !pinned.has(toggle.key))} />}
      control={
        toggle.kind === 'check' ? (
          <Switch label={toggle.label} checked={value === '1'} onChange={(on) => onFlip(toggle.key, on ? '1' : '0')} />
        ) : toggle.kind === 'choice' ? (
          <ToggleChoice label={toggle.label} options={toggle.options} value={value} onChange={(next) => onFlip(toggle.key, next)} />
        ) : (
          <TextToggle toggle={toggle} value={value} owner={toggleOwner} write={onWrite} />
        )
      }
    />
  );
  return (
    <SidePanel title="토글" onClose={onClose}>
      {all.length === 0 ? (
        <Empty variant="section">{card ? '이 채팅의 프롬프트와 캐릭터 카드에는 토글이 없어요.' : '이 채팅의 프롬프트에는 토글이 없어요.'}</Empty>
      ) : (
        <Section
          level={3}
          title="설정"
          tag={tag}
          note={toggles.changed ? `변경 ${toggles.changed}개` : undefined}
          help={card ? `바꾼 값은 ${card.name}의 모든 채팅에 적용돼요.` : '바꾼 값은 캐릭터 없이 대화하는 모든 채팅에 적용돼요.'}
          action={
            toggles.changed > 0 && (
              <Button variant="link" onClick={onReset}>
                {RESET}
              </Button>
            )
          }
        >
          {search.field && (
            <Row kind="toolbar">
              {search.field}
              <Tabs
                label="보기"
                items={[
                  { value: 'all', label: '전체', count: all.length },
                  { value: 'changed', label: '변경', count: toggles.changed },
                ]}
                value={filter}
                onChange={show}
              />
            </Row>
          )}
          {visible.map((section, index) => (
            <Section
              key={index}
              level={3}
              title={`${FROM[section.from]} · ${section.name}`}
              note={String(section.rows.length)}
              action={
                <Button variant="link" onClick={() => onEdit(section)}>
                  기본값 바꾸기
                </Button>
              }
            >
              {laying ? <ToggleList owner={section.id} items={section.items} row={row} /> : section.shown.map(row)}
            </Section>
          ))}
          {visible.length === 0 && <Empty variant="section">{search.none ?? '바꾼 토글이 없어요.'}</Empty>}
        </Section>
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
