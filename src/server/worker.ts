import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { PULSE_HEADER } from '../contracts/http';
import { readPulseHeader } from '../contracts/pulse';
import { accounts } from './accounts';
import { admin, notices } from './admin';
import { board } from './board';
import { relayCall } from './calls';
import { files } from './files';
import { MAX_PICTURE_BYTES } from '../contracts/board';
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
import { diagnoses } from './diagnoses';
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

// Labelled requests mark a session-read account active even on failures: owed seen may ride a missing stream.
// Count calls only on provider answers (calls/streams); never infer guest identity.
app.use(async (c, next) => {
  const label = readPulseHeader(c.req.header(PULSE_HEADER));
  if (!label) return next();
  c.set('label', label);
  await next();
  const account: Account | undefined = c.get('account');
  if (account) c.executionCtx.waitUntil(c.env.pulse.seen(account.id));
});

// Return app-shaped JSON for exceptions so clients distinguish app failures from proxy HTML/plain-text outages.
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
  ['POST', /^\/api\/board\/posts\/[^/]+\/pictures$/, MAX_PICTURE_BYTES],
];

// Reject chunked bodies before routing: Hono would otherwise buffer the entire route cap per unauthenticated connection.
// Browser uploads always carry Content-Length.
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
app.route('/diagnoses', diagnoses);
app.post('/relay', requireSession, canCall, relayBot, relayCall);
app.route('/streams', streams);
app.notFound((c) => fail(c, 404, 'not-found'));

export default app;
