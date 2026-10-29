import { chatRequest, sending, type Route } from './registry';
import type { ChatRequest, HttpRequest } from './types';
import { isRecord, list } from './values';

export type WireText = { segments: { role: string; text: string }[]; messages: number; pictures: number };
export type PreparedChat = { request: HttpRequest; wire: WireText; identity: string; pdf: boolean };

export function prepareChat(route: Route, asked: ChatRequest): PreparedChat {
  const request = chatRequest(route, asked);
  const { settings, messages: sent, tools } = sending(route, asked);
  const body = JSON.parse(request.body!) as Record<string, unknown>;
  const wire: WireText = { segments: [], messages: 0, pictures: 0 };
  const content = (value: unknown, role: string) => {
    if (typeof value === 'string') { wire.segments.push({ role, text: value }); return; }
    for (const part of list(value)) {
      if (!isRecord(part)) continue;
      if (typeof part.text === 'string') wire.segments.push({ role, text: part.text });
      else if (part.type === 'image' || part.type === 'image_url' || part.type === 'input_image' || isRecord(part.inlineData)) wire.pictures++;
    }
  };
  // Read only the text-bearing fields of the request already built by the codec, never JSON syntax or image bytes.
  switch (route.endpoint.protocol) {
    case 'anthropic-messages':
      if (body.system !== undefined) { wire.messages++; content(body.system, 'system'); }
      break;
    case 'gemini':
      if (isRecord(body.systemInstruction)) { wire.messages++; content(body.systemInstruction.parts, 'system'); }
      break;
  }
  // A document counts as a picture, which keeps the call out of calibration; the model still reads every word in it, so
  // the budget counts them.
  const documents = sent.flatMap(({ role, document }) => (document === undefined ? [] : [{ role, text: document }]));
  wire.segments.push(...documents);
  // Each format spells tools differently, so they are read from the request as asked, not from the body.
  if (tools) wire.segments.push({ role: 'tools', text: JSON.stringify(tools) });
  wire.segments.push(...sent.flatMap(({ role, calls = [], results = [] }) => [...calls.map((call) => ({ role, text: `${call.name}${call.arguments}` })), ...results.map((result) => ({ role, text: result.text }))]));
  const messages = route.endpoint.protocol === 'responses' ? body.input : route.endpoint.protocol === 'gemini' ? body.contents : body.messages;
  for (const message of list(messages)) {
    // chat-completions' own tool turns hold the results already counted above.
    if (!isRecord(message) || message.role === 'tool') continue;
    wire.messages++;
    content(route.endpoint.protocol === 'gemini' ? message.parts : message.content, String(message.role));
  }
  // Text and cache routing keys vary per prompt. Everything else describes the actual request regime.
  const variable = new Set(['messages', 'system', 'systemInstruction', 'contents', 'input', 'prompt_cache_key', 'stream']);
  const regime = Object.fromEntries(Object.entries(body).filter(([key]) => !variable.has(key)).sort(([a], [b]) => a.localeCompare(b)));
  return { request, wire, pdf: documents.length > 0, identity: JSON.stringify([route.endpoint.baseUrl, route.endpoint.protocol, asked.model.id, settings.systemAsUser === true, settings.cache ?? null, regime]) };
}

export type ContextRefusal = { actual: number | null; maximum: number | null };

export function contextRefusal(protocol: string, failure: { status?: number; code?: string; detail: string }): ContextRefusal | null {
  if (failure.status !== undefined && failure.status !== 400 && failure.status !== 413 && failure.status !== 422) return null;
  const { detail, code } = failure;
  if (protocol === 'anthropic-messages') {
    const counts = /prompt is too long:\s*([\d,]+)\s*tokens\s*>\s*([\d,]+)\s*maximum/i.exec(detail);
    if (counts) return { actual: Number(counts[1]!.replaceAll(',', '')), maximum: Number(counts[2]!.replaceAll(',', '')) };
    if (/prompt is too long|input length.*exceed|prompt.*exceed.*context/i.test(detail)) return { actual: null, maximum: null };
  } else if (protocol === 'gemini') {
    const counts = /input token count\s*\(([\d,]+)\)\s*exceeds.*maximum.*\(([\d,]+)\)/i.exec(detail);
    if (counts) return { actual: Number(counts[1]!.replaceAll(',', '')), maximum: Number(counts[2]!.replaceAll(',', '')) };
    if (/input token count.*exceed|input.*exceeds.*token limit/i.test(detail)) return { actual: null, maximum: null };
  } else if ((protocol === 'responses' || protocol === 'chat-completions') && (code === 'context_length_exceeded' || /maximum context length|exceeds the context window|context[_ ]length[_ ]exceeded/i.test(detail))) {
    // OpenAI errors can include output reservation in "requested N". That number is not an exact input observation.
    return { actual: null, maximum: null };
  }
  return null;
}
