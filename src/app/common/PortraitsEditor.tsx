import { useRef, useState } from 'react';
import { readPortraitFile, writePortraitFile } from '../../engine/likeness';
import { likenessId, PORTRAITS_MOST, type Portrait, type PortraitSource } from '../../model/likeness';
import { addPortrait, editPortrait, importPortraits, removeLikeness, removePortrait, restoreLikeness } from '../../runtime/likeness';
import { useLikenessRuns, useLikenesses, useSaves, useStore, useStored } from '../session';
import { useToast } from '../toast';
import { Button, Callout, Empty, FileButton, IconButton, MarkupArea, MenuItem, MoreMenu, PhraseField, Row, Section, Stack, TextField } from '../ui';
import { ACTS, addOf } from './acts';
import { download, fileNamed } from './download';
import { EntryList } from './EntryList';
import { describeLikenessFailure } from './failure';
import { filled, typedText } from './typed';
import { useAutosave } from './useAutosave';
import { portraitName } from './words';

const SOURCES: Record<PortraitSource, string> = { metadata: '이미지 정보에서', vision: '이미지를 보고', text: '설명에서', user: '직접 입력' };

// By place, so a rename keeps its field; a portrait's place moves only by this screen's add and remove, and 다시
// 만들기, which flush the edits first.
const saveKey = (owner: string, index: number) => `likeness:${owner}:${index}`;

// Edits/additions make portraits user-owned, so regeneration must keep them (design §6.6).
export function PortraitsEditor({ owner }: { owner: string }) {
  const store = useStore();
  const saves = useSaves();
  const toast = useToast();
  const stored = useStored('likeness', likenessId(owner));
  const run = useLikenessRuns().get(owner);
  const likenesses = useLikenesses();
  const building = run?.stage === 'building';
  const portraits = stored?.value.portraits ?? [];
  const settle = () => Promise.all(portraits.map((_, index) => saves.flush(saveKey(owner, index))));

  async function rebuild() {
    await settle();
    const before = await likenesses.rebuild(owner);
    if (before) toast.undoable('삽화 프로필을 새로 만들었어요.', () => restoreLikeness(store, before));
  }

  async function add() {
    await settle();
    const added = await addPortrait(store, owner);
    if (!added.ok) toast.failed(added, '추가하지 못했어요.');
  }

  async function removeAll() {
    await settle();
    const removed = await removeLikeness(store, owner);
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable('삽화 프로필을 삭제했어요.', () => restoreLikeness(store, removed.data));
  }

  async function exportFile() {
    await settle();
    const name = store.get('character', owner)?.value.card.name ?? store.get('module', owner)?.value.name ?? store.get('persona', owner)?.value.name ?? '';
    const flushed = store.get('likeness', likenessId(owner))?.value.portraits ?? [];
    download(fileNamed(`${name} 삽화 프로필`, '삽화 프로필', 'json'), new Blob([writePortraitFile(flushed)], { type: 'application/json' }));
  }

  async function importFile(file: File) {
    const read = readPortraitFile(await file.text());
    if (!read.ok) return toast.error(read.reason === 'portrait' ? `${read.index + 1}번째 인물의 형식이 맞지 않아요.` : '삽화 프로필 파일이 아니에요.');
    await settle();
    const imported = await importPortraits(store, owner, read.portraits);
    if (!imported.ok) return 'count' in imported ? toast.error(`인물이 ${PORTRAITS_MOST}명을 넘어요.`, { detail: `가져오면 ${imported.count}명이 돼요.` }) : toast.failed(imported, '가져오지 못했어요.');
    const { before, replaced } = imported.data;
    toast.undoable(`인물 ${read.portraits.length}명을 가져왔어요.`, () => (before ? restoreLikeness(store, before) : removeLikeness(store, owner)), replaced ? `이름이 같은 ${replaced}명은 바꿨어요.` : undefined);
  }

  async function remove(index: number, name: string) {
    await settle();
    const removed = await removePortrait(store, owner, { index, name });
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable(`'${portraitName(name)}' 프로필을 삭제했어요.`, () => restoreLikeness(store, removed.data));
  }

  return (
    <Stack gap="section">
      <Section
        title="삽화 프로필"
        note={building ? '만드는 중…' : undefined}
        help="삽화에서 인물을 같은 모습으로 그릴 때 쓰는 태그예요. 직접 수정하거나 추가한 프로필은 다시 만들어도 남아요."
        action={
          <>
            <Button variant="link" disabled={building} onClick={() => void rebuild()}>
              {stored ? '다시 만들기' : '지금 만들기'}
            </Button>
            {stored && !building && (
              <MoreMenu of="삽화 프로필">
                <MenuItem icon={ACTS.remove.icon} label={`모두 ${ACTS.remove.label}`} sub="다음에 삽화를 그릴 때 새로 만들어져요" tone="warn" onClick={() => void removeAll()} />
              </MoreMenu>
            )}
          </>
        }
      >
        {run?.stage === 'failed' && <Callout tone="warn">{`프로필을 만들지 못했어요. ${describeLikenessFailure(run.failure)}`}</Callout>}
        {!stored ? <Empty variant="section">프로필이 없어요.</Empty> : portraits.length === 0 && <Empty variant="section">삽화에 넣을 인물이 없어요.</Empty>}
      </Section>
      {portraits.map((portrait, index) => (
        <PortraitFields key={index} owner={owner} index={index} portrait={portrait} onRemove={building ? undefined : () => void remove(index, portrait.name)} />
      ))}
      {!building && (
        <Row kind="actions">
          {/* Not before the first build: a pack holding a likeness gets none built by the next 삽화. */}
          {stored && portraits.length < PORTRAITS_MOST && (
            <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={() => void add()}>
              {addOf('인물')}
            </Button>
          )}
          <FileButton accept=".json,application/json" size="sm" icon={ACTS.import.icon} onFiles={([file]) => void importFile(file!)}>
            {ACTS.import.label}
          </FileButton>
          {portraits.length > 0 && (
            <Button variant="secondary" size="sm" icon={ACTS.export.icon} onClick={() => void exportFile()}>
              {ACTS.export.label}
            </Button>
          )}
        </Row>
      )}
    </Stack>
  );
}

