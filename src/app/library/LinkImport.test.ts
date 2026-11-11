import { expect, it } from 'vitest';
import type { LinkFolder } from '../../runtime/import/link';
import { firstTicks } from './LinkImport';

const folder = (...names: string[]): LinkFolder => ({ files: names.map((name) => ({ name, size: undefined })), skipped: [], take: () => Promise.reject(new Error('unused')) });

it('ticks the files at a folder’s top, and every file where all sit in subfolders', () => {
  expect(firstTicks(folder('new.risum', 'old/1.risum'))).toEqual([true, false]);
  expect(firstTicks(folder('a/1.risum', 'b/2.risup'))).toEqual([true, true]);
});
