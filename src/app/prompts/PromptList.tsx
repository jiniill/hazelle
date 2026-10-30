import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Stored } from '../../model/kinds';
import type { PromptSort } from '../../model/prompt';
import { availableFeatures } from '../../runtime/features';
import { addAgent, addPrompt, isDefaultPrompt, ofSort } from '../../runtime/prompts';
import type { AgentStart } from '../../engine/agent';
import { ACTS } from '../common/acts';
import type { Frame } from '../common/frame';
import { TASK_NAMES } from '../common/prompt-words';
import { useSearch } from '../common/useSearch';
import { useConnections, usePrompts, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { AGENTS, defaultMark, EMPTY_FOLDER, MODEL_ROLES, PAGES, PRE_READ, promptName, STAGE_NAMES } from '../common/words';
import { Button, CardItem, CardList, ChoiceGroup, Columns, Disclosure, Empty, Hint, Menu, MenuItem, PickCard, Row, Stack, Tabs } from '../ui';
import { taskModelWords } from './ModelPane';
import { useImport } from '../common/importing';
import { EMPTY_USE, promptUseWords, usePromptUse } from '../common/usePromptUse';
import { byLastUse, byPromptName, groupPrompts, promptFolder as folderOf } from '../common/promptCopies';
import { folderNote, placeIn, useFolderIndex, whereIs } from '../common/folders/filing';
import { FolderMenu, FolderPath, named, useMoving, useNaming } from '../common/folders/FolderParts';
import { useFolderActions } from '../common/folders/useFolderActions';

const NEW_NAME = { conversation: '새 프롬프트', translate: '새 번역 프롬프트', memory: '새 기억 프롬프트', illustrate: '새 삽화 프롬프트', mascot: '새 마스코트 프롬프트', preread: `새 ${PRE_READ} 프롬프트`, agent: `새 ${AGENTS}` } satisfies Record<PromptSort, string>;
// What a new agent starts from (user ruling, 2026-10-21): the two built-ins, or one empty of either stage.
const AGENT_STARTS: { start: AgentStart; name: string; sub: string }[] = [
  { start: 'scene', name: '기본 장면 메모', sub: `${STAGE_NAMES.pre} · 응답을 생성하기 전에 필요한 설정과 대화 흐름을 정리해요.` },
  { start: 'polish', name: '기본 문장 다듬기', sub: `${STAGE_NAMES.post} · 생성된 응답에서 불필요한 표현을 다듬어요.` },
  { start: 'pre', name: `새 ${STAGE_NAMES.pre} ${AGENTS}`, sub: '내용이 비어 있는 새 에이전트를 만들어요.' },
  { start: 'post', name: `새 ${STAGE_NAMES.post} ${AGENTS}`, sub: '내용이 비어 있는 새 에이전트를 만들어요.' },
];
const SORTS: { sort: PromptSort; label: string; hint?: string; none: string }[] = [
  { sort: 'conversation', label: '대화', none: '대화 프롬프트가 없어요.' },
  { sort: 'translate', label: '번역', hint: '받은 응답과 보낼 메시지를 번역할 때 쓰는 프롬프트예요.', none: '번역 프롬프트가 없어요.' },
  { sort: 'memory', label: '기억', hint: '지난 대화를 장기 기억으로 정리할 때 쓰는 프롬프트예요.', none: '기억 프롬프트가 없어요.' },
  { sort: 'illustrate', label: '삽화', hint: '메시지에 넣을 삽화의 장면을 정할 때 쓰는 프롬프트예요.', none: '삽화 프롬프트가 없어요.' },
  { sort: 'mascot', label: '마스코트', hint: '응답마다 마스코트가 한마디 할 때 쓰는 프롬프트예요.', none: '마스코트 프롬프트가 없어요.' },
  { sort: 'preread', label: PRE_READ, hint: `응답을 생성하기 전에 ${MODEL_ROLES.aux}이 긴 내용을 요약할 때 쓰는 프롬프트예요.`, none: `${PRE_READ} 프롬프트가 없어요.` },
  { sort: 'agent', label: AGENTS, hint: '응답 생성 전에 맥락을 정리하거나 생성된 응답을 다듬는 에이전트예요.', none: `${AGENTS}가 없어요.` },
];
type Order = 'name' | 'recent';

// Closed, this line alone tells a missing default, which the turn stops on.
export function defaultsSummary(picks: readonly { label: string; prompt?: unknown }[]): string {
  const missing = picks.filter(({ prompt }) => !prompt).map(({ label }) => label);
  const held = picks.filter(({ prompt }) => prompt).map(({ label }) => label);
  return ['기본 프롬프트', held.length ? `${held.join(', ')}${missing.length ? ' 있음' : ''}` : '', missing.length ? `${missing.join(', ')} 없음` : ''].filter(Boolean).join(' · ');
}

// Default cards lead each sort but only their own pages change the default.
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
  const prompts = usePrompts();
  const connections = useConnections();
  const grouped = useMemo(() => groupPrompts(prompts), [prompts]);
  const settings = useSettings();
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

  const badge = (prompt: Stored<'prompt'>) => defaultMark(isDefaultPrompt(settings, prompt), prompt.value.name);
  const tags = (id: string) => (id === inUse ? ['사용 중'] : []);
  // Only conversation prompts are used by chats; a translation prompt is chosen by a character's 번역.
  const usage = (prompt: Stored<'prompt'>) => (ofSort(prompt, 'conversation') ? promptUseWords(uses.get(prompt.id) ?? EMPTY_USE) : ofSort(prompt, 'agent') ? STAGE_NAMES[prompt.value.stage] : undefined);

  function addFrom(start: AgentStart, name: string) {
    void addAgent(store, start, name).then((added) => (added.ok ? onPick(added.data.id) : toast.failed(added, '에이전트를 만들지 못했어요.')));
  }

  function add(sort: Exclude<PromptSort, 'agent'>) {
    const id = crypto.randomUUID();
    const folder = sort === 'conversation' ? at.here?.folder.id : undefined;
    void addPrompt(store, NEW_NAME[sort], sort, id, folder).then((added) => added.ok || toast.failed(added, '프롬프트를 만들지 못했어요.'));
    onPick(id);
  }

  const byName = (a: Stored<'prompt'>, b: Stored<'prompt'>) => Number(isDefaultPrompt(settings, b)) - Number(isDefaultPrompt(settings, a)) || byPromptName(a, b);
  const recentFirst = shown === 'conversation' && order === 'recent';
  const top = (filing ? at.placed(conversations) : grouped.top.filter((prompt) => ofSort(prompt, shown))).sort(recentFirst ? byLastUse(uses, grouped.copies) : byName);
  const current = sorts.find(({ sort }) => sort === shown)!;

  const row = (prompt: Stored<'prompt'>, nested = false) => {
    const copies = grouped.copies.get(prompt.id) ?? [];
    const expanded = open.has(prompt.id);
    const flip = () => setOpen((current) => new Set(current.has(prompt.id) ? [...current].filter((id) => id !== prompt.id) : [...current, prompt.id]));
    const picking = moving.picked !== null && !nested;
    return (
      <CardItem
        key={prompt.id}
        title={promptName(prompt.value.name)}
        badge={badge(prompt)}
        tags={tags(prompt.id)}
        note={usage(prompt)}
        selected={picking ? moving.picked!.has(prompt.id) : undefined}
        drag={moving.dropInto && !nested ? prompt.id : undefined}
        onClick={() => (picking ? moving.toggle(prompt.id) : onPick(prompt.id))}
        control={
          copies.length > 0 && (
            <Button variant="ghost" size="sm" icon={expanded ? ChevronDown : ChevronRight} expanded={expanded} onClick={flip}>
              {`사본 ${copies.length}개`}
            </Button>
          )
        }
      >
        {expanded && copies.map((copy) => row(copy, true))}
      </CardItem>
    );
  };

  const folderRows = filing ? at.folders.map((folder) => (
    <CardItem
      key={folder.id}
      folder
      title={folder.value.name}
      note={folderNote('prompt', index.byFolder.get(folder.id)!)}
      onClick={() => onGo(folder.id)}
      onDropCard={moving.dropInto?.(folder.id)}
      control={<FolderMenu actions={folderActions} folder={named(folder)} depth={at.path.length + 1} onName={naming.name} />}
    />
  )) : [];

  const defaultPicks = !defaults ? [] : sorts.filter(({ sort }) => sort !== 'agent').map(({ sort, label }) => ({ sort, label, prompt: prompts.find((each) => ofSort(each, sort) && isDefaultPrompt(settings, each)) }));
  const defaultCards = defaults && (
    <Disclosure label={defaultsSummary(defaultPicks)}>
      <Columns>
        {defaultPicks.map(({ sort, label, prompt }) => {
          if (!prompt) return <PickCard key={sort} label={label} value="없음" tone="warn" onClick={() => setShown(sort)} />;
          const model = prompt.value.task && prompt.value.model;
          return <PickCard key={sort} label={label} value={promptName(prompt.value.name)} note={model ? taskModelWords(model, connections) : usage(prompt)} onClick={() => onPick(prompt.id)} />;
        })}
      </Columns>
    </Disclosure>
  );

  const search = useSearch(listed, '프롬프트 검색', (prompt) => [promptName(prompt.value.name)]);

  const adding =
    shown === 'agent' ? (
      <Menu label={NEW_NAME.agent} place="below-end" trigger={(opener) => <Button variant="secondary" icon={ACTS.create.icon} {...opener}>{NEW_NAME.agent}</Button>}>
        {AGENT_STARTS.map(({ start, name, sub }) => (
          <MenuItem key={start} label={name} sub={sub} onClick={() => addFrom(start, name)} />
        ))}
      </Menu>
    ) : (
      <Button variant="secondary" icon={ACTS.create.icon} onClick={() => add(shown)}>
        {NEW_NAME[shown]}
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
        {defaultCards}
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
              <CardList label={`${current.label} 프롬프트`}>
                {folderRows}
                {top.map((prompt) => row(prompt))}
              </CardList>
            ) : at.here && filing ? (
              <Empty>{EMPTY_FOLDER}</Empty>
            ) : (
              <Empty action={adding}>
                {current.none}
              </Empty>
            )}
          </>,
          (found) => (
            <CardList label="검색 결과">
              {found.toSorted(byPromptName).map((prompt) => (
                <CardItem
                  key={prompt.id}
                  title={promptName(prompt.value.name)}
                  badge={badge(prompt)}
                  tags={[...(prompt.value.task ? [TASK_NAMES[prompt.value.task]] : []), ...tags(prompt.id)]}
                  note={[whereIs(index, folderOf(prompt)), usage(prompt)].filter(Boolean).join(' · ') || undefined}
                  onClick={() => onPick(prompt.id)}
                />
              ))}
            </CardList>
          ),
          'body',
        )}
      </Stack>
      {moving.bar}
      {naming.dialog}
    </>
  );
  return frame({ head: { title: PAGES.prompts, actions }, body });
}
