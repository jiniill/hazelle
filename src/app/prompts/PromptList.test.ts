import { expect, it } from 'vitest';
import { promptHolds } from './PromptList';

it('says how many blocks and toggles a prompt holds, and no toggles where it has none', () => {
  const block = { id: 'a', kind: 'text', name: null, role: 'system', text: '', mark: null } as const;
  expect(promptHolds({ blocks: [block, block], toggles: [{ key: 'k', label: 'K', kind: 'check' }, { divider: '' }] as never })).toBe('블록 2개 · 토글 1개');
  expect(promptHolds({ blocks: [block], toggles: [] })).toBe('블록 1개');
});
