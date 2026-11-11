import { useMemo, useState } from 'react';
import type { Stored } from '../../model/kinds';
import { isToggle, sortOf, type Prompt, type PromptSort } from '../../model/prompt';
import { availableFeatures } from '../../runtime/tasks/features';
import { addAgent, addPrompt, isDefaultPrompt, ofSort } from '../../runtime/library/prompts';
import type { AgentStart } from '../../engine/agent';
import { ACTS, newOf } from '../common/acts';
import type { Frame } from '../common/frame';
import { defaultPrompt, SORT_PROMPT, TASK_NAMES } from '../common/prompt-words';
import { useMaking } from '../common/useMaking';
import { useSearch } from '../common/useSearch';
import { counted } from '../common/pack';
import { useConnections, usePrompts, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { AGENTS, defaultMark, EMPTY_FOLDER, MODEL_ROLES, PAGES, promptName, STAGE_NAMES, THINGS, USED_IN } from '../common/words';
import { Button, Callout, ChoiceGroup, Empty, FoldButton, Hint, Menu, MenuItem, Row, Stack, Table, Tabs, useMenuHandle, type TableColumn, type TableRow } from '../ui';
import { useImport } from '../common/importing';
import { EMPTY_USE, promptUseWords, usePromptUse } from '../common/usePromptUse';
import { byLastUse, byPromptName, groupPrompts, promptFolder as folderOf } from '../common/promptCopies';
import { folderNote, placeIn, useFolderIndex, whereIs } from '../common/folders/filing';
import { FOLDER_COLUMNS, FolderMenu, FolderPath, named, useMoving, useNaming } from '../common/folders/FolderParts';
import { useFolderActions } from '../common/folders/useFolderActions';
import { agentModelWords, modelWords } from './ModelPane';
import { PresetExport } from './PresetExport';
import { PromptMenu } from './PromptMenu';

const newName = (sort: PromptSort) => newOf(SORT_PROMPT[sort]);
// What a new agent starts from (user ruling, 2026-10-21): the two built-ins, or one empty of either stage.
const AGENT_STARTS: { start: AgentStart; name: string; description: string }[] = [
  { start: 'scene', name: '기본 장면 메모', description: `${STAGE_NAMES.pre} · 응답을 생성하기 전에 필요한 설정과 대화 흐름을 정리해요.` },
  { start: 'polish', name: '기본 문장 다듬기', description: `${STAGE_NAMES.post} · 생성된 응답에서 불필요한 표현을 다듬어요.` },
  { start: 'pre', name: `새 ${STAGE_NAMES.pre} ${AGENTS}`, description: '내용이 비어 있는 새 에이전트를 만들어요.' },
  { start: 'post', name: `새 ${STAGE_NAMES.post} ${AGENTS}`, description: '내용이 비어 있는 새 에이전트를 만들어요.' },
];
const task = (sort: keyof typeof TASK_NAMES, hint: string) => ({ sort, label: TASK_NAMES[sort], hint, none: `${SORT_PROMPT[sort]}가 없어요.` });
const SORTS: { sort: PromptSort; label: string; hint?: string; none: string }[] = [
  { sort: 'conversation', label: '대화', none: '대화 프롬프트가 없어요.' },
  task('translate', '받은 응답과 보낼 메시지를 번역할 때 쓰는 프롬프트예요.'),
  task('memory', '지난 대화를 장기 기억으로 정리할 때 쓰는 프롬프트예요.'),
  task('illustrate', '메시지에 넣을 삽화의 장면을 정할 때 쓰는 프롬프트예요.'),
  task('mascot', '응답마다 마스코트가 한마디 할 때 쓰는 프롬프트예요.'),
  task('preread', `응답을 생성하기 전에 ${MODEL_ROLES.aux}이 긴 내용을 요약할 때 쓰는 프롬프트예요.`),
  task('agent', '응답 생성 전에 맥락을 정리하거나 생성된 응답을 다듬는 에이전트예요.'),
  task('status', '응답이 끝난 뒤 그 응답으로 바뀐 상태를 기록할 때 쓰는 프롬프트예요.'),
];
type Order = 'name' | 'recent';

const NAME: TableColumn = { label: '이름', track: 'name' };
const MODEL: TableColumn = { label: '모델', track: 'fill' };
const HOLDS: TableColumn = { label: '구성', track: 'fill' };
const columnsOf = (sort: PromptSort): TableColumn[] =>
  sort === 'conversation' ? [NAME, MODEL, HOLDS, { label: USED_IN, track: 'fill' }] : sort === 'agent' ? [NAME, MODEL, HOLDS, { label: '단계', track: 'fill' }] : [NAME, HOLDS];
const FOUND_COLUMNS: TableColumn[] = [NAME, { label: '종류', track: 'fill' }, { label: USED_IN, track: 'fill' }];

export const promptHolds = ({ blocks, toggles }: Pick<Prompt, 'blocks' | 'toggles'>) => counted([['블록', blocks.length], ['토글', toggles.filter(isToggle).length]]).join(' · ');

// Defaults lead each sort but only a prompt's own menu changes the default.
// place applies to the conversation folder tree only.
type Props = {
  onPick: (id: string) => void;
  inUse?: string;
  defaults?: boolean;
  place: string | null;
  onGo: (place: string | null) => void;
  frame: Frame;
  // The sort it opens on; one whose 실험실 switch is off opens 대화.
  sort?: PromptSort | null;
};

export function PromptList({ onPick, inUse, defaults = false, place, onGo, frame, sort = null }: Props) {
  const store = useStore();
  const toast = useToast();
  const making = useMaking();
  const prompts = usePrompts();
  const grouped = useMemo(() => groupPrompts(prompts), [prompts]);
  const settings = useSettings();
  const connections = useConnections();
  // An experiment's prompts show only while its 실험실 switch is on.
  const sorts = useMemo(() => {
    const available = availableFeatures(settings);
    return SORTS.filter(({ sort }) => sort === 'conversation' || available.includes(sort === 'agent' ? 'agents' : sort));
  }, [settings]);
  const listed = useMemo(() => prompts.filter((prompt) => sorts.some(({ sort }) => ofSort(prompt, sort))), [prompts, sorts]);
  const uses = usePromptUse();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState<PromptSort>(() => sorts.find((each) => each.sort === sort)?.sort ?? 'conversation');
  const [order, setOrder] = useState<Order>('name');
  const { pickPrompts } = useImport();
  const conversations = useMemo(() => grouped.top.filter((prompt) => ofSort(prompt, 'conversation')), [grouped]);
  const index = useFolderIndex('prompt', conversations, folderOf);
  const filing = shown === 'conversation';
  const at = placeIn(index, place, false);
  const folderActions = useFolderActions('prompt');
  const naming = useNaming(folderActions);
  // A prompt moves with the copies listed under it.
  const carry = (id: string): string[] => [id, ...(grouped.copies.get(id) ?? []).flatMap((copy) => carry(copy.id))];
  const filedAt = (id: string) => {
    const prompt = prompts.find((each) => each.id === id);
    return prompt ? folderOf(prompt) : null;
  };
  const moving = useMoving('prompt', index, filedAt, { off: !filing, carry });
  // One menu for every card: a right-click says which prompt it is of.
  const menu = useMenuHandle();
  const [asked, setAsked] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const askedPrompt = prompts.find((each) => each.id === asked);
  const exported = prompts.find((each) => each.id === exporting);
  const menuOf = (prompt: Stored<'prompt'>) => ({ handle: menu, onOpen: () => setAsked(prompt.id) });

  const badge = (prompt: Stored<'prompt'>) => defaultMark(isDefaultPrompt(settings, prompt), prompt.value.name);
  const tags = (prompt: Stored<'prompt'>) => (prompt.id === inUse ? ['사용 중'] : []);
  // Only conversation prompts are used by chats; a translation prompt is chosen by a character's 번역.
  const usage = (prompt: Stored<'prompt'>) => (ofSort(prompt, 'conversation') ? promptUseWords(uses.get(prompt.id) ?? EMPTY_USE) : undefined);
  // What columnsOf names after the name, for the prompt's sort.
  const facts = (prompt: Stored<'prompt'>): (string | null)[] => {
    const holds = promptHolds(prompt.value) || null;
    if (ofSort(prompt, 'conversation')) return [modelWords(prompt.value.models, connections), holds, usage(prompt) ?? null];
    if (ofSort(prompt, 'agent')) return [agentModelWords(prompt.value.model, connections), holds, STAGE_NAMES[prompt.value.stage]];
    return [holds];
  };

  function addFrom(start: AgentStart, name: string) {
    void addAgent(store, start, name).then((added) => (added.ok ? onPick(added.data.id) : toast.failed(added, '에이전트를 만들지 못했어요.')));
  }

  function add(sort: Exclude<PromptSort, 'agent'>) {
    const folder = sort === 'conversation' ? at.here?.folder.id : undefined;
    making.create('prompt', (id) => addPrompt(store, newName(sort), sort, id, folder), onPick);
  }

  const byName = (a: Stored<'prompt'>, b: Stored<'prompt'>) => Number(isDefaultPrompt(settings, b)) - Number(isDefaultPrompt(settings, a)) || byPromptName(a, b);
  const recentFirst = shown === 'conversation' && order === 'recent';
  const top = (filing ? at.placed(conversations) : grouped.top.filter((prompt) => ofSort(prompt, shown))).sort(recentFirst ? byLastUse(uses, grouped.copies) : byName);
  const current = sorts.find(({ sort }) => sort === shown)!;

  const row = (prompt: Stored<'prompt'>, nested = false): TableRow => {
    const copies = grouped.copies.get(prompt.id) ?? [];
    const expanded = open.has(prompt.id);
    const flip = () => setOpen((current) => new Set(current.has(prompt.id) ? [...current].filter((id) => id !== prompt.id) : [...current, prompt.id]));
    const picking = moving.picked !== null && !nested;
    const cells = facts(prompt);
    return {
      key: prompt.id,
      cells: [promptName(prompt.value.name), ...cells],
      summary: cells.filter(Boolean).join(' · '),
      badge: badge(prompt),
      tags: tags(prompt),
      selected: picking ? moving.picked!.has(prompt.id) : undefined,
      drag: moving.dropInto && !nested ? prompt.id : undefined,
      onClick: () => (picking ? moving.toggle(prompt.id) : onPick(prompt.id)),
      menu: picking ? undefined : menuOf(prompt),
      control: copies.length > 0 && <FoldButton open={expanded} onToggle={flip} noun="사본" count={copies.length} brief />,
      under: expanded ? copies.map((copy) => row(copy, true)) : undefined,
    };
  };

  const folderRows: TableRow[] = filing
    ? at.folders.map((folder) => ({
        key: folder.id,
        folder: true,
        cells: [folder.value.name, folderNote('prompt', index.byFolder.get(folder.id)!)],
        onClick: () => onGo(folder.id),
        onDropCard: moving.dropInto?.(folder.id),
        control: <FolderMenu actions={folderActions} folder={named(folder)} depth={at.path.length + 1} onName={naming.name} />,
      }))
    : [];

  // A turn stops on a sort whose default is gone, so the list says which.
  const missing = defaults ? sorts.filter(({ sort }) => sort !== 'agent' && !prompts.some((each) => ofSort(each, sort) && isDefaultPrompt(settings, each))) : [];
  const warnings = missing.map(({ sort, label }) => (
    <Callout key={sort} tone="warn" action={sort === shown ? undefined : { label: `${label} 프롬프트 보기`, onClick: () => setShown(sort) }}>
      {`${defaultPrompt(sort)}가 없어요.`}
    </Callout>
  ));

  const search = useSearch(listed, '프롬프트 검색', (prompt) => [promptName(prompt.value.name)]);

  const adding =
    shown === 'agent' ? (
      <Menu label={newName('agent')} place="below-end" trigger={(opener) => <Button variant="secondary" icon={ACTS.create.icon} {...opener}>{newName('agent')}</Button>}>
        {AGENT_STARTS.map(({ start, name, description }) => (
          <MenuItem key={start} label={name} description={description} onClick={() => addFrom(start, name)} />
        ))}
      </Menu>
    ) : (
      <Button variant="secondary" icon={ACTS.create.icon} onClick={() => add(shown)}>
        {newName(shown)}
      </Button>
    );
  const actions = (
    <Row kind="actions">
      <Button variant="secondary" icon={ACTS.import.icon} onClick={pickPrompts}>
        Risu 프리셋 가져오기
      </Button>
      {adding}
    </Row>
  );
  const sortChoice = shown === 'conversation' && !search.words && (
    <ChoiceGroup
      label="정렬"
      showLabel
      layout="segmented"
      options={[
        { value: 'name', label: '이름' },
        { value: 'recent', label: '최근 사용' },
      ]}
      value={order}
      onChange={setOrder}
    />
  );
  const body = (
    <>
      <Stack gap="related">
        {warnings}
        {(search.field || sortChoice) && (
          <Row kind="toolbar">
            {search.field}
            {sortChoice}
          </Row>
        )}
        {/* Its own line: beside the sort, which only 대화 has, the pills would move under the press that switches sort. */}
        {!search.words && (
          <Row kind="toolbar">
            <Tabs
              label="프롬프트 종류"
              items={sorts.map(({ sort, label }) => ({ value: sort, label, count: prompts.filter((prompt) => ofSort(prompt, sort)).length }))}
              value={shown}
              onChange={setShown}
            />
            {current.hint && <Hint label={`${current.label} 프롬프트`}>{current.hint}</Hint>}
          </Row>
        )}
        {search.shown(
          <>
            {filing && (
              <FolderPath kind="prompt" path={at.path} onGo={onGo} onName={naming.name} dropInto={moving.dropInto}>
                {moving.button}
              </FolderPath>
            )}
            {folderRows.length + top.length > 0 ? (
              <>
                {folderRows.length > 0 && <Table label="폴더" columns={FOLDER_COLUMNS} rows={folderRows} />}
                {top.length > 0 && <Table label={SORT_PROMPT[shown]} columns={columnsOf(shown)} rows={top.map((prompt) => row(prompt))} />}
              </>
            ) : at.here && filing ? (
              <Empty>{EMPTY_FOLDER}</Empty>
            ) : (
              <Empty action={adding}>
                {current.none}
              </Empty>
            )}
          </>,
          (found) => (
            <Table
              label="검색 결과"
              columns={FOUND_COLUMNS}
              rows={found.toSorted(byPromptName).map((prompt) => {
                const cells = [SORTS.find(({ sort }) => sort === sortOf(prompt.value))!.label, [whereIs(index, folderOf(prompt)), usage(prompt)].filter(Boolean).join(' · ') || null];
                return { key: prompt.id, cells: [promptName(prompt.value.name), ...cells], summary: cells.filter(Boolean).join(' · '), badge: badge(prompt), tags: tags(prompt), onClick: () => onPick(prompt.id), menu: menuOf(prompt) };
              })}
            />
          ),
          'body',
        )}
      </Stack>
      {moving.bar}
      {naming.dialog}
      <Menu handle={menu} label={`${THINGS.prompt.noun} 메뉴`} trigger={() => null}>
        {askedPrompt && <PromptMenu stored={askedPrompt} onOpen={onPick} onExport={() => setExporting(askedPrompt.id)} />}
      </Menu>
      {exported && ofSort(exported, 'conversation') && <PresetExport prompt={exported.value} onClose={() => setExporting(null)} />}
    </>
  );
  return frame({ head: { title: PAGES.prompts, actions }, body });
}
