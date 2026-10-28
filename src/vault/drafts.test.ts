import { expect, it } from 'vitest';
import { randomBytes } from './aead';
import { draftEncryptionKey, openDraft, sealDraft } from './drafts';
import { objectKey } from './objects';

it('seals draft text under a separate key and binds it to its account and draft key', async () => {
  const vaultKey = randomBytes(32);
  const key = await draftEncryptionKey(vaultKey);
  const body = await sealDraft(key, 'account', 'chat', 'Private text');
  expect(await openDraft(await draftEncryptionKey(vaultKey), 'account', 'chat', body)).toBe('Private text');
  expect(await openDraft(key, 'other-account', 'chat', body)).toBeNull();
  expect(await openDraft(key, 'account', 'other-chat', body)).toBeNull();
  expect(await openDraft(await objectKey(vaultKey), 'account', 'chat', body)).toBeNull();
});
