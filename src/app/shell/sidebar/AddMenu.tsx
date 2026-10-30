import { MessageSquarePlus, PackageOpen, UserRoundPlus } from 'lucide-react';
import type { ComponentProps } from 'react';
import { ACTS, importOf, newOf } from '../../common/acts';
import { useImport } from '../../common/importing';
import { NO_CHARACTER } from '../../common/words';
import { useNewCharacter } from '../../library/useCharacterActions';
import { Menu, MenuItem } from '../../ui';
import { navigate } from '../router';

export function AddMenu({ trigger }: Pick<ComponentProps<typeof Menu>, 'trigger'>) {
  const { pick, move } = useImport();
  const create = useNewCharacter();
  return (
    <Menu label={ACTS.create.label} trigger={trigger}>
      <MenuItem icon={ACTS.import.icon} label={importOf('봇')} onClick={pick} />
      <MenuItem icon={UserRoundPlus} label={newOf('캐릭터')} onClick={create} />
      <MenuItem icon={PackageOpen} label="Risu에서 이사" onClick={move} />
      <MenuItem icon={MessageSquarePlus} label={`${NO_CHARACTER} 새 채팅`} onClick={() => navigate({ kind: 'new-chat', character: null })} />
    </Menu>
  );
}
