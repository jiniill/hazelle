import { act, createElement, Fragment } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { keysOf, Quiet, runShortcut, SHORTCUT_GROUPS, SHORTCUTS, useShortcut } from './shortcuts';
import { titled } from './ui';
import { probeRoot } from './ui/probe';

describe('shortcuts', () => {
  it('writes the titles the chat shows', () => {
    expect(titled(SHORTCUTS.send.label, SHORTCUTS.send.keys)).toBe('보내기 · Enter');
    expect(titled(SHORTCUTS.stop.label, SHORTCUTS.stop.keys)).toBe('응답 생성 중지 · Esc');
    expect(titled('이전', [SHORTCUTS.swipe.keys[0]])).toBe('이전 · ←');
    expect(titled('다시 생성', [SHORTCUTS.swipe.keys[1]])).toBe('다시 생성 · →');
  });

  it('sends with Ctrl+Enter and breaks the line with Enter when Enter로 보내기 is off', () => {
    expect(titled(SHORTCUTS.send.label, keysOf('send', false))).toBe('보내기 · Ctrl+Enter');
    expect(titled(SHORTCUTS.newline.label, keysOf('newline', false))).toBe('줄바꿈 · Enter');
    expect(keysOf('send', true)).toBe(SHORTCUTS.send.keys);
  });

  it('lists every shortcut in 단축키 once', () => {
    expect(SHORTCUT_GROUPS.flatMap((group) => group.names).sort()).toEqual(Object.keys(SHORTCUTS).sort());
  });

  it('runs no handler of a page held quiet behind a window', async () => {
    const root = probeRoot();
    const ran: string[] = [];
    function Probe({ name }: { name: string }) {
      useShortcut('search', () => void ran.push(name));
      return null;
    }
    try {
      await act(async () => root.render(createElement(Fragment, null, createElement(Quiet.Provider, { value: true }, createElement(Probe, { name: 'behind' })), createElement(Probe, { name: 'window' }))));
      runShortcut('search');
      expect(ran).toEqual(['window']);
      await act(async () => root.unmount());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
