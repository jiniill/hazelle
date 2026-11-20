import type { ReactElement } from 'react';
import { expect, it, vi } from 'vitest';
import { Press } from './Press';

type Key = { key: string; repeat: boolean; defaultPrevented: boolean; preventDefault: () => void; currentTarget: { click: () => void } };
const key = (name: string, repeat = false): Key => {
  const event: Key = { key: name, repeat, defaultPrevented: false, preventDefault: () => (event.defaultPrevented = true), currentTarget: { click: vi.fn() } };
  return event;
};

it('presses a link on Space as its button does, once however long held, without scrolling, after its own keys', () => {
  const own = vi.fn((event: Key) => event.key === 'x' && event.preventDefault());
  const link = Press({ href: '/chat', onKeyDown: own as never }) as ReactElement<{ onKeyDown: (event: Key) => void }>;
  const press = (event: Key) => (link.props.onKeyDown(event), event);
  const space = press(key(' '));
  expect(space.currentTarget.click).toHaveBeenCalledOnce();
  expect(space.defaultPrevented).toBe(true);
  const held = press(key(' ', true));
  expect(held.currentTarget.click).not.toHaveBeenCalled();
  expect(held.defaultPrevented).toBe(true);
  expect(press(key('Enter')).defaultPrevented).toBe(false);
  expect(own).toHaveBeenCalledTimes(3);
});

it('leaves Space to a press that takes it itself', () => {
  const link = Press({ href: '/chat', onKeyDown: (event) => event.preventDefault() }) as ReactElement<{ onKeyDown: (event: Key) => void }>;
  const space = key(' ');
  link.props.onKeyDown(space);
  expect(space.currentTarget.click).not.toHaveBeenCalled();
});
