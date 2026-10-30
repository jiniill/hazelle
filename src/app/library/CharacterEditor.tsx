import { setModels } from '../../runtime/pack';
import { setAgentAt } from '../../runtime/agents';
import { setFeatureAt } from '../../runtime/features';
import type { ObjectStore } from '../../runtime/store';
import { BookOpen, Braces, Eye, IdCard, Images, Languages, MessageSquareQuote, Package, Palette, ScrollText, SlidersHorizontal, Sparkles, Square, ToggleRight, UserRound, Variable, type LucideIcon } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { storyHtml } from '../../engine/display';
import { unused } from '../../engine/pipeline';
import type { ChatSummary } from '../../model/chat';
import type { CharacterShelf, Pictures } from '../../model/library';
import { likenessId } from '../../model/likeness';
import { isToggle } from '../../model/prompt';
import { editCharacter, setAvatar, setCardWrites, setDecor, setKeepThoughts, setPictures, setTranslatorNote, type CharacterText } from '../../runtime/characters';
import { scriptsOf } from '../../runtime/script-selection';
import { packsOf } from '../../runtime/chat-context';
import { aliased } from '../common/alias';
import { cbsLanguage } from '../common/code/cbs';
import { useTrial } from '../common/code/Trial';
import { CountedField } from '../common/CountedFields';
import { describeTranslateFailure } from '../common/failure';
import { describeUnused } from '../common/unused';
import { AssetsEditor } from '../common/AssetsEditor';
import { EntryList } from '../common/EntryList';
import { LoreEditor } from '../common/LoreEditor';
import { scriptHolds } from '../common/pack';
import { featureHolds, FeatureSwitches } from '../common/FeatureSwitches';
import { AgentSwitches } from '../common/AgentSwitches';
import { ModuleSwitches } from '../common/ModuleSwitches';
import { PackToggles } from '../common/PackToggles';
import { ScriptsEditor } from '../common/ScriptsEditor';
import { PortraitsEditor } from '../common/PortraitsEditor';
import type { CharacterPart } from '../common/characterPart';
import type { Frame } from '../common/frame';
import { PICTURE_PERCENT_ERROR, readPicturePercent } from '../common/picturePercent';
import { FaceChange } from '../common/FaceChange';
import { useTypedNumber } from '../common/typed';
import { mergeStatus, saveWords, useAutosave } from '../common/useAutosave';
import { useIdentityFields } from '../common/useIdentityFields';
import { BOT_MODELS, BOT_MODELS_HELP, CARD_WRITES, CARD_WRITES_HELP, copyOf, DEFAULT_VARIABLES, FEATURES_TITLE, inFeature, inSettings, NOTE_PLACEHOLDER, opens, ORIGINAL_GONE, PAGES, SCRIPTS, SEE_ORIGINAL, STOP, TRANSLATOR_NOTE } from '../common/words';
import { useDisplay } from '../display';
import { editing } from './editing';
import { CharacterActionItems } from './gallery/CharacterCard';
import { ShareDialog } from './ShareDialog';
import { useCharacter, useChildren, useFiles, useModules, useSettings, useStore, useStored } from '../session';
import { navigate } from '../shell/router';
import { characterPage, HOME } from '../shell/routes';
import { SHORTCUTS } from '../shortcuts';
import { useToast } from '../toast';
import { Button, Callout, ChoiceGroup, Disclosure, FieldRow, List, ListItem, MenuItem, NavGroup, NavRow, NumberInput, Portrait, Row, Section, SettingGroup, SettingRow, Story, Switch, Tag, Text, TextField, useWide, type Help } from '../ui';
import { useCardTranslation } from './useCardTranslation';
import { useCharacterActions } from './useCharacterActions';
import { useNoteDraft } from './useNoteDraft';

const SWITCHES = { decor: setDecor, botModels: (store: ObjectStore, id: string, on: boolean) => setModels(store, { kind: 'character', id }, on), cardWrites: setCardWrites, keepThoughts: setKeepThoughts };
type Switched = keyof typeof SWITCHES;