type Fields = Omit<Portrait, 'source'>;

function PortraitFields({ owner, index, portrait, onRemove }: { owner: string; index: number; portrait: Portrait; onRemove: (() => void) | undefined }) {
  const store = useStore();
  // The name the store holds, which finds the portrait: a rename saved moves it before the next render shows it.
  const named = useRef(portrait.name);
  named.current = portrait.name;
  const save = useAutosave<Fields>(saveKey(owner, index), async (patch) => {
    const saved = await editPortrait(store, owner, { index, name: named.current }, patch);
    if (!saved.ok) return saved;
    if (patch.name !== undefined) named.current = patch.name;
    return { ok: true };
  });
  const shown = <K extends keyof Fields>(key: K): Fields[K] => save.unsaved[key] ?? portrait[key];
  const [typed, setTyped] = useState<string>();
  const name = typedText(typed, filled, shown('name'), String);
  const outfits = shown('outfits');
  const label = portraitName(portrait.name);
  const tags = (title: string, value: string, change: (tags: string) => void) => (
    <MarkupArea label={`${label} ${title}`} variant="field" kind="tags" value={value} onChange={change} />
  );
  return (
    <Section
      title={label}
      note={SOURCES[portrait.source]}
      action={onRemove && <IconButton icon={ACTS.remove.icon} label={`${label} ${ACTS.remove.label}`} size="sm" onClick={onRemove} />}
    >
      <Stack gap="related">
        <TextField
          label="이름"
          value={name}
          onChange={(next) => {
            setTyped(next);
            save.change({ name: next }, next.trim() !== '');
          }}
          error={name.trim() ? undefined : '이름을 적어 주세요.'}
        />
        <Section title="별명" level={3} help="이야기에서 이 이름으로 불려도 같은 모습으로 그려요.">
          <PhraseField label={`${label} 별명`} phrases={shown('aliases')} onChange={(aliases) => save.change({ aliases })} />
        </Section>
        <Section title="외모" level={3}>
          {tags('외모', shown('look'), (look) => save.change({ look }))}
        </Section>
        <EntryList
          entries={outfits}
          onChange={(next) => save.change({ outfits: next })}
          name={(at) => outfits[at]!.name || '옷'}
          blank={{ name: '', tags: '' }}
          addLabel={addOf('옷')}
          removed={(at) => `${at + 1}번째 옷을 삭제했어요.`}
        >
          {({ value: outfit, index: at, set, remove }) => (
            <Section
              title={at === 0 ? '옷 (기본)' : '옷'}
              level={3}
              help={at === 0 ? '이야기에서 다른 옷을 입지 않으면 이 옷으로 그려요.' : undefined}
              action={remove}
            >
              <Stack gap="related">
                <TextField label="옷 이름" showLabel={false} placeholder="옷 이름" value={outfit.name} onChange={(next) => set({ ...outfit, name: next })} />
                {tags(`옷 ${outfit.name}`, outfit.tags, (next) => set({ ...outfit, tags: next }))}
              </Stack>
            </Section>
          )}
        </EntryList>
        <Section title="작가" level={3}>
          {tags('작가', shown('artist'), (artist) => save.change({ artist }))}
        </Section>
      </Stack>
    </Section>
  );
}
