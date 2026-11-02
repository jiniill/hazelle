import { addPersona } from '../../runtime/personas';
import { ACTS, importOf, newOf } from '../common/acts';
import { useMoving, useNaming } from '../common/folders/FolderParts';
import { useFolderActions } from '../common/folders/useFolderActions';
import { useImport } from '../common/importing';
import { PersonaGrid, usePersonaPlaces } from '../common/PersonaGrid';
import { PAGES } from '../common/words';
import { useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, NavBar, Row, Screen } from '../ui';

const go = (place: string | null) => navigate({ kind: 'personas', place });

// Picking here opens a persona to edit; it changes no chat and not the current persona. place: the folder it stands in.
export function PersonaList({ place, back }: { place: string | null; back: Back | null }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const places = usePersonaPlaces();
  const folderActions = useFolderActions('persona');
  const naming = useNaming(folderActions);
  const moving = useMoving('persona', places.index, (id) => places.byId(id)?.value.folder ?? null);
  const { pickPersonas } = useImport();
  const here = place !== null && places.index.byFolder.has(place) ? place : null;

  function add() {
    const id = crypto.randomUUID();
    toast.settled(addPersona(store, { name: '새 페르소나', description: '', picture: null, ...(here !== null && { folder: here }) }, id), '페르소나를 만들지 못했어요.');
    navigate({ kind: 'persona', id });
  }

  const actions = (
    <>
      <Button variant="secondary" icon={ACTS.import.icon} onClick={pickPersonas}>
        {importOf('페르소나')}
      </Button>
      <Button variant="secondary" icon={ACTS.create.icon} onClick={add}>
        {newOf('페르소나')}
      </Button>
    </>
  );
  return (
    <Screen width="page" top={<NavBar title={PAGES.personas} actions={actions} {...backBar(back)} />}>
      <Row kind="toolbar">
        {places.search.field}
        {moving.button}
      </Row>
      <PersonaGrid
        places={places}
        place={place}
        onGo={go}
        onOpen={({ id }) => navigate({ kind: 'persona', id })}
        tagOf={(id) => (settings.persona === id ? '현재' : undefined)}
        manage={{ onName: naming.name, dropInto: moving.dropInto, picked: moving.picked, onPick: moving.toggle }}
      />
      {moving.bar}
      {naming.dialog}
    </Screen>
  );
}
