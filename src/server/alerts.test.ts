import { afterAll, beforeAll, expect, it } from 'vitest';
import { alerts, slowLoop } from './alerts';
import { testApp } from './testing';

const MINUTE_MS = 60 * 1000;

const sent: string[] = [];
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(async (_url, init) => {
    sent.push((JSON.parse(init.body as string) as { text: string }).text);
    return new Response(null, { status: 204 });
  });
});
afterAll(() => t.dispose());

it('raises server-slow on the third delayed window within an hour, once a day', async () => {
  const slow = slowLoop();
  const operator = alerts('https://alerts.test/hook');
  const start = Date.UTC(2026, 9, 13, 1);
  const delayed = async (at: number) => { if (slow(at)) await operator.send(t.env, 'server-slow', at); };
  await delayed(start);
  await delayed(start + 30 * MINUTE_MS);
  await delayed(start + 61 * MINUTE_MS);
  expect(sent).toEqual([]);
  await delayed(start + 62 * MINUTE_MS);
  await delayed(start + 63 * MINUTE_MS);
  expect(sent).toEqual(['[Hazelle] 서버 응답 지연: 1시간 안에 이벤트 루프가 여러 번 0.25초 넘게 밀림']);
});
