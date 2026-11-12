import { Link, PackageOpen, UserRoundPlus } from 'lucide-react';
import type { ComponentProps } from 'react';
import { ACTS, importOf, newOf } from '../../common/acts';
import { useImport } from '../../common/importing';
import { NO_CHARACTER, LINK_IMPORT, MOVE_IN } from '../../common/words';
import { useNewCharacter } from '../../library/useCharacterActions';
import { Menu, MenuItem } from '../../ui';
import { navigate } from '../router';

export function AddMenu({ trigger }: Pick<ComponentProps<typeof Menu>, 'trigger'>) {
  const { pick, pickLink, move } = useImport();
  const create = useNewCharacter();
  return (
    <Menu label={ACTS.create.label} trigger={trigger}>
      <MenuItem icon={ACTS.import.icon} label={importOf('봇')} onClick={pick} />
      <MenuItem icon={Link} label={LINK_IMPORT} onClick={() => pickLink('')} />
      <MenuItem icon={UserRoundPlus} label={newOf('캐릭터')} onClick={create} />
      <MenuItem icon={PackageOpen} label={MOVE_IN} onClick={move} />
      <MenuItem icon={ACTS.newChat.icon} label={`${NO_CHARACTER} ${ACTS.newChat.label}`} onClick={() => navigate({ kind: 'new-chat', character: null })} />
    </Menu>
  );
}
