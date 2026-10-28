import { describe, expect, it, vi } from 'vitest';
import type { ApiFailure } from '../../runtime/api';
import { SaveQueue, Saves } from './saveQueue';

type Note = { title: string; body: string };
type Answer = { ok: true } | ApiFailure;

function queue() {
  const writes: { patch: Partial<Note>; answer: (answer: Answer) => void }[] = [];
  const saves = new SaveQueue<Note>(
    (patch) => new Promise((answer) => writes.push({ patch, answer })),
    () => {},
  );
  return { saves, writes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SaveQueue', () => {
  it('reports a thrown save, prevents removal while it fails, and retries newer edits', async () => {
    const write = vi.fn<() => Promise<Answer>>().mockRejectedValue(new Error('write failed'));
    const changed = vi.fn();
    const saves = new SaveQueue<Note>(write, changed);
    expect(await saves.save({ title: 'a', body: 'x' })).toBe(false);
    expect(saves.status).toBe('failed');
    expect(changed).toHaveBeenLastCalledWith({ ok: false, error: 'save-failed' });
    const remove = vi.fn(async () => ({ ok: true }));
    expect(await saves.remove(remove)).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    write.mockResolvedValue({ ok: true });
    expect(await saves.save({ title: 'b' })).toBe(true);
    expect(write).toHaveBeenLastCalledWith({ title: 'b', body: 'x' });
    expect(saves.status).toBe('saved');
    expect(saves.busy).toBe(false);
  });

  it('releases a thrown removal and still accepts the next save', async () => {
    const write = vi.fn(async () => ({ ok: true as const }));
    const saves = new SaveQueue<Note>(write, () => {});
    await expect(saves.remove(async () => { throw new Error('remove failed'); })).rejects.toThrow('remove failed');
    expect(saves.busy).toBe(false);
    expect(await saves.save({ title: 'kept' })).toBe(true);
    expect(write).toHaveBeenCalledWith({ title: 'kept' });
  });

  it('tries a failed patch again on the next flush, under what was typed since', async () => {
    const { saves, writes } = queue();
    saves.change({ title: 'a', body: 'x' });
    const first = saves.flush();
    await settle();
    saves.change({ title: 'b' });
    writes[0]!.answer({ ok: false, error: 'offline' });
    expect(await first).toBe(false);
    expect(saves.status).toBe('saving');

    const second = saves.flush();
    await settle();
    expect(writes[1]!.patch).toEqual({ title: 'b', body: 'x' });
    writes[1]!.answer({ ok: true });
    expect(await second).toBe(true);
    expect(saves.status).toBe('saved');
  });

  it('drops a patch a restore dropped, and what was typed meanwhile, without telling a failure', async () => {
    const failures: unknown[] = [];
    const writes: { answer: (answer: Answer) => void }[] = [];
    const saves = new SaveQueue<Note>(() => new Promise((answer) => writes.push({ answer })), (failure) => failures.push(failure));
    saves.change({ title: 'a' });
    const first = saves.flush();
    await settle();
    saves.change({ body: 'x' });
    writes[0]!.answer({ ok: false, error: 'timeline-changed' });
    expect(await first).toBe(false);
    expect(saves.unsaved).toEqual({});
    expect(saves.status).toBeNull();
    expect(failures.filter(Boolean)).toEqual([]);
    expect(await saves.flush()).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it('starts the next save only once the one in flight is answered', async () => {
    const { saves, writes } = queue();
    saves.change({ title: 'a' });
    void saves.flush();
    await settle();
    saves.change({ body: 'x' });
    const second = saves.flush();
    await settle();
    expect(writes).toHaveLength(1);

    writes[0]!.answer({ ok: true });
    await settle();
    expect(writes.map((write) => write.patch)).toEqual([{ title: 'a' }, { body: 'x' }]);
    writes[1]!.answer({ ok: true });
    expect(await second).toBe(true);
  });

  it('counts a save in flight as unsaved until it is answered', async () => {
    const { saves, writes } = queue();
    saves.change({ title: 'a' });
    const flushed = saves.flush();
    await settle();
    expect(saves.busy).toBe(true);
    expect(saves.unsaved).toEqual({ title: 'a' });
    writes[0]!.answer({ ok: true });
    await flushed;
    expect(saves.busy).toBe(false);
  });

  it('runs a removal once what was changed is stored, and drops what is typed while it runs', async () => {
    const { saves, writes } = queue();
    saves.change({ title: 'a' });
    let answer!: (result: { ok: boolean }) => void;
    const removed = saves.remove(() => new Promise<{ ok: boolean }>((resolve) => (answer = resolve)));
    await settle();
    expect(writes[0]!.patch).toEqual({ title: 'a' });
    writes[0]!.answer({ ok: true });
    await settle();

    saves.change({ title: 'b' });
    answer({ ok: true });
    expect(await removed).toEqual({ ok: true });
    saves.change({ title: 'c' });
    expect(await saves.flush()).toBe(true);
    expect(writes).toHaveLength(1);
    expect(saves.busy).toBe(false);
  });

  it('does not run a removal when a change could not be stored', async () => {
    const { saves, writes } = queue();
    saves.change({ title: 'a' });
    let ran = false;
    const removed = saves.remove(async () => ({ ok: (ran = true) }));
    await settle();
    writes[0]!.answer({ ok: false, error: 'too-large' });
    expect(await removed).toBeNull();
    expect(ran).toBe(false);
    expect(saves.unsaved).toEqual({ title: 'a' });
  });
});

// asks: whether leaving the page now is asked about.
function page() {
  const listeners = new Set<(event: { preventDefault: () => void }) => void>();
  const target = { addEventListener: (_: string, listener: never) => void listeners.add(listener), removeEventListener: (_: string, listener: never) => void listeners.delete(listener) };
  const asks = () => {
    let asked = false;
    for (const listener of listeners) listener({ preventDefault: () => (asked = true) });
    return asked;
  };
  return { target: target as unknown as Window, asks };
}
const nothingUnsent = () => 0;

describe('Saves', () => {
  it('gives a screen opened again the queue the one before it left, so its save lands after the earlier one', async () => {
    const { target, asks } = page();
    const saves = new Saves(target, nothingUnsent);
    const writes: { patch: Partial<Note>; answer: (answer: Answer) => void }[] = [];
    const write = (patch: Partial<Note>) => new Promise<Answer>((answer) => writes.push({ patch, answer }));

    const leave = saves.watch('note', () => {});
    saves.queue<Note>('note', write, () => {}).change({ title: 'a' });
    leave();
    void saves.flush('note');
    await settle();

    const leaveAgain = saves.watch('note', () => {});
    expect(saves.view<Note>('note').unsaved).toEqual({ title: 'a' });
    void saves.queue<Note>('note', write, () => {}).save({ title: 'b' });
    await settle();
    expect(writes).toHaveLength(1);
    writes[0]!.answer({ ok: true });
    await settle();
    expect(writes[1]!.patch).toEqual({ title: 'b' });

    leaveAgain();
    expect(asks()).toBe(true);
    writes[1]!.answer({ ok: true });
    await settle();
    expect(asks()).toBe(false);
  });

  it('asks before the tab goes while a hold is held, and stops asking once it is released', () => {
    const { target, asks } = page();
    const saves = new Saves(target, nothingUnsent);
    expect(asks()).toBe(false);
    const release = saves.hold();
    expect(asks()).toBe(true);
    release();
    release();
    expect(asks()).toBe(false);
  });

  it('tells a save that failed after its screen was left once, and drops it', async () => {
    const { target, asks } = page();
    const saves = new Saves(target, nothingUnsent);
    const told: ApiFailure[] = [];
    let answer!: (answer: Answer) => void;
    const leave = saves.watch('note', () => {});
    saves.queue<Note>('note', () => new Promise<Answer>((resolve) => (answer = resolve)), (failure) => told.push(failure)).change({ title: 'a' });
    leave();
    void saves.flush('note');
    await settle();
    answer({ ok: false, error: 'gone' });
    await settle();
    expect(told).toEqual([{ ok: false, error: 'gone' }]);
    expect(saves.view<Note>('note').unsaved).toEqual({});
    expect(asks()).toBe(false);
  });

  it("asks before the page goes while the store has a write the server has not taken", () => {
    const { target, asks } = page();
    let unsent = 1;
    const saves = new Saves(target, () => unsent);
    expect(asks()).toBe(true);
    unsent = 0;
    expect(asks()).toBe(false);
    unsent = 1;
    saves.close();
    expect(asks()).toBe(false);
  });

  it('drops what waits when the session closes', async () => {
    const { target, asks } = page();
    const saves = new Saves(target, nothingUnsent);
    const written: Partial<Note>[] = [];
    saves.watch('note', () => {});
    const note = saves.queue<Note>('note', async (patch) => (written.push(patch), { ok: true }), () => {});
    note.change({ title: 'a' });
    saves.close();
    expect(asks()).toBe(false);
    expect(await note.flush()).toBe(true);
    expect(written).toEqual([]);
  });

  it('writes what waits its pause at once for leaving, and stops waiting at the bound for a save that is not answered', async () => {
    const saves = new Saves(page().target, nothingUnsent);
    const written: Partial<Note>[] = [];
    saves.queue<Note>('note', async (patch) => (written.push(patch), { ok: true }), () => {}).change({ title: 'a' });
    expect(await saves.settled(1000)).toBe(true);
    expect(written).toEqual([{ title: 'a' }]);

    saves.queue<Note>('other', () => new Promise<Answer>(() => {}), () => {}).change({ body: 'x' });
    expect(await saves.settled(10)).toBe(false);
  });

  it('does not count leaving as settled while the store still holds unsent writes', async () => {
    expect(await new Saves(page().target, () => 1).settled(10)).toBe(false);
  });
});
