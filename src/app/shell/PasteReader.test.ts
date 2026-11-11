import { expect, it } from 'vitest';
import { readPaste } from './PasteReader';

it('reads a pasted key whose form names its type and a Realm or Proton link, and nothing else', () => {
  expect(readPaste('  sk-ant-api03-abc  ')).toMatchObject({ kind: 'key', type: { id: 'anthropic' }, secret: 'sk-ant-api03-abc' });
  const realm = 'https://realm.risuai.net/character/0b6a4c3e-1f2d-4e5a-9b8c-7d6e5f4a3b2c';
  expect(readPaste(` ${realm}\n`)).toEqual({ kind: 'link', text: realm });
  expect(readPaste('https://drive.proton.me/urls/ABC123#secret')).toEqual({ kind: 'link', text: 'https://drive.proton.me/urls/ABC123#secret' });
  for (const other of ['https://example.com/card.png', 'hello', 'a8f3e9c1b2d4', '안녕하세요 반가워요', '']) expect(readPaste(other)).toBeNull();
});
