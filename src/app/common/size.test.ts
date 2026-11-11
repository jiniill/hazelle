import { expect, it } from 'vitest';
import { sizeText } from './size';

it('says a size under a megabyte in kilobytes, so a small file never reads 0 MB', () => {
  expect([sizeText(12_300), sizeText(2_500_000), sizeText(3_000_000_000)]).toEqual(['12.3 KB', '2.5 MB', '3 GB']);
});
