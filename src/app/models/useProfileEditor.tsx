import { useState, type ReactNode } from 'react';
import { modelSettings } from '../../connectors/registry';
import { fit, SERVICE_TIERS, VERBOSITY, WHOLE, type Change, type ModelSettings, type PdfKeep, type Reasoning, type SettingsSchema } from '../../connectors/settings';
import { entryName, type Starred } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { profileUsers, renameProfile, setProfileSettings, withSettings, type ProfileUser } from '../../runtime/profiles';
import { choices } from '../common/reading';
import { DetailFold } from '../common/DetailFold';
import { RetriesRow } from '../common/RetriesRow';
import { typedText } from '../common/typed';
import { useAutosave } from '../common/useAutosave';
import { DISCOUNT, PDF_SEND, UNSET } from '../common/words';
import { useConnections, useSettings, useStore } from '../session';
import { ChoiceGroup, NumberInput, PhraseField, Section, SettingGroup, SettingRow, Switch } from '../ui';
import { CACHE, changeLine, followsRetries, DETAIL, LEVELS, levelName, MAIN, NUMBER, PDF_KEEP_WORDS, SERVICE_TIER_LABEL, SERVICE_TIER_WORDS, VERBOSITY_LABEL, VERBOSITY_WORDS, type Field } from '../common/settingWords';
import { count, readCount, readOptional, readTyped } from '../common/typedNumber';

const whole = (field: Field | 'budget') => field === 'budget' || field === 'context' || WHOLE.has(field);
// undefined: left empty, which unsets it. null: not a number the field takes.
const readNumber = (text: string, field: Field | 'budget') => readOptional(text, whole(field));
const BUDGET_START = 8000;
const RECENT_START = 20;
// 100 would leave nothing to pack.
const readRecent = (text: string) => {
  const share = readCount(text);
  return share !== null && share <= 99 ? share : null;
};

type Choice = 'unset' | 'off' | 'adaptive' | 'budget' | `level:${string}`;
const choiceOf = (reasoning: Reasoning | undefined): Choice => (!reasoning ? 'unset' : reasoning.kind === 'level' ? `level:${reasoning.level}` : reasoning.kind);

// schema null: this version cannot call it.
export type User = ProfileUser & { schema: SettingsSchema | null; changes: Change[] };

// The name rides in the settings' patch, so one queue orders both writes.
type Saved = ModelSettings & { name: string };
const split = ({ name, ...settings }: Partial<Saved>): { name?: string; settings: ModelSettings } => ({ name, settings });

