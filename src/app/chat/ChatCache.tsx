import { useEffect, useState } from 'react';
import { shortStreak } from '../../engine/cache-history';
import type { CacheBreak, CacheForecast, CacheRecurrence } from '../../model/cache';
import type { Route } from '../../runtime/assignment';
import { modelProfile } from '../../runtime/profiles';
import { tokens } from '../common/receipt';
import { MODEL_SETTINGS } from '../common/words';
import { useStore } from '../session';
import { SendNote } from '../ui';
import { breakCauses, SHORT } from './CacheDiagnosis';
import { partName } from './ChatSent';
import type { CacheNotes } from './useSendNotes';

const TITLE = '캐시 남은 시간';
const PREFIX_TITLE = '캐시';
export const BROKEN = '캐시 깨짐';

// profile: the 모델 설정 the send goes out with, which 'off' names; null for an earlier request, whose 모델 설정 is not kept.
export function why(broken: CacheBreak, profile: string | null): string {
  switch (broken.kind) {
    case 'model':
      return '이전 응답 때와 모델이나 연결이 달라요.';
    case 'account':
      return '이전과 다른 계정으로 보내서 캐시를 이어 쓸 수 없어요.';
    case 'reasoning':
      return '이전과 추론 설정이 달라요.';
    case 'off':
      return profile === null ? '이 모델 설정에서는 캐시가 꺼져 있어요.' : `'${profile}' ${MODEL_SETTINGS}에서는 캐시가 꺼져 있어요.`;
    case 'expired':
      return '캐시 유지 시간이 지났어요.';
    case 'far':
      return '한 번에 늘어난 메시지가 너무 많아서 이전 캐시를 이어 쓸 수 없어요.';
    case 'moved':
      return `'${partName(broken.from, broken.role)}'의 위치가 이전과 달라졌어요.`;
    case 'changed':
      return broken.from.kind === 'block' && broken.from.slot === 'chat' ? '이전 대화 메시지가 수정됐어요.' : `'${partName(broken.from, broken.role)}' 내용이 이전과 달라졌어요.`;
    case 'removed':
      return broken.from.kind === 'block' && broken.from.slot === 'chat' ? '이전 대화 메시지가 빠졌어요.' : `'${partName(broken.from, broken.role)}' 부분이 이전보다 빠졌어요.`;
    case 'added':
      return `'${partName(broken.from, broken.role)}' 부분이 중간에 새로 들어갔어요.`;
  }
}

export function profileName(store: Parameters<typeof modelProfile>[0], route: Route): string | null {
  const choice = modelProfile(store, route.model);
  return choice.kind === 'profile' ? choice.profile.value.name : null;
}

const reads = ({ read, of }: CacheForecast) => (read > 0 ? `캐시된 ${tokens(of)} 토큰 중 약 ${tokens(read)} 토큰만 읽어요.` : '캐시를 쓰지 못하고 처음부터 다시 읽어요.');

const clock = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// The ticking lives here, so only this note draws each second.
export function useNow(until: number | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      if (at >= until) window.clearInterval(timer);
    };
    const timer = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(timer);
  }, [until]);
  return now;
}

// What the next send is warned of, beside the send button and in 다음 전송 예상 alike: a forecast break first, else
// a run of provider shortfalls on its connection.
export function nextWarning(next: NonNullable<CacheNotes['next']>, recurrence: CacheRecurrence, profile: string | null): { words: string; why: string } | undefined {
  const { against } = next.forecast;
  if (against?.broken) return { words: BROKEN, why: [why(against.broken, profile), breakCauses(next.diagnosis, against.broken), reads(against)].filter(Boolean).join(' ') };
  const streak = shortStreak(recurrence, next.route.connection.id);
  return streak === null ? undefined : { words: SHORT, why: `이 연결은 최근 ${streak}번 연속으로 캐시를 예상보다 적게 읽었어요.` };
}

export function ChatCache({ cache, onOpen }: { cache: CacheNotes; onOpen: () => void }) {
  const store = useStore();
  const now = useNow(cache.until);
  const { next } = cache;
  const warning = next ? nextWarning(next, cache.recurrence, profileName(store, next.route)) : undefined;
  // A provider caching on its own tells no time to count down, so only a warning shows.
  if (next?.forecast.prefix) return warning ? <SendNote label={PREFIX_TITLE} title={PREFIX_TITLE} warning={warning} onClick={onOpen} /> : null;
  if (cache.until === null || now >= cache.until) return null;
  return <SendNote label={clock(cache.until - now)} title={TITLE} warning={warning} onClick={onOpen} />;
}
