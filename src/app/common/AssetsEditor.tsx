import { unsupportedCount } from '../../engine/import/types';
import { ImageUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { findAsset, isVideo, type AssetUse } from '../../engine/assets';
import { extensionOf } from '../../engine/import/convert';
import type { Stored } from '../../model/kinds';
import { addAssets, removeAssets, renameAsset, replaceAsset, restoreAssets } from '../../runtime/library/characters';
import { useAssetUrl, useChildren, useFiles, useStore, useUnfoundAssets } from '../session';
import { SHORTCUTS } from '../shortcuts';
import { useToast } from '../toast';
import { Button, Callout, CardGrid, DropOverlay, Empty, FaceCard, FileButton, MenuItem, MoreMenu, pickFiles, PictureView, Row, Section, Stack, Tabs, useFileDrop, type Pages, type PictureAction } from '../ui';
import { ACTS, addOf } from './acts';
import { clickDownload, fileNamed } from './download';
import { NameDialog } from './NameDialog';
import { useCopy } from './useCopy';
import { useSearch } from './useSearch';
import { useSelection } from './useSelection';
import { ASSET, CHANGE_IMAGE, namedObject, REMOVE_FAILED, SAVE_FAILED } from './words';

// What runtime/library/characters keeps as an asset (engine/import assetType), and as a background (a picture).
const KEEPS = {
  any: { accept: 'image/*,video/mp4,video/webm', refused: '이미지나 영상(MP4, WebM) 파일이 아니거나 용량이 너무 커요.' },
  picture: { accept: 'image/*', refused: '이미지 파일이 아니거나 용량이 너무 커요.' },
};
type Shelf = 'asset' | AssetUse;
// A character's assets and backgrounds, each with what it holds and the tag that shows one, if any.
// hint: under the name field of its rename dialog.
const SHELVES: Record<Shelf, { label: string; keeps: (typeof KEEPS)[keyof typeof KEEPS]; help: string; hint?: string; tag: ((asset: Stored<'asset'>['value']) => string) | null }> = {
  asset: { label: ASSET, keeps: KEEPS.any, help: '봇이 {{img::이름}}이나 {{video::이름}}으로 표시하는 이미지·영상이에요.', hint: '{{img::이름}} 같은 명령어에서 이 이름으로 찾아요.', tag: ({ type, name }) => `{{${isVideo(type) ? 'video' : 'img'}::${name}}}` },
  background: { label: '배경', keeps: KEEPS.picture, help: '채팅 화면 뒤에 깔리는 이미지예요. 여러 개면 이름이 main인 이미지를 써요.', tag: null },
};
const SHELF_ORDER: Shelf[] = ['asset', 'background'];
const useOf = (shelf: Shelf) => (shelf === 'asset' ? undefined : shelf);
// By name, never by the store's order, which moves an asset to the end on each rename or new picture.
const byName = new Intl.Collator('ko', { numeric: true }).compare;
const UNFOUND_SHOWN = 10;

// shelves: a character's, whose backgrounds stand apart from its assets; a module holds assets only.
export function AssetsEditor({ owner, shelves = false }: { owner: string; shelves?: boolean }) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const stored = useChildren('asset', owner);
  const [shelf, setShelf] = useState<Shelf>('asset');
  const use = useOf(shelf);
  const { label, keeps, help, hint, tag } = SHELVES[shelf];
  const onShelf = (each: Shelf) => stored.filter(({ value }) => value.use === useOf(each));
  const assets = useMemo(() => onShelf(shelf).toSorted((a, b) => byName(a.value.name, b.value.name)), [stored, shelf]);
  const [adding, setAdding] = useState(false);
  const [naming, setNaming] = useState<Stored<'asset'> | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const selection = useSelection();
  const { picked } = selection;
  const copy = useCopy();
  // Missing names are keyed by character, never module, regardless of which pack referenced them.
  // A newly resolvable fuzzy match also clears the missing name.
  const asked = useUnfoundAssets(owner);
  const unfound = useMemo(() => {
    if (use) return [];
    const named = assets.map(({ id, value }) => ({ id, name: value.name }));
    return [...asked].filter((name) => !findAsset(named, name, Math.random));
  }, [asked, assets, use]);
  const search = useSearch(assets, `${label} 검색`, ({ value }) => [value.name]);
  const named = (asset: Stored<'asset'>) => asset.value.name.toLowerCase();
  const shared = new Map<string, number>();
  for (const asset of assets) shared.set(named(asset), (shared.get(named(asset)) ?? 0) + 1);

  async function add(picked: File[]) {
    if (!picked.length) return;
    setAdding(true);
    const added = await addAssets(store, files, owner, picked, use);
    setAdding(false);
    if (!added.ok) return toast.failed(added, `${label}을 추가하지 못했어요.`);
    const refused = unsupportedCount(added.data.unsupported);
    if (refused) toast.error(`${refused}개는 추가하지 못했어요.`, { detail: keeps.refused });
  }

  const dragging = useFileDrop((dropped) => void add(dropped), 'screen');

  async function remove(ids: readonly string[]) {
    const removed = await removeAssets(store, ids);
    if (!removed.ok) return toast.failed(removed, REMOVE_FAILED);
    const [only] = removed.data;
    toast.undoable(removed.data.length === 1 ? `${namedObject(only!.value.name, label)} 삭제했어요.` : `${label} ${removed.data.length}개를 삭제했어요.`, () => restoreAssets(store, removed.data));
  }

  async function replace(id: string, file: File) {
    const replaced = await replaceAsset(store, files, id, new Uint8Array(await file.arrayBuffer()));
    if (replaced.ok) return;
    if (replaced.error === 'picture-unreadable' || replaced.error === 'picture-refused') toast.error('바꾸지 못했어요.', { detail: keeps.refused });
    else toast.failed(replaced, '바꾸지 못했어요.');
  }

  function rename(asset: Stored<'asset'>, name: string) {
    setNaming(null);
    toast.settled(renameAsset(store, asset.id, name), SAVE_FAILED);
  }

  const actionsOf = (asset: Stored<'asset'>): PictureAction[] => [
    ...(tag ? [{ icon: ACTS.copy.icon, ...SHORTCUTS.assetTag, run: () => copy(tag(asset.value)) }] : []),
    { icon: ACTS.rename.icon, ...SHORTCUTS.assetRename, run: () => setNaming(asset) },
    { icon: ImageUp, label: isVideo(asset.value.type) ? '영상 바꾸기' : CHANGE_IMAGE, run: () => pickFiles(keeps.accept, false, ([file]) => void replace(asset.id, file!)) },
    { icon: ACTS.remove.icon, ...SHORTCUTS.assetRemove, warn: true, run: () => { setViewing(null); void remove([asset.id]); } },
  ];

  const press = (id: string) => (picked ? selection.toggle(id) : setViewing(id));

  const viewed = viewing === null ? undefined : assets.find(({ id }) => id === viewing);
  // Stepped in the grid's order; an asset the search no longer shows is viewed alone.
  const at = search.found.findIndex(({ id }) => id === viewing);
  const pages = at < 0 ? undefined : { at, count: search.found.length, onStep: (by: -1 | 1) => setViewing(search.found[(at + by + search.found.length) % search.found.length]!.id) };
  return (
    <Section title={ASSET} note={shelves ? undefined : `${stored.length}개`} help={help}>
      <Stack gap="related">
        {shelves && <Tabs label={ASSET} items={SHELF_ORDER.map((value) => ({ value, label: SHELVES[value].label, count: onShelf(value).length }))} value={shelf} onChange={(next) => { selection.clear(); setShelf(next); }} />}
        {unfound.length > 0 && (
          <Callout tone="warn">
            {`채팅에서 찾지 못한 에셋 이름이 ${unfound.length}개 있어요: ${unfound.slice(0, UNFOUND_SHOWN).join(', ')}${unfound.length > UNFOUND_SHOWN ? ` 외 ${unfound.length - UNFOUND_SHOWN}개` : ''}`}
          </Callout>
        )}
        <Row kind="toolbar">
          {search.field}
          {assets.length > 0 && selection.button(ACTS.remove.icon, '선택 삭제')}
          <FileButton accept={keeps.accept} multiple size="sm" icon={ACTS.create.icon} busy={adding} onFiles={(dropped) => void add(dropped)}>
            {addOf(label)}
          </FileButton>
        </Row>
        {search.found.length > 0 ? (
          <CardGrid label={label} variant="face" keys={search.found.map(({ id }) => id)}>
            {(index) => {
              const asset = search.found[index]!;
              return <AssetCard key={asset.id} asset={asset} shared={shared.get(named(asset))!} picked={picked && picked.has(asset.id)} onPress={() => press(asset.id)} actions={actionsOf(asset)} />;
            }}
          </CardGrid>
        ) : (
          <Empty variant="section">{search.none ?? `${label}이 없어요.`}</Empty>
        )}
        {picked &&
          selection.bar(
            { counted: (count) => `${count}개`, ask: `삭제할 ${label}을 선택해 주세요`, every: search.found.map(({ id }) => id) },
            <Button variant="danger" size="sm" disabled={picked.size === 0} onClick={() => { selection.clear(); void remove([...picked]); }}>
              {ACTS.remove.label}
            </Button>,
          )}
      </Stack>
      {dragging && <DropOverlay>{`여기에 놓으면 ${label}으로 추가돼요`}</DropOverlay>}
      {viewed && <AssetPreview asset={viewed} actions={actionsOf(viewed)} pages={pages} onClose={() => setViewing(null)} />}
      {naming && <NameDialog title={`${label} ${ACTS.rename.label}`} value={naming.value.name} hint={hint} onSave={(name) => rename(naming, name)} onClose={() => setNaming(null)} />}
    </Section>
  );
}

