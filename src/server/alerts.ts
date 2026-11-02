import { HOUR_MS, type Services } from './http';
import { dayStart } from './backup/snapshots';

// The operator's webhook (HAZELLE_ALERT_WEBHOOK): every alert goes out here, each condition at most once a UTC day.

const TEXTS = {
  'backup-stale': '백업이 36시간 넘게 없음',
  'disk-full': '디스크 80% 초과',
  'job-failed': '오늘 백업 작업 실패',
  'server-slow': '서버 응답 지연: 1시간 안에 이벤트 루프가 여러 번 0.25초 넘게 밀림',
};
type AlertCondition = keyof typeof TEXTS;

export type Alerts = {
  // A send that fails is not recorded, so a later call tries it again. One already on its way is not sent again.
  send(env: Services, condition: AlertCondition, now: number): Promise<void>;
};

// webhook: a Discord- or Slack-compatible URL, or null for none.
export function alerts(webhook: string | null): Alerts {
  const sending = new Map<AlertCondition, Promise<void>>();
  const post = async (env: Services, condition: AlertCondition, day: number) => {
    if ((await env.db.prepare('SELECT 1 FROM alerts_sent WHERE condition = ? AND day = ?').bind(condition, day).first()) !== null) return;
    const text = `[Hazelle] ${TEXTS[condition]}`;
    const sent = await env
      .outbound(new URL(webhook!), {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ content: text, text }),
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
      .then((response) => response.ok, () => false);
    if (sent) await env.db.prepare('INSERT INTO alerts_sent (condition, day) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(condition, day).run();
  };
  return {
    send: (env, condition, now) => {
      if (webhook === null) return Promise.resolve();
      const open = sending.get(condition);
      if (open) return open;
      const done = post(env, condition, dayStart(now)).finally(() => sending.delete(condition));
      sending.set(condition, done);
      return done;
    },
  };
}

// A lone delayed window is a blip (a backup's fsync, a burst); this many within an hour is the loop falling behind, as
// 100 simultaneous replies made it (docs/research/load-test-2026-10-12.md).
const SLOW_WINDOWS = 3;

// Told each delayed window; true while SLOW_WINDOWS of them fall within the last hour.
export function slowLoop(): (now: number) => boolean {
  let delayed: number[] = [];
  return (now) => {
    delayed = [...delayed.filter((at) => now - at < HOUR_MS), now];
    return delayed.length >= SLOW_WINDOWS;
  };
}
