import { expect, it } from 'vitest';
import { attachmentLead, inlayIds, textFileNames, withAttachments } from './assets';

it("leads a message with its attached pictures' and text files' tags, which the translation takes off and puts back", () => {
  const sent = withAttachments({ pictures: ['a', 'b'], files: ['f'] }, '이거 봐.');
  expect([inlayIds([sent]), textFileNames(sent)]).toEqual([['a', 'b'], ['f']]);
  const { lead, text } = attachmentLead(sent);
  expect([lead + 'Look at this.', text]).toEqual([withAttachments({ pictures: ['a', 'b'], files: ['f'] }, 'Look at this.'), '이거 봐.']);
  expect(attachmentLead(withAttachments({ pictures: [], files: ['f'] }, ''))).toEqual({ lead: '{{textfile::f}}', text: '' });
  expect(attachmentLead('{{inlay::a}} 글 사이')).toEqual({ lead: '', text: '{{inlay::a}} 글 사이' });
});
