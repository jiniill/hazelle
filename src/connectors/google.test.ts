import { expect, it } from 'vitest';
import { toBase64 } from '../base64';
import { google } from './google';

it("reads Gemini speech as the last audio of the model's output, a WAV unless named otherwise, and nothing from an answer without one", () => {
  const speaks = google.speaks!;
  const model = speaks.models[0]!;
  const request = speaks.request({ model, voice: 'Kore', text: '안녕' });
  expect(JSON.parse(request.body as string)).toMatchObject({ model: model.id, generation_config: { speech_config: [{ voice: 'Kore' }] } });
  const answer = (content: unknown[]) => new TextEncoder().encode(JSON.stringify({ steps: [{ type: 'user_input', content: [] }, { type: 'model_output', content }] }));
  const audio = (bytes: number[], mime?: string) => ({ type: 'audio', data: toBase64(new Uint8Array(bytes)), ...(mime && { mime_type: mime }) });
  expect(speaks.parse(answer([audio([1]), audio([2, 3])]), 'application/json')).toEqual({ bytes: new Uint8Array([2, 3]), type: 'audio/wav' });
  expect(speaks.parse(answer([audio([4], 'audio/mpeg')]), 'application/json')?.type).toBe('audio/mpeg');
  expect(speaks.parse(answer([{ type: 'text', text: '못 읽어요' }]), 'application/json')).toBeNull();
  expect(speaks.parse(answer([audio([])]), 'application/json')).toBeNull();
});
