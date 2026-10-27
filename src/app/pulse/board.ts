import { CONNECTION_TYPES } from '../../connectors/registry';
import { DIRECT_TYPE, PULSE_FLOORS, PULSE_ROLES, type PulseOrder, type PulsePlace, type PulseRanking, type PulseRole } from '../../contracts/pulse';
import { count } from '../common/typedNumber';
import type { Ranked } from '../ui';
import { DIRECT_CONNECTION, ROLE_TAGS } from '../common/words';

export const PULSE_ROLE_NAMES: Record<PulseRole, string> = { chat: ROLE_TAGS.main, aux: ROLE_TAGS.aux, image: '이미지', embedding: ROLE_TAGS.embed };

// null: a type this build does not list, which a newer client may label; its row is left out rather than named wrong.
export function providerName(type: string): string | null {
  if (type === DIRECT_TYPE) return DIRECT_CONNECTION;
  return CONNECTION_TYPES.find((each) => each.id === type)?.label ?? null;
}

// The server counts its days from 00:00 KST and its weeks from Monday, so the page tells every time in KST whatever the
// viewer's zone.
const KST = 'Asia/Seoul';
const hourFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, hour: 'numeric' });
const clockFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, month: 'long', day: 'numeric' });
export const hourText = (at: number) => hourFormat.format(at);
export const clockText = (at: number) => clockFormat.format(at);
export const weekText = (from: number) => `${dayFormat.format(from)} 주`;

export const hourDetail = (calls: Record<PulseRole, number>) =>
  PULSE_ROLES.filter((role) => role === 'chat' || calls[role] > 0)
    .map((role) => `${role === 'chat' ? '응답' : PULSE_ROLE_NAMES[role]} ${count(calls[role])}번`)
    .join(' · ');

export const percent = (share: number) => (share > 0 && share < 0.005 ? '1% 미만' : `${Math.round(share * 100)}%`);

const OTHERS = '기타';

// The one identity of a row across periods (contracts/pulse.ts): its key and type, never its model's spelling.
const rowId = (place: PulsePlace) => `${place.key}\0${place.type ?? ''}`;

// Re-rank both current/prior lists identically: exclude unknown providers and move 기타 last without a place.
// Never award the pooled row a medal or introduce rank gaps.
function placeRows<T extends PulsePlace>(order: { merged: T[]; split: T[] }, split: boolean): { row: T; provider: string | null; rank: number | null }[] {
  const shown = split
    ? order.split.flatMap((row) => {
        const provider = row.type === undefined ? null : providerName(row.type);
        return provider === null ? [] : [{ row, provider }];
      })
    : order.merged.map((row) => ({ row, provider: null }));
  const named = shown.filter(({ row }) => row.key !== '');
  return [...named.map((each, index) => ({ ...each, rank: index + 1 })), ...shown.filter(({ row }) => row.key === '').map((each) => ({ ...each, rank: null }))];
}

function moveOf(rank: number, was: number | undefined): Ranked['move'] {
  if (was === undefined) return { tone: 'new', text: 'NEW', label: '새로 올랐어요' };
  if (was > rank) return { tone: 'up', text: `▲${was - rank}`, label: `${was - rank}계단 올랐어요` };
  if (was < rank) return { tone: 'down', text: `▼${rank - was}`, label: `${rank - was}계단 내려갔어요` };
  return undefined;
}

export const REST = '순위 밖 모델';
const REST_HELP = `사용자가 ${PULSE_FLOORS.row}명 미만인 모델을 묶은 항목이에요.`;

const OTHERS_HELP = `확인되지 않는 모델은 개인 모델 이름이 드러나지 않도록 ${OTHERS}로 묶어 표시하며, ${DIRECT_CONNECTION}로 쓴 모델도 여기에 해당해요.`;

// before: null where the earlier period was not counted whole, which marks no row at all. earlier: a past week's
// ranking, whose people are that week's.
export function rankRows(ranking: PulseRanking, before: PulseOrder | null, split: boolean, earlier: boolean): Ranked[] {
  const rows = placeRows(ranking, split);
  const was = before && new Map(placeRows(before, split).flatMap(({ row, rank }) => (rank === null ? [] : [[rowId(row), rank] as const])));
  const rest = ranking.rest?.[split ? 'split' : 'merged'];
  const largest = Math.max(0, ...rows.map(({ row }) => row.share), rest?.share ?? 0);
  const ranked = rows.map(({ row, provider, rank }): Ranked => {
    const move = was && rank !== null ? moveOf(rank, was.get(rowId(row))) : undefined;
    return {
      key: rowId(row),
      rank,
      name: row.model ?? OTHERS,
      note: [provider, row.replies === undefined ? null : `응답 ${count(row.replies)}번`, `${earlier ? '' : '이번 주 '}${count(row.people)}명`].filter(Boolean).join(' · '),
      value: percent(row.share),
      share: largest ? row.share / largest : 0,
      ...(move && { move }),
      ...(rank === null && { help: OTHERS_HELP }),
    };
  });
  if (!rest?.share) return ranked;
  return [...ranked, { key: REST, rank: null, name: REST, note: rest.replies ? `응답 ${count(rest.replies)}번` : `응답 ${PULSE_FLOORS.round}번 미만`, value: percent(rest.share), share: rest.share / largest, help: REST_HELP }];
}

// The server's order, 기타 left out there; a split row whose provider this build cannot name is left out, as in the ranking.
export function belowNames(ranking: PulseRanking, split: boolean): string[] {
  if (!ranking.below) return [];
  return placeRows(ranking.below, split).map(({ row, provider }) => (provider ? `${row.model} (${provider})` : row.model!));
}
