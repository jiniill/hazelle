import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { GUIDES } from '../../contracts/guides';
import { guidePage } from './GuidePage';

it('lists each guide’s questions in its contents, under an id no section of it takes', () => {
  for (const guide of GUIDES) {
    expect(guide.sections.map(({ id }) => id)).not.toContain('faq');
    const html = renderToStaticMarkup(guidePage(guide.path));
    expect(html).toContain('href="#faq"');
    expect(html).toContain('id="faq"');
  }
});
