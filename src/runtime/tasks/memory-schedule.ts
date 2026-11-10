export type MemoryCheck = 'stale' | 'full';

type Run = { check: MemoryCheck; pending: boolean };
type ChatWork = { run: Run | null; record: string | null };

export class MemorySchedule {
  private readonly chats = new Map<string, ChatWork>();

  private work(chat: string): ChatWork {
    let work = this.chats.get(chat);
    if (!work) {
      work = { run: null, record: null };
      this.chats.set(chat, work);
    }
    return work;
  }

  begin(chat: string, check: MemoryCheck): boolean {
    const work = this.work(chat);
    if (work.run) return false;
    work.run = { check, pending: false };
    return true;
  }

  queue(chat: string, check: MemoryCheck): boolean {
    const run = this.chats.get(chat)?.run;
    if (!run) return false;
    if (check === 'full') run.check = 'full';
    run.pending = true;
    return true;
  }

  // Only the next plan consumes a check: one arriving during that plan or indexing survives finish.
  planning(chat: string) {
    this.chats.get(chat)!.run!.pending = false;
  }

  includesNew(chat: string): boolean {
    return this.chats.get(chat)?.run?.check === 'full';
  }

  requested(chat: string): string | null {
    return this.chats.get(chat)?.record ?? null;
  }

  // A chapter stays requested while its stale members are rebuilt. It can also outlive a failed run until retry.
  rebuild(chat: string, record: string | null) {
    const work = this.work(chat);
    work.record = record;
    this.release(chat, work);
  }

  finish(chat: string): MemoryCheck | null {
    const work = this.chats.get(chat)!;
    const run = work.run!;
    work.run = null;
    this.release(chat, work);
    return run.pending ? run.check : null;
  }

  private release(chat: string, work: ChatWork) {
    if (!work.run && work.record === null) this.chats.delete(chat);
  }
}
