import { ArrowDown, ArrowUp, GitBranch, X } from 'lucide-react';
import { useMemo, type Ref } from 'react';
import { ACTS, addOf, newOf } from '../common/acts';
import { cbsLanguage } from '../common/code/cbs';
import { useTrial } from '../common/code/Trial';
import { CountedMarkup } from '../common/CountedFields';
import { withParticle } from '../common/particles';
import { SLOT } from '../common/prompt-words';
import { SHORTCUTS } from '../shortcuts';
import type { Block, ChatRange, ChatSlot, PromptSort, RecentSlot, Role, TextBlock, Toggle, WrappedSlot } from '../../model/prompt';
import { Button, ChoiceGroup, Divider, Empty, Hint, MarkupArea, Menu, MenuHeading, MenuItem, MoreMenu, Row, Section, SettingRow, Stack, Stepper, Switch, Tag, Text, TitleField } from '../ui';
import { blockTitle, describeRange, firstLine, MARKS, RANGES, rangeKey, ROLES, type CacheMark } from './blocks';
import { CommandMenu } from './CommandMenu';
import { RECENT_MAX, type Snippet } from './edits';


type Props = {
  block: Block;
  // A card replaces only a conversation prompt's texts.
  sort: PromptSort;
  index: number;
  count: number;
  toggles: readonly Toggle[];
  // null in a sort of prompt without one.
  authorNote: string | null;
  // What is typed into the block's fields, which the browser undoes; the rest are the editor's steps.
  onChange: (block: Block) => void;
  onRole: (block: Extract<Block, { role: Role }>, role: Role) => void;
  onRange: (block: ChatSlot, range: ChatRange) => void;
  onCount: (block: RecentSlot, count: number) => void;
  onTranslations: (block: RecentSlot, on: boolean) => void;
  onWrapper: (block: WrappedSlot, wrapper: string | null) => void;
  onAuthorNote: (text: string) => void;
  onMark: (block: TextBlock, mark: TextBlock['mark']) => void;
  cache: CacheMark | undefined;
  onCache: () => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onCondition: (toggle: Toggle) => void;
  onInsert: (snippet: Snippet) => void;
  onNewToggle: () => void;
  textRef: Ref<HTMLTextAreaElement>;
  nameRef: Ref<HTMLInputElement>;
};

const CACHE_HELP = '이 블록까지 캐시로 저장해 다음 요청에서 요금을 아껴요.';

