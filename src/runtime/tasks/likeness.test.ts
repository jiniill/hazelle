import { describe, expect, it } from 'vitest';
import { blankCard } from '../../engine/import/card';
import { likenessId, PORTRAITS_MOST, type Portrait } from '../../model/likeness';
import { addCharacter } from '../library/characters';
import { importPortraits } from './likeness';
import { testServer } from '../testing';

const server = testServer();
const made = (name: string): Portrait => ({ name, aliases: [], look: '', outfits: [], artist: '', source: 'user' });

describe('importPortraits', () => {
  it('gives a pack without profiles the imported ones, with nothing before to restore', async () => {
    const { store } = await server.account();
    const added = await addCharacter(store, { card: blankCard('루나'), folder: null, loreFolders: [] }, { avatar: null, assets: [], lore: [], likeness: null }, () => {});
    const owner = added.ok ? added.data : '';
    expect(await importPortraits(store, owner, [made('루나')])).toEqual({ ok: true, data: { before: null, replaced: 0 } });
    expect(store.get('likeness', likenessId(owner))?.value).toMatchObject({ portraits: [made('루나')], receipt: null });
  });

  it('refuses past the most portraits a pack holds and writes nothing', async () => {
    const { store } = await server.account();
    const portraits = Array.from({ length: PORTRAITS_MOST }, (_, at) => made(`인물 ${at}`));
    const added = await addCharacter(store, { card: blankCard('루나'), folder: null, loreFolders: [] }, { avatar: null, assets: [], lore: [], likeness: { portraits, at: 1, receipt: null } }, () => {});
    const owner = added.ok ? added.data : '';
    expect(await importPortraits(store, owner, [made('인물 0'), made('카엘')])).toEqual({ ok: false, error: 'too-many', count: PORTRAITS_MOST + 1 });
    expect(store.get('likeness', likenessId(owner))?.value.portraits).toEqual(portraits);
  });
});
