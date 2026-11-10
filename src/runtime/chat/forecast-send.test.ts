import { expect, it } from 'vitest';
import { startChat } from './chat-log';
import { greetingPreview } from './greetings';
import { answerable, testServer } from '../testing';
import { forecastSend, wouldSend } from './turn-context';

const server = testServer();

it('tells the composer why a draft cannot go when its CBS runs away, and its other callers only that it cannot', () => server.withSession(async (session) => {
  await answerable(session);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  const text = '{{settempvar::x::abcdefghijklmnop}}' + '{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}'.repeat(22);
  expect(await forecastSend(session, chat, { kind: 'send', text })).toEqual({ kind: 'runaway' });
  expect(await wouldSend(session, chat, { kind: 'send', text })).toBeNull();
}));

it('forecasts a new chat before its first save as the request it sends once saved', () => server.withSession(async (session) => {
  await answerable(session);
  const chat = crypto.randomUUID();
  const value = { title: null, character: null, models: {} };
  const greetings = { choices: [{ id: crypto.randomUUID(), index: 0, text: '어서 와요.' }], selected: 0 };
  const target = { kind: 'send', text: '안녕' } as const;
  const unsaved = (await wouldSend(session, chat, target, undefined, 'forecast', { chat: value, messages: [greetingPreview(greetings, Date.now())!] }))!;
  await server.hold(session.store, chat);
  await startChat(session.store, chat, value, greetings);
  const saved = (await wouldSend(session, chat, target))!;
  expect(unsaved.prompt.messages).toEqual(saved.prompt.messages);
  expect(unsaved.prompt.messages.map(({ content }) => content).join('\n')).toContain('어서 와요.');
}));