const kindOf = ({ value }: Stored<'asset'>) => value.type.slice(value.type.indexOf('/') + 1).toUpperCase();

type CardProps = { asset: Stored<'asset'>; shared: number; picked: boolean | null; onPress: () => void; actions: PictureAction[] };

// Each card holds its own file while drawn, so a grid of thousands keeps only the rows on screen.
function AssetCard({ asset, shared, picked, onPress, actions }: CardProps) {
  const url = useAssetUrl([asset]);
  const { id, value } = asset;
  return (
    <FaceCard
      image={url('asset', id) ?? null}
      video={isVideo(value.type)}
      name={value.name}
      note={shared > 1 ? `같은 이름 ${shared}개` : kindOf(asset)}
      selected={picked}
      onClick={onPress}
      popup={picked === null ? 'dialog' : undefined}
      menu={
        picked === null && (
          <MoreMenu of={`'${value.name}'`}>
            {actions.map(({ icon, label, warn, run }) => (
              <MenuItem key={label} icon={icon} label={label} tone={warn ? 'warn' : undefined} onClick={run} />
            ))}
          </MoreMenu>
        )
      }
    />
  );
}

// Its own view, so the whole file is held only while it is open.
function AssetPreview({ asset, actions, pages, onClose }: { asset: Stored<'asset'>; actions: PictureAction[]; pages: Pages | undefined; onClose: () => void }) {
  const url = useAssetUrl([asset]);
  const src = url('asset', asset.id);
  const { name, type } = asset.value;
  const shown = src ? [{ icon: ACTS.export.icon, ...SHORTCUTS.assetExport, run: () => clickDownload(fileNamed(name, ASSET, extensionOf(type)), src) }, ...actions] : actions;
  return <PictureView src={src} label={name} video={isVideo(type)} title={name} note={kindOf(asset)} actions={shown} pages={pages} onClose={onClose} />;
}
