import { Check } from 'lucide-react';
import { useMemo } from 'react';
import type { Stored } from '../../model/kinds';
import { createModule, type ModulePlace } from '../../runtime/modules';
import { ofSort } from '../../runtime/prompts';
import { ACTS, importOf, newOf } from '../common/acts';
import { useImport } from '../common/importing';
import { counted, holdsLine, packParts, type PackParts } from '../common/pack';
import { useSearch } from '../common/useSearch';
import { folderNote, placeIn, useFolderIndex, whereIs } from '../common/folders/filing';
import { FolderPath, useMoving, useNaming } from '../common/folders/FolderParts';
import { useFolderActions } from '../common/folders/useFolderActions';
import { ALWAYS, EMPTY_FOLDER, moduleName, PAGES, SCRIPTS } from '../common/words';
import { useChildrenOf, useLibrary, useModulesAndPlugins, usePersonas, usePrompts, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Empty, Icon, NavBar, Row, Screen, Section, Table, Tag, type TableColumn, type TableRow } from '../ui';

// The table's columns and each module's contents line both come from these parts, so the two always agree.
export function useModuleParts(modules: readonly Stored<'module'>[]): PackParts[] {
  const ids = modules.map(({ id }) => id);
  const lore = useChildrenOf('lore', ids);
  const assets = useChildrenOf('asset', ids);
  return modules.map(({ value }, index) => packParts(value, lore[index]!.length, assets[index]!.length));
}

export function useModuleOwners() {
  const prompts = usePrompts();
  const { characters } = useLibrary();
  const personas = usePersonas();
  const settings = useSettings();
  return useMemo(() => ({ always: settings.modules ?? [], prompts: prompts.filter((prompt) => ofSort(prompt, 'conversation')), characters, personas }), [settings, prompts, characters, personas]);
}

type Place = ModulePlace['kind'] | 'none';
type Use = { always: boolean; prompt: number; character: number; persona: number };
const UNUSED: Use = { always: false, prompt: 0, character: 0, persona: 0 };

export function useModuleUse() {
  const owners = useModuleOwners();
  const uses = useMemo(() => {
    const map = new Map<string, Use>();
    const of = (id: string) => map.get(id) ?? map.set(id, { ...UNUSED }).get(id)!;
    for (const id of owners.always) of(id).always = true;
    for (const { value } of owners.prompts) for (const id of value.modules ?? []) of(id).prompt++;
    for (const { character } of owners.characters) for (const id of character.modules ?? []) of(id).character++;
    for (const { value } of owners.personas) for (const id of value.modules ?? []) of(id).persona++;
    return map;
  }, [owners]);
  const use = (id: string) => uses.get(id) ?? UNUSED;
  const place = (id: string): Place => {
    const on = use(id);
    return on.always ? 'always' : on.prompt > 0 ? 'prompt' : on.character > 0 ? 'character' : on.persona > 0 ? 'persona' : 'none';
  };
  const cell = (id: string) => {
    const on = use(id);
    const used = counted([['프롬프트', on.prompt], ['캐릭터', on.character], ['페르소나', on.persona]]).join(' · ');
    return (
      <>
        {on.always && <Tag>{ALWAYS}</Tag>}
        {on.always && used && ' '}
        {used}
      </>
    );
  };
  return { place, cell };
}

const COLUMNS: TableColumn[] = [
  { label: PAGES.modules, track: 'name' },
  { label: '로어북', track: 'figure' },
  { label: SCRIPTS.regex, track: 'figure' },
  { label: SCRIPTS.triggers, track: 'figure' },
  { label: '토글', track: 'figure' },
  { label: '스타일', track: 'figure' },
  { label: '사용처', track: 'fill', keep: true },
];
const FOLDER_COLUMNS: TableColumn[] = [
  { label: '폴더', track: 'name' },
  { label: '포함된 항목', track: 'fill', keep: true },
];

// A module stands in the first place it is on, in the order packs apply (항상, prompt, character, persona); its 쓰는 곳
// still names every place.
const SECTIONS: { place: Place; title: string }[] = [
  { place: 'always', title: `${ALWAYS} 켠 모듈` },
  { place: 'prompt', title: '프롬프트 모듈' },
  { place: 'character', title: '캐릭터 모듈' },
  { place: 'persona', title: '페르소나 모듈' },
  { place: 'none', title: '사용 안 함' },
];

