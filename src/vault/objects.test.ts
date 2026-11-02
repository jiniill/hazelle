import { describe, expect, it } from 'vitest';
import { randomBytes } from './aead';
import { fromBase64, toBase64 } from '../base64';
import { objectKey, openObject, sealObject } from './objects';

const address = { id: 'object-1', kind: 'connection', parent: null };

describe('object bodies', () => {
  it('round-trips a value and compresses repetitive text', async () => {
    const key = await objectKey(randomBytes(32));
    const value = { label: '본계정', notes: '반복 '.repeat(2000) };
    const body = await sealObject(key, 'account-1', address, value);
    expect(fromBase64(body).length).toBeLessThan(JSON.stringify(value).length / 10);
    expect(await openObject(key, 'account-1', address, body)).toEqual(value);
  });

  it('refuses a body moved to another object, kind, parent or account, or opened with another key', async () => {
    const vaultKey = randomBytes(32);
    const key = await objectKey(vaultKey);
    const body = await sealObject(key, 'account-1', address, { secret: 'sk-test' });
    expect(await openObject(key, 'account-1', { ...address, id: 'object-2' }, body)).toBeUndefined();
    expect(await openObject(key, 'account-1', { ...address, kind: 'settings' }, body)).toBeUndefined();
    expect(await openObject(key, 'account-1', { ...address, parent: 'object-9' }, body)).toBeUndefined();
    expect(await openObject(key, 'account-2', address, body)).toBeUndefined();
    expect(await openObject(await objectKey(randomBytes(32)), 'account-1', address, body)).toBeUndefined();
    expect(await openObject(await objectKey(vaultKey), 'account-1', address, body)).toEqual({ secret: 'sk-test' });
  });

  it('refuses an unknown format byte', async () => {
    const key = await objectKey(randomBytes(32));
    const bytes = fromBase64(await sealObject(key, 'account-1', address, {}));
    bytes[0] = 2;
    expect(await openObject(key, 'account-1', address, toBase64(bytes))).toBeUndefined();
  });
});
