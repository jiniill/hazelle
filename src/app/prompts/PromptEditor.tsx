import { Cpu, ImageIcon, SlidersHorizontal } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { holdsPersona } from '../../engine/pipeline';
import type { Stored } from '../../model/kinds';
import { live } from '../../model/library';
import { labOn } from '../../model/settings';
import { isToggle, slotsOf, sortOf, type Block, type PromptSort, type TextBlock, type Toggle, type WrappedSlot } from '../../model/prompt';
import { setPromptModel, setTaskModel } from '../../runtime/assignment';
import { copyPrompt, editPrompt, isDefaultPrompt, ofSort, removePrompt, resetPromptBlocks, restorePrompt, setDefaultPrompt, type PromptPatch } from '../../runtime/prompts';
import { ACTS } from '../common/acts';
import { FeatureSwitches } from '../common/FeatureSwitches';
import { ModuleSwitches } from '../common/ModuleSwitches';
import { NO_PERSONA_SLOT, SLOT } from '../common/prompt-words';
import type { Frame } from '../common/frame';
import { useAutosave } from '../common/useAutosave';
import { BIN_KEEPS, cannotRemove, copyName, copyOf, ORIGINAL_GONE, PRE_READ, promptName, SEE_ORIGINAL, SET_DEFAULT, STAGE_NAMES } from '../common/words';
import { useConnections, useSettings, useStore, useStored } from '../session';
import type { PromptPane } from '../shell/routes';
import { typing, useShortcut } from '../shortcuts';
import { useOwnUndo, useToast } from '../toast';
import { Button, Callout, Divider, MenuHeading, MenuItem, NavRow, Outline, Row, Section, Stack, Tag, typeInto, type NavBarProps, type OutlineStop } from '../ui';
import { BlockPane } from './BlockPane';
import { blockIcon, blockKind, blockMeta, blockTitle, cacheMarks, hasConditions, isText, MARKS, rangeKey, TEXTS } from './blocks';
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
import { ModelPane, modelWords, TaskModelPane, taskModelWords } from './ModelPane';
import { chatWarning } from './ranges';
import { PicturePane } from './PicturePane';
import { PresetExport } from './PresetExport';
import { ProtectRules } from './ProtectRules';
import { AgentPlace } from './AgentPlace';
import { AgentSwitches } from '../common/AgentSwitches';
import { TogglePane } from '../common/TogglePane';
import { withParticle } from '../common/particles';
import { lineTitle } from '../common/toggleWords';
import { EMPTY_USE, promptUseWords, usePromptUse } from '../common/usePromptUse';

const MODEL = 'model' satisfies PromptPane;
const TOGGLES = 'toggles' satisfies PromptPane;
const PICTURE = 'picture' satisfies PromptPane;
const SORT_WORDS = {
  conversation: { default: '기본 프롬프트', makeDefault: '새 채팅을 시작할 때 이 프롬프트를 써요' },
  translate: { default: '기본 번역 프롬프트', makeDefault: '번역 프롬프트를 따로 선택하지 않은 채팅에 써요' },
  memory: { default: '기본 기억 프롬프트', makeDefault: '장기 기억을 이 프롬프트로 정리해요' },
  illustrate: { default: '기본 삽화 프롬프트', makeDefault: '삽화 프롬프트를 따로 선택하지 않은 채팅에 써요' },
  mascot: { default: '기본 마스코트 프롬프트', makeDefault: '마스코트가 이 프롬프트로 대사를 써요' },
  preread: { default: `기본 ${PRE_READ} 프롬프트`, makeDefault: '이 프롬프트로 긴 내용을 먼저 줄여요' },
} satisfies Record<Exclude<PromptSort, 'agent'>, { default: string; makeDefault: string }>;
const HELP = '위아래 화살표로 이동, Alt+화살표로 순서 변경, Enter로 편집, Delete로 빼기';

const CACHE_WORDS = { set: '여기까지 캐시', auto: '자동 캐시' } as const;
const UNDO = { did: '되돌렸어요', failed: '되돌리지 못했어요' };
const REDO = { did: '다시 실행했어요', failed: '다시 실행하지 못했어요' };

