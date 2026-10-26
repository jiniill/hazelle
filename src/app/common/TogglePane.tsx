import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { readToggles } from '../../engine/import/toggles';
import { isToggle, type Toggle, type ToggleLine, type ToggleMark, type UnreadLine } from '../../model/prompt';
import { groupLines, lineMoves, newGroup, toggleTree, type LineAt, type LineMove, type ShownLine } from '../../model/toggles';
import { ACTS, newOf } from './acts';
import { NameDialog } from './NameDialog';
import { ToggleChoice } from './ToggleChoice';
import { laidOut } from './toggleLayout';
import { ToggleList } from './ToggleList';
import { keyProblem, LINE_WORDS, lineTitle } from './toggleWords';
import { useSearch } from './useSearch';
import { Button, Checkbox, ChoiceGroup, Dialog, Empty, Menu, MenuItem, MoreMenu, Row, Section, SettingRow, Switch, TextField } from '../ui';

type Props = {
  // The prompt's, character's or module's id (common/ToggleList).
  owner: string;
  lines: readonly ToggleLine[];
  // How many conditions changing a key rewrites with it; null for an owner whose text it leaves as it is (a pack's
  // lorebook and scripts), which the pane says rather than count none.
  uses: ((key: string) => number) | null;
  // A group comes with its end, so what is added after it stays out of it.
  onAdd: (lines: readonly [ShownLine, ...ToggleLine[]]) => void;
  // line: an unread line fixed, the whole line read again.
  onEdit: (before: ShownLine, after: ToggleLine, at: number, what: 'label' | 'default' | 'line') => void;
  // A text toggle's default, typed in place.
  onType: (after: TextToggle, at: number) => void;
  onMove: (line: ShownLine, move: LineMove) => void;
  onRekey: (toggle: Toggle, to: string) => void;
  // In order; a group's head goes with its end, and what it held stays.
  onRemove: (lines: readonly [LineAt<ShownLine>, ...LineAt[]]) => void;
  // The new-toggle form is open; 조건 삽입's 새 토글 만들기 opens it too.
  adding: boolean;
  onAdding: (adding: boolean) => void;
};

type Labeled = Exclude<ToggleMark['kind'], 'groupEnd'>;
type Field = 'label' | 'key' | 'line';
type TextToggle = Extract<Toggle, { kind: 'text' }>;
type Editing = { at: number; field: Field } | { add: Labeled };

const FIELD: Record<Labeled, string> = { divider: '이름', caption: '내용', group: '이름' };
const LINE_ONLY = '비워 두면 선만 보여요.';

