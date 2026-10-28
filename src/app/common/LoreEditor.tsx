import { FolderPlus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { Card } from '../../engine/import/types';
import { lorebookFile, readLorebookText } from '../../engine/import/lorebook';
import type { Stored } from '../../model/kinds';
import type { Lore, LoreFolder, LoreOwner } from '../../model/library';
import { loreGroups } from '../../model/lore';
import { lorebookOf } from '../../runtime/card-file';
import { sharedLoreScan } from '../../runtime/chat-context';
import { addLore, addLoreFolder, editLore, loreFolderRemoval, removeLore, removeLoreFolder, renameLoreFolder, importLore, restoreLore, restoreLoreFolder, setCharacterLoreScan, undoLoreImport } from '../../runtime/lore';
import type { ObjectStore } from '../../runtime/store';
import { useChildren, useSaves, useSettings, useStore, useStored } from '../session';
import { SHORTCUTS } from '../shortcuts';
import { useToast } from '../toast';
import { Button, ChipButton, ChoiceGroup, Empty, FileButton, List, ListItem, Menu, MenuItem, NumberInput, PhraseField, Row, Section, SettingGroup, SettingRow, Stack, Switch, TextField, type CodeAside, type CodeLanguage } from '../ui';
import { ACTS, addOf, newOf } from './acts';
import { cbsLanguage } from './code/cbs';
import { useTrial } from './code/Trial';
import type { Defaults } from './code/variables';
import { DetailFold } from './DetailFold';
import { download, fileNamed } from './download';
import { FolderMenu, useNaming, type FolderActions, type Naming } from './folders/FolderParts';
import { OpenRow, RowFoot, useOpenRows, type OpenRows } from './OpenRows';
import { SLOT } from './prompt-words';
import { typedText, useTypedNumber } from './typed';
import { count, readOptional } from './typedNumber';
import { useAutosave } from './useAutosave';
import { useSearch } from './useSearch';
import { follows, LORE_SCAN_WORDS, loreName, SCOPE } from './words';

type Position = Lore['position'];
const POSITIONS: { value: NonNullable<Position> | 'lorebook'; label: string }[] = [
  { value: 'lorebook', label: `${SLOT.lorebook.name} 블록` },
  { value: 'before_char', label: `${SLOT.description.name} 앞` },
  { value: 'after_char', label: `${SLOT.description.name} 뒤` },
];
const NUMBER_ERROR = '숫자를 입력해 주세요.';
const NO_FOLDER = '폴더 없음';
const ENTRY = '항목';
const KEYS_SHOWN = 3;

const readNumber = (draft: string) => readOptional(draft, false);
// undefined: empty, which follows the account's value.
const readOwnCount = (draft: string) => {
  const typed = readOptional(draft, true);
  return typed === null || (typed !== undefined && typed < 1) ? null : typed;
};

type Scan = Card['loreSettings'];

// A character's own scan settings, each over the account's in 설정 › 채팅 (runtime/chat-context loreScanOf).
function LoreScanFold({ id }: { id: string }) {
  const store = useStore();
  // Subscribed for sharedLoreScan, which reads the account's from the store.
  useSettings();
  const stored = useStored('character', id);
  const save = useAutosave<Scan>(`character-lore-scan:${id}`, (change) => setCharacterLoreScan(store, id, change));
  if (!stored) return null;
  const own: Scan = { ...stored.value.card.loreSettings, ...save.unsaved };
  const shared = sharedLoreScan(store);
  const flag = (key: 'recursive' | 'fullWordMatching') => {
    const { label, help } = LORE_SCAN_WORDS[key];
    const change = (choice: 'default' | 'on' | 'off') => {
      const patch: Partial<Scan> = {};
      patch[key] = choice === 'default' ? null : choice === 'on';
      save.change(patch);
    };
    return (
      <SettingRow
        label={label}
        help={help}
        changed={own[key] !== null}
        control={
          <ChoiceGroup
            layout="fit"
            label={label}
            options={[
              { value: 'default', label: `${follows(SCOPE.default)} (${shared[key] ? '켜짐' : '꺼짐'})` },
              { value: 'on', label: '켜기' },
              { value: 'off', label: '끄기' },
            ]}
            value={own[key] === null ? 'default' : own[key] ? 'on' : 'off'}
            onChange={change}
          />
        }
      />
    );
  };
  const amount = (key: 'tokenBudget' | 'scanDepth') => (
    <OwnScanNumber key={key} field={key} own={own[key]} shared={shared[key]} onChange={(value) => save.change(key === 'tokenBudget' ? { tokenBudget: value } : { scanDepth: value })} />
  );
  return (
    <DetailFold set={Object.values(own).filter((value) => value !== null).length}>
      {amount('tokenBudget')}
      {flag('recursive')}
      {amount('scanDepth')}
      {flag('fullWordMatching')}
    </DetailFold>
  );
}

function OwnScanNumber({ field, own, shared, onChange }: { field: 'tokenBudget' | 'scanDepth'; own: number | null; shared: number; onChange: (value: number | null) => void }) {
  const { label, help, unit, amount } = LORE_SCAN_WORDS[field];
  const typed = useTypedNumber(readOwnCount, own ?? undefined, { error: '1 이상의 정수를 입력해 주세요.', onChange: (value) => onChange(value ?? null) });
  return (
    <SettingRow
      label={label}
      help={`${help} 비워 두면 공용 값(${amount(count(shared))})을 따라요.`}
      changed={own !== null}
      error={typed.error}
      control={<NumberInput label={label} unit={unit} value={typed.text} invalid={typed.error !== undefined} placeholder={count(shared)} onChange={typed.change} />}
    />
  );
}

function ownerName(store: ObjectStore, { kind, id }: LoreOwner): string {
  switch (kind) {
    case 'character':
      return store.get('character', id)?.value.card.name ?? '';
    case 'module':
      return store.get('module', id)?.value.name ?? '';
    case 'chat':
      return store.get('chat', id)?.value.title ?? '';
  }
}

function when({ enabled, constant, keys }: Lore) {
  const named = keys.filter((key) => key.trim());
  const more = named.length > KEYS_SHOWN ? ` 외 ${named.length - KEYS_SHOWN}개` : '';
  return !enabled ? '꺼짐' : constant ? '항상' : named.length ? named.slice(0, KEYS_SHOWN).join(', ') + more : '키워드 없음';
}

// An owner's lorebook folders, which hold no folders.
function useLoreFolders(owner: LoreOwner): FolderActions {
  const store = useStore();
  const toast = useToast();
  return {
    deepest: 1,
    create: (name) => void addLoreFolder(store, owner, name).then((saved) => saved.ok || toast.failed(saved, '저장하지 못했어요.')),
    rename: (id, name) => void renameLoreFolder(store, owner, id, name).then((saved) => saved.ok || toast.failed(saved, '저장하지 못했어요.')),
    remove: (folder) => {
      const removal = loreFolderRemoval(store, owner, folder.id);
      if (!removal) return false;
      void removeLoreFolder(store, owner, removal).then((removed) => removed.ok || toast.failed(removed, '폴더를 삭제하지 못했어요.'));
      const held = removal.entries.length;
      toast.undoable(`'${folder.name}' 폴더를 삭제했어요.`, () => restoreLoreFolder(store, owner, removal), held > 0 ? `항목 ${held}개는 폴더 밖으로 꺼냈어요.` : undefined);
      return true;
    },
  };
}

// folders: the owner's loreFolders as stored now. variables: a character's 기본 변수, offered in an entry's text.
export function LoreEditor({ owner, folders, variables }: { owner: LoreOwner; folders: LoreFolder[]; variables?: Defaults }) {
  const store = useStore();
  const trial = useTrial(owner, variables);
  const language = useMemo(() => cbsLanguage({ variables: trial.variables }), [trial.variables]);
  const entries = useChildren('lore', owner.id);
  const groups = useMemo(() => loreGroups(entries, folders), [entries, folders]);
  const openRows = useOpenRows(true);
  const folderActions = useLoreFolders(owner);
  const naming = useNaming(folderActions);
  const add = (folder: string | null) => openRows.add(ENTRY, (id) => addLore(store, owner.id, folder, id));
  const saves = useSaves();
  const toast = useToast();

  async function importFile(file: File) {
    const read = readLorebookText(await file.text());
    if (!read) return toast.error('로어북 파일이 아니에요.', { detail: 'Risu, SillyTavern, NovelAI의 로어북 JSON 파일을 가져올 수 있어요.' });
    if (read.lore.length === 0) return toast.error('가져올 항목이 없는 파일이에요.');
    const imported = await importLore(store, owner, read.lore, read.loreFolders);
    if (!imported.ok) return toast.failed(imported, '가져오지 못했어요.');
    const folderCount = imported.data.folders.length;
    toast.undoable(`항목 ${read.lore.length}개를 가져왔어요.`, () => undoLoreImport(store, owner, imported.data), folderCount > 0 ? `폴더 ${folderCount}개도 함께 만들었어요.` : undefined);
  }

  async function exportFile() {
    await Promise.all(entries.map(({ id }) => saves.flush(entryKey(id))));
    const name = ownerName(store, owner);
    const { lore, loreFolders } = lorebookOf(store, owner.id, folders);
    download(fileNamed(`${name} 로어북`, '로어북', 'json'), new Blob([JSON.stringify(lorebookFile(name, lore, loreFolders), null, 2)], { type: 'application/json' }));
  }

  const rows = (list: readonly Stored<'lore'>[]) => list.map((entry) => <EntryRow key={entry.id} stored={entry} folders={folders} language={language} trial={trial.cbs} rows={openRows} />);
  const [loose, ...grouped] = groups;
  const search = useSearch(entries, '로어북 검색', ({ value }) => [loreName(value.name), ...value.keys]);
  const listed = entries.length === 0 && folders.length === 0 ? (
    <Empty variant="section">항목이 없어요.</Empty>
  ) : (
    <List box label="로어북 항목">
      {rows(loose!.entries)}
      {grouped.map(({ folder, entries: inside }) => (
        <FolderItem key={folder!.id} folder={folder!} count={inside.length} actions={folderActions} onName={naming.name}>
          {inside.length > 0 && <List label={`${folder!.name} 항목`}>{rows(inside)}</List>}
          <Row kind="actions">
            <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={() => void add(folder!.id)}>
              {addOf('항목')}
            </Button>
          </Row>
        </FolderItem>
      ))}
    </List>
  );
  return (
    <Section title={owner.kind === 'chat' ? '항목' : '로어북'} note={`${entries.length}개`} help={`대화에 키워드가 나오면 그 항목의 내용이 프롬프트에 들어가요.${owner.kind === 'chat' ? ' 현재 채팅에서만 사용돼요.' : ''}`}>
      <Stack gap="related">
        {owner.kind === 'character' && <LoreScanFold id={owner.id} />}
        {search.field}
        {search.shown(listed, (found) => (
          <List box label="찾은 로어북 항목">
            {rows(found)}
          </List>
        ))}
        <Row kind="actions">
          <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={() => void add(null)}>
            {addOf('항목')}
          </Button>
          <Button variant="secondary" size="sm" icon={FolderPlus} onClick={() => naming.name({ id: null, name: '' })}>
            {newOf('폴더')}
          </Button>
          <FileButton accept=".json,.lorebook,application/json" size="sm" icon={ACTS.import.icon} onFiles={([file]) => void importFile(file!)}>
            {ACTS.import.label}
          </FileButton>
          {entries.length > 0 && (
            <Button variant="secondary" size="sm" icon={ACTS.export.icon} onClick={() => void exportFile()}>
              {ACTS.export.label}
            </Button>
          )}
        </Row>
      </Stack>
      {naming.dialog}
    </Section>
  );
}

// Folds in place, unlike the library's folders, which are places: expanded keeps the kit's folder row from drawing
// the › a place's row takes.
function FolderItem({ folder, count, actions, onName, children }: { folder: LoreFolder; count: number; actions: FolderActions; onName: (naming: Naming) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <ListItem
      folder
      title={folder.name}
      note={`${count}개`}
      expanded={open}
      onClick={() => setOpen(!open)}
      control={<FolderMenu actions={actions} folder={folder} depth={1} onName={onName} />}
      detail={open && <Stack gap="related">{children}</Stack>}
    />
  );
}

const entryKey = (id: string) => `lore:${id}`;

type RowProps = { stored: Stored<'lore'>; folders: LoreFolder[]; language: CodeLanguage; trial: (text: string) => CodeAside; rows: OpenRows };

// Its edits wait in its own save queue, so the line shows them before they are stored.
function EntryRow({ stored, folders, language, trial, rows }: RowProps) {
  const store = useStore();
  const save = useAutosave<Lore>(entryKey(stored.id), (patch) => editLore(store, stored.id, patch));
  const shown: Lore = { ...stored.value, ...save.unsaved };
  const name = loreName(shown.name);
  const remove = () => void rows.remove({ id: stored.id, noun: ENTRY, name }, save.remove(() => removeLore(store, stored.id)), (removed) => restoreLore(store, removed));
  return (
    <OpenRow title={name} tag={when(shown)} open={rows.isOpen(stored.id)} onOpen={(on) => rows.setOpen(stored.id, on)}>
      <EntryFields shown={shown} folders={folders} language={language} trial={trial} change={save.change} />
      <RowFoot noun={ENTRY} words={save.words} onRemove={remove} />
    </OpenRow>
  );
}

type FieldsProps = {
  shown: Lore;
  folders: LoreFolder[];
  language: CodeLanguage;
  trial: (text: string) => CodeAside;
  change: (patch: Partial<Lore>, valid?: boolean) => void;
};

function EntryFields({ shown, folders, language, trial, change }: FieldsProps) {
  const [typed, setTyped] = useState<{ order?: string; priority?: string }>({});
  const order = typedText(typed.order, (draft) => readNumber(draft) ?? null, shown.insertionOrder, String);
  const priority = typedText(typed.priority, readNumber, shown.priority ?? undefined, (value) => (value === undefined ? '' : String(value)));
  const orderValid = typeof readNumber(order) === 'number';
  const priorityValid = readNumber(priority) !== null;
  const folder = folders.find(({ id }) => id === shown.folder);

  function changeOrder(draft: string) {
    setTyped((current) => ({ ...current, order: draft }));
    const value = readNumber(draft);
    change({ insertionOrder: value ?? 0 }, typeof value === 'number');
  }

  function changePriority(draft: string) {
    setTyped((current) => ({ ...current, priority: draft }));
    const value = readNumber(draft);
    change({ priority: value ?? null }, value !== null);
  }

  const toggle = (field: 'enabled' | 'constant' | 'selective' | 'useRegex' | 'caseSensitive', label: string, help?: string) => (
    <SettingRow label={label} help={help} control={<Switch label={label} checked={shown[field]} onChange={(on) => change({ [field]: on })} />} />
  );

  return (
    <>
      <TextField label="이름" value={shown.name} onChange={(name) => change({ name })} />
      <SettingGroup label="키워드">
        <SettingRow label="키워드" help="최근 대화에 이 중 하나라도 나오면 내용이 프롬프트에 들어가요." wide control={<PhraseField label="키워드" phrases={shown.keys} onChange={(keys) => change({ keys })} />} />
        {toggle('selective', '보조 키워드 사용', '키워드 하나와 보조 키워드 하나가 함께 나와야 프롬프트에 들어가요.')}
        {shown.selective && (
          <SettingRow label="보조 키워드" wide control={<PhraseField label="보조 키워드" phrases={shown.secondaryKeys} onChange={(secondaryKeys) => change({ secondaryKeys })} />} />
        )}
        {toggle('useRegex', '정규식 사용', '키워드를 /패턴/ 또는 /패턴/플래그 형식의 정규식으로 인식해요.')}
        {toggle('caseSensitive', '대소문자 구분')}
      </SettingGroup>
      <TextField label="내용" lines={8} expand={SHORTCUTS.bigEdit.keys} language={language} aside={trial} value={shown.content} onChange={(content) => change({ content })} help="@@로 시작하는 줄은 삽입 방식을 정하는 명령이에요. 예: @@depth 0" />
      <SettingGroup label="삽입">
        {toggle('enabled', '켬')}
        {toggle('constant', '항상 삽입', '키워드와 상관없이 항상 넣어요.')}
        <SettingRow
          label="순서"
          help="숫자가 클수록 프롬프트 뒤쪽에 들어가요."
          error={orderValid ? undefined : NUMBER_ERROR}
          control={<NumberInput label="순서" value={order} invalid={!orderValid} onChange={changeOrder} />}
        />
        <SettingRow
          label="우선순위"
          help="로어북 최대 분량을 넘으면 숫자가 큰 항목부터 먼저 넣어요."
          changed={shown.priority !== null}
          error={priorityValid ? undefined : NUMBER_ERROR}
          control={<NumberInput label="우선순위" value={priority} placeholder="순서와 같음" invalid={!priorityValid} onChange={changePriority} />}
        />
        <SettingRow
          label="위치"
          help={`${SLOT.lorebook.name}을 프롬프트의 ${SLOT.lorebook.name} 블록에 넣을지, 아니면 ${SLOT.description.name} 블록의 맨 앞이나 맨 뒤에 넣을지 정해요.`}
          control={<ChoiceGroup layout="fit" label="위치" options={POSITIONS} value={shown.position ?? 'lorebook'} onChange={(value) => change({ position: value === 'lorebook' ? null : value })} />}
        />
        {folders.length > 0 && (
          <SettingRow
            label="폴더"
            control={
              <Menu place="below-end" label="폴더" trigger={(opener) => <ChipButton variant="field" label={folder?.name ?? NO_FOLDER} title="폴더" {...opener} />}>
                <MenuItem label={NO_FOLDER} checked={!folder} onClick={() => change({ folder: null })} />
                {folders.map((each) => (
                  <MenuItem key={each.id} label={each.name} checked={each.id === folder?.id} onClick={() => change({ folder: each.id })} />
                ))}
              </Menu>
            }
          />
        )}
      </SettingGroup>
    </>
  );
}
