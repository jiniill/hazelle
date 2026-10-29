import { draftState } from '../../runtime/tools/drafts';
import { ACTS, importOf, newOf } from '../common/acts';
import { useImport } from '../common/importing';
import { ago } from '../common/time';
import { useSearch } from '../common/useSearch';
import { moduleName, PAGES, TOOL, toolVersion } from '../common/words';
import { useModulesAndPlugins, usePluginDrafts } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Empty, NavBar, Row, Screen, Section, Stack, Table, Tag, type TableColumn, type TableRow } from '../ui';
import { useModuleUse } from './ModulesScreen';
import { DRAFT_STATES, draftHeader } from './studio';
import { StudioPlaces } from './StudioPlaces';

const COLUMNS: TableColumn[] = [
  { label: PAGES.plugins, track: 'name' },
  { label: '버전', track: 'fill' },
  { label: '사용처', track: 'fill', keep: true },
];

const DRAFT_COLUMNS: TableColumn[] = [
  { label: PAGES.plugins, track: 'name' },
  { label: '수정', track: 'fill' },
  { label: '상태', track: 'fill', keep: true },
];

// Drafts stand above the installed plugins; with none, the studio's cards are the way in.
function Drafts() {
  const drafts = usePluginDrafts();
  const rows: TableRow[] = drafts.map(({ id, value }) => {
    const state = draftState(value);
    const edited = `${ago(value.at)} 수정`;
    return {
      key: id,
      cells: [draftHeader(value.text).title, edited, state === 'applied' ? null : <Tag tone={state === 'differs' ? 'accent' : 'faint'}>{DRAFT_STATES[state]}</Tag>],
      summary: edited,
      onClick: () => navigate({ kind: 'plugin-draft', id }),
    };
  });
  return (
    <Section title="만드는 중" note={rows.length > 0 ? `${rows.length}개` : undefined} help={`적용하기 전까지는 채팅에서 작동하지 않아요. 헤이젤에서 만든 ${TOOL}은 RisuAI에서 쓸 수 없어요.`}>
      {rows.length > 0 ? <Table label="만드는 중" columns={DRAFT_COLUMNS} rows={rows} /> : <StudioPlaces onPick={(place) => navigate({ kind: 'plugin-new', place })} />}
    </Section>
  );
}

export function PluginsScreen({ back }: { back: Back | null }) {
  const { pick } = useImport();
  const { plugins } = useModulesAndPlugins();
  const use = useModuleUse();
  const search = useSearch(plugins, '플러그인 검색', ({ module }) => [moduleName(module.value.name)]);
  const importing = (
    <Button variant="secondary" icon={ACTS.import.icon} onClick={pick}>
      {importOf(PAGES.plugins)}
    </Button>
  );
  const head = (
    <>
      {importing}
      <Button variant="secondary" icon={ACTS.create.icon} onClick={() => navigate({ kind: 'plugin-new', place: null })}>
        {newOf(TOOL)}
      </Button>
    </>
  );
  const rows: TableRow[] = search.found.map(({ module: { id, value }, manifest }) => ({
      key: id,
      cells: [
        <>
          {moduleName(value.name)}
          {manifest.risu && ' '}
          {manifest.risu && <Tag>Risu</Tag>}
        </>,
        toolVersion(manifest.version),
        use.cell(id),
      ],
      summary: toolVersion(manifest.version),
      onClick: () => navigate({ kind: 'plugin', id }),
  }));
  return (
    <Screen width="page" top={<NavBar title={PAGES.plugins} {...backBar(back)} actions={head} />}>
      <Stack gap="section">
        <Drafts />
        <Stack gap="group">
          {search.field && <Row kind="toolbar">{search.field}</Row>}
          {search.none !== null ? (
            <Empty>{search.none}</Empty>
          ) : rows.length > 0 ? (
            <Table label={PAGES.plugins} columns={COLUMNS} rows={rows} />
          ) : (
            <Empty action={importing}>플러그인이 없어요.</Empty>
          )}
        </Stack>
      </Stack>
    </Screen>
  );
}
