import { expect, it, vi } from 'vitest';
import { StoreChanges } from './store-changes';

it('tells every listener and leaves the store work whole when one throws', () => {
  const later = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(() => {});
  try {
    const changes = new StoreChanges();
    const heard = vi.fn();
    const broken = new Error('listener');
    changes.subscribe(() => { throw broken; });
    changes.subscribe(heard);
    changes.add({ kind: 'inlay', id: 'x', parent: 'chat' });
    expect(() => changes.publish()).not.toThrow();
    expect(heard).toHaveBeenCalledOnce();
    expect(later.mock.calls[0]![0]).toThrow(broken);
  } finally {
    later.mockRestore();
  }
});
