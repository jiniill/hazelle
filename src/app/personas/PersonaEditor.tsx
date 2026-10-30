import { useMemo, useState } from 'react';
import type { ApiFailure } from '../../runtime/api';
import type { Stored } from '../../model/kinds';
import type { Persona } from '../../model/persona';
import { chatsHolding, copyPersona, editPersona, rebindChats, removePersona, restorePersona, setCurrentPersona } from '../../runtime/personas';
import { thumbnail } from '../../runtime/picture';
import { useChats, useLibrary, useSettings, useStore } from '../session';
import { ACTS } from '../common/acts';
import { aliased } from '../common/alias';
import { CountedField } from '../common/CountedFields';
import { FaceChange } from '../common/FaceChange';
import { framePage } from '../common/frame';
import { ModuleSwitches } from '../common/ModuleSwitches';
import { PersonaPickDialog } from '../common/PersonaPickDialog';
import { PortraitsEditor } from '../common/PortraitsEditor';
import { useAutosave } from '../common/useAutosave';
import { useIdentityFields } from '../common/useIdentityFields';
import { BIN_KEEPS, cannotRemove, copyName } from '../common/words';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Avatar, Facts, MenuItem } from '../ui';
import { PersonaExport } from './PersonaExport';

// A caller leaves by unmounting it, which saves.
export function PersonaEditor({ stored, back }: { stored: Stored<'persona'>; back: Back }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const library = useLibrary();
  const { id } = stored;
  const autosave = useAutosave<Persona>(`persona:${id}`, (patch) => editPersona(store, id, patch));
  const [exporting, setExporting] = useState(false);
  const [moving, setMoving] = useState(false);
  const chats = useChats();
  const holding = useMemo(() => chatsHolding(store, id).length, [store, id, chats]);
  const held = { ...stored.value, ...autosave.unsaved };
  const identity = useIdentityFields({ name: held.name, alias: held.alias ?? '', nameHelp: '채팅에서 {{user}}가 이 이름으로 바뀌어요.', aliasExample: '부자 스티브', onChange: autosave.change });
  const persona = { ...held, name: identity.name };

  async function picture(file: File): Promise<{ ok: true } | ApiFailure> {
    const made = await thumbnail({ bytes: new Uint8Array(await file.arrayBuffer()), type: file.type }).catch(() => null);
    if (made === null) return { ok: false, error: 'picture-unreadable' };
    // The queue tells its own failure.
    await autosave.save({ picture: made });
    return { ok: true };
  }

  async function remove() {
    const removed = await autosave.remove(() => removePersona(store, id));
    if (!removed) return;
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    navigate({ kind: 'personas', place: null });
    toast.undoable(`'${removed.data.value.name}' 페르소나를 삭제했어요.`, () => restorePersona(store, id), BIN_KEEPS);
  }

  async function copy() {
    if (!(await autosave.flush())) return;
    const made = crypto.randomUUID();
    const copying = copyPersona(store, id, copyName(held.name), made);
    navigate({ kind: 'persona', id: made });
    const copied = await copying;
    if (!copied.ok) return toast.failed(copied, '사본을 만들지 못했어요.');
    toast.show('사본을 만들었어요.');
  }

  const makeCurrent = () => void setCurrentPersona(store, id).then((saved) => saved.ok || toast.failed(saved, '현재 페르소나로 지정하지 못했어요.'));

  function moveChats(to: string) {
    setMoving(false);
    const target = store.get('persona', to)?.value;
    if (to === id || !target) return;
    const ids = chatsHolding(store, id);
    void rebindChats(store, ids, to).then((saved) => {
      if (!saved.ok) return toast.failed(saved, '채팅을 옮기지 못했어요.');
      toast.undoable(`채팅 ${ids.length}개를 '${aliased(target.name, target.alias)}' 페르소나로 옮겼어요.`, () => rebindChats(store, ids, id));
    });
  }

  const current = settings.persona === id;
  const pinnedBy = library.characters.filter(({ character }) => character.persona === id).map(({ character }) => character.card.name);
  const facts = [
    ...(current ? [{ label: '사용처', value: '현재 페르소나' }] : []),
    ...(pinnedBy.length ? [{ label: '고정', value: pinnedBy.join(', ') }] : []),
  ];
  const body = (
    <>
      <FaceChange face={<Avatar face={persona.name} image={persona.picture} size="lg" tone="you" />} apply={picture} />
      {facts.length > 0 && <Facts items={facts} />}
      {identity.fields}
      <CountedField label="설명" lines={8} value={persona.description} onChange={(description) => autosave.change({ description })} />
      <ModuleSwitches owner={{ kind: 'persona', id }} own={stored.value.modules ?? []} />
      <PortraitsEditor owner={id} />
    </>
  );
  const menu = {
    of: '페르소나',
    items: (
      <>
        <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} onClick={() => void copy()} />
        <MenuItem icon={ACTS.export.icon} label={ACTS.export.label} onClick={() => setExporting(true)} />
        {!current && <MenuItem label="현재 페르소나로 지정" sub="새 채팅을 시작할 때 이 페르소나를 써요" onClick={makeCurrent} />}
        {holding > 0 && <MenuItem label="채팅 옮기기" sub={`이 페르소나를 쓰는 채팅 ${holding}개를 다른 페르소나로 옮겨요`} onClick={() => setMoving(true)} />}
        <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} sub={current ? cannotRemove('현재 페르소나') : undefined} tone="warn" disabled={current} onClick={() => void remove()} />
      </>
    ),
  };
  const exportDialog = exporting && <PersonaExport persona={persona} onClose={() => setExporting(false)} />;
  const moveDialog = moving && <PersonaPickDialog title="채팅을 옮길 페르소나" using={id} onChoose={moveChats} onClose={() => setMoving(false)} />;
  return framePage({ head: { title: aliased(persona.name, persona.alias), backLabel: back.label, onBack: () => navigate(back.to), status: autosave.words, menu }, body: <>{body}{exportDialog}{moveDialog}</> });
}
