import type { CacheBreak } from './cache';
import type { CacheNoted, CauseKept, UsageCall } from './usage';

// of: what the calls before these left in the cache. broken: the part of it their own requests could not read.
// missed: the part the provider did not read though the request could.
export type CacheShare = { calls: number; of: number; broken: number; missed: number };
export const cacheRead = ({ of, broken, missed }: CacheShare) => of - broken - missed;

type Placed = { key: string | null; share: CacheShare };
type Provider = Pick<UsageCall['call'], 'connection' | 'model' | 'modelName' | 'source'> & { share: CacheShare };

// Every list largest first. leaks: by the break and where it began, with the chats it happened in. causes: by what the diagnoses named, a reply
// counted under each cause it has. first: the earliest reply counted.
export type CacheReport = {
  total: CacheShare;
  leaks: { cause: CacheBreak; lost: number; times: number; chats: { key: string | null; lost: number; times: number }[] }[];
  providers: Provider[];
  prompts: Placed[];
  characters: Placed[];
  chats: Placed[];
  causes: (CauseKept & { lost: number; times: number })[];
  first: number | null;
};

const none = (): CacheShare => ({ calls: 0, of: 0, broken: 0, missed: 0 });

// missed: the tokens of a reply's forecast read the provider did not read, 0 where it read them or told nothing.
export function cacheReport(noted: readonly CacheNoted[], since: number, missed: (one: CacheNoted) => number): CacheReport {
  const total = none();
  const leaks = new Map<string, Omit<CacheReport['leaks'][number], 'chats'> & { chats: Map<string | null, { lost: number; times: number }> }>();
  const providers = new Map<string, Provider>();
  const places = { prompts: new Map<string | null, CacheShare>(), characters: new Map<string | null, CacheShare>(), chats: new Map<string | null, CacheShare>() };
  const causes = new Map<string, CacheReport['causes'][number]>();
  let first: number | null = null;
  const held = <K>(map: Map<K, CacheShare>, key: K) => map.get(key) ?? map.set(key, none()).get(key)!;
  for (const one of noted) {
    const { forecast, call } = one;
    if (one.at < since || forecast.of <= 0) continue;
    first = Math.min(first ?? one.at, one.at);
    const broken = forecast.of - forecast.read;
    const lost = missed(one);
    const provider = providers.get(`${call.connection}:${call.model}`) ?? providers.set(`${call.connection}:${call.model}`, { connection: call.connection, model: call.model, modelName: call.modelName, source: call.source, share: none() }).get(`${call.connection}:${call.model}`)!;
    for (const share of [total, provider.share, held(places.prompts, one.prompt), held(places.characters, one.character), held(places.chats, one.chat)]) {
      share.calls++;
      share.of += forecast.of;
      share.broken += broken;
      share.missed += lost;
    }
    if (!forecast.broken || broken <= 0) continue;
    const key = JSON.stringify([forecast.broken.kind, 'from' in forecast.broken ? [forecast.broken.from, forecast.broken.role] : null]);
    const leak = leaks.get(key) ?? leaks.set(key, { cause: forecast.broken, lost: 0, times: 0, chats: new Map() }).get(key)!;
    const where = leak.chats.get(one.chat) ?? leak.chats.set(one.chat, { lost: 0, times: 0 }).get(one.chat)!;
    for (const count of [leak, where]) {
      count.lost += broken;
      count.times++;
    }
    for (const cause of one.causes ?? []) {
      const named = causes.get(`${cause.kind}:${cause.name}`) ?? causes.set(`${cause.kind}:${cause.name}`, { ...cause, lost: 0, times: 0 }).get(`${cause.kind}:${cause.name}`)!;
      named.lost += broken;
      named.times++;
    }
  }
  const placed = (map: Map<string | null, CacheShare>) => [...map].map(([key, share]) => ({ key, share })).sort((a, b) => b.share.broken - a.share.broken);
  return {
    total,
    leaks: [...leaks.values()].map((leak) => ({ ...leak, chats: [...leak.chats].map(([key, count]) => ({ key, ...count })).sort((a, b) => b.lost - a.lost) })).sort((a, b) => b.lost - a.lost),
    providers: [...providers.values()].sort((a, b) => b.share.missed - a.share.missed),
    prompts: placed(places.prompts),
    characters: placed(places.characters),
    chats: placed(places.chats),
    causes: [...causes.values()].sort((a, b) => b.lost - a.lost),
    first,
  };
}
