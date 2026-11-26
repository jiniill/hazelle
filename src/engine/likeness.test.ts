import { describe, expect, it } from 'vitest';
import type { Portrait } from '../model/likeness';
import { artistOf, importedPortraits, likenessRequest, parseLikeness, readPortraitFile, rebuiltPortraits, sample, sourcesOf, TEXT_MOST, writePortraitFile, type LikenessInput } from './likeness';

const answer = { characters: [{ name: ' Ari ', aliases: ['아리', ' '], look: 'girl, silver hair', outfits: [{ name: 'usual', tags: 'white dress' }], source: 'text' }] };
const reading = { sources: ['text' as const], artist: 'artist:a', most: 2 };

describe('parseLikeness', () => {
  it('reads the portraits, bare or fenced, each with the pack’s artist', () => {
    const portraits = [{ name: 'Ari', aliases: ['아리'], look: 'girl, silver hair', outfits: [{ name: 'usual', tags: 'white dress' }], artist: 'artist:a', source: 'text' }];
    expect(parseLikeness(JSON.stringify(answer), reading)).toEqual({ ok: true, portraits });
    expect(parseLikeness('```json\n' + JSON.stringify(answer) + '\n```', reading)).toEqual({ ok: true, portraits });
    expect(parseLikeness('{"characters": []}', reading)).toEqual({ ok: true, portraits: [] });
  });

  it('fails a missing field, more characters than asked for, or a source the build did not have, and fills nothing in', () => {
    const [ari] = answer.characters;
    expect(parseLikeness(JSON.stringify({ characters: [{ ...ari, outfits: undefined }] }), reading)).toEqual({ ok: false, reason: 'fields' });
    expect(parseLikeness(JSON.stringify({ characters: [ari, ari, ari] }), reading)).toEqual({ ok: false, reason: 'fields' });
    expect(parseLikeness(JSON.stringify({ characters: [{ ...ari, source: 'vision' }] }), reading)).toEqual({ ok: false, reason: 'fields' });
    expect(parseLikeness('Here they are.', reading)).toEqual({ ok: false, reason: 'unreadable' });
  });
});

it('samples the first picture of each name stem, up to the count', () => {
  const names = ['Aya_smile.png', 'aya angry', 'Mina-1', 'Mina-2', '1', '2', 'Sora'];
  expect(sample(names.map((name) => ({ name })), 4).map(({ name }) => name)).toEqual(['Aya_smile.png', 'Mina-1', '1', '2']);
});

it('sends the text within its bound, names only the sources it has, and attaches the pictures to the material', () => {
  const input: LikenessInput = {
    name: 'Ari',
    user: false,
    texts: [{ label: 'Description', text: 'Silver hair.' }, { label: 'Scenario', text: '  ' }],
    lore: [{ name: 'huge', keys: [], content: 'x'.repeat(TEXT_MOST) }, { name: 'Mina', keys: ['mina'], content: 'Red eyes.' }],
    prompts: [],
    pictures: [{ type: 'image/webp', data: 'AAAA' }],
    avatar: true,
    most: 8,
  };
  const [system, user] = likenessRequest(input);
  expect(sourcesOf(input)).toEqual(['vision', 'text']);
  expect(system!.content).toContain('one of "vision" (the pictures themselves), "text" (the description and lorebook)');
  expect(user).toMatchObject({ role: 'user', pictures: input.pictures });
  expect(user!.content).toContain('## Mina\nRed eyes.');
  expect(user!.content).not.toContain('xxx');
  expect(user!.content).not.toContain('Scenario');
  expect(sourcesOf({ ...input, texts: [], lore: [], pictures: [] })).toEqual([]);
});

it('asks a persona’s profile for the user’s character itself, where a bot’s leaves them out', () => {
  const input: LikenessInput = { name: 'Jin', user: true, texts: [{ label: 'Description', text: 'Black hair.' }], lore: [], prompts: [], pictures: [], avatar: false, most: 8 };
  const [system, user] = likenessRequest(input);
  expect(system!.content).toContain('The material is the user’s own character in the roleplay: list them first');
  expect(system!.content).not.toContain('Leave out the user’s character');
  expect(user!.content).toMatch(/^The user’s character: Jin/);
  expect(likenessRequest({ ...input, user: false })[0]!.content).toContain('Leave out the user’s character');
});

it('takes the artist tags most pictures share, the earlier on a tie', () => {
  expect(artistOf([[], ['artist:a'], ['artist:b', 'artist:c'], ['artist:b', 'artist:c']])).toBe('artist:b, artist:c');
  expect(artistOf([['artist:a'], ['artist:b']])).toBe('artist:a');
  expect(artistOf([[]])).toBe('');
});

it('a rebuild keeps the user’s and a tool’s portraits first and leaves out a built one sharing a name or alias with them', () => {
  const made = (name: string, aliases: string[], source: Portrait['source']): Portrait => ({ name, aliases, look: '', outfits: [], artist: '', source });
  const lotta = made('Charlotte Grandellia', ['Lotta'], 'user');
  const rei = made('Rei', [], 'tool');
  const before = [made('Mina', [], 'text'), lotta, rei];
  const built = [made('Lotta', [], 'vision'), made('Mina', [], 'vision'), made('Rei', [], 'vision'), made('Sora', [], 'vision')];
  expect(rebuiltPortraits(before, built, 8)).toEqual([lotta, rei, built[1], built[3]]);
  expect(rebuiltPortraits(before, built, 3)).toEqual([lotta, rei, built[1]]);
});

describe('삽화 프로필 file', () => {
  const ari: Portrait = { name: 'Ari', aliases: ['아리'], look: 'girl, silver hair', outfits: [{ name: 'usual', tags: 'white dress' }], artist: 'artist:a', source: 'vision' };

  it('reads back what it wrote, an unnamed portrait too, every portrait the user’s', () => {
    const unnamed: Portrait = { name: '', aliases: [], look: '', outfits: [], artist: '', source: 'user' };
    expect(readPortraitFile(writePortraitFile([ari, unnamed]))).toEqual({ ok: true, portraits: [{ ...ari, source: 'user' }, unnamed] });
  });

  it('refuses another version of the file', () => {
    expect(readPortraitFile(JSON.stringify({ hazelle: 'portraits', version: 2, portraits: [ari] }))).toEqual({ ok: false, reason: 'other' });
  });

  it('refuses a malformed portrait and names its place', () => {
    const file = { hazelle: 'portraits', version: 1, portraits: [ari, { ...ari, outfits: [{ name: 'usual' }] }] };
    expect(readPortraitFile(JSON.stringify(file))).toEqual({ ok: false, reason: 'portrait', index: 1 });
  });
});

it('an import replaces the portraits sharing a name or alias with an imported one and appends the imported', () => {
  const made = (name: string, aliases: string[]): Portrait => ({ name, aliases, look: '', outfits: [], artist: '', source: 'user' });
  const before = [made('Charlotte', ['Lotta']), made('Mina', []), made('Rei', [])];
  const imported = [made('lotta', []), made('Sora', [])];
  expect(importedPortraits(before, imported)).toEqual({ portraits: [before[1], before[2], ...imported], replaced: 1 });
});
