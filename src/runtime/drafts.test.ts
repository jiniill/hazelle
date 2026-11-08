import { expect, it, vi } from 'vitest';
import { draftKey, Drafts } from './drafts';
import { openSession } from './session';
import { stubPage, testServer } from './testing';

const server = testServer();

it('outlives the session it was handed to, which a restore ends', async () => {
  vi.stubGlobal('window', new EventTarget());
  stubPage('hidden');
  const { accountId, vaultKey } = await server.account();
  const drafts = new Drafts();
  const opened = await openSession(accountId, vaultKey, 'jin', new AbortController().signal, undefined, undefined, { drafts });
  if (!opened.ok) throw new Error(opened.error);
  opened.data.drafts.set(draftKey(null, null), '쓰던 말');
  opened.data.close();
  expect(drafts.text(draftKey(null, null))).toBe('쓰던 말');
});

it('puts a failed send back before what was typed since', () => {
  const drafts = new Drafts();
  drafts.set('chat', '그동안 쓴 말');
  drafts.putBack('chat', '보낸 말');
  expect(drafts.text('chat')).toBe('보낸 말\n그동안 쓴 말');
});

it("moves a new chat's text under the id it was saved as", () => {
  const drafts = new Drafts();
  const fresh = draftKey(null, 'character');
  drafts.set(fresh, '쓰던 말');
  drafts.move(fresh, 'chat');
  expect([drafts.text(fresh), drafts.text(draftKey('chat', 'character'))]).toEqual(['', '쓰던 말']);
});

it('notifies after every set, even for the same text, but clearing the session stays silent', () => {
  const drafts = new Drafts();
  const reads: string[] = [];
  drafts.subscribe(() => reads.push(drafts.text('chat')));
  drafts.set('chat', 'same');
  drafts.set('chat', 'same');
  drafts.close();
  expect(reads).toEqual(['same', 'same']);
  expect(drafts.text('chat')).toBe('');
});
