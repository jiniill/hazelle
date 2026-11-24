import { inputUsage } from './chat-completions';
import { decisionOf } from './decide';
import { streamError } from './errors';
import type { BatchAnswer, Batches, ConnectionType, DecideQuestion, Decides, Decision } from './types';
import { count, jsonObject, list } from './values';
import { isRecord } from '../record';

// Inline batch operation; match state suffixes because guide/reference use JOB_STATE_/BATCH_STATE_
// (ai.google.dev/api/batch-api, 2026-10-12).
const batches: Batches = {
  submit: (endpoint, model, request, key) => ({
    url: `${endpoint.baseUrl}/models/${model.id}:batchGenerateContent`,
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ batch: { display_name: key, input_config: { requests: { requests: [{ request: JSON.parse(request.body!), metadata: { key } }] } } } }),
  }),
  submitted: (payload) => (isRecord(payload) && typeof payload.name === 'string' && payload.name.startsWith('batches/') ? payload.name : null),
  check: (endpoint, batch) => ({ url: `${endpoint.baseUrl}/${batch}`, method: 'GET', headers: {}, body: null }),
  ended: (payload) => (isRecord(payload) && typeof payload.name === 'string' ? payload.done === true : null),
  results: (endpoint, batch) => ({ url: `${endpoint.baseUrl}/${batch}`, method: 'GET', headers: {}, body: null }),
  answer(body) {
    const payload = jsonObject(body);
    return payload?.done === true ? answerOf(payload) : null;
  },
  cancel: (endpoint, batch) => ({ url: `${endpoint.baseUrl}/${batch}:cancel`, method: 'POST', headers: {}, body: null }),
};

// A batch of one request has one inline answer, whatever its key.
function answerOf(operation: Record<string, unknown>): BatchAnswer | null {
  const response = isRecord(operation.response) ? operation.response : {};
  const inlined = isRecord(response.inlinedResponses) ? response.inlinedResponses : {};
  const [first] = list(inlined.inlinedResponses);
  if (isRecord(first) && first.response !== undefined) return { kind: 'reply', payload: first.response };
  if (isRecord(first) && first.error !== undefined) return { kind: 'failed', detail: streamError(first.error) };
  if (operation.error !== undefined) return { kind: 'failed', detail: streamError(operation.error) };
  const state = isRecord(operation.metadata) && typeof operation.metadata.state === 'string' ? operation.metadata.state : '';
  if (state.endsWith('_CANCELLED')) return { kind: 'canceled' };
  if (state.endsWith('_EXPIRED')) return { kind: 'expired' };
  return null;
}

// The Decisions API names a noul's two criteria in words of its own.
const asked = (question: DecideQuestion) =>
  question.type === 'noul' && question.criteria ? { ...question, criteria: { true_description: question.criteria.true, false_description: question.criteria.false } } : question;

// POST /decisions, as it answered a live call on 2026-11-24 (aistudio.google.com/docs/decisions-api): in beta, text
// input only here, and its usage counts input alone.
const decides: Decides = {
  request: (endpoint, model, input, questions) => ({
    url: `${endpoint.baseUrl}/decisions`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: model.id, input, questions: Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, asked(question)])) }),
  }),
  parse(payload, questions) {
    if (!isRecord(payload) || !isRecord(payload.answers)) return null;
    const answers: Record<string, Decision> = {};
    for (const [id, question] of Object.entries(questions)) {
      const answer = decisionOf(question, payload.answers[id]);
      if (!answer) return null;
      answers[id] = answer;
    }
    const usage = isRecord(payload.usage) ? payload.usage : {};
    return { answers, usage: inputUsage(count(usage.total_input_tokens)), raw: usage };
  },
};

export const google: ConnectionType = {
  browser: {},
  id: 'google',
  label: 'Google',
  group: 'maker',
  major: true,
  description: 'Gemini API로 Gemini를 써요.',
  keyPage: 'https://aistudio.google.com/apikey',
  endpoint: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', protocol: 'gemini' },
  detect: { key: /^AIza[0-9A-Za-z_-]{35}$/, host: 'generativelanguage.googleapis.com' },
  // Half-rate batch input/output; keep unspecified cache discounts at full price to err high.
  // Model eligibility is unknown (Gemini pricing, 2026-10-12).
  discount: { lane: 'batch', batches, accepted: null, rates: { input: 0.5, output: 0.5, cacheRead: 1, cacheWrite: 1 } },
  decides,
};
