import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { StartPage } from './StartPage';

type Field = { label: string; value: string; onChange: (value: string) => void };
const live = vi.hoisted(() => ({ fields: new Map<string, Field>(), refuse: null as ((message: string) => void) | null, focus: () => {}, pass: ({ children }: { children?: ReactNode }) => children }));
vi.mock('../ui', () => ({
  ...Object.fromEntries(['Beat', 'Hero', 'Indoors', 'PanelBody', 'Row', 'Stack', 'Link', 'Callout', 'ExampleTalk', 'Said', 'Upcoming', 'WalkOnHint', 'Text'].map((name) => [name, live.pass])),
  ...Object.fromEntries(['Brand', 'Button', 'KeyPlaces', 'NightScene', 'Progress', 'Promises', 'SayChoices', 'TrialSteps'].map((name) => [name, () => null])),
  ChoiceGroup: (field: Field) => (live.fields.set('제공자', field), null),
  TextField: (field: Field) => (live.fields.set('key', field), null),
}));
vi.mock('./Trial', () => ({ Trial: ({ onRefused }: { onRefused: (message: string) => void }) => ((live.refuse = onRefused), null) }));
vi.mock('../common/LegalNotice', () => ({ LegalNotice: () => null }));

afterEach(() => {
  vi.unstubAllGlobals();
});

// The page's own elements, as many as React needs to place them: the form finds its key field, and its submit is the
// one React was given.
function hostElements() {
  const made: Record<string, unknown>[] = [];
  const element = (tag: string) => {
    const node: Record<string, unknown> = {
      nodeType: 1, tagName: tag.toUpperCase(), namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: document, style: {},
      setAttribute() {}, removeAttribute() {}, appendChild() {}, insertBefore() {}, removeChild() {}, addEventListener() {}, removeEventListener() {},
      querySelector: (selector: string) => (tag === 'form' && selector === 'input' ? { focus: live.focus } : null),
    };
    if (tag === 'form') made.push(node);
    return node;
  };
  Object.assign(document, { createElement: element, createTextNode: () => ({ nodeType: 3 }) });
  return () => {
    const form = made.at(-1)!;
    const props = form[Object.keys(form).find((key) => key.startsWith('__reactProps'))!] as { onSubmit: (event: unknown) => void };
    props.onSubmit({ preventDefault() {} });
  };
}

it('keeps the typed key and pick through a refused try, and takes focus back to the key', async () => {
  probeRoot();
  const submit = hostElements();
  const root = createRoot(document.createElement('div'));
  live.focus = vi.fn();
  await act(async () => root.render(<StartPage doors={null} />));
  act(() => live.fields.get('제공자')!.onChange('anthropic'));
  act(() => live.fields.get('key')!.onChange('typed'));
  expect(live.focus).not.toHaveBeenCalled();

  await act(async () => submit());
  live.fields.clear();
  await act(async () => live.refuse!('키가 거절됐어요.'));
  expect(live.fields.get('key')).toMatchObject({ label: 'Anthropic API 키', value: 'typed' });
  expect(live.focus).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
