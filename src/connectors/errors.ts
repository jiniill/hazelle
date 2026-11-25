import type { Terminal } from './types';
import { isRecord } from '../record';

// Decoded error strings and message fields are already presentation text, never JSON-quoted.
// Unknown shapes have no message; each transport keeps its own fallback policy.
export function errorValue(error: unknown): string | null {
  if (typeof error === 'string') return error;
  return isRecord(error) && typeof error.message === 'string' ? error.message : null;
}

// An error already identified (a stream's error event, a batch's failed answer): retain an unknown JSON value verbatim
// as JSON. A malformed error event with no value still fails, but has no detail to display.
export const streamError = (error: unknown): string => errorValue(error) ?? JSON.stringify(error) ?? '';

// A provider's word for its refusal: OpenAI's {error: {code}}, which a connector may tell apart (Discount busy), or
// Google's {error: {code: 400, status}}, whose number only repeats the HTTP status.
const errorCode = (error: unknown) => (!isRecord(error) ? null : typeof error.code === 'string' ? error.code : typeof error.status === 'string' ? error.status : null);

export function failedTerminal(error: unknown): Terminal {
  const code = errorCode(error);
  return { state: 'failed', error: streamError(error), ...(code !== null && { code }) };
}

// A provider's error body in the shapes seen so far: OpenAI and OpenRouter {error: {message}}, Anthropic
// {type: 'error', error: {message}}, others {message} or {error: '...'}. Anything else, such as
// Cloudflare's plain "error code: 1002", is passed on as text.
export function providerMessage(text: string): string {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return text.trim().slice(0, 300);
  }
  if (isRecord(body)) {
    const message = errorValue(body.error);
    if (message !== null) return message;
    if (typeof body.message === 'string') return body.message;
    if (typeof body.detail === 'string') return body.detail;
  }
  return text.trim().slice(0, 300);
}

export function providerCode(text: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  return isRecord(body) ? errorCode(body.error) : null;
}
