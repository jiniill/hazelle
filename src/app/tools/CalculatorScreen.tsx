import { useMemo, useState } from 'react';
import { MODELS_DEV_LISTS, type PriceTable, type Rates } from '../../connectors/models-dev';
import { inUnit, priceCost } from '../../connectors/pricing';
import { CONNECTION_TYPES, costUnit } from '../../connectors/registry';
import type { Cost } from '../../connectors/types';
import { readPriceTable } from '../../runtime/prices';
import { money } from '../common/money';
import { cost } from '../common/receipt';
import { count, readWhole } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { useSearch } from '../common/useSearch';
import { ACTS } from '../common/acts';
import { TOOL_PAGES } from '../common/words';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Disclosure, Empty, Facts, List, ListItem, NavBar, NumberInput, Panel, Screen, SettingGroup, SettingRow } from '../ui';

// Prices differ by provider, so one model is a row per list, never merged by name as 헤이젤 나우 does.
type Row = { key: string; name: string; provider: string; model: string; price: Rates | null; unit: Cost['unit'] };

const TYPES = new Map(CONNECTION_TYPES.flatMap((type) => (MODELS_DEV_LISTS[type.id] ? [[MODELS_DEV_LISTS[type.id]!.list, type] as const] : [])));

const rowsOf = (table: PriceTable): Row[] =>
  table.models
    .flatMap(({ list, model, name, price }) => {
      const type = TYPES.get(list);
      return type ? [{ key: `${list} ${model}`, name: name ?? model, provider: type.label, model, price, unit: costUnit(type) }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.provider.localeCompare(b.provider, 'ko'));

const perMillion = (rate: number, unit: Cost['unit']) => money(unit, inUnit(rate, unit));

type Count = 'input' | 'output' | 'cacheRead' | 'cacheWrite';
const BLANK: Record<Count, string> = { input: '', output: '', cacheRead: '', cacheWrite: '' };
const LABELS: Record<Count, string> = { input: '입력', output: '출력', cacheRead: '캐시 읽기', cacheWrite: '캐시 쓰기' };
const HELPS: Record<Count, string> = {
  input: '캐시에서 읽거나 캐시에 쓴 토큰까지 모두 더한 입력이에요.',
  output: '추론 토큰도 출력으로 계산해요.',
  cacheRead: '입력 중 캐시에서 읽은 토큰이에요.',
  cacheWrite: '입력 중 캐시에 쓴 토큰이에요.',
};

// An empty field counts none.
const tokensOf = (text: string) => (text.trim() === '' ? 0 : readWhole(text));

export function CalculatorScreen({ back }: { back: Back | null }) {
  const table = useLoaded(readPriceTable);
  const rows = useMemo(() => (table.data ? rowsOf(table.data) : []), [table.data]);
  const [picked, setPicked] = useState<Row | null>(null);
  const [texts, setTexts] = useState(BLANK);
  const query = useState('');
  const search = useSearch(rows, '모델 검색', (row) => [row.name, row.model, row.provider], { onEnter: pick, query });

  function pick(row: Row) {
    setPicked(row);
    query[1]('');
  }

  const counts = { input: tokensOf(texts.input), output: tokensOf(texts.output), cacheRead: tokensOf(texts.cacheRead), cacheWrite: tokensOf(texts.cacheWrite) };
  const field = (key: Count) => (
    <SettingRow
      key={key}
      label={LABELS[key]}
      help={HELPS[key]}
      error={counts[key] === null ? '0 이상의 정수를 입력해 주세요.' : undefined}
      control={<NumberInput label={LABELS[key]} value={texts[key]} unit="토큰" placeholder="0" invalid={counts[key] === null} onChange={(text) => setTexts({ ...texts, [key]: text })} />}
    />
  );

  const row = (shown: Row) => (
    <ListItem
      title={shown.name}
      description={`${shown.provider} · ${shown.model}`}
      note={shown.price ? `입력 ${perMillion(shown.price.input, shown.unit)} · 출력 ${perMillion(shown.price.output, shown.unit)}` : '가격 없음'}
      selected={shown.key === picked?.key}
      onClick={() => pick(shown)}
    />
  );

  return (
    <Screen width="form" top={<NavBar title={TOOL_PAGES.calculator} {...backBar(back)} />}>
      <Panel title="모델" help="models.dev의 가격표로 계산해요.">
        {table.loading}
        {table.failure}
        {table.data?.fetchedAt === null && (
          <Empty variant="section" action={<Button variant="secondary" size="sm" onClick={table.reload}>{ACTS.retry.label}</Button>}>
            가격표를 아직 받지 못했어요. 잠시 뒤 다시 시도해 주세요.
          </Empty>
        )}
        {search.field}
        {search.shown(
          picked ? <List label="고른 모델" box>{row(picked)}</List> : rows.length > 0 && <Empty variant="section">모델을 검색해 선택해요.</Empty>,
          (found) => <List label="검색 결과" keys={found.map(({ key }) => key)} box>{(index) => row(found[index]!)}</List>,
        )}
      </Panel>
      <Panel title="토큰">
        <SettingGroup label="토큰">{field('input')}{field('output')}</SettingGroup>
        <Disclosure label="캐시">
          <SettingGroup label="캐시">{field('cacheRead')}{field('cacheWrite')}</SettingGroup>
        </Disclosure>
      </Panel>
      {picked && <Result row={picked} counts={counts} />}
    </Screen>
  );
}

function Result({ row, counts }: { row: Row; counts: Record<Count, number | null> }) {
  const { price, unit } = row;
  if (!price) return <Facts variant="figures" items={[{ label: '예상 비용', value: cost(null), notes: ['models.dev에 이 모델의 가격이 없어요.'], tone: 'muted' }]} />;
  const { input, output, cacheRead, cacheWrite } = counts;
  const typed = input !== null && output !== null && cacheRead !== null && cacheWrite !== null;
  const worked = typed ? priceCost(price, { inputTokens: input, outputTokens: output, cachedInputTokens: cacheRead, cacheWriteInputTokens: cacheWrite, reasoningTokens: null }, unit) : null;
  const estimate = !typed
    ? { label: '예상 비용', value: '-', tone: 'muted' as const }
    : worked
      ? { label: '예상 비용', value: cost(worked) }
      : { label: '예상 비용', value: '-', notes: ['캐시 토큰이 입력보다 많아요.'], tone: 'warn' as const };
  // A cache rate the table leaves out is billed as plain input (priceCost).
  const rate = (label: string, pick: (rates: Omit<Rates, 'tiers'>) => number | null) => {
    const base = pick(price);
    const above = price.tiers.flatMap((tier) => {
      const value = pick(tier);
      return value === null ? [] : [`입력 ${count(tier.above)}토큰 넘으면 ${perMillion(value, unit)}`];
    });
    return base === null ? { label, value: '가격 정보 없음', notes: ['입력 가격 적용', ...above], tone: 'muted' as const } : { label, value: perMillion(base, unit), notes: above };
  };
  return (
    <>
      <Facts variant="figures" items={[estimate]} />
      <Panel title="가격" note="100만 토큰당">
        <Facts
          variant="tiles"
          items={[rate(LABELS.input, (rates) => rates.input), rate(LABELS.output, (rates) => rates.output), rate(LABELS.cacheRead, (rates) => rates.cacheRead), rate(LABELS.cacheWrite, (rates) => rates.cacheWrite)]}
        />
      </Panel>
    </>
  );
}
