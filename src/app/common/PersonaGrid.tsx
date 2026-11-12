import { useMemo } from 'react';
import type { Stored } from '../../model/kinds';
import { usePersonas } from '../session';
import { CardGrid, Empty, FaceCard } from '../ui';
import { personaFaces, personaTexts, type PersonaFace } from './alias';
import { placeIn, useFolderIndex, whereIs } from './folders/filing';
import { FolderPath, FolderTile, type Drop, type Naming } from './folders/FolderParts';
import { useSearch, type SearchOptions } from './useSearch';
import { EMPTY_FOLDER, searchOf, THINGS } from './words';

const folderOf = ({ persona }: PersonaFace) => persona.value.folder ?? null;

// The personas as faces in their folders, which both the persona list and the pickers walk. search: its field goes
// where the caller puts it.
export function usePersonaPlaces(options?: SearchOptions<PersonaFace>) {
  const personas = usePersonas();
  const faces = useMemo(() => personaFaces(personas), [personas]);
  const index = useFolderIndex('persona', faces, folderOf);
  const search = useSearch(faces, searchOf(THINGS.persona.noun), personaTexts, options);
  return { index, search, byId: (id: string) => personas.find((persona) => persona.id === id) };
}

type Props = {
  places: ReturnType<typeof usePersonaPlaces>;
  place: string | null;
  onGo: (place: string | null) => void;
  onOpen: (persona: Stored<'persona'>) => void;
  current?: string;
  tagOf?: (id: string) => string | undefined;
  // Where folders are made and things moved: the persona list, not a picker.
  manage?: { onName: (naming: Naming) => void; dropInto?: Drop; picked: ReadonlySet<string> | null; onPick: (id: string) => void };
};

export function PersonaGrid({ places: { index, search }, place, onGo, onOpen, current, tagOf, manage }: Props) {
  const at = placeIn(index, place, search.words !== '');
  const shown = at.placed(search.found);
  const keys = [...at.folders.map(({ id }) => id), ...shown.map(({ persona }) => persona.id)];
  return (
    <>
      {(manage || index.folders.length > 0) && <FolderPath kind="persona" path={at.path} onGo={onGo} onName={manage?.onName} dropInto={manage?.dropInto} />}
      {search.none && <Empty>{search.none}</Empty>}
      {!search.words && keys.length === 0 && at.here && <Empty>{EMPTY_FOLDER}</Empty>}
      <CardGrid label="페르소나" variant="face" current={current} keys={keys}>
        {(position) => {
          if (position < at.folders.length) {
            const contents = index.byFolder.get(at.folders[position]!.id)!;
            const faces = contents.inside.slice(0, 4).map(({ persona: { value } }) => ({ image: value.picture, name: value.name }));
            return <FolderTile kind="persona" contents={contents} depth={at.path.length + 1} faces={faces} onOpen={() => onGo(contents.folder.id)} onName={manage?.onName} dropInto={manage?.dropInto} />;
          }
          const { persona, note, faint } = shown[position - at.folders.length]!;
          const where = search.words ? whereIs(index, folderOf({ persona, note, faint })) : undefined;
          const picked = manage?.picked ?? null;
          return (
            <FaceCard
              image={persona.value.picture}
              name={persona.value.name}
              note={where ? [where, note].filter(Boolean).join(' · ') : note}
              faint={faint && !where}
              selected={picked && picked.has(persona.id)}
              current={persona.id === current}
              tag={tagOf?.(persona.id)}
              drag={manage?.dropInto && persona.id}
              onClick={() => (picked ? manage!.onPick(persona.id) : onOpen(persona))}
            />
          );
        }}
      </CardGrid>
    </>
  );
}
