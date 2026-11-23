import { expect, it } from 'vitest';
import { attachmentLead, findAsset, inlayIds, textFileNames, withAttachments } from './assets';

it("leads a message with its attached pictures' and text files' tags, which the translation takes off and puts back", () => {
  const sent = withAttachments({ pictures: ['a', 'b'], files: ['f'] }, '이거 봐.');
  expect([inlayIds([sent]), textFileNames(sent)]).toEqual([['a', 'b'], ['f']]);
  const { lead, text } = attachmentLead(sent);
  expect([lead + 'Look at this.', text]).toEqual([withAttachments({ pictures: ['a', 'b'], files: ['f'] }, 'Look at this.'), '이거 봐.']);
  expect(attachmentLead(withAttachments({ pictures: [], files: ['f'] }, ''))).toEqual({ lead: '{{textfile::f}}', text: '' });
  expect(attachmentLead('{{inlay::a}} 글 사이')).toEqual({ lead: '', text: '{{inlay::a}} 글 사이' });
});

const assets = [{ name: 'Smile.png' }, { name: 'smile.PNG' }, { name: 'angry_face.webp' }];

it('finds an asset by its name in any case, rolling among those that share it', () => {
  expect(findAsset(assets, 'SMILE.png', () => 0)).toBe(assets[0]);
  expect(findAsset(assets, 'smile.png', () => 0.99)).toBe(assets[1]);
});

it('finds the nearest name, its extension and separators aside, and none past the distance', () => {
  expect(findAsset(assets, 'angry face', () => 0)).toBe(assets[2]);
  expect(findAsset(assets, 'angryfase.png', () => 0)).toBe(assets[2]);
  expect(findAsset(assets, 'a name like no other', () => 0)).toBeNull();
});

it('finds in another list what the list before it lacked', () => {
  expect(findAsset(assets, 'lighthouse-at-dusk.png', () => 0)).toBeNull();
  const added = { name: 'lighthouse-at-dusk.png' };
  expect(findAsset([...assets, added], 'lighthouse-at-dusk.png', () => 0)).toBe(added);
});
