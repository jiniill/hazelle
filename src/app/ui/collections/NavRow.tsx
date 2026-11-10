import type { LucideIcon } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import { Item } from './Item';

type Props = { icon: LucideIcon; label: string; note?: string; current?: boolean; onClick: () => void };

export function NavRow({ icon, label, note, current, onClick }: Props) {
  return <Item density="compact" scheme="side" leading={<Icon icon={icon} size="sm" />} title={label} meta={note} current={current} onClick={onClick} />;
}