// While searching, only the toggles found show, without the layout lines a few found rows would sit oddly under, and
// without moves past rows not shown.
export function TogglePane({ owner, lines, uses, onAdd, onEdit, onType, onMove, onRekey, onRemove, adding, onAdding }: Props) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const toggles = lines.flatMap((line, at) => (isToggle(line) ? [{ line, at }] : []));
  const search = useSearch(toggles, '토글 검색', ({ line }) => [line.label, line.key]);
  const nodes = toggleTree(lines);
  const groups = new Map(nodes.flatMap((node) => ('head' in node ? [[node.head.at, node] as const] : [])));
  const opened = editing && 'at' in editing ? lines[editing.at] : undefined;
  const close = () => setEditing(null);

  function control(line: Toggle | UnreadLine, at: number) {
    if (!isToggle(line)) return null;
    return line.kind === 'text' ? (
      <TextField label={`${line.label} 기본값`} showLabel={false} value={line.default} lines={line.lines ? 3 : undefined} onChange={(value) => onType({ ...line, default: value }, at)} />
    ) : line.kind === 'check' ? (
      <Switch label={`${line.label} 기본값`} checked={line.default === '1'} onChange={(on) => onEdit(line, { ...line, default: on ? '1' : '0' }, at, 'default')} />
    ) : (
      <ToggleChoice label={`${line.label} 기본값`} options={line.options} value={line.default} onChange={(value) => onEdit(line, { ...line, default: value }, at, 'default')} />
    );
  }

  function menu({ line, at }: LineAt<ShownLine>) {
    const moves = search.words ? null : lineMoves(nodes, at);
    const group = groups.get(at);
    return (
      <MoreMenu of={isToggle(line) ? `'${line.label}'` : lineTitle(line)}>
        <MenuItem
          icon={ACTS.rename.icon}
          label={line.kind === 'caption' || line.kind === 'unread' ? '내용 바꾸기' : ACTS.rename.label}
          onClick={() => setEditing({ at, field: line.kind === 'unread' ? 'line' : 'label' })}
        />
        {isToggle(line) && <MenuItem label="키 바꾸기" sub={uses ? '조건에 쓴 키도 함께 바뀌어요' : undefined} onClick={() => setEditing({ at, field: 'key' })} />}
        {moves?.up && <MenuItem icon={ArrowUp} label="위로 옮기기" onClick={() => onMove(line, moves.up!)} />}
        {moves?.down && <MenuItem icon={ArrowDown} label="아래로 옮기기" onClick={() => onMove(line, moves.down!)} />}
        <MenuItem
          icon={ACTS.remove.icon}
          label={ACTS.remove.label}
          sub={group && group.members.length > 0 ? '안의 토글은 남아요' : undefined}
          tone="warn"
          onClick={() => onRemove(group ? groupLines(group) : [{ line, at }])}
        />
      </MoreMenu>
    );
  }

  const row = ({ line, at }: LineAt<Toggle | UnreadLine>) => (
    <SettingRow
      key={isToggle(line) ? line.key : `unread${at}`}
      label={isToggle(line) ? line.label : LINE_WORDS.unread}
      sub={isToggle(line) ? undefined : line.text}
      wide={line.kind === 'text'}
      control={control(line, at)}
      menu={menu({ line, at })}
    />
  );

  function dialog(line: ShownLine, at: number, field: Field) {
    if (field === 'line' && line.kind === 'unread') {
      return (
        <LineDialog
          line={line}
          lines={lines}
          onClose={close}
          onSave={(read) => {
            close();
            onEdit(line, read, at, 'line');
          }}
        />
      );
    }
    if (field === 'key' && isToggle(line)) {
      return (
        <KeyDialog
          toggle={line}
          lines={lines}
          uses={uses && uses(line.key)}
          onClose={close}
          onSave={(key) => {
            close();
            if (key !== line.key) onRekey(line, key);
          }}
        />
      );
    }
    if (field !== 'label' || line.kind === 'unread') return null;
    return (
      <NameDialog
        title={line.kind === 'caption' ? '내용 바꾸기' : ACTS.rename.label}
        field={isToggle(line) ? '이름' : FIELD[line.kind]}
        value={line.label}
        blank={line.kind === 'divider' ? LINE_ONLY : undefined}
        onClose={close}
        onSave={(label) => {
          close();
          onEdit(line, { ...line, label }, at, 'label');
        }}
      />
    );
  }

  return (
    <Section
      title="토글"
      note={`${toggles.length}개`}
      help="채팅에서 켜고 끄면 조건에 따라 보내는 내용이 바뀌어요. 구분선과 설명, 그룹으로 채팅의 토글 목록을 정리할 수 있어요."
      action={
        <Row kind="actions">
          <Menu label="줄 추가" place="below-end" trigger={(opener) => <Button variant="secondary" {...opener}>줄 추가</Button>}>
            <MenuItem label={LINE_WORDS.divider} onClick={() => setEditing({ add: 'divider' })} />
            <MenuItem label={LINE_WORDS.caption} onClick={() => setEditing({ add: 'caption' })} />
            <MenuItem label={LINE_WORDS.group} onClick={() => setEditing({ add: 'group' })} />
          </Menu>
          <Button variant="secondary" icon={ACTS.create.icon} onClick={() => onAdding(true)}>
            {newOf('토글')}
          </Button>
        </Row>
      }
    >
      {search.field && <Row kind="toolbar">{search.field}</Row>}
      {lines.length === 0 || search.none ? (
        <Empty variant="section">{search.none ?? '토글이 없어요.'}</Empty>
      ) : search.words ? (
        search.found.map(row)
      ) : (
        <ToggleList owner={owner} items={laidOut(nodes, (line, at) => ({ line, at }))} row={row} menu={menu} />
      )}
      {editing && 'add' in editing && (
        <NameDialog
          title={`${LINE_WORDS[editing.add]} 추가`}
          field={FIELD[editing.add]}
          value=""
          blank={editing.add === 'divider' ? LINE_ONLY : undefined}
          onClose={close}
          onSave={(label) => {
            close();
            onAdd(editing.add === 'group' ? newGroup(label) : [{ kind: editing.add, label }]);
          }}
        />
      )}
      {editing && 'at' in editing && opened && opened.kind !== 'groupEnd' && dialog(opened, editing.at, editing.field)}
      {adding && (
        <NewToggleDialog
          lines={lines}
          onClose={() => onAdding(false)}
          onSave={(toggle) => {
            onAdding(false);
            onAdd([toggle]);
          }}
        />
      )}
    </Section>
  );
}

