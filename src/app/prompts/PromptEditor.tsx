import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { holdsPersona } from '../../engine/pipeline';
import type { Stored } from '../../model/kinds';
import { labOn } from '../../model/settings';
import { isToggle, slotsOf, sortOf, type Block, type ConversationPrompt, type TextBlock, type Toggle, type WrappedSlot } from '../../model/prompt';
import type { ApiResult } from '../../runtime/api';
import { setAgentModel, setPromptModel } from '../../runtime/models/assignment';
import { setAgentAt } from '../../runtime/tasks/agents';
import { setFeatureAt } from '../../runtime/tasks/features';
import { editPrompt, isDefaultPrompt, ofSort, type PromptPatch } from '../../runtime/library/prompts';
import { ACTS, addOf } from '../common/acts';
import { DefaultVariables } from '../common/DefaultVariables';
import { FeatureSwitches } from '../common/FeatureSwitches';
import { ModuleSwitches } from '../common/ModuleSwitches';
import { defaultPrompt, NO_PERSONA_SLOT, SLOT } from '../common/prompt-words';
import type { Frame } from '../common/frame';
import { useAutosave } from '../common/useAutosave';
import { byPromptName } from '../common/promptCopies';
import { useSearch } from '../common/useSearch';
import { copyOf, DEFAULT_VARIABLES, FEATURES_TITLE, PAGES, promptName, STAGE_NAMES, STATUS, THINGS } from '../common/words';
import { useConnections, useModules, usePrompts, useSettings, useStore } from '../session';
import type { PromptPane } from '../shell/routes';
import { typing, useShortcut } from '../shortcuts';
import { useOwnUndo, useToast } from '../toast';
import { Button, Callout, Divider, FoundRow, Icon, List, Menu, MenuHeading, MenuItem, Outline, revealIn, Section, Stack, Tabs, Tag, Text, typeInto, useHover, type EditorLayout, type NavBarProps, type OutlineStop } from '../ui';
import { BlockPane } from './BlockPane';
import { blockHit, blockIcon, blockKind, blockMeta, blockTitle, CACHE_WORDS, cacheMarks, hasConditions, isText, MARKS, rangeKey, TEXTS } from './blocks';
import { conditionSnippet, countUses, draftOf, newBlock, placedOnce, withMark, type Draft, type NewBlock, type Snippet } from './edits';
import {
  addBlock,
  addLines,
  doing,
  editLine,
  moveBlock,
  moveLines,
  NO_HISTORY,
  redoing,
  removeBlock,
  removeLines,
  renameKey,
  setCache,
  setCount,
  setTranslations,
  setMark,
  setRange,
  setRole,
  setWrapper,
  undoing,
  type Step,
  type Turned,
} from './history';
import { AgentModelPane, ModelPane } from './ModelPane';
import { chatWarning } from './ranges';
import { PicturePane } from './PicturePane';
import { PresetExport } from './PresetExport';
import { PromptMenu } from './PromptMenu';
import { PromptRead } from './PromptRead';
import { ProtectRules } from './ProtectRules';
import { AgentPlace } from './AgentPlace';
import { AgentSwitches } from '../common/AgentSwitches';
import { StatusPane } from '../common/StatusPane';
import { TogglePane } from '../common/TogglePane';
import { withParticle } from '../common/particles';
import { lineTitle } from '../common/toggleWords';
import { EMPTY_USE, promptUseWords, usePromptUse } from '../common/usePromptUse';

const MODEL = 'model' satisfies PromptPane;
const TOGGLES = 'toggles' satisfies PromptPane;
const STATE = 'status' satisfies PromptPane;
const PICTURE = 'picture' satisfies PromptPane;
const VARIABLES = 'variables' satisfies PromptPane;
const MODULES = 'modules' satisfies PromptPane;
const FEATURES = 'features' satisfies PromptPane;
const READ = 'read' satisfies PromptPane;
const PANE_TITLES: Record<PromptPane, string> = { read: '전체 읽기', model: '모델', picture: '이미지', toggles: '토글', status: STATUS, variables: DEFAULT_VARIABLES, modules: PAGES.modules, features: FEATURES_TITLE };
const isPane = (id: string): id is PromptPane => Object.hasOwn(PANE_TITLES, id);
// The tabs after 블록, in their order.
const PANES: PromptPane[] = [READ, MODEL, PICTURE, TOGGLES, STATE, VARIABLES, MODULES, FEATURES];
// The tab of the blocks, which an address names by naming no pane.
const BLOCKS = 'blocks';
const HELP = '위아래 화살표로 이동, Alt+화살표로 순서 변경, Enter로 편집, Delete로 빼기';
const ADD_BLOCK = addOf('블록');

