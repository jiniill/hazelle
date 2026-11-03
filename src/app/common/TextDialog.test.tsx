import { Send } from 'lucide-react';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { counted, TextDialog } from './TextDialog';

// Static markup holds no portal: the dialog renders in place.
vi.mock('react-dom', async (original) => ({ ...(await original<typeof import('react-dom')>()), createPortal: (node: unknown) => node }));
vi.stubGlobal('document', {});

it('counts text trimmed against its limit, with the error only past it', () => {
  expect(counted('  abc  ', 3)).toEqual({ length: 3, over: false, hint: '3 / 3자', error: undefined });
  expect(counted('abcd', 3)).toMatchObject({ over: true, error: '3자까지 쓸 수 있어요.' });
});

it('shows the count unless quiet, 취소 only when asked, the slots around the field, and no sending while empty', () => {
  const shown = (props: Partial<ComponentProps<typeof TextDialog>>) =>
    renderToStaticMarkup(
      <TextDialog title="신고" label="신고 이유" lines={3} max={500} confirm={{ label: '보내기', icon: Send }} send={async () => ({ ok: true, data: undefined })} onDone={() => {}} onClose={() => {}} {...props} />,
    );
  const counting = shown({ above: <i>above</i>, below: <b>below</b> });
  expect(counting).toContain('0 / 500자');
  expect(counting).not.toContain('취소');
  expect(counting).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  expect(counting.indexOf('<i>above</i>')).toBeLessThan(counting.indexOf('<textarea'));
  expect(counting.indexOf('<textarea')).toBeLessThan(counting.indexOf('<b>below</b>'));
  const quiet = shown({ quiet: true, cancel: true });
  expect(quiet).not.toContain('/ 500자');
  expect(quiet).toContain('취소');
});