const PARTS: Record<CharacterPart, { label: string; icon: LucideIcon }> = {
  profile: { label: '프로필', icon: IdCard },
  character: { label: '캐릭터', icon: UserRound },
  greetings: { label: '첫인사', icon: MessageSquareQuote },
  instructions: { label: '지시문', icon: ScrollText },
  lore: { label: '로어북', icon: BookOpen },
  modules: { label: PAGES.modules, icon: Package },
  features: { label: FEATURES_TITLE, icon: ToggleRight },
  scripts: { label: SCRIPTS.part, icon: Braces },
  toggles: { label: '토글', icon: SlidersHorizontal },
  variables: { label: DEFAULT_VARIABLES, icon: Variable },
  assets: { label: '에셋', icon: Images },
  illustration: { label: '삽화', icon: Palette },
  display: { label: '표시', icon: Eye },
};
const GROUPS: CharacterPart[][] = [
  ['profile', 'character', 'greetings'],
  ['instructions', 'lore', 'modules', 'features', 'scripts', 'toggles', 'variables'],
  ['assets', 'illustration', 'display'],
];
const LIST = '캐릭터 항목';
// Keep variable fields single-line and names free of = so Risu name=value export round-trips.
const variableError = (variables: [string, string][], index: number) => {
  const name = variables[index]![0];
  if (!name) return '이름을 입력해 주세요.';
  if (name.includes('=')) return '이름에 =는 쓸 수 없어요.';
  return variables.some(([other], at) => at > index && other === name) ? '아래에 같은 이름이 있어서 이 값은 쓰이지 않아요.' : undefined;
};
type Reading = 'source' | 'translated';
const READINGS: { value: Reading; label: string }[] = [
  { value: 'source', label: '원문' },
  { value: 'translated', label: '번역' },
];

type Props = {
  shelf: CharacterShelf<ChatSummary>;
  // The caller decides, since a side panel is narrow on any screen.
  layout: 'split' | 'drill';
  part: CharacterPart | null;
  onPart: (part: CharacterPart | null) => void;
  // Where the part goes back to when it was opened from outside the editor; the list is a link under its head.
  partBack?: { label: string; onBack: () => void };
  frame: Frame;
};