const UNDO = { did: '되돌렸어요', failed: '되돌리지 못했어요' };
const REDO = { did: '다시 실행했어요', failed: '다시 실행하지 못했어요' };
const IMPORTED_FROM: Record<NonNullable<ConversationPrompt['imported']>, string> = { 'risu-preset': 'Risu 프리셋에서 가져옴', 'sillytavern-preset': 'SillyTavern 프리셋에서 가져옴' };

export type PromptAt = { pane: PromptPane | null; block?: string };

type Props = {
  stored: Stored<'prompt'>;
  // The caller decides, since a side panel is narrow on any screen.
  layout: EditorLayout;
  // The tab or the block open, or neither: the list of blocks. A page keeps it in its address, a panel in its own
  // state.
  at: PromptAt;
  onAt: (at: PromptAt) => void;
  // Where the 토글 tab goes back to when it was opened from outside the editor.
  paneBack?: { label: string; onBack: () => void };
  backLabel: string;
  onBack: () => void;
  // Opens another prompt: a copy just made, or the original of this copy.
  onOpen: (id: string) => void;
  onErased: () => void;
  frame: Frame;
};

// Its state is one prompt's, so a caller keys it by id; unmounting it saves.
export function PromptEditor({ stored, layout, at: { pane, block: named }, onAt, paneBack, backLabel, onBack, onOpen, onErased, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  // 에이전트 노트 and 상태 are offered only while their 실험실 switch is on, as everything of an experiment.
  const agentsLab = labOn(settings, 'agents');
  const statusLab = labOn(settings, 'status');
  const connections = useConnections();
  const prompts = usePrompts();
  const uses = usePromptUse().get(stored.id) ?? EMPTY_USE;
  const split = layout === 'split';
  const hover = useHover();
  const save = useAutosave<PromptPatch>(`prompt:${stored.id}`, (patch) => editPrompt(store, stored.id, patch));
  const sort = sortOf(stored.value);

  // The stored prompt under what waits to be saved, so another device's edit to a field nothing here changed shows.
  const draft: Draft = { ...draftOf(stored.value), ...save.unsaved };
  // The draft with the edits made since this render, for one made right after another.
  const latest = useRef(draft);
  latest.current = draft;
  const update = (change: (current: Draft) => PromptPatch) => {
    const patch = change(latest.current);
    latest.current = { ...latest.current, ...patch };
    save.change(patch);
  };

  // Only a conversation prompt and an agent pick models; another task's model is its feature's (runtime/models/assignment taskModel).
  const picksModel = sort === 'conversation' || sort === 'agent';
  const firstText = () => latest.current.blocks.find(isText)?.id ?? (picksModel ? MODEL : TOGGLES);
  const modules = useModules();
  const [editing, setEditing] = useState(false);
  const [addingToggle, setAddingToggle] = useState(false);
  const [exporting, setExporting] = useState(false);
  // 이미지 is an illustration prompt's only, 기본 변수, 모듈 and 기능 a conversation prompt's (its draft alone holds the
  // variables; 모듈 only while there is one to switch; 상태 only with its 실험실 switch on), and 모델 a prompt's that picks one; an address naming one on
  // another opens as if it named none.
  const has: Record<PromptPane, boolean> = { read: true, model: picksModel, picture: sort === 'illustrate', toggles: true, status: sort === 'conversation' && statusLab, variables: draft.variables !== undefined, modules: sort === 'conversation' && modules.length > 0, features: sort === 'conversation' };
  const panes = PANES.filter((each) => has[each]);
  const shownPane = pane !== null && panes.includes(pane) ? pane : null;
  // A block it does not hold opens as if none were named, as a pane it does not have does.
  const picked = named !== undefined && draft.blocks.some((block) => block.id === named) ? named : undefined;
  const open = shownPane ?? picked ?? firstText();
  const index = draft.blocks.findIndex((block) => block.id === open);
  const block = draft.blocks[index];
  // The block 블록 goes back to from another tab.
  const lastBlock = useRef(block?.id);
  if (block) lastBlock.current = block.id;

  const textRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // A selection to set once the text it falls in is on the page: after 조건 삽입 or 명령어 삽입, or Enter from the outline.
  const select = useRef<[number, number] | { show: [number, number] } | 'name' | 'text' | null>(null);
  const applySelect = () => {
    const want = select.current;
    select.current = null;
    const area = textRef.current;
    if (want === null) return;
    if (want === 'name' || !area) {
      nameRef.current?.focus();
      return;
    }
    if (typeof want === 'object' && 'show' in want) return revealIn(area, want.show);
    area.focus();
    if (Array.isArray(want)) area.setSelectionRange(...want);
  };
  useLayoutEffect(applySelect);

  const pick = (id: string) => onAt(isPane(id) ? { pane: id } : { pane: null, block: id });
  const leavePage = () => onAt({ pane: null });
  // Beside the outline 블록 opens a block, the last one open; drilled, the outline itself.
  const pickTab = (tab: PromptPane | typeof BLOCKS) => {
    if (tab !== BLOCKS) return pick(tab);
    if (!split) return leavePage();
    const blocks = latest.current.blocks;
    const back = blocks.find((each) => each.id === lastBlock.current) ?? blocks.find(isText) ?? blocks[0];
    if (back) pick(back.id);
  };

  // Every structural edit is a step on this one stack; a toast's 되돌리기 undoes its own step, and leaves with the
  // editor, whose stack it is.
  const undoable = useOwnUndo();
  const history = useRef(NO_HISTORY);
  // null: the step was refused, which the toast says, and nothing changed.
  const turn = (turned: Turned, failed: string): Step | null => {
    history.current = turned.history;
    if ('refused' in turned) {
      toast.error(`${failed}: ${turned.step.label}`, { detail: turned.refused });
      return null;
    }
    update(() => turned.patch);
    return turned.step;
  };
  const perform = (step: Step) => turn(doing(history.current, latest.current, step), '바꾸지 못했어요');
  const undo = (step: Step) => {
    const undone = undoing(history.current, latest.current, step);
    if (undone) turn(undone, UNDO.failed);
  };
  const report = (turned: Turned | null, words: typeof UNDO) => {
    if (!turned) return false;
    const step = turn(turned, words.failed);
    if (!step) return;
    if (split && step.block !== null && latest.current.blocks.some((each) => each.id === step.block)) pick(step.block);
    toast.show(`${words.did}: ${step.label}`);
  };
  // The editor's steps are everything but what is typed in a text field.
  useShortcut('undo', (event) => (typing(event) ? false : report(undoing(history.current, latest.current), UNDO)));
  useShortcut('redo', (event) => (typing(event) ? false : report(redoing(history.current, latest.current), REDO)));

  const change = (next: Block) => update((current) => ({ blocks: current.blocks.map((each) => (each.id === next.id ? next : each)) }));
  const insert = (at: number, kind: NewBlock) => {
    const added = newBlock(kind);
    if (!perform(addBlock(added, at))) return;
    pick(added.id);
    select.current = added.kind === 'text' ? 'text' : 'name';
  };
  const move = (from: number, to: number) => perform(moveBlock(latest.current.blocks[from]!, from, to));
  const remove = (id: string) => {
    const at = latest.current.blocks.findIndex((each) => each.id === id);
    const gone = latest.current.blocks[at];
    if (!gone) return;
    const next = latest.current.blocks[at + 1] ?? latest.current.blocks[at - 1];
    const step = perform(removeBlock(gone, at));
    if (!step) return;
    // The block on show gives way to its neighbour; a phone's list shows none.
    if (open === id && next && (split || picked !== undefined)) pick(next.id);
    undoable(`'${blockTitle(gone).title}' 블록을 뺐어요.`, () => undo(step));
  };
  const mark = (target: TextBlock, value: TextBlock['mark']) => {
    if (value === target.mark) return;
    const { taken } = withMark(latest.current.blocks, target.id, value);
    perform(setMark(target, value, taken));
    if (value && taken) toast.show(`'${MARKS[value].label}' 표시를 이 블록으로 옮겼어요.`);
  };
  const wrap = (target: WrappedSlot, wrapper: string | null) => {
    const step = perform(setWrapper(target, wrapper));
    if (step && wrapper === null) undoable('감싸는 텍스트를 뺐어요.', () => undo(step));
  };
  const typeSnippet = (snippet: (selected: string) => Snippet) => {
    const area = textRef.current!;
    const { selectionStart: start, selectionEnd: end } = area;
    const { text, select: [from, to] } = snippet(area.value.slice(start, end));
    select.current = [start + from, start + to];
    typeInto(area, [start, end], text);
  };
  const dropLines = (lines: Parameters<typeof removeLines>[0]) => {
    const step = perform(removeLines(lines));
    if (!step) return;
    undoable(`${withParticle(lineTitle(lines[0].line), '을/를')} 삭제했어요.`, () => undo(step));
  };
  const changeKey = (toggle: Toggle, to: string) => {
    const count = countUses(latest.current, toggle.key);
    if (!perform(renameKey(toggle, to))) return;
    toast.show('키를 바꿨어요.', count ? { detail: `조건 ${count}곳도 함께 바꿨어요.` } : undefined);
  };
  const modelSaved = (saving: Promise<ApiResult<unknown>>) => toast.settled(saving, '모델을 바꾸지 못했어요.');

  const isDefault = isDefaultPrompt(settings, stored);
  const cacheAt = (id: string) => {
    const target = latest.current.blocks.find((each) => each.id === id);
    if (target) perform(setCache(target, !target.cache));
  };

  const marks = cacheMarks(draft.blocks);
  const stops: OutlineStop[] = draft.blocks.map((each, at) => {
    const { title, dim } = blockTitle(each);
    const meta = blockMeta(each);
    const badge = each.kind === 'text' && each.mark ? MARKS[each.mark].label : undefined;
    const flagged = hasConditions(each);
    const cache = marks.get(each.id);
    const words = [`${at + 1}. ${title}`, badge, meta, flagged && '토글 조건 있음', cache && CACHE_WORDS[cache]].filter(Boolean).join(', ');
    return { id: each.id, kind: blockKind(each), icon: blockIcon(each), title, dim, note: meta, badge, flagged, cache, label: words };
  });
  const addMenu = (at: number) => (
    <>
      <MenuHeading>직접 입력</MenuHeading>
      {TEXTS.map((text) => (
        <MenuItem key={text.role} label={text.name} description={text.hint} onClick={() => insert(at, { text: text.role })} />
      ))}
      <Divider variant="menu" />
      <MenuHeading>자동 입력</MenuHeading>
      {slotsOf(sort).filter((slot) => (slot !== 'agentNotes' || agentsLab) && (slot !== 'status' || statusLab)).map((slot) => {
        const there = placedOnce(draft.blocks, slot);
        return there ? (
          <MenuItem key={slot} tone="muted" label={SLOT[slot].name} description="추가된 블록으로 이동" onClick={() => pick(there.id)} />
        ) : (
          <MenuItem key={slot} label={SLOT[slot].name} description={SLOT[slot].hint} onClick={() => insert(at, { slot })} />
        );
      })}
    </>
  );

  // A block found opens with the first place in its text selected and in view, or its name where only that holds it.
  const openFound = (found: Block) => {
    const { first } = blockHit(found, 0, search.words);
    select.current = first ? { show: first } : 'name';
    if (split && found.id === open) applySelect();
    else pick(found.id);
  };
  const search = useSearch(draft.blocks, '블록 검색', (each) => [blockTitle(each).title, each.kind === 'text' ? each.text : ''], { onEnter: openFound });
  const found = (blocks: readonly Block[]) => {
    const hits = blocks.map((each) => ({ block: each, hit: blockHit(each, draft.blocks.indexOf(each), search.words) }));
    return (
      <>
        <Text variant="note">{`블록 ${hits.length}개 · ${hits.reduce((sum, { hit }) => sum + hit.count, 0)}곳`}</Text>
        <List label="검색 결과">
          {hits.map(({ block: each, hit }) => (
            <FoundRow key={each.id} face={<Icon icon={blockIcon(each)} />} path={[hit.name]} snippet={hit.snippet} note={hit.count ? `${hit.count}곳` : '이름'} onClick={() => openFound(each)} />
          ))}
        </List>
      </>
    );
  };

  const warning = sort === 'conversation' ? chatWarning(draft.blocks) : null;
  const noPersona = sort === 'conversation' && !holdsPersona(draft.blocks);
  const addPersona = () => insert(draft.blocks.findIndex((each) => each.kind === 'slot' && each.slot === 'description') + 1, { slot: 'persona' });
  const outline = (
    <>
      <Section
        title="전송 순서"
        level={3}
        note={`${draft.blocks.length}개`}
        help={hover ? HELP : undefined}
        action={
          <>
            {/* The rows' own tools show only under a pointer that hovers; drilled, a press on a row opens its block. What a
                search found is not the outline, so nothing there is edited. */}
            {!(split && hover) && !search.words && (
              <Button variant="link" onClick={() => setEditing(!editing)}>
                {editing ? '완료' : '순서 편집'}
              </Button>
            )}
            <Menu
              label={ADD_BLOCK}
              size="lg"
              place="below-end"
              trigger={(opener) => (
                <Button variant="ghost" icon={ACTS.create.icon} {...opener}>
                  {ADD_BLOCK}
                </Button>
              )}
            >
              {addMenu(split && block ? index + 1 : draft.blocks.length)}
            </Menu>
          </>
        }
      >
        {search.field}
        {search.shown(
          <>
            {warning && <Callout tone="warn">{warning}</Callout>}
            {noPersona && (
              <Callout tone="warn" action={{ label: addOf(SLOT.persona.name), onClick: addPersona }}>
                {NO_PERSONA_SLOT}
              </Callout>
            )}
            <Outline
              label="전송 순서"
              help={HELP}
              start="맨 처음"
              end="응답 직전"
              stops={stops}
              current={split ? open : null}
              onPick={pick}
              onOpen={(id) => {
                select.current = draft.blocks.find((each) => each.id === id)?.kind === 'text' ? 'text' : 'name';
                // The block already open renders nothing new, so nothing would take the focus after it.
                if (split && id === open) applySelect();
                else pick(id);
              }}
              onRemove={remove}
              onMove={move}
              insert={addMenu}
              onCache={cacheAt}
              tools={editing ? 'shown' : 'hover'}
              drill={!split}
            />
          </>,
          found,
        )}
      </Section>
      {sort === 'translate' && <ProtectRules task="translate" rules={draft.protect ?? []} onChange={(protect) => update(() => ({ protect }))} />}
      {ofSort(stored, 'agent') && stored.value.stage === 'post' && (
        <>
          <AgentPlace place={draft.place} onChange={(place) => update(() => ({ place }))} />
          {draft.place === undefined && <ProtectRules task="agent" rules={draft.protect ?? []} onChange={(protect) => update(() => ({ protect }))} />}
        </>
      )}
    </>
  );

  const toggleCount = draft.toggles.filter(isToggle).length;
  const tabs = (
    <Tabs
      label={`${THINGS.prompt.noun} 항목`}
      items={[
        { value: BLOCKS, label: '블록', count: draft.blocks.length },
        ...panes.map((each) => ({ value: each, label: PANE_TITLES[each], count: (each === TOGGLES ? toggleCount : each === VARIABLES ? draft.variables!.length : 0) || undefined })),
      ]}
      value={split ? (isPane(open) ? open : BLOCKS) : (shownPane ?? BLOCKS)}
      onChange={pickTab}
    />
  );

  const page: ReactNode =
    open === READ ? (
      <PromptRead blocks={draft.blocks} marks={marks} onOpen={pick} />
    ) : open === MODEL && ofSort(stored, 'conversation') ? (
      <ModelPane models={stored.value.models} defaults={settings.models} connections={connections} onPick={(role, ref) => modelSaved(setPromptModel(store, stored.id, role, ref))} />
    ) : open === MODEL && ofSort(stored, 'agent') ? (
      <AgentModelPane own={stored.value.model} connections={connections} onPick={(ref) => modelSaved(setAgentModel(store, stored.id, ref))} />
    ) : open === PICTURE ? (
      <PicturePane tags={draft.tags} picture={draft.picture} onTags={(tags) => update(() => ({ tags }))} onPicture={(picture) => update(() => ({ picture }))} />
    ) : open === VARIABLES && draft.variables ? (
      <DefaultVariables variables={draft.variables} help="이 프롬프트를 쓰는 채팅의 변수 초기값이에요. 캐릭터에도 같은 이름의 기본 변수가 있으면 캐릭터 값을 써요." onChange={(variables) => update(() => ({ variables }))} />
    ) : open === MODULES && ofSort(stored, 'conversation') ? (
      <ModuleSwitches owner={{ kind: 'prompt', prompt: stored }} own={stored.value.modules ?? []} />
    ) : open === FEATURES && ofSort(stored, 'conversation') ? (
      <Stack gap="section">
        <FeatureSwitches owner={{ kind: 'prompt' }} own={stored.value.features} onChange={(feature, value) => setFeatureAt(store, { kind: 'prompt', id: stored.id }, feature, value)} />
        <AgentSwitches owner={{ kind: 'prompt' }} own={stored.value.agents ?? []} onChange={(agent, on) => setAgentAt(store, { kind: 'prompt', id: stored.id }, agent, on)} />
      </Stack>
    ) : open === STATE && ofSort(stored, 'conversation') ? (
      <StatusPane owner={{ kind: 'prompt', id: stored.id }} definition={stored.value.status} />
    ) : open === TOGGLES ? (
      <TogglePane
        owner={stored.id}
        lines={draft.toggles}
        uses={(key) => countUses(latest.current, key)}
        onAdd={(lines) => perform(addLines(lines, latest.current.toggles.length))}
        onEdit={(before, after, at, what) => JSON.stringify(before) !== JSON.stringify(after) && perform(editLine(before, after, at, what))}
        onType={(after, at) => update((current) => ({ toggles: current.toggles.with(at, after) }))}
        onMove={(line, move) => perform(moveLines(line, move))}
        onRekey={changeKey}
        onRemove={dropLines}
        adding={addingToggle}
        onAdding={setAddingToggle}
      />
    ) : (
      block && (
        <BlockPane
          key={block.id}
          block={block}
          sort={sort}
          index={index}
          count={draft.blocks.length}
          toggles={draft.toggles.filter(isToggle)}
          authorNote={draft.authorNote}
          onChange={change}
          onRole={(target, role) => role !== target.role && perform(setRole(target, role))}
          onRange={(target, range) => rangeKey(range) !== rangeKey(target.range) && perform(setRange(target, range))}
          onCount={(target, count) => perform(setCount(target, count))}
          onTranslations={(target, on) => perform(setTranslations(target, on))}
          onWrapper={wrap}
          onAuthorNote={(authorNote) => update(() => ({ authorNote }))}
          onMark={mark}
          cache={marks.get(block.id)}
          onCache={() => cacheAt(block.id)}
          onMove={(to) => move(index, to)}
          onStep={split ? undefined : (to) => pick(draft.blocks[to]!.id)}
          onRemove={() => remove(block.id)}
          onCondition={(toggle) => typeSnippet((selected) => conditionSnippet(toggle, selected))}
          onInsert={(snippet) => typeSnippet(() => snippet)}
          onNewToggle={() => {
            setAddingToggle(true);
            pick(TOGGLES);
          }}
          textRef={textRef}
          nameRef={nameRef}
        />
      )
    );

  const status = save.words;
  // Drilled, a block is a page of its own under the prompt's name; its place and its name stand in the page.
  if (!split && shownPane === null && picked !== undefined) return frame({ head: { title: promptName(draft.name), onBack: leavePage, backLabel: '전송 순서', status }, body: page, open });

  const origin = stored.value.task === undefined && stored.value.imported ? IMPORTED_FROM[stored.value.imported] : stored.value.origin ? copyOf(promptName(stored.value.origin.name)) : null;
  const facts = [sort === 'conversation' && promptUseWords(uses), ofSort(stored, 'agent') && STAGE_NAMES[stored.value.stage], origin].filter(Boolean).join(' · ');
  const subtitle = (isDefault || facts) && (
    <>
      {isDefault && sort !== 'agent' && <Tag tone="accent">{defaultPrompt(sort)}</Tag>} {facts}
    </>
  );
  // The prompts this one stands among in its list: its own sort's.
  const siblings = prompts.filter((each) => ofSort(each, sort)).toSorted(byPromptName);
  const head: NavBarProps = {
    title: draft.name,
    rename: { label: `${THINGS.prompt.noun} 이름`, placeholder: promptName(draft.name), onChange: (name) => update(() => ({ name })) },
    description: subtitle,
    ...(shownPane === TOGGLES && paneBack ? { onBack: paneBack.onBack, backLabel: paneBack.label } : { onBack, backLabel }),
    others: siblings.length > 1 ? { label: `다른 ${THINGS.prompt.noun}`, items: siblings.map((each) => <MenuItem key={each.id} label={promptName(each.value.name)} checked={each.id === stored.id} onClick={() => each.id !== stored.id && onOpen(each.id)} />) } : undefined,
    status,
    menu: {
      of: THINGS.prompt.noun,
      items: <PromptMenu stored={stored} onOpen={onOpen} onErased={onErased} onExport={() => setExporting(true)} />,
    },
  };

  const exportDialog = exporting && ofSort(stored, 'conversation') && <PresetExport prompt={{ ...stored.value, ...save.unsaved }} onClose={() => setExporting(false)} />;
  if (split) return frame({ head, tabs, side: outline, body: <>{page}{exportDialog}</>, open });
  return frame({ head, tabs, body: <>{shownPane === null ? <Stack gap="section">{outline}</Stack> : page}{exportDialog}</>, open: shownPane ?? BLOCKS });
}