export function BlockPane({ block, sort, index, count, toggles, authorNote, onChange, onRole, onRange, onCount, onTranslations, onWrapper, onAuthorNote, onMark, cache, onCache, onMove, onRemove, onCondition, onInsert, onNewToggle, textRef, nameRef }: Props) {
  const trial = useTrial(null);
  const cbs = useMemo(() => cbsLanguage({ variables: trial.variables }), [trial.variables]);
  const { title } = blockTitle(block);
  const where = `${index + 1}번째 · ${block.kind === 'text' ? '직접 입력' : `자동 입력 · ${SLOT[block.slot].name}`}`;
  const placeholder = block.kind === 'slot' ? SLOT[block.slot].name : firstLine(block.text) || '이름 붙이기';

  return (
    <Stack gap="section">
      <Stack gap="related">
        <Text variant="note">
          {where}
        </Text>
        <TitleField
          ref={nameRef}
          label="블록 이름"
          value={block.name ?? ''}
          placeholder={placeholder}
          blank={block.kind === 'slot' ? '비워 두면 자동 입력 이름으로 표시돼요.' : '비워 두면 첫 줄이 이름으로 표시돼요.'}
          onChange={(name) => onChange({ ...block, name: name || null })}
        />
        <Row kind="toolbar">
          {'role' in block && <ChoiceGroup<Role> label="전송 역할" showLabel layout="fit" options={ROLES} value={block.role} onChange={(role) => onRole(block, role)} />}
          {block.kind === 'text' && block.mark && (
            <>
              <Tag tone="accent">{MARKS[block.mark].label}</Tag>
              <Hint label={MARKS[block.mark].label}>{`캐릭터 카드에 ${withParticle(`'${MARKS[block.mark].card}'`, '이/가')} 있으면 그 내용으로 대체되고, 이 텍스트는 카드의 {{original}} 자리에 들어가요.`}</Hint>
            </>
          )}
          {block.kind === 'text' && (
            <Menu
              label="조건 삽입"
              place="below-end"
              trigger={(opener) => (
                <Button variant="ghost" size="sm" icon={GitBranch} {...opener}>
                  조건 삽입
                </Button>
              )}
            >
              <MenuHeading>토글 선택</MenuHeading>
              {toggles.length === 0 && <Empty variant="menu">토글이 없어요.</Empty>}
              {toggles.map((toggle) => (
                <MenuItem
                  key={toggle.key}
                  label={toggle.label}
                  sub={`${toggle.key} · ${toggle.kind === 'check' ? '켬 · 끔' : toggle.kind === 'choice' ? toggle.options.join(' · ') : '입력한 값'}`}
                  onClick={() => onCondition(toggle)}
                />
              ))}
              <Divider variant="menu" />
              <MenuItem icon={ACTS.create.icon} label={newOf('토글')} onClick={onNewToggle} />
            </Menu>
          )}
          {block.kind === 'text' && <CommandMenu sort={sort} onInsert={onInsert} />}
          <MoreMenu of={`'${title}'`}>
            {block.kind === 'text' && sort === 'conversation' && (
              <>
                <MenuHeading>카드 내용으로 대체</MenuHeading>
                <MenuItem label="대체하지 않음" sub="캐릭터 카드와 상관없이 이 텍스트를 보내요" checked={block.mark === null} onClick={() => onMark(block, null)} />
                {(['main', 'globalNote'] as const).map((mark) => (
                  <MenuItem key={mark} label={MARKS[mark].label} sub={MARKS[mark].hint} checked={block.mark === mark} onClick={() => onMark(block, mark)} />
                ))}
                <Divider variant="menu" />
              </>
            )}
            {index > 0 && <MenuItem icon={ArrowUp} label="위로 옮기기" onClick={() => onMove(index - 1)} />}
            {index < count - 1 && <MenuItem icon={ArrowDown} label="아래로 옮기기" onClick={() => onMove(index + 1)} />}
            <MenuItem icon={X} tone="warn" label="빼기" onClick={onRemove} />
          </MoreMenu>
        </Row>
      </Stack>
      {block.kind === 'slot' && <Text>{SLOT[block.slot].line}</Text>}
      {block.kind === 'text' && (
        <CountedMarkup
          ref={textRef}
          label="내용"
          language={cbs}
          expand={SHORTCUTS.bigEdit.keys}
          aside={trial.cbs}
          value={block.text}
          placeholder={block.mark === 'globalNote' ? `비워 두면 카드에 '대화 뒤 지시문'이 있을 때만 보내요.` : '모델에게 보낼 내용'}
          onChange={(text) => onChange({ ...block, text })}
        />
      )}
      {block.kind === 'slot' && block.slot === 'chat' && <RangeChoice block={block} onRange={(range) => onRange(block, range)} />}
      {block.kind === 'slot' && block.slot === 'recent' && (
        <>
          <SettingRow
            label="메시지 수"
            control={<Stepper label="메시지 수" less="메시지 1개 줄이기" more="메시지 1개 늘리기" value={block.count} min={1} max={RECENT_MAX} onChange={(next) => onCount(block, next)} />}
          />
          {/* A 삽화 prompt's 이전 메시지 never holds translations (engine/pipeline). */}
          {sort === 'translate' && (
            <SettingRow
              label="번역 포함"
              help="끄면 대화 원문만 보내요."
              control={<Switch label="번역 포함" checked={block.translations !== false} onChange={(on) => onTranslations(block, on)} />}
            />
          )}
        </>
      )}
      {block.kind === 'slot' && block.slot === 'authorNote' && authorNote !== null && (
        <Section title="기본 노트" level={3} help="비워 두면 노트가 없는 채팅에는 아무것도 들어가지 않아요.">
          <CountedMarkup label="기본 노트" variant="field" language={cbs} expand={SHORTCUTS.bigEdit.keys} aside={trial.cbs} value={authorNote} onChange={onAuthorNote} />
        </Section>
      )}
      {'wrapper' in block &&
        (block.wrapper === null ? (
          <Row kind="actions">
            <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={() => onWrapper(block, '{{slot}}')}>
              {addOf('감싸는 텍스트')}
            </Button>
          </Row>
        ) : (
          <Section
            title="감싸는 텍스트"
            level={3}
            note={`{{slot}} 자리에 ${SLOT[block.slot].name} 내용이 들어가요.`}
            action={
              <Button variant="ghost" onClick={() => onWrapper(block, null)}>
                빼기
              </Button>
            }
          >
            <MarkupArea label="감싸는 텍스트" variant="field" language={cbs} value={block.wrapper} onChange={(wrapper) => onChange({ ...block, wrapper })} />
          </Section>
        ))}
      <SettingRow
        label="여기까지 캐시"
        help={cache === 'auto' ? undefined : CACHE_HELP}
        control={cache === 'auto' ? <Text variant="note">자동</Text> : <Switch label="여기까지 캐시" checked={cache === 'set'} onChange={onCache} />}
      />
    </Stack>
  );
}

function RangeChoice({ block, onRange }: { block: ChatSlot; onRange: (range: ChatRange) => void }) {
  const current = rangeKey(block.range);
  const known = RANGES.some((option) => rangeKey(option.range) === current);
  const options = [...RANGES, ...(known ? [] : [{ range: block.range, ...describeRange(block.range) }])];
  return (
    <ChoiceGroup
      label="포함할 메시지 범위"
      layout="list"
      options={options.map((option) => ({ value: rangeKey(option.range), label: option.label }))}
      value={current}
      onChange={(key) => onRange(options.find((option) => rangeKey(option.range) === key)!.range)}
    />
  );
}