// Unmount flushes edits; moving between parts must keep the editor mounted.
// Show current stored shelf under queued patches, writing only changed fields.
export function CharacterEditor({ shelf, layout, part, onPart, partBack, frame }: Props) {
  const { id, character, face } = shelf;
  const { card, origin } = character;
  const trial = useTrial({ kind: 'character', id }, card.variables);
  const cbs = useMemo(() => cbsLanguage({ variables: trial.variables }), [trial.variables]);
  const instructions = useMemo(() => cbsLanguage({ variables: trial.variables, placeholder: 'original' }), [trial.variables]);
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const wide = useWide();
  const original = useCharacter(origin?.id ?? null);
  const lore = useChildren('lore', id);
  const assets = useChildren('asset', id);
  const likeness = useStored('likeness', likenessId(id));
  const modules = useModules();
  const always = useSettings().modules ?? [];
  const ownModules = character.modules ?? [];
  const textSave = useAutosave<CharacterText>(`character:${id}`, (patch) => editCharacter(store, id, patch));
  const { status, unsaved, change } = textSave;
  const { display } = useDisplay();
  const pictureSave = useAutosave<Pictures>(`character-pictures:${id}`, (patch) => setPictures(store, id, patch));
  const noteSave = useAutosave<{ note: string }>(`character-note:${id}`, ({ note = '' }) => setTranslatorNote(store, id, note));
  const actions = useCharacterActions(editing(textSave, [pictureSave, noteSave]));
  const { busy, sharing, stopSharing } = actions;
  const noteText = noteSave.unsaved.note ?? character.translatorNote ?? '';
  // The draft lands after the user may have typed more; it goes under the note as it is then.
  const noteNow = useRef(noteText);
  noteNow.current = noteText;
  const noteDraft = useNoteDraft(id, noteSave.flush, (lines) => noteSave.change({ note: noteNow.current.trim() ? `${noteNow.current.trimEnd()}\n\n${lines}` : lines }));
  const held: CharacterText = { ...character.card, alias: character.alias ?? '', ...unsaved };
  const identity = useIdentityFields({ name: held.name, alias: held.alias, aliasExample: '겨울 버전', onChange: change });
  const text = { ...held, name: identity.name };
  // Most cards leave these two empty. Fixed at mount, so clearing one while typing does not hide it.
  const [legacy] = useState(() => ({ personality: !!held.personality, scenario: !!held.scenario }));
  const translation = useCardTranslation(id, character);
  const [reading, setReading] = useState<Reading>('source');
  const translated = reading === 'translated';
  const pictures: Pictures = { ...character.pictures, ...pictureSave.unsaved };
  const fold = pictures.fold !== false;
  const decor = character.decor !== false;
  const botModels = character.botModels === true;
  const cardWrites = character.cardWrites === true;
  const scripted = scriptsOf(packsOf(store, { character: id })).length > 0;
  const keepThoughts = character.keepThoughts === true;

  function flip(field: Switched, on: boolean) {
    void SWITCHES[field](store, id, on).then((saved) => saved.ok || toast.failed(saved, '저장하지 못했어요.'));
  }

  const peek = useTypedNumber(readPicturePercent, pictures.peek, { error: PICTURE_PERCENT_ERROR, onChange: (value) => pictureSave.change({ peek: value }) });
  const widest = useTypedNumber(readPicturePercent, pictures.widest, { error: PICTURE_PERCENT_ERROR, onChange: (value) => pictureSave.change({ widest: value }) });

  const percentRow = (percent: typeof peek, label: string, help: Help, placeholder: string) => (
    <SettingRow
      label={label}
      help={help}
      changed={percent.text.trim() !== ''}
      error={percent.error}
      control={<NumberInput label={label} value={percent.text} unit="%" placeholder={placeholder} invalid={percent.error !== undefined} onChange={percent.change} />}
    />
  );

  const readingSwitch = (
    <Row kind="toolbar">
      {translated &&
        (translation.running.size > 0 ? (
          <Button variant="secondary" icon={Square} onClick={translation.stop}>
            {STOP}
          </Button>
        ) : (
          <Button variant="ghost" icon={Languages} disabled={!translation.translator.ok || translation.sources.length === 0} onClick={translation.start}>
            {translation.missing.length > 0 ? '번역하기' : '다시 번역'}
          </Button>
        ))}
      <ChoiceGroup layout="fit" label="보기" options={READINGS} value={reading} onChange={setReading} />
    </Row>
  );
  const untranslated = (source: string) => (translation.running.has(source) ? '번역하는 중…' : '번역하지 않았어요.');
  const translatorMissing = translated && !translation.translator.ok && <Callout tone="warn">{`번역할 수 없어요. ${describeTranslateFailure(translation.translator.failure)}`}</Callout>;
  // The stored card's text, as it was translated; a draft not saved yet is not.
  const translatedField = (label: string, source: string, lines: number) =>
    source.trim() && (
      <TextField
        key={label}
        label={label}
        lines={lines}
        expand={SHORTCUTS.bigEdit.keys}
        readOnly
        value={translation.translationOf(source) ?? ''}
        placeholder={untranslated(source)}
        onChange={() => {}}
      />
    );

  const notUsed = describeUnused(unused(card));
  const notesTranslated = translation.translationOf(card.creatorNotes);
  const split = layout === 'split';
  const lead = (
    <>
      {card.tags.length > 0 && (
        <Row kind="tags">
          {card.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Row>
      )}
      {notUsed && <Callout tone="warn">{notUsed}</Callout>}
    </>
  );
  const pages: Record<CharacterPart, ReactNode> = {
    profile: (
      <>
        <FaceChange face={<Portrait image={face} name={card.name} />} apply={async (file) => setAvatar(store, files, id, new Uint8Array(await file.arrayBuffer()))} />
        {split && lead}
        <Section title={PARTS.profile.label}>
          {identity.fields}
          <TextField
            label="채팅 내 이름"
            value={text.nickname ?? ''}
            onChange={(value) => change({ nickname: value === '' ? null : value })}
            help="채팅에서 {{char}} 자리에 캐릭터 이름 대신 들어가요."
          />
        </Section>
        {card.creatorNotes.trim() && (
          <Section title="소개" action={readingSwitch}>
            {translatorMissing}
            {!translated ? (
              <Story html={storyHtml(card.creatorNotes, true)} />
            ) : notesTranslated !== undefined ? (
              <Story html={storyHtml(notesTranslated, true)} />
            ) : (
              <Text variant="note">{untranslated(card.creatorNotes)}</Text>
            )}
          </Section>
        )}
      </>
    ),
    character: (
      <Section title={PARTS.character.label} action={readingSwitch}>
        {translatorMissing}
        {translated ? (
          <>
            {translatedField('설명', card.description, 20)}
            {translatedField('성격', card.personality, 4)}
            {translatedField('상황', card.scenario, 4)}
            {translatedField('예시 대화', card.exampleDialogue, 6)}
          </>
        ) : (
          <>
            <CountedField label="설명" lines={20} expand={SHORTCUTS.bigEdit.keys} language={cbs} aside={trial.cbs} value={text.description} onChange={(value) => change({ description: value })} />
            {legacy.personality && <CountedField label="성격" lines={4} expand={SHORTCUTS.bigEdit.keys} language={cbs} aside={trial.cbs} value={text.personality} onChange={(value) => change({ personality: value })} />}
            {legacy.scenario && <CountedField label="상황" lines={4} expand={SHORTCUTS.bigEdit.keys} language={cbs} aside={trial.cbs} value={text.scenario} onChange={(value) => change({ scenario: value })} />}
            <CountedField label="예시 대화" lines={6} expand={SHORTCUTS.bigEdit.keys} language={cbs} aside={trial.cbs} value={text.exampleDialogue} onChange={(value) => change({ exampleDialogue: value })} />
          </>
        )}
      </Section>
    ),
    greetings: (
      <Section title={PARTS.greetings.label} help="새 채팅을 시작할 때 이 중에서 선택할 수 있어요." action={readingSwitch}>
        {translatorMissing}
        {translated ? (
          card.greetings.map((greeting, index) => translatedField(`첫인사 ${index + 1}`, greeting, 6))
        ) : (
          <EntryList
            entries={text.greetings}
            onChange={(greetings) => change({ greetings })}
            name={(index) => `첫인사 ${index + 1}`}
            blank=""
            addLabel="첫인사 추가"
            removed={(index) => `${index + 1}번째 첫인사를 삭제했어요.`}
          >
            {({ value, name, set, remove }) => <CountedField label={name} lines={6} expand={SHORTCUTS.bigEdit.keys} language={cbs} aside={trial.cbs} value={value} onChange={set} action={remove} />}
          </EntryList>
        )}
      </Section>
    ),
    instructions: (
      <Section title={PARTS.instructions.label}>
        <CountedField
          label="시스템 프롬프트"
          lines={6}
          expand={SHORTCUTS.bigEdit.keys}
          language={instructions}
          aside={trial.cbs}
          value={text.systemPrompt}
          onChange={(value) => change({ systemPrompt: value })}
          help={{ text: '비워 두면 기본 지시문을 써요. {{original}}을 넣으면 그 자리에 기본 지시문이 들어가요.', open: { label: opens(inSettings('prompts')), onClick: () => navigate({ kind: 'prompts', place: null, sort: 'conversation' }) } }}
        />
        <CountedField
          label="대화 뒤 지시문"
          lines={4}
          expand={SHORTCUTS.bigEdit.keys}
          language={instructions}
          aside={trial.cbs}
          value={text.postHistoryInstructions}
          onChange={(value) => change({ postHistoryInstructions: value })}
          help="대화 기록 바로 뒤에 붙어요."
        />
        <SettingRow
          label="유틸리티 봇"
          help="프롬프트는 쓰지 않고 이 캐릭터의 지시문과 설명, 로어북, 대화만 보내요."
          control={<Switch label="유틸리티 봇" checked={text.utility} onChange={(on) => change({ utility: on })} />}
        />
        <CountedField
          label={TRANSLATOR_NOTE}
          lines={6}
          expand={SHORTCUTS.bigEdit.keys}
          value={noteText}
          onChange={(note) => noteSave.change({ note })}
          placeholder={NOTE_PLACEHOLDER}
          help={{ text: "이 캐릭터를 번역할 때만 적용돼요. '초안 만들기'를 누르면 캐릭터 카드를 분석해 노트 아래에 내용을 추가해요.", open: { label: opens(inFeature('translate')), onClick: () => navigate({ kind: 'feature', feature: 'translate' }) } }}
          action={
            <Button variant="ghost" size="sm" icon={Sparkles} busy={noteDraft.running} onClick={noteDraft.start}>
              {noteDraft.running ? '쓰는 중…' : '초안 만들기'}
            </Button>
          }
        />
      </Section>
    ),
    lore: <LoreEditor owner={{ kind: 'character', id }} folders={character.loreFolders} variables={card.variables} />,
    modules: <ModuleSwitches owner={{ kind: 'character', id }} own={ownModules} />,
    features: (
      <>
        <FeatureSwitches owner={{ kind: 'character' }} own={character.features} onChange={(feature, value) => setFeatureAt(store, { kind: 'character', id }, feature, value)} />
        <AgentSwitches owner={{ kind: 'character' }} own={character.agents ?? []} onChange={(agent, on) => setAgentAt(store, { kind: 'character', id }, agent, on)} />
      </>
    ),
    scripts: <ScriptsEditor owner={{ kind: 'character', id }} pack={card} drill={!split} status={character.statusScripts} variables={card.variables} />,
    toggles: <PackToggles owner={{ kind: 'character', id }} lines={card.toggles} />,
    variables: (
      <Section title={DEFAULT_VARIABLES} help="새 채팅을 시작할 때 변수에 설정되는 초기값이에요. 기존 채팅에서도 아직 값이 바뀌지 않은 변수는 이 값을 사용해요.">
        <EntryList
          entries={text.variables}
          onChange={(variables) => change({ variables })}
          name={(index) => `변수 ${index + 1}`}
          blank={['', ''] as [string, string]}
          addLabel="변수 추가"
          removed={(index) => `${index + 1}번째 변수를 삭제했어요.`}
        >
          {({ value: [name, value], index, name: label, set, remove }) => (
            <FieldRow
              name={<TextField label={`${label} 이름`} showLabel={false} placeholder="이름" kind="key" value={name} onChange={(next) => set([next, value])} error={variableError(text.variables, index)} />}
              value={<TextField label={`${label} 값`} showLabel={false} placeholder="값" kind="key" value={value} onChange={(next) => set([name, next])} />}
              action={remove}
            />
          )}
        </EntryList>
      </Section>
    ),
    assets: <AssetsEditor owner={id} />,
    illustration: <PortraitsEditor owner={id} />,
    display: (
      <Section title={PARTS.display.label}>
        <SettingGroup label={PARTS.display.label}>
          <SettingRow label="봇 스타일" help="봇이 만든 상태창과 스타일, 버튼을 화면에 보여 줘요." control={<Switch label="봇 스타일" checked={decor} onChange={(on) => flip('decor', on)} />} />
          {decor && (
            <SettingRow
              label="긴 이미지 접기"
              help="이미지만 있는 줄은 길이를 접어 윗부분만 먼저 보여 줘요."
              control={<Switch label="긴 이미지 접기" checked={fold} onChange={(on) => pictureSave.change({ fold: on ? undefined : false })} />}
            />
          )}
          <SettingRow
            label="추론을 본문에 표시"
            help="<Thoughts> 같은 추론 블록을 숨기지 않고 본문에 그대로 보여 줘요."
            control={<Switch label="추론을 본문에 표시" checked={keepThoughts} onChange={(on) => flip('keepThoughts', on)} />}
          />
          {scripted && <SettingRow label={BOT_MODELS} help={BOT_MODELS_HELP} control={<Switch label={BOT_MODELS} checked={botModels} onChange={(on) => flip('botModels', on)} />} />}
          {/* An always-on module's script can ask too, so an answer given shows here whatever the character's own packs hold. */}
          {(scripted || character.cardWrites !== undefined) && <SettingRow label={CARD_WRITES} help={CARD_WRITES_HELP} control={<Switch label={CARD_WRITES} checked={cardWrites} onChange={(on) => flip('cardWrites', on)} />} />}
        </SettingGroup>
        {decor && (
          <Disclosure label="이미지 크기">
            <SettingGroup label="이미지 크기">
              {fold && percentRow(peek, '접힌 높이', '화면 높이 대비 비율이에요.', '40')}
              {percentRow(widest, '최대 폭', { text: '읽기 폭 대비 비율이에요. 비워 두면 디스플레이 설정 값을 사용해요.', open: { label: opens(inSettings('display')), onClick: () => navigate({ kind: 'display' }) } }, String(display.pictureWidest))}
            </SettingGroup>
          </Disclosure>
        )}
      </Section>
    ),
  };
  const holds: Partial<Record<CharacterPart, string>> = {
    greetings: `${text.greetings.length}개`,
    lore: `${lore.length}개`,
    modules: `${modules.filter((module) => always.includes(module.id) || ownModules.includes(module.id)).length}개 켜짐`,
    features: featureHolds(store, { kind: 'character' }, character.features),
    scripts: scriptHolds(card) || undefined,
    toggles: `${card.toggles.filter(isToggle).length}개`,
    variables: `${text.variables.length}개`,
    assets: `${assets.length}개`,
    illustration: likeness ? `${likeness.value.portraits.length}명` : undefined,
  };
  // A part with nothing to show is left out: 모듈 lists the account's modules, and there may be none.
  const groups = GROUPS.map((group) => group.filter((each) => each !== 'modules' || modules.length > 0));
  const subtitle = [card.creator && `제작자 ${card.creator}`, origin && copyOf(origin.name)].filter(Boolean).join(' · ') || undefined;
  const working = busy?.id === id ? busy.label : null;
  const menu = {
    of: '캐릭터',
    items: (
      <>
        {origin && <MenuItem label={SEE_ORIGINAL} sub={original ? undefined : ORIGINAL_GONE} disabled={!original} onClick={() => navigate(characterPage(origin.id, wide))} />}
        <CharacterActionItems shelf={shelf} actions={actions} disabled={busy !== null} onRemoved={() => navigate(HOME)} />
      </>
    ),
  };
  const title = aliased(text.name, text.alias);
  const shareDialog = sharing && <ShareDialog character={id} name={text.name} onClose={stopSharing} />;
  const state = working ?? saveWords(mergeStatus(status, pictureSave.status, noteSave.status));
  if (split) {
    const open = part ?? 'profile';
    const side = groups.map((group) => (
      <NavGroup key={group[0]}>
        {group.map((each) => (
          <NavRow key={each} icon={PARTS[each].icon} label={PARTS[each].label} meta={holds[each]} current={each === open} onClick={() => onPart(each)} />
        ))}
      </NavGroup>
    ));
    return frame({ head: { title, subtitle, status: state, menu }, side, body: <>{pages[open]}{shareDialog}</>, open });
  }
  if (part && partBack) {
    const toList = (
      <Row kind="actions">
        <Button variant="link" size="xs" onClick={() => onPart(null)}>
          캐릭터 열기
        </Button>
      </Row>
    );
    return frame({ head: { title, onBack: partBack.onBack, backLabel: partBack.label, status: state }, body: <>{toList}{pages[part]}</>, open: part });
  }
  if (part) return frame({ head: { title, onBack: () => onPart(null), backLabel: LIST, status: state }, body: pages[part], open: part });
  const list = (
    <>
      {lead}
      {groups.map((group) => (
        <NavGroup key={group[0]}>
          <List box places label={group.map((each) => PARTS[each].label).join(', ')}>
            {group.map((each) => (
              <ListItem key={each} title={PARTS[each].label} note={holds[each]} onClick={() => onPart(each)} />
            ))}
          </List>
        </NavGroup>
      ))}
    </>
  );
  return frame({ head: { title, subtitle, status: state, menu }, body: <>{list}{shareDialog}</>, open: LIST });
}
