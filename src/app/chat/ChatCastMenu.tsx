import { toggle } from '../../connectors/values';
import { CAST_MAX } from '../../model/chat';
import { characterTexts } from '../../model/library';
import { aliased } from '../common/alias';
import { useSearch } from '../common/useSearch';
import { CAST } from '../common/words';
import { useLibrary } from '../session';
import { Avatar, Empty, Menu, MenuHeading, MenuItem, type MenuHandle } from '../ui';
type Choices = { cast: string[]; character: string | null; onChange: (ids: string[]) => void };

// No button of its own: it opens from the header's ⋯ (ChatHeaderActions).
export function ChatCastMenu({ handle, ...choices }: Choices & { handle: MenuHandle }) {
  return (
    <Menu
      handle={handle}
      place="below-end"
      size="lg"
      label={CAST}
      trigger={() => null}
    >
      <CastChoices {...choices} />
    </Menu>
  );
}

// Mounted only while the menu is open, so each opening starts with an empty search.
function CastChoices({ cast, character, onChange }: Choices) {
  const { characters } = useLibrary();
  const offered = characters.filter(({ id }) => id !== character);
  const { field, found, none } = useSearch(offered, '캐릭터 검색', ({ character }) => characterTexts(character));
  const gone = cast.filter((id) => !offered.some((each) => each.id === id));
  const full = cast.length >= CAST_MAX;
  const flip = (id: string) => onChange(toggle(cast, id));
  return (
    <>
      {field}
      {full && <MenuHeading>{`최대 ${CAST_MAX}명`}</MenuHeading>}
      {found.length === 0 && <Empty variant="menu">{none ?? '선택할 수 있는 다른 캐릭터가 없어요.'}</Empty>}
      {found.map(({ id, character, face }) => (
        <MenuItem
          key={id}
          label={aliased(character.card.name, character.alias)}
          avatar={<Avatar face={character.card.name} image={face} />}
          checked={cast.includes(id)}
          multiple
          disabled={full && !cast.includes(id)}
          onClick={() => flip(id)}
        />
      ))}
      {gone.map((id) => (
        <MenuItem key={id} label="삭제된 캐릭터" tone="muted" checked multiple onClick={() => flip(id)} />
      ))}
    </>
  );
}
