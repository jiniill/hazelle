import { expect, it } from 'vitest';
import type { MemorySent, RecordCounts } from '../engine/memory';
import { leavingCauses } from './memory-view';

const idle = { running: new Map(), failed: new Map(), chapterFailed: new Map() };
const none: RecordCounts = { over: 0, stale: 0, forgotten: 0, deleted: 0, changed: 0, rendered: 0 };
const built = (over: Partial<Extract<MemorySent, { by: null }>>): MemorySent => ({ by: null, sent: [], found: [], records: none, covered: 10, missing: 0, slot: true, ...over });

it('names why messages leave a request, what ends by itself first', () => {
  expect(leavingCauses({ memory: built({ missing: 5, records: { ...none, over: 3 } }), dropped: 2 }, 'c', idle)).toEqual(['over', 'no-room']);
  expect(leavingCauses({ memory: built({ missing: 5, records: { ...none, stale: 3, changed: 3 } }), dropped: 0 }, 'c', { ...idle, running: new Map([['c', { model: 'm', left: 2 }]]) })).toEqual(['working', 'stale']);
  expect(leavingCauses({ memory: built({ missing: 10, slot: false, records: { ...none, over: 3 } }), dropped: 0 }, 'c', idle)).toEqual(['no-slot']);
  expect(leavingCauses({ memory: null, dropped: 4 }, 'c', idle)).toEqual(['off']);
  expect(leavingCauses({ memory: { by: 'Keeper', text: '', covered: 0, missing: 0, slot: false }, dropped: 4 }, 'c', idle)).toEqual(['tool']);
  expect(leavingCauses({ memory: built({ missing: 1 }), dropped: 0 }, 'c', idle)).toEqual(['unknown']);
  expect(leavingCauses({ memory: built({}), dropped: 1 }, 'other', { ...idle, running: new Map([['c', { model: 'm', left: 2 }]]) })).toEqual(['no-room']);
});
