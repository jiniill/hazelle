import { describe, expect, it, vi } from 'vitest';
import type { Spoken } from '../../connectors/types';
import { fold, shown } from '../../model/chat';
import { appendUserMessage, startChat } from '../chat/chat-log';
import { takeTurn } from '../chat/turn';
import { setSpeech } from '../library/characters';
import type { Session } from '../session';
import { answerable, inTurn, saying, stubRelay, testServer } from '../testing';
import { Speaker, speakingModels, type Player } from './speech';

const server = testServer();

const audio = (...bytes: number[]) => new Response(new Uint8Array(bytes), { headers: { 'x-relay': 'upstream', 'content-type': 'audio/mpeg' } });
const REPLY = `${'ㄱ'.repeat(100)}\n\n${'ㄴ'.repeat(200)}`;

function listener() {
  const heard: Spoken[] = [];
  const player: Player = { unlock: () => {}, play: (sound) => (heard.push(sound), Promise.resolve('ended')) };
  return { heard, player };
}

async function replied(session: Session) {
  await answerable(session);
  const voice = await session.store.create('connection', { type: 'elevenlabs', label: 'ElevenLabs', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk_x' }], turns: null, starred: [] });
  if (!voice.ok) throw new Error('fixture');
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Go on' });
  stubRelay(inTurn([saying(REPLY)]));
  expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
  const message = fold(session.store.children('entry', chat)).at(-1)!;
  return { chat, connection: voice.data.id, message: message.id, version: shown(message).id };
}

it('lists the speaking models by connection name, as 연결 does, so the first is one wherever it is read', () => {
  const stored = (id: string, type: string, label: string) => ({ id, kind: 'connection' as const, parent: null, rev: 1, value: { type, label, baseUrl: null, protocol: null, accounts: [], turns: null, starred: [] } });
  const routes = speakingModels([stored('a', 'google', 'Google'), stored('b', 'elevenlabs', 'ElevenLabs')]);
  expect(routes.map(({ connection }) => connection.id)).toEqual(['b', 'b', 'b', 'a', 'a']);
});

describe('Speaker', () => {
  it('reads the shown reply in stretches, each heard as it comes, and keeps them as one file the next listen plays without a call', () =>
    server.withSession(async (session) => {
      const { chat, connection, message, version } = await replied(session);
      await setSpeech(session.store, null, { voice: { connection, id: 'voice-1', name: 'Ari' } });
      const { heard, player } = listener();
      const speaker = new Speaker({ ...session, player });
      const sent = stubRelay(inTurn([audio(1, 2), audio(3)]));
      speaker.play(chat, message, version);
      await vi.waitFor(() => expect(session.store.children('speech', chat)).toHaveLength(1));
      await vi.waitFor(() => expect(speaker.snapshot().size).toBe(0));

      expect(sent.map(({ sent }) => [sent.url, JSON.parse(sent.body!)])).toEqual([
        ['https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_64', { text: 'ㄱ'.repeat(100), model_id: 'eleven_v3' }],
        ['https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_64', { text: 'ㄴ'.repeat(200), model_id: 'eleven_v3' }],
      ]);
      expect(heard.map(({ bytes }) => [...bytes])).toEqual([[1, 2], [3]]);
      expect(session.store.children('speech', chat)[0]!.value).toMatchObject({ message, version, of: 'text', type: 'audio/mpeg', size: 3 });

      const again = stubRelay(inTurn([]));
      speaker.play(chat, message, version);
      await vi.waitFor(() => expect(heard).toHaveLength(3));
      expect(again).toEqual([]);
      expect([...heard[2]!.bytes]).toEqual([1, 2, 3]);
    }));

  it('reads nothing with no voice picked on the 음성 모델\'s connection, and says so', () =>
    server.withSession(async (session) => {
      const { chat, message, version } = await replied(session);
      await setSpeech(session.store, null, { voice: { connection: 'another', id: 'voice-1', name: 'Ari' } });
      const { heard, player } = listener();
      const speaker = new Speaker({ ...session, player });
      const sent = stubRelay(inTurn([]));
      speaker.play(chat, message, version);
      await vi.waitFor(() => expect(speaker.snapshot().get(message)?.failure).toEqual({ kind: 'no-voice' }));
      expect(sent).toEqual([]);
      expect(heard).toEqual([]);
    }));
});
