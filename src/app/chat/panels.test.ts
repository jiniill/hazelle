import { describe, expect, it } from 'vitest';
import type { Card } from '../../engine/import/types';
import type { Block } from '../../model/prompt';
import { carryPanel, inspectShown, editorOf, loreBudgetEditor, NO_PANELS, opened, promptEditor, takeCarried, toggleEditor } from './panels';

describe('the panels beside the story', () => {
  const editor = { kind: 'character', id: 'c', part: null } as const;

  it('hands a carried panel to the chat it was carried into, once, and to no other', () => {
    carryPanel('next', { kind: 'lineage' });
    expect(takeCarried('other')).toBeNull();
    carryPanel('next', { kind: 'lineage' });
    expect(takeCarried('next')).toEqual({ kind: 'lineage' });
    expect(takeCarried('next')).toBeNull();
  });

  it('keeps every inspect tab beside an editor where two fit, and one panel at a time elsewhere', () => {
    for (const tab of ['request', 'variables', 'modules', 'scripts', 'log'] as const) {
      const inspect = { kind: 'inspect', tab } as const;
      const openedInspect = opened(NO_PANELS, inspect, true);
      const both = opened(openedInspect, editor, true);
      expect([both, inspectShown(both, true)]).toEqual([{ panel: editor, inspect }, inspect]);
      expect(opened(both, { kind: 'toggles' }, true)).toEqual({ panel: { kind: 'toggles' }, inspect: null });
      expect(opened(openedInspect, editor, false)).toEqual({ panel: editor, inspect: null });
      expect(opened({ panel: editor, inspect: null }, inspect, false)).toEqual({ panel: null, inspect });
      expect(opened({ panel: editor, inspect: null }, inspect, true)).toEqual(both);
      expect(inspectShown(both, false)).toBeNull();
    }
  });
});

describe('the editor a cache row opens', () => {
  const blocks: Block[] = [{ id: 'main', name: null, kind: 'text', role: 'system', mark: null, text: '' }];
  const prompt = { id: 'p', blocks };
  const owner = (id: string) => (id === 'mine' ? 'c' : 'module');

  it('opens a block of the chat prompt, the character’s 설명 and its own lorebook entries, and nothing else', () => {
    expect(editorOf({ kind: 'block', id: 'main', name: null, slot: null }, prompt, 'c', owner)).toEqual({ kind: 'prompts', id: 'p', pane: null, block: 'main' });
    expect(editorOf({ kind: 'block', id: 'utility:description', name: null, slot: 'description' }, prompt, 'c', owner)).toEqual({ kind: 'character', id: 'c', part: 'character' });
    expect(editorOf({ kind: 'depth', id: 'mine', name: 'mood', depth: 1 }, prompt, 'c', owner)).toEqual({ kind: 'character', id: 'c', part: 'lore' });
    expect(editorOf({ kind: 'lore', id: 'theirs', name: 'x', slot: 'lorebook' }, prompt, 'c', owner)).toBeNull();
    expect(editorOf({ kind: 'block', id: 'utility:main', name: null, slot: null }, prompt, 'c', owner)).toBeNull();
    expect(editorOf({ kind: 'block', name: null, slot: 'description' }, prompt, null, owner)).toBeNull();
  });
});

describe('where the lorebook budget that cut entries is set', () => {
  const card = (tokenBudget: number | null) => ({ loreSettings: { scanDepth: null, tokenBudget, recursive: null, fullWordMatching: null } }) as Card;

  it('opens the character’s 로어북 part when it holds its own budget, and the account’s otherwise', () => {
    expect(loreBudgetEditor({ id: 'c', card: card(500) })).toEqual({ kind: 'character', id: 'c', part: 'lore' });
    expect(loreBudgetEditor({ id: 'c', card: card(null) })).toBeNull();
    expect(loreBudgetEditor(null)).toBeNull();
  });
});

describe('the editor a toggle section opens', () => {
  it('opens the prompt’s 토글 pane, the character’s 토글 part and a module’s toggles, each beside the chat', () => {
    expect(toggleEditor({ from: 'prompt', id: 'p' })).toEqual({ kind: 'prompts', id: 'p', pane: 'toggles', fromToggles: true });
    expect(toggleEditor({ from: 'card', id: 'c' })).toEqual({ kind: 'character', id: 'c', part: 'toggles', fromToggles: true });
    expect(toggleEditor({ from: 'module', id: 'm' })).toEqual({ kind: 'module', id: 'm' });
  });
});

describe('the editor a task prompt door opens', () => {
  it('opens the prompt at its pane, or the prompt list without one', () => {
    expect(promptEditor({ id: 'p', pane: 'model' })).toEqual({ kind: 'prompts', id: 'p', pane: 'model' });
    expect(promptEditor(null)).toEqual({ kind: 'prompts', id: null, pane: null });
  });
});
