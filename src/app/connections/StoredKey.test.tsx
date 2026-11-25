import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { StoredKey, covered } from './StoredKey';

vi.mock('../toast', () => ({ useToast: () => ({ show: vi.fn(), error: vi.fn() }) }));

it('opens covered, showing only the end of a long one-line key', () => {
  const key = 'sk-or-v1-0123456789abcdef';
  const html = renderToStaticMarkup(<StoredKey label="API 키" secret={key} />);
  expect(html).not.toContain(key.slice(0, -4));
  expect(html).toContain(covered(key));
  expect(covered(key)).toBe('••••••••••••cdef');
  expect(covered('short-key')).toBe('••••••••••••');
  expect(covered('{\n  "private_key": "-----BEGIN PRIVATE KEY-----"\n}')).toBe('••••••••••••');
});
