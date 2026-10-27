import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { PULSE_HEADER } from '../contracts/http';
import { readPulseHeader } from '../contracts/pulse';
import { accounts } from './accounts';
import { admin, notices } from './admin';
import { board } from './board';
import { relayCall } from './calls';
import { files } from './files';
import { MAX_FILE_BYTES } from '../contracts/files';
import { BATCH_LIMITS } from '../contracts/objects';
import { fail, type Account, type AppEnv } from './http';
import { objects } from './objects';
import { modelsDev } from './models-dev';
import { pulse } from './pulse';
import { PUBLISH_BYTES, shares } from './shares';
import { canCall, relayBot, requireSession } from './session';
import { streams } from './streams';
import { vaults } from './vaults';
import { guestVisits } from './visits';

const app = new Hono<AppEnv>().basePath('/api');

// A request this slow is the account store waking (storeMs, set by the objects routes) or the service database answering
// the session row; a provider's own answer time and a picture's upload time are not news.
const SLOW_MS = 5_000;
const OWN_TIME = [/^\/api\/(relay|streams)(\/|$)/, /^\/api\/files\/[^/]+$/];

app.use(async (c, next) => {
  const started = Date.now();
  await next();
  const ms = Date.now() - started;
  if (ms > SLOW_MS && !OWN_TIME.some((path) => path.test(c.req.path))) {
    console.warn('slow request', { method: c.req.method, path: c.req.path, status: c.res.status, ms, storeMs: c.get('storeMs') ?? null });
  }
});

// 헤이젤 나우 counts only labelled requests. One a signed-in account sent marks it active this week whatever the route
// answered, since the page's one seen mark may ride a pick-up that finds its stream gone; a call counts where its
// provider answered (calls.ts, streams.ts). The account is the one requireSession or the session read (accounts.ts) set.
app.use(async (c, next) => {
  const label = readPulseHeader(c.req.header(PULSE_HEADER));
  if (!label) return next();
  c.set('label', label);
  await next();
  const account: Account | undefined = c.get('account');
  if (account) c.executionCtx.waitUntil(c.env.pulse.seen(account.id));
});

// Hono's own handler would answer a route's exception with plain text, which the browser cannot tell from a page the
// proxy wrote while the app was down (runtime/api): the JSON shape says it was the app, and the log says what broke.
app.onError((error, c) => {
  console.error('request failed', { method: c.req.method, path: c.req.path, error: String(error.stack ?? error) });
  return fail(c, 500, 'server-error');
});

// Another site cannot send either content type here without a CORS preflight, which this API never
// answers. That makes this a second CSRF guard beside SameSite=Strict.
const BODY_TYPES = ['application/json', 'application/octet-stream'];

app.use(async (c, next) => {
  const type = c.req.header('content-type');
  if (c.req.method !== 'GET' && !BODY_TYPES.some((allowed) => type?.startsWith(allowed))) {
    return fail(c, 415, 'bad-content-type');
  }
  await next();
});

// Every body is bounded here, before a route reads it, signed in or not. A route that takes more than BODY_BYTES is
// listed. A provider call carries a whole prompt.
const BODY_BYTES = 100_000;
const CALL_BYTES = 32 * 1024 * 1024;
const CALLS = /^\/api\/(relay|streams\/[^/]+)$/;
const LARGER: [method: string, path: RegExp, bytes: number][] = [
  ['POST', /^\/api\/objects\/batch$/, BATCH_LIMITS.bytes],
  ['PUT', /^\/api\/files\/[^/]+$/, MAX_FILE_BYTES],
  ['POST', CALLS, CALL_BYTES],
  ['POST', /^\/api\/shares(\/[^/]+\/versions)?$/, PUBLISH_BYTES],
];

// bodyLimit trusts Content-Length and passes the stream through, but buffers a chunked body whole before any route
// runs, so an unauthenticated chunked request could hold a route's whole cap in memory per connection. The browser never
// sends a chunked request body.
app.use(async (c, next) => {
  if (c.req.header('transfer-encoding')?.toLowerCase().includes('chunked')) return fail(c, 411, 'length-required');
  // A provider call is admitted by the size it states before its body is read (calls.ts).
  if (c.req.method === 'POST' && CALLS.test(c.req.path) && c.req.header('content-length') === undefined) return fail(c, 411, 'length-required');
  const maxSize = LARGER.find(([method, path]) => method === c.req.method && path.test(c.req.path))?.[2] ?? BODY_BYTES;
  return bodyLimit({ maxSize, onError: () => fail(c, 413, 'too-large') })(c, next);
});

app.route('/', accounts);
app.route('/vault', vaults);
app.route('/objects', objects);
app.route('/files', files);
app.route('/shares', shares);
app.route('/notices', notices);
app.route('/admin', admin);
app.route('/board', board);
app.route('/models-dev', modelsDev);
app.route('/pulse', pulse);
app.route('/visits', guestVisits);
app.post('/relay', requireSession, canCall, relayBot, relayCall);
app.route('/streams', streams);
app.notFound((c) => fail(c, 404, 'not-found'));

export default app;
