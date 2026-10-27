import { useState, type ReactNode } from 'react';
import type { ApiResult } from '../../runtime/api';
import { useToast } from '../toast';
import { Button, ListItem, Row, Stack, Tag, Text } from '../ui';
import { withParticle } from './particles';

// Script editors open one row; lore opens several for side-by-side reading/copying (user ruling, not a kit limit).
export function useOpenRows(several = false) {
  const toast = useToast();
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const setOpen = (id: string, on: boolean) =>
    setOpened((now) => {
      const next = new Set(several ? now : []);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // The row opens as added, before the store holds it.
  async function add(noun: string, task: (id: string) => Promise<ApiResult<unknown>>) {
    const id = crypto.randomUUID();
    setOpen(id, true);
    const saved = await task(id);
    if (!saved.ok) toast.failed(saved, `${withParticle(noun, '을/를')} 추가하지 못했어요.`);
  }

  // removing: through the row's save queue, so a save still waiting never writes after the delete; null when a change
  // waiting in it could not be stored, so the delete did not run.
  async function remove<R>({ id, noun, name }: { id: string; noun: string; name: string }, removing: Promise<ApiResult<R> | null>, restore: (removed: R) => Promise<ApiResult<unknown>>) {
    const done = await removing;
    if (!done) return;
    if (!done.ok) return toast.failed(done, '삭제하지 못했어요.');
    setOpen(id, false);
    toast.undoable(`'${name}' ${withParticle(noun, '을/를')} 삭제했어요.`, () => restore(done.data));
  }

  return { opened, isOpen: (id: string) => opened.has(id), setOpen, add, remove };
}

export type OpenRows = ReturnType<typeof useOpenRows>;

export function OpenRow({ title, note, tag, open, onOpen, children }: { title: string; note?: string; tag: string | null; open: boolean; onOpen: (open: boolean) => void; children: ReactNode }) {
  return <ListItem title={title} note={note} trailing={tag && <Tag>{tag}</Tag>} expanded={open} onClick={() => onOpen(!open)} detail={open && <Stack gap="group">{children}</Stack>} />;
}

// An open row's foot: its save state and its delete. children: tools before the save state, such as moves.
export function RowFoot({ noun, words, onRemove, children }: { noun: string; words: string | undefined; onRemove: () => void; children?: ReactNode }) {
  return (
    <Row kind="spread">
      <Row kind="toolbar">
        {children}
        <Text variant="note">{words}</Text>
      </Row>
      <Button variant="danger" size="sm" onClick={onRemove}>
        {`이 ${noun} 삭제`}
      </Button>
    </Row>
  );
}
