import type { LucideIcon } from 'lucide-react';
import { ErrorMark, Icon } from '../foundation/Icon';
import { Item } from './Item';

// error: why the place cannot run now, a mark before its note.
type Props = { icon: LucideIcon; label: string; note?: string; error?: string; current?: boolean; onClick: () => void };

export function NavRow({ icon, label, note, error, current, onClick }: Props) {
  const meta = error ? (
    <>
      <ErrorMark why={error} />
      {note}
    </>
  ) : (
    note
  );
  return <Item density="compact" scheme="side" leading={<Icon icon={icon} size="sm" />} title={label} meta={meta} current={current} onClick={onClick} />;
}
