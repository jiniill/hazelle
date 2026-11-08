import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { RETRY_MOST, type Retry, type StreamStart } from '../contracts/streams';
import { admitCall } from './calls';
import { fail, ID, isRecord, type AppEnv } from './http';
import { botCalls, canCall, requireSession } from './session';

const whole = (value: unknown, least: number, most: number) => Number.isInteger(value) && (value as number) >= least && (value as number) <= most;
const isRetry = (value: unknown): value is Retry => {
  if (!isRecord(value)) return false;
  const { times, statuses } = value;
  return whole(times, 1, RETRY_MOST) && Array.isArray(statuses) && statuses.length <= 20 && statuses.every((status) => whole(status, 100, 599));
};

const checkId = createMiddleware<AppEnv>(async (c, next) => (ID.test(c.req.param('id') ?? '') ? next() : fail(c, 400, 'bad-id')));
// A stream per account and call: the account's id is in the name so one account never reads another's reply.
const name = (c: Context<AppEnv>) => `${c.get('account').id}:${c.req.param('id')}`;

export const streams = new Hono<AppEnv>()
  .use(requireSession)
  .use('/:id', checkId)
  .use('/:id/*', checkId)
  .post('/:id', canCall, async (c) => {
    const call = await admitCall(c);
    if (call instanceof Response) return call;
    const body: { [K in keyof StreamStart]?: unknown } | null = isRecord(call.body) ? call.body : null;
    const retry = body?.retry;
    if (!body || (body.bot !== undefined && (typeof body.bot !== 'string' || !ID.test(body.bot))) || (retry !== undefined && !isRetry(retry))) {
      call.leave();
      return fail(c, 400, 'bad-body');
    }
    if (body.bot !== undefined && !botCalls(c, body.bot)) {
      call.leave();
      return fail(c, 429, 'too-many-bot-calls');
    }
    const label = c.get('label');
    const account = c.get('account').id;
    const { env, executionCtx } = c;
    const counted = label?.kind === 'call' ? () => executionCtx.waitUntil(env.pulse.call(account, label)) : undefined;
    return env.streams.start(name(c), { id: c.req.param('id')!, key: body.key, request: body.request, bytes: call.bytes, ...(retry !== undefined && { retry }) }, c.req.raw.signal, call.leave, counted);
  })
  .get('/:id', (c) => c.env.streams.read(name(c), Number(c.req.query('from') ?? '0') || 0, c.req.raw.signal))
  .post('/:id/stop', (c) => {
    c.env.streams.stop(name(c));
    return c.body(null, 204);
  })
  .delete('/:id', async (c) => {
    await c.env.streams.drop(name(c));
    return c.body(null, 204);
  });
