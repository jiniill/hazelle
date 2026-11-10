import { describe, expect, it } from 'vitest';
import type { Connection } from '../connectors/types';
import { addFirstProfile, addProfile, FIRST_PROFILE_ID, modelProfile, profileUsers, removeProfile, setModelProfile, setProfileSettings, writerOf } from './profiles';
import { testConnection, testModel as model, testServer } from './testing';

const server = testServer();

const openRouter: Connection = { ...testConnection, starred: [model, { ...model, id: 'other' }] };

describe('설정 묶음', () => {
  it('gives a model the default 묶음 until it names its own, reads a deleted one as missing, keeps the default, and clears its own when put on the default', async () => {
    const { store } = await server.account();
    const created = await store.create('connection', openRouter);
    const id = created.ok ? created.data.id : '';
    const starred = () => store.get('connection', id)!.value.starred[0]!;

    await addFirstProfile(store);
    expect(modelProfile(store, starred())).toMatchObject({ kind: 'profile', own: false, profile: { id: FIRST_PROFILE_ID, value: { name: '기본', settings: {} } } });
    const added = await addProfile(store, { name: 'Claude', settings: { temperature: 1 } });
    const claude = added.ok ? added.data.id : '';
    await setModelProfile(store, id, 'm', claude);
    expect(modelProfile(store, starred())).toMatchObject({ kind: 'profile', own: true, profile: { id: claude } });
    await removeProfile(store, claude);
    expect(modelProfile(store, starred())).toEqual({ kind: 'missing', own: true });
    expect(await removeProfile(store, FIRST_PROFILE_ID)).toEqual({ ok: false, error: 'default' });
    await setModelProfile(store, id, 'm', FIRST_PROFILE_ID);
    expect(starred()).not.toHaveProperty('profile');
  });

  it('writes with a route’s 묶음, and stops on a missing one, saying whether it was the model’s own', async () => {
    const { store } = await server.account();
    const created = await store.create('connection', openRouter);
    const connection = created.ok ? created.data : null!;
    await addFirstProfile(store);
    expect(writerOf(store, { connection, model })).toEqual({ route: { connection, model }, settings: {} });
    expect(writerOf(store, { connection, model: { ...model, profile: 'gone' } })).toEqual({ kind: 'profile-missing', own: true });
  });

  it('merges each change into what is stored, so another device’s change to another field survives', async () => {
    const { store, open } = await server.account();
    const added = await addProfile(store, { name: 'Claude', settings: {} });
    const id = added.ok ? added.data.id : '';
    const other = await open();
    await other.pull();

    await setProfileSettings(store, id, { temperature: 1, stop: ['끝'] });
    await setProfileSettings(other, id, { maxOutput: 6000 });
    await store.pull();
    await setProfileSettings(store, id, { stop: undefined });
    expect(store.get('profile', id)!.value.settings).toEqual({ temperature: 1, maxOutput: 6000 });
  });

  it('counts no model that only draws among a 묶음’s users', () => {
    const drawing = { ...model, id: 'draws', output: ['image' as const] };
    const stored = { id: 'c', value: { ...openRouter, starred: [model, drawing] } } as Parameters<typeof profileUsers>[0][number];
    expect(profileUsers([stored], FIRST_PROFILE_ID, FIRST_PROFILE_ID).map(({ model: user }) => user.id)).toEqual(['m']);
  });
});