type Props = {
  stored: Stored<'prompt'>;
  // The caller decides, since a side panel is narrow on any screen.
  layout: 'split' | 'drill';
  // The pane open in place of a block, drilled into: a page keeps it in its address, a panel in its own state.
  pane: PromptPane | null;
  onPane: (pane: PromptPane | null) => void;
  // The block it opens at, drilled into; read once, as it mounts.
  block?: string;
  // Where the 토글 pane goes back to when it was opened from outside the editor; the outline is a link under its head.
  paneBack?: { label: string; onBack: () => void };
  backLabel: string;
  onBack: () => void;
  // Opens another prompt: a copy just made, or the original of this copy.
  onOpen: (id: string) => void;
  onErased: () => void;
  frame: Frame;
};

// Its state is one prompt's, so a caller keys it by id; unmounting it saves.
export function PromptEditor({ stored, layout, pane, onPane, block: openAt, paneBack, backLabel, onBack, onOpen, onErased, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  // 에이전트 노트 is offered only while the 실험실 switch is on, as everything of an experiment.
  const agentsLab = labOn(settings, 'agents');
  const connections = useConnections();
  const uses = usePromptUse().get(stored.id) ?? EMPTY_USE;
  const original = live(useStored('prompt', stored.value.origin?.id ?? null));
  const split = layout === 'split';
  const save = useAutosave<PromptPatch>(`prompt:${stored.id}`, (patch) => editPrompt(store, stored.id, patch));
  const sort = sortOf(stored.value);
  // An agent has no default: the chats whose lists hold it run it (runtime/agents).
  const words = sort === 'agent' ? null : SORT_WORDS[sort];

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

  const firstText = () => latest.current.blocks.find(isText)?.id ?? MODEL;
  // A block only: the pane open in its place is the pane prop's.
  const [picked, setPicked] = useState(openAt);
  const [drilled, setDrilled] = useState(openAt !== undefined);
  const [reordering, setReordering] = useState(false);
  const [addingToggle, setAddingToggle] = useState(false);
  const [exporting, setExporting] = useState(false);
  // 이미지 is an illustration prompt's only; an address naming it on another opens as if it named none.
  const shownPane = pane === PICTURE && sort !== 'illustrate' ? null : pane;
  const open = shownPane ?? (picked !== undefined && draft.blocks.some((block) => block.id === picked) ? picked : firstText());
  const index = draft.blocks.findIndex((block) => block.id === open);
  const block = draft.blocks[index];

  const textRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // A selection to set once the text it falls in is on the page: after 조건 삽입 or 명령어 삽입, or Enter from the outline.
  const select = useRef<[number, number] | 'name' | 'text' | null>(null);
  const applySelect = () => {
    const want = select.current;
    select.current = null;
    const area = textRef.current;
    if (want === null) return;
    if (want === 'name' || !area) {
      nameRef.current?.focus();
      return;
    }
    area.focus();
    if (Array.isArray(want)) area.setSelectionRange(...want);
  };
  useLayoutEffect(applySelect);

  const pick = (id: string) => {
    if (!split) setDrilled(true);
    if (id === MODEL || id === PICTURE || id === TOGGLES) return onPane(id);
    setPicked(id);
    if (pane) onPane(null);
  };
  const leavePage = () => {
    setDrilled(false);
    if (pane) onPane(null);
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
    if (open === id && next) setPicked(next.id);
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
  const modelSaved = (saving: ReturnType<typeof setTaskModel>) => void saving.then((saved) => saved.ok || toast.failed(saved, '모델을 바꾸지 못했어요.'));

  const isDefault = isDefaultPrompt(settings, stored);
  const copy = async () => {
    if (!(await save.flush())) return;
    const made = crypto.randomUUID();
    const copying = copyPrompt(store, stored.id, copyName(promptName(latest.current.name)), made);
    onOpen(made);
    const copied = await copying;
    if (!copied.ok) return toast.failed(copied, '사본을 만들지 못했어요.');
    toast.show('사본을 만들었어요.');
  };
  const resetBlocks = async () => {
    if (!(await save.flush())) return;
    const { blocks, toggles } = latest.current;
    const reset = await resetPromptBlocks(store, stored.id);
    if (!reset.ok) return toast.failed(reset, '기본 블록으로 되돌리지 못했어요.');
    toast.undoable('기본 블록으로 되돌렸어요.', () => editPrompt(store, stored.id, { blocks, toggles }));
  };
  const makeDefault = async () => {
    const saved = await setDefaultPrompt(store, stored.id);
    if (!saved.ok) toast.failed(saved, '기본으로 정하지 못했어요.');
  };
  const erase = async () => {
    const removed = await save.remove(() => removePrompt(store, stored.id));
    if (!removed) return;
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    onErased();
    toast.undoable(`'${promptName(removed.data.value.name)}' 프롬프트를 삭제했어요.`, () => restorePrompt(store, stored.id), BIN_KEEPS);
  };

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
    return { id: each.id, kind: blockKind(each), icon: blockIcon(each), title, dim, meta, badge, flagged, cache, label: words };
  });
  const addMenu = (at: number) => (
    <>
      <MenuHeading>직접 입력</MenuHeading>
      {TEXTS.map((text) => (
        <MenuItem key={text.role} label={text.name} sub={text.hint} onClick={() => insert(at, { text: text.role })} />
      ))}
      <Divider variant="menu" />
      <MenuHeading>자동 입력</MenuHeading>
      {slotsOf(sort).filter((slot) => slot !== 'agentNotes' || agentsLab).map((slot) => {
        const there = placedOnce(draft.blocks, slot);
        return there ? (
          <MenuItem key={slot} tone="muted" label={SLOT[slot].name} sub="추가된 블록으로 이동" onClick={() => pick(there.id)} />
        ) : (
          <MenuItem key={slot} label={SLOT[slot].name} sub={SLOT[slot].hint} onClick={() => insert(at, { slot })} />
        );
      })}
    </>
  );

  const warning = sort === 'conversation' ? chatWarning(draft.blocks) : null;
  const noPersona = sort === 'conversation' && !holdsPersona(draft.blocks);
  const outline = (
    <>
      <Stack gap="related">
        <NavRow
          icon={Cpu}
          label="모델"
          meta={stored.value.task === undefined ? modelWords(stored.value.models, connections) : taskModelWords(stored.value.model, connections)}
          current={split && open === MODEL}
          onClick={() => pick(MODEL)}
        />
        {sort === 'illustrate' && <NavRow icon={ImageIcon} label="이미지" meta={draft.tags || Object.values(draft.picture ?? {}).some((value) => value !== undefined) ? '직접 지정' : '기본값'} current={split && open === PICTURE} onClick={() => pick(PICTURE)} />}
        <NavRow icon={SlidersHorizontal} label="토글" meta={`${draft.toggles.filter(isToggle).length}개`} current={split && open === TOGGLES} onClick={() => pick(TOGGLES)} />
      </Stack>
      <Section
        title="보내는 순서"
        level={3}
        note={`${draft.blocks.length}개`}
        action={
          !split && (
            <Button variant="link" onClick={() => setReordering(!reordering)}>
              {reordering ? '완료' : '순서 바꾸기'}
            </Button>
          )
        }
      >
        {warning && <Callout tone="warn">{warning}</Callout>}
        {noPersona && <Callout tone="warn">{NO_PERSONA_SLOT}</Callout>}
        <Outline
          label="보내는 순서"
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
          reorder={reordering ? 'buttons' : 'drag'}
          drill={!split}
        />
      </Section>
      {sort === 'translate' && <ProtectRules task="translate" rules={draft.protect ?? []} onChange={(protect) => update(() => ({ protect }))} />}
      {ofSort(stored, 'agent') && stored.value.stage === 'post' && (
        <>
          <AgentPlace place={draft.place} onChange={(place) => update(() => ({ place }))} />
          {draft.place === undefined && <ProtectRules task="agent" rules={draft.protect ?? []} onChange={(protect) => update(() => ({ protect }))} />}
        </>
      )}
      {ofSort(stored, 'conversation') && (
        <>
          <ModuleSwitches owner={{ kind: 'prompt', prompt: stored }} own={stored.value.modules ?? []} />
          <FeatureSwitches owner={{ kind: 'prompt', id: stored.id }} own={stored.value.features} />
          <AgentSwitches owner={{ kind: 'prompt', id: stored.id }} own={stored.value.agents ?? []} />
        </>
      )}
    </>
  );

  const page: ReactNode =
    open === MODEL ? (
      stored.value.task === undefined ? (
        <ModelPane models={stored.value.models} defaults={settings.models} connections={connections} onPick={(role, ref) => modelSaved(setPromptModel(store, stored.id, role, ref))} />
      ) : (
        <TaskModelPane task={stored.value.task} own={stored.value.model} connections={connections} onPick={(ref) => modelSaved(setTaskModel(store, stored.id, ref))} />
      )
    ) : open === PICTURE ? (
      <PicturePane tags={draft.tags} picture={draft.picture} onTags={(tags) => update(() => ({ tags }))} onPicture={(picture) => update(() => ({ picture }))} />
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
  if (!split && (drilled || shownPane !== null)) {
    const title = open === MODEL ? '모델' : open === PICTURE ? '이미지' : open === TOGGLES ? '토글' : block ? blockTitle(block).title : '';
    if (open === TOGGLES && paneBack) {
      const toOutline = (
        <Row kind="actions">
          <Button variant="link" size="xs" onClick={leavePage}>
            프롬프트 열기
          </Button>
        </Row>
      );
      return frame({ head: { title, onBack: paneBack.onBack, backLabel: paneBack.label, status }, body: <>{toOutline}{page}</>, open });
    }
    return frame({ head: { title, onBack: leavePage, backLabel: '보내는 순서', status }, body: page, open });
  }

  const origin = stored.value.task === undefined && stored.value.imported === 'risu-preset' ? 'Risu 프리셋에서 가져옴' : stored.value.origin ? copyOf(promptName(stored.value.origin.name)) : null;
  const facts = [sort === 'conversation' && promptUseWords(uses), ofSort(stored, 'agent') && STAGE_NAMES[stored.value.stage], origin].filter(Boolean).join(' · ');
  const subtitle = (isDefault || facts) && (
    <>
      {isDefault && <Tag tone="accent">{words?.default}</Tag>} {facts}
    </>
  );
  const head: NavBarProps = {
    title: draft.name,
    rename: { label: '프롬프트 이름', placeholder: promptName(draft.name), onChange: (name) => update(() => ({ name })) },
    subtitle,
    onBack,
    backLabel,
    status,
    menu: {
      of: '프롬프트',
      items: (
        <>
          {stored.value.origin && <MenuItem label={SEE_ORIGINAL} sub={original ? undefined : ORIGINAL_GONE} disabled={!original} onClick={() => onOpen(stored.value.origin!.id)} />}
          <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} onClick={() => void copy()} />
          {ofSort(stored, 'conversation') && <MenuItem icon={ACTS.export.icon} label={ACTS.export.label} onClick={() => setExporting(true)} />}
          {words && !isDefault && <MenuItem label={SET_DEFAULT} sub={words.makeDefault} onClick={() => void makeDefault()} />}
          {sort !== 'conversation' && <MenuItem label="기본 블록으로 되돌리기" sub="블록을 앱의 기본으로 바꿔요. 이름과 모델은 그대로예요." onClick={() => void resetBlocks()} />}
          <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} sub={isDefault ? cannotRemove(words!.default) : undefined} tone="warn" disabled={isDefault} onClick={() => void erase()} />
        </>
      ),
    },
  };

  const exportDialog = exporting && ofSort(stored, 'conversation') && <PresetExport prompt={{ ...stored.value, ...save.unsaved }} onClose={() => setExporting(false)} />;
  if (split) return frame({ head, side: outline, body: <>{page}{exportDialog}</>, open });
  return frame({ head, body: <Stack gap="section">{outline}{exportDialog}</Stack>, open });
}