function KeyDialog({ toggle, lines, uses, onClose, onSave }: { toggle: Toggle; lines: readonly ToggleLine[]; uses: number | null; onClose: () => void; onSave: (key: string) => void }) {
  const [key, setKey] = useState(toggle.key);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title="키 바꾸기"
      onClose={onClose}
      onSubmit={() => {
        const problem = keyProblem(key.trim(), lines, toggle.key);
        if (problem) return setError(problem);
        onSave(key.trim());
      }}
      actionsLayout="full"
      actions={
        <Button type="submit">
          바꾸기
        </Button>
      }
    >
      <TextField
        label="키"
        kind="key"
        value={key}
        onChange={setKey}
        error={error ?? undefined}
        hint={uses === null ? '이 키를 쓴 다른 곳은 바뀌지 않아요.' : uses ? `조건 ${uses}곳도 함께 바뀌어요.` : '이 키를 쓰는 조건이 없어요.'}
      />
    </Dialog>
  );
}

// The line is read as an import reads it; one that still reads as nothing stays unread with what was typed.
function LineDialog({ line, lines, onClose, onSave }: { line: UnreadLine; lines: readonly ToggleLine[]; onClose: () => void; onSave: (read: ToggleLine) => void }) {
  const [text, setText] = useState(line.text);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title="내용 바꾸기"
      onClose={onClose}
      onSubmit={() => {
        const [read] = readToggles(text);
        if (!read) return setError('내용을 입력해 주세요.');
        const problem = isToggle(read) && keyProblem(read.key, lines, null);
        if (problem) return setError(problem);
        onSave(read);
      }}
      actionsLayout="full"
      actions={<Button type="submit">저장</Button>}
    >
      <TextField label="줄" kind="key" value={text} onChange={setText} help="Risu의 토글 형식은 키=이름=종류=선택지예요." error={error ?? undefined} />
    </Dialog>
  );
}

function NewToggleDialog({ lines, onClose, onSave }: { lines: readonly ToggleLine[]; onClose: () => void; onSave: (toggle: Toggle) => void }) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [kind, setKind] = useState<Toggle['kind']>('check');
  const [options, setOptions] = useState('');
  const [several, setSeveral] = useState(false);
  const [error, setError] = useState<{ key?: string; label?: string; options?: string }>({});
  const choices = options
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);

  function submit() {
    const problems = {
      label: label.trim() ? undefined : '이름을 입력해 주세요.',
      key: keyProblem(key.trim(), lines, null) ?? undefined,
      options: kind === 'choice' && choices.length < 2 ? '선택지를 2개 이상 입력해 주세요.' : undefined,
    };
    if (problems.label || problems.key || problems.options) return setError(problems);
    const named = { key: key.trim(), label: label.trim() };
    onSave(
      kind === 'check'
        ? { ...named, kind, default: '0' }
        : kind === 'choice'
          ? { ...named, kind, options: choices, default: '0' }
          : { ...named, kind, ...(several && { lines: true as const }), default: '' },
    );
  }

  return (
    <Dialog
      title={newOf('토글')}
      onClose={onClose}
      onSubmit={submit}
      actionsLayout="full"
      actions={
        <Button type="submit">
          만들기
        </Button>
      }
    >
      <TextField label="이름" value={label} onChange={setLabel} placeholder="예: 시뮬레이터 모드" error={error.label} />
      <TextField
        label="키"
        kind="key"
        value={key}
        onChange={setKey}
        placeholder="예: sims"
        help="조건에서 이 토글을 가리키는 이름이에요."
        error={error.key}
      />
      <ChoiceGroup<Toggle['kind']>
        label="종류"
        layout="segmented"
        options={[
          { value: 'check', label: LINE_WORDS.check },
          { value: 'choice', label: LINE_WORDS.choice },
          { value: 'text', label: LINE_WORDS.text },
        ]}
        value={kind}
        onChange={setKind}
      />
      {kind === 'choice' && <TextField label="선택지" help="쉼표(,)로 구분해요." value={options} onChange={setOptions} placeholder="예: 간결, 보통, 풍부" error={error.options} />}
      {kind === 'text' && <Checkbox label="여러 줄" checked={several} onChange={setSeveral} />}
    </Dialog>
  );
}
