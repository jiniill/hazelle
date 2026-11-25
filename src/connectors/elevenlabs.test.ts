import { describe, expect, it } from 'vitest';
import { elevenlabs } from './elevenlabs';
import { detect, resolveConnection, resolveModel } from './registry';
import { ConnectorError, type Connection } from './types';

const connection: Connection = { type: 'elevenlabs', label: 'ElevenLabs', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk_key' }], turns: null, starred: [] };
const speaks = elevenlabs.speaks!;
const voices = speaks.voices as Exclude<typeof speaks.voices, readonly unknown[]>;
const [v3] = speaks.models;

describe('ElevenLabs', () => {
  it('only speaks: its models are its own list, and no chat request is built for it', () => {
    const resolved = resolveConnection(connection)!;
    expect(resolved).toMatchObject({ codec: null, models: speaks.models });
    expect(() => resolveModel(resolved, v3!)).toThrow(new ConnectorError('image-only'));
    expect(detect(`sk_${'0a'.repeat(24)}`)).toMatchObject({ kind: 'key', type: elevenlabs });
  });

  it('reads a voice with its model as 64 kbps MP3, the key in its own header', () => {
    const request = speaks.request({ model: v3!, voice: 'abc/1', text: '안녕' });
    expect(request).toMatchObject({ url: 'https://api.elevenlabs.io/v1/text-to-speech/abc%2F1?output_format=mp3_44100_64', method: 'POST' });
    expect(JSON.parse(request.body!)).toEqual({ text: '안녕', model_id: 'eleven_v3' });
    expect(speaks.authHeaders('sk_key')).toEqual({ 'xi-api-key': 'sk_key' });
    expect(speaks.most(v3!)).toBe(5000);
  });

  it("takes an audio answer as MP3 and anything else as no audio", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(speaks.parse(bytes, 'audio/mpeg')).toEqual({ bytes, type: 'audio/mpeg' });
    expect(speaks.parse(bytes, 'application/json')).toBeNull();
    expect(speaks.parse(new Uint8Array(), 'audio/mpeg')).toBeNull();
  });

  it("lists the account's voices a page at a time, each with its description or else its labels", () => {
    expect(voices.request('sk_key', null).url).toBe('https://api.elevenlabs.io/v2/voices?page_size=100');
    expect(voices.request('sk_key', 'n/1').url).toBe('https://api.elevenlabs.io/v2/voices?page_size=100&next_page_token=n%2F1');
    expect(voices.parse({
      voices: [
        { voice_id: 'a', name: '아린', description: ' 밝은 목소리 ', labels: { gender: 'female' } },
        { voice_id: 'b', name: 'Bella', description: '', labels: { gender: 'female', age: 'young' } },
        { voice_id: 'c', name: 'Plain' },
        { name: 'no id' },
      ],
      has_more: true,
      next_page_token: 'next',
    })).toEqual({
      voices: [
        { id: 'a', name: '아린', about: '밝은 목소리' },
        { id: 'b', name: 'Bella', about: 'female · young' },
        { id: 'c', name: 'Plain', about: null },
      ],
      next: 'next',
    });
    expect(voices.parse({ voices: [], has_more: false, next_page_token: 'stale' })).toEqual({ voices: [], next: null });
    expect(voices.parse({})).toBeNull();
  });

  it("meters the period's characters left, until the reset it names", () => {
    const [meter] = elevenlabs.meters!;
    expect(meter!.parse({ character_count: 1200, character_limit: 30000, next_character_count_reset_unix: 1_790_000_000, tier: 'creator' })).toEqual([
      { kind: 'left', label: '크레딧', unit: 'credit', amount: 28800, limit: 30000, resets: { at: 1_790_000_000_000 } },
    ]);
    expect(meter!.plan!({ tier: 'creator' })).toBe('creator');
  });
});
