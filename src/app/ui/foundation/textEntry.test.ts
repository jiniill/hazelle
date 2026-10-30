import { expect, it } from 'vitest';

const components = import.meta.glob<string>(['/src/app/ui/**/*.tsx', '!**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });
const sheets = import.meta.glob<string>('/src/app/ui/**/*.module.css', { query: '?raw', import: 'default', eager: true });

// Their one size is already at least 16px at every width.
const DRAWN_LARGE = ['Composer.module.css', 'TitleField.module.css'];

it('floors the type of every text-entry control in the kit, so a focus never zooms the page on iOS', () => {
  const entries = Object.entries(components).filter(([, source]) => /<textarea\b|<input\b(?![^>]*type="checkbox")/.test(source));
  expect(entries.length).toBeGreaterThan(0);
  const unfloored = entries.filter(([path, source]) => {
    const sheet = /from '\.\/(\w+\.module\.css)'/.exec(source)?.[1];
    if (!sheet) return true;
    if (DRAWN_LARGE.includes(sheet)) return false;
    return !sheets[`${path.slice(0, path.lastIndexOf('/'))}/${sheet}`]?.includes('--text-entry-min');
  });
  expect(unfloored.map(([path]) => path)).toEqual([]);
});
