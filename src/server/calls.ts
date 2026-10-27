import type { Context } from 'hono';
import { fail, RETRY_SECONDS, type AppEnv } from './http';
import { forward, refuse } from './relay';

export type AdmittedCall = { body: unknown; bytes: number; leave: () => void };

// Before reading a provider-call body, reserve daily relay traffic, an account live-call slot and upload bytes.
// bytes is the Content-Length required by worker.ts.
export async function admitCall(c: Context<AppEnv>): Promise<AdmittedCall | Response> {
  const allowance = c.env.limits.relay.account(c.get('account').id);
  if (!allowance.take(0)) return unread(c, refuse(429, 'relay-traffic-limit'));
  const leave = allowance.enter();
  if (!leave) return unread(c, fail(c, 429, 'too-many-live-calls'));
  const bytes = Number(c.req.header('content-length'));
  const { uploads } = c.env.limits;
  if (!(await uploads.take(bytes))) {
    leave();
    return unread(c, fail(c, 503, 'busy', { retryAfter: RETRY_SECONDS }));
  }
  try {
    return { body: await c.req.json().catch(() => null), bytes, leave };
  } finally {
    uploads.give(bytes);
  }
}

// A refusal answered while the body is still being sent reaches the browser as a dropped connection (the server stops
// draining it after half a second), so the body is read and dropped first, never held.
async function unread(c: Context, answer: Response): Promise<Response> {
  await c.req.raw.body?.pipeTo(new WritableStream()).catch(() => {});
  return answer;
}

export async function relayCall(c: Context<AppEnv>): Promise<Response> {
  const call = await admitCall(c);
  if (call instanceof Response) return call;
  const signal = c.req.raw.signal;
  let answer: Response;
  try {
    answer = await forward(c.env.outbound, call.body, call.bytes, signal, c.env.limits.relay.account(c.get('account').id));
  } catch (error) {
    call.leave();
    throw error;
  }
  const label = c.get('label');
  // A relay's own refusal is never 2xx (relay.ts).
  if (label?.kind === 'call' && answer.ok) c.executionCtx.waitUntil(c.env.pulse.call(c.get('account').id, label));
  return holding(answer, call.leave, signal);
}

// A relayed call is live until its answer is read to the end, fails or is cancelled, or its client leaves: a client
// gone before the answer existed never reads or cancels its body.
function holding(answer: Response, leave: () => void, signal: AbortSignal): Response {
  signal.addEventListener('abort', leave, { once: true });
  if (signal.aborted) leave();
  const reader = answer.body?.getReader();
  if (!reader) {
    leave();
    return answer;
  }
  const body = new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        try {
          const { done, value } = await reader.read();
          if (!done) return controller.enqueue(value);
          leave();
          controller.close();
        } catch (error) {
          leave();
          controller.error(error);
        }
      },
      cancel: async (reason) => {
        leave();
        await reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status: answer.status, headers: answer.headers });
}