// One mounted editor/queue per profile, shared between profile and model frames.
// Model pages explain fit/caps once and show that model's catalog defaults; profile pages cannot promise one
// connection's inherited retry count because profiles span connections.
export function useProfileEditor(stored: Stored<'profile'>, { model, retries }: { model?: Starred; retries?: number } = {}) {
  const store = useStore();
  const settings = useSettings();
  const connections = useConnections();
  const { id } = stored;

  const [drafts, setDrafts] = useState<Partial<Record<Field | 'budget' | 'recent', string>>>({});
  const { status, unsaved, change, save, flush, remove: removing } = useAutosave<Saved>(`profile:${id}`, async (patch) => {
    const { name: renamed, settings: values } = split(patch);
    if (renamed !== undefined) {
      const done = await renameProfile(store, id, renamed);
      if (!done.ok) return done;
    }
    return Object.keys(values).length ? setProfileSettings(store, id, values) : { ok: true };
  });
  const shown = withSettings(stored.value.settings, split(unsaved).settings);
  const name = unsaved.name ?? stored.value.name;
  const set = (values: ModelSettings) => void save(values);

  function type(field: Field | 'budget', draft: string, value: (number: number) => ModelSettings) {
    setDrafts((current) => ({ ...current, [field]: draft }));
    const key = field === 'budget' ? 'reasoning' : field;
    const typed = readTyped(draft, whole(field));
    if (draft.trim() === '' && field !== 'budget') change({ [key]: undefined });
    else change(typed.ok ? value(typed.value) : { [key]: undefined }, typed.ok);
  }

  const rename = (next: string) => change({ name: next.trim() });

  const users: User[] = profileUsers(connections, settings.profile, id).map((user) => {
    const schema = modelSettings(user.connection.value, user.model);
    return { ...user, schema, changes: schema ? fit(schema, shown).changes : [] };
  });
  const callable = users.filter((user): user is User & { schema: SettingsSchema } => user.schema !== null);

  function noteFor(setting: Change['setting']): string | undefined {
    if (model) return undefined;
    const left = users.filter((user) => user.changes.some((change) => change.setting === setting && change.change === 'left-out')).map((user) => entryName(user.model));
    const capped = users.flatMap((user) => user.changes.flatMap((change) => (change.setting === setting && change.change === 'capped' ? [`${entryName(user.model)} ${count(change.to)}`] : [])));
    return changeLine(left, capped);
  }

  function numberRow(field: Field): ReactNode {
    const { label, help, unit, unset } = NUMBER[field];
    const value = shown[field];
    // null: the catalog gave no number, so the field keeps naming where the value comes from.
    const known = (field === 'maxOutput' ? model?.maxOutput : field === 'context' ? model?.contextLength : null) ?? undefined;
    const draft = typedText(drafts[field], (text) => readNumber(text, field), value, (number) => (number === undefined ? '' : String(number)));
    const typed = draft.trim() === '' ? null : readTyped(draft, whole(field));
    return (
      <SettingRow
        key={field}
        label={label}
        help={help}
        sub={value === undefined && known !== undefined ? (unset ?? UNSET) : undefined}
        changed={value !== undefined}
        error={typed && !typed.ok ? typed.error : undefined}
        note={noteFor(field)}
        control={
          <NumberInput
            label={label}
            value={draft}
            unit={unit}
            placeholder={known === undefined ? (unset ?? UNSET) : count(known)}
            placeholderTone={known === undefined ? 'hint' : 'value'}
            invalid={typed?.ok === false}
            onChange={(next) => type(field, next, (number) => ({ [field]: number }))}
          />
        }
      />
    );
  }

  function reasoningRow(): ReactNode {
    const reasoning = shown.reasoning;
    const current = choiceOf(reasoning);
    const offers = (takes: (rules: SettingsSchema['reasoning']) => boolean) => callable.length === 0 || callable.some((user) => takes(user.schema.reasoning));
    const named = callable.length === 0 ? Object.keys(LEVELS) : [...new Set(callable.flatMap((user) => (user.schema.reasoning.level === false ? [] : user.schema.reasoning.levels)))];
    const known = Object.keys(LEVELS);
    const levels = [...known.filter((level) => named.includes(level)), ...named.filter((level) => !known.includes(level))];
    // One stored elsewhere with a level still names it, so picking another choice never drops it unseen.
    const adaptive = reasoning?.kind === 'adaptive' && reasoning.level !== null ? `적응형 · ${levelName(reasoning.level)}` : '적응형';
    const options: { value: Choice; label: string }[] = [
      { value: 'unset', label: UNSET },
      ...(offers((rules) => rules.off !== false) ? [{ value: 'off' as const, label: '끔' }] : []),
      ...(offers((rules) => rules.adaptive !== false) ? [{ value: 'adaptive' as const, label: adaptive }] : []),
      ...levels.map((level) => ({ value: `level:${level}` as const, label: levelName(level) })),
      ...(offers((rules) => rules.budget.accepted !== false) ? [{ value: 'budget' as const, label: '예산' }] : []),
    ];
    if (!options.some((option) => option.value === current)) options.push({ value: current, label: current === 'adaptive' ? adaptive : current.startsWith('level:') ? levelName(current.slice(6)) : current });

    const pick = (choice: Choice) => {
      setDrafts((drafted) => ({ ...drafted, budget: undefined }));
      if (choice === 'budget') return set({ reasoning: { kind: 'budget', tokens: reasoning?.kind === 'budget' ? reasoning.tokens : BUDGET_START } });
      const next: Reasoning | undefined =
        choice === 'unset' ? undefined : choice === 'off' ? { kind: 'off' } : choice === 'adaptive' ? { kind: 'adaptive', level: null } : { kind: 'level', level: choice.slice('level:'.length) };
      set({ reasoning: next });
    };
    const draft = typedText(drafts.budget, (text) => readNumber(text, 'budget') ?? null, reasoning?.kind === 'budget' ? reasoning.tokens : undefined, (tokens) => (tokens === undefined ? '' : String(tokens)));
    const typed = reasoning?.kind === 'budget' ? readTyped(draft, true) : null;
    return (
      <SettingRow
        key="reasoning"
        label="추론"
        changed={reasoning !== undefined}
        error={typed && !typed.ok ? typed.error : undefined}
        note={noteFor('reasoning')}
        control={
          <>
            <ChoiceGroup layout="fit" label="추론" options={options} value={current} onChange={pick} />
            {reasoning?.kind === 'budget' && (
              <NumberInput label="추론 예산" unit="토큰" value={draft} invalid={!typed?.ok} onChange={(next) => type('budget', next, (tokens) => ({ reasoning: { kind: 'budget', tokens } }))} />
            )}
          </>
        }
      />
    );
  }

  // Shown where a model on this 설정 can be sent it, or while a value is set, so a stored one is never hidden.
  function choiceRow<V extends string>(setting: 'verbosity' | 'serviceTier', label: string, help: string, values: readonly V[], words: Record<V, string>, value: V | undefined, pick: (value: V | undefined) => ModelSettings): ReactNode {
    if (value === undefined && callable.length > 0 && callable.every((user) => user.schema[setting] === false)) return null;
    return (
      <SettingRow
        key={setting}
        label={label}
        help={help}
        changed={value !== undefined}
        note={noteFor(setting)}
        control={
          <ChoiceGroup<V | 'unset'>
            layout="fit"
            label={label}
            options={[{ value: 'unset', label: UNSET }, ...values.map((choice) => ({ value: choice, label: words[choice] }))]}
            value={value ?? 'unset'}
            onChange={(next) => set(pick(next === 'unset' ? undefined : next))}
          />
        }
      />
    );
  }

  const cacheRow = (
    <SettingRow
      key="cache"
      label="캐시"
      help="보낸 프롬프트의 앞부분을 저장해 두고 다음 요청에서 더 싸게 읽어요. 처음 저장할 때는 요금이 조금 더 나와요"
      changed={shown.cache !== undefined}
      note={noteFor('cache')}
      control={
        <ChoiceGroup
          layout="fit"
          label="캐시"
          options={[{ value: 'off' as const, label: '끔' }, ...choices(CACHE)]}
          value={shown.cache ?? 'off'}
          onChange={(value) => set({ cache: value === 'off' ? undefined : value })}
        />
      }
    />
  );

  // Shown only where a model on this 설정 has a discount lane, or while it is set, so a stored one is never hidden.
  const discountRow = (shown.discount || callable.some((user) => user.schema.discount !== false)) && (
    <SettingRow
      key="discount"
      label={DISCOUNT}
      help="요금이 절반으로 줄어드는 대신 응답이 느려질 수 있어요. 번역 등 보조 작업은 할인되지 않아요."
      changed={shown.discount !== undefined}
      note={noteFor('discount')}
      control={<Switch label={DISCOUNT} checked={shown.discount === true} onChange={(on) => set({ discount: on ? true : undefined })} />}
    />
  );

  // Shown only where a model on this 설정 may take it, or while it is set, so a stored one is never hidden.
  function pdfRow(): ReactNode {
    const pdf = shown.pdf;
    if (!pdf && !callable.some((user) => user.schema.pdf !== false)) return null;
    const draft = typedText(drafts.recent, readRecent, pdf?.keep === 'recent' ? pdf.recent : undefined, (recent) => (recent === undefined ? '' : String(recent)));
    const recent = pdf?.keep === 'recent' ? readRecent(draft) : undefined;
    const pick = (keep: PdfKeep | 'off') => {
      setDrafts((drafted) => ({ ...drafted, recent: undefined }));
      set({ pdf: keep === 'off' ? undefined : { keep, recent: pdf?.recent ?? RECENT_START } });
    };
    const typeRecent = (next: string) => {
      setDrafts((drafted) => ({ ...drafted, recent: next }));
      const typed = readRecent(next);
      change(typed === null || !pdf ? { pdf: undefined } : { pdf: { ...pdf, recent: typed } }, typed !== null);
    };
    return (
      <SettingRow
        key="pdf"
        label={PDF_SEND}
        help={{
          text: '지난 대화를 PDF로 묶어 보내 입력 토큰을 아껴요. 대화를 문서로 인식해 응답이 조금 달라질 수 있어요. pdf-pod 플러그인에서 가져온 아이디어예요.',
          // Credit with its link, as promised to pdf-pod's author when the port was allowed.
          open: { label: 'pdf-pod 보기', onClick: () => window.open('https://arca.live/b/characterai/186333157', '_blank', 'noopener') },
        }}
        changed={pdf !== undefined}
        error={recent === null ? '1부터 99 사이의 값을 입력해 주세요.' : undefined}
        note={noteFor('pdf')}
        control={
          <>
            <ChoiceGroup<PdfKeep | 'off'>
              layout="fit"
              label={PDF_SEND}
              options={[{ value: 'off', label: '끔' }, ...choices(PDF_KEEP_WORDS)]}
              value={pdf?.keep ?? 'off'}
              onChange={pick}
            />
            {pdf?.keep === 'recent' && <NumberInput label="원문으로 보낼 최근 대화" unit="%" value={draft} invalid={recent === null} onChange={typeRecent} />}
          </>
        }
      />
    );
  }

  const stopRow = (
    <SettingRow
      key="stop"
      label="멈춤 문구"
      help="이 문구가 나오면 그 자리에서 응답 생성을 멈춰요"
      changed={shown.stop !== undefined}
      note={noteFor('stop')}
      control={<PhraseField label="멈춤 문구" phrases={shown.stop ?? []} onChange={(next) => set({ stop: next.length ? next : undefined })} />}
    />
  );

  const systemRow = (
    <SettingRow
      key="system"
      label="시스템 메시지 보내는 방식"
      help="시스템 메시지를 지원하지 않는 모델에는 사용자 메시지로 바꿔서 보내요"
      changed={shown.systemAsUser !== undefined}
      control={
        <ChoiceGroup
          layout="fit"
          label="시스템 메시지 보내는 방식"
          options={[
            { value: 'as-is', label: '시스템 메시지로' },
            { value: 'user', label: '사용자 메시지로' },
          ]}
          value={shown.systemAsUser ? 'user' : 'as-is'}
          onChange={(value) => set({ systemAsUser: value === 'user' ? true : undefined })}
        />
      }
    />
  );

  const streamingRow = (
    <SettingRow
      key="streaming"
      label="스트리밍"
      help="프록시 서버에서 응답을 중간에 끊어 버린다면 이 설정을 꺼 주세요"
      changed={shown.streaming !== undefined}
      control={<Switch label="스트리밍" checked={shown.streaming !== false} onChange={(on) => set({ streaming: on ? undefined : false })} />}
    />
  );

  const detailSet =
    DETAIL.filter((field) => shown[field] !== undefined).length + [shown.stop, shown.verbosity, shown.serviceTier, shown.systemAsUser, shown.streaming === false, shown.retries !== undefined].filter(Boolean).length;
  const rows = (
    <>
      <Section title="자주 쓰는 설정">
        <SettingGroup label="자주 쓰는 설정">
          {MAIN.map(numberRow)}
          {reasoningRow()}
          {cacheRow}
          {discountRow}
          {pdfRow()}
        </SettingGroup>
      </Section>
      <DetailFold set={detailSet}>
        {DETAIL.map(numberRow)}
        {stopRow}
        {choiceRow('verbosity', VERBOSITY_LABEL, '간단히를 선택하면 같은 내용을 더 짧게 요약해서 써요', VERBOSITY, VERBOSITY_WORDS, shown.verbosity, (verbosity) => ({ verbosity }))}
        {choiceRow('serviceTier', SERVICE_TIER_LABEL, '자동으로 두면 Anthropic 계정에 우선 처리 용량이 남아 있을 때 그 용량부터 먼저 써요', SERVICE_TIERS, SERVICE_TIER_WORDS, shown.serviceTier, (serviceTier) => ({ serviceTier }))}
        {systemRow}
        {streamingRow}
        <RetriesRow value={shown.retries} follows={retries === undefined ? '연결 설정' : followsRetries('connection', retries)} onChange={(value) => change({ retries: value })} />
      </DetailFold>
    </>
  );
  // Every value unset in one save; answers what was set, for an undo, or null when the save failed.
  async function clear(): Promise<ModelSettings | null> {
    const previous = shown;
    const cleared: ModelSettings = {};
    for (const key of Object.keys(shown) as (keyof ModelSettings)[]) cleared[key] = undefined;
    setDrafts({});
    return (await save(cleared)) ? previous : null;
  }
  return { status, name, rename, flush, clear, removing, shown, users, rows };
}
