import type { ReactNode } from 'react';
import type { Mark } from '../../../model/library';
import { ACTS } from '../../common/acts';
import { ListItem, MenuItem, MoreMenu } from '../../ui';
import { timeLeft } from '../shelf';
import type { Binned, CharacterActions } from '../useCharacterActions';
import { PURGE } from '../../common/words';

type Props = {
  item: Binned;
  face?: ReactNode;
  description?: string;
  mark: Mark;
  busy: string | null;
  actions: CharacterActions;
  onPurge: () => void;
};

export function BinnedRow({ item, face, description, mark, busy, actions, onPurge }: Props) {
  return (
    <ListItem
      leading={face}
      title={item.name}
      description={description}
      note={busy ?? timeLeft(mark)}
      trailing={
        busy === null && (
          <MoreMenu of={item.name}>
            <BinnedItems item={item} actions={actions} onPurge={onPurge} />
          </MoreMenu>
        )
      }
    />
  );
}

export function BinnedItems({ item, actions, onPurge }: Pick<Props, 'item' | 'actions' | 'onPurge'>) {
  return (
    <>
      <MenuItem icon={ACTS.restore.icon} label={ACTS.restore.label} onClick={() => actions.restore(item)} />
      <MenuItem icon={ACTS.remove.icon} label={PURGE} tone="warn" onClick={onPurge} />
    </>
  );
}