const figure = (count: number) => (count > 0 ? count : null);
const folderOf = ({ value }: Stored<'module'>) => value.folder ?? null;
const go = (place: string | null) => navigate({ kind: 'modules', place });

// place: the folder it stands in.
export function ModulesScreen({ place, back }: { place: string | null; back: Back | null }) {
  const store = useStore();
  const toast = useToast();
  const { pick } = useImport();
  const { modules } = useModulesAndPlugins();
  const use = useModuleUse();
  const search = useSearch(modules, '모듈 검색', ({ value }) => [moduleName(value.name)]);
  const index = useFolderIndex('module', modules, folderOf);
  const at = placeIn(index, place, search.words !== '');
  const folderActions = useFolderActions('module');
  const naming = useNaming(folderActions);
  const moving = useMoving('module', index, (id) => modules.find((module) => module.id === id)?.value.folder ?? null);
  const shown = at.placed(search.found);
  const parts = useModuleParts(shown);
  function add() {
    const id = crypto.randomUUID();
    void createModule(store, newOf('모듈'), id, at.here?.folder.id ?? null).then((saved) => saved.ok || toast.failed(saved, '모듈을 만들지 못했어요.'));
    navigate({ kind: 'module', id, pane: null });
  }
  const adding = (
    <Button variant="secondary" icon={ACTS.create.icon} onClick={add}>
      {newOf('모듈')}
    </Button>
  );
  const actions = (
    <>
      <Button variant="secondary" icon={ACTS.import.icon} onClick={pick}>
        {importOf('모듈')}
      </Button>
      {adding}
    </>
  );
  const folderRows: TableRow[] = at.folders.map((folder) => ({
    key: folder.id,
    folder: true,
    cells: [folder.value.name, folderNote('module', index.byFolder.get(folder.id)!)],
    onDropCard: moving.dropInto?.(folder.id),
    onClick: () => go(folder.id),
  }));
  const rows: TableRow[] = shown.map((module, position) => {
    const { id, value } = module;
    const { lore, regex, triggers, toggles, style } = parts[position]!;
    const path = search.words ? whereIs(index, folderOf(module)) : undefined;
    return {
      key: id,
      selected: moving.picked ? moving.picked.has(id) : undefined,
      drag: moving.dropInto && id,
      cells: [
        moduleName(value.name),
        figure(lore),
        figure(regex),
        figure(triggers),
        figure(toggles),
        style ? <Icon icon={Check} size="sm" /> : null,
        use.cell(id),
      ],
      summary: [path, holdsLine(parts[position]!)].filter(Boolean).join(' · '),
      onClick: () => (moving.picked ? moving.toggle(id) : navigate({ kind: 'module', id, pane: null })),
    };
  });
  const sections = SECTIONS.map(({ place, title }) => ({ title, rows: rows.filter(({ key }) => use.place(key) === place) })).filter(({ rows }) => rows.length > 0);
  return (
    <Screen width="page" top={<NavBar title={PAGES.modules} {...backBar(back)} actions={actions} />}>
      {search.field && <Row kind="toolbar">{search.field}</Row>}
      {modules.length + index.folders.length > 0 && (
        <FolderPath kind="module" path={at.path} onGo={go} onName={naming.name} dropInto={moving.dropInto}>
          {moving.button}
        </FolderPath>
      )}
      {search.none !== null ? (
        <Empty>{search.none}</Empty>
      ) : folderRows.length + rows.length > 0 ? (
        <>
          {folderRows.length > 0 && <Table label="폴더" columns={FOLDER_COLUMNS} rows={folderRows} />}
          {sections.map(({ title, rows }) => (
            <Section key={title} title={title} note={`${rows.length}개`}>
              <Table label={title} columns={COLUMNS} rows={rows} />
            </Section>
          ))}
        </>
      ) : at.here ? (
        <Empty>{EMPTY_FOLDER}</Empty>
      ) : (
        <Empty action={adding}>모듈이 없어요.</Empty>
      )}
      {moving.bar}
      {naming.dialog}
    </Screen>
  );
}
