import { useState, type ReactNode } from 'react';
import { ModelsConsent } from './PluginSection';
import type { Stored } from '../../model/kinds';
import { likenessId } from '../../model/likeness';
import { isToggle } from '../../model/prompt';
import { copyModule, editModule, setModuleAlways, setModuleDeleted } from '../../runtime/modules';
import { ACTS } from '../common/acts';
import { aliased } from '../common/alias';
import { holdsLine } from '../common/pack';
import { AssetsEditor } from '../common/AssetsEditor';
import { LoreEditor } from '../common/LoreEditor';
import { PackToggles } from '../common/PackToggles';
import { ScriptsEditor } from '../common/ScriptsEditor';
import { PortraitsEditor } from '../common/PortraitsEditor';
import { useAutosave } from '../common/useAutosave';
import { ALWAYS, BIN_KEEPS, copyName, moduleName, PAGES, promptName } from '../common/words';
import { useChildren, useSettings, useStore, useStored } from '../session';
import { backBar, navigate } from '../shell/router';
import { characterPage, type Back } from '../shell/routes';
import { useToast } from '../toast';
import { Avatar, Empty, List, ListItem, MenuItem, NavBar, Screen, Section, SettingGroup, SettingRow, Switch, Text, TextField, useWide } from '../ui';
import { ModuleExport } from './ModuleExport';
import { useModuleOwners, useModuleParts } from './ModulesScreen';

const ALWAYS_ON = `${ALWAYS} 켜기`;
const USED_BY = '사용 중인 캐릭터';
const PROMPTS_USING = '사용 중인 프롬프트';
const PERSONAS_USING = '사용 중인 페르소나';

// What a module's page and a plugin's share; page is the list it belongs to. items: the page's own menu items, before 삭제,
// handed the autosave's flush.
export function useModuleEditor({ id, value }: Stored<'module'>, page: 'modules' | 'plugins', back: Back, items?: (flush: () => Promise<boolean>) => ReactNode) {
  const noun = PAGES[page];
  const store = useStore();
  const toast = useToast();
  const autosave = useAutosave<{ name: string; description: string }>(`module:${id}`, (patch) => editModule(store, id, patch));
  const name = autosave.unsaved.name ?? value.name;
  const description = autosave.unsaved.description ?? value.description;

  async function remove() {
    const removed = await autosave.remove(() => setModuleDeleted(store, id, Date.now()));
    if (!removed) return;
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    navigate(page === 'modules' ? { kind: 'modules', place: null } : { kind: 'plugins' });
    toast.undoable(`'${moduleName(name)}' ${noun}을 삭제했어요.`, () => setModuleDeleted(store, id, null), BIN_KEEPS);
  }

  const top = (
    <NavBar
      title={name}
      rename={{ label: `${noun} 이름`, placeholder: moduleName(name), onChange: (next) => autosave.change({ name: next }) }}
      status={autosave.words}
      {...backBar(back)}
      menu={{
        of: noun,
        items: (
          <>
            {items?.(autosave.flush)}
            <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => void remove()} />
          </>
        ),
      }}
    />
  );
  const describing = <TextField label="설명" lines={3} value={description} onChange={(next) => autosave.change({ description: next })} />;
  return { name, top, describing };
}

export function AlwaysSwitch({ id }: { id: string }) {
  const store = useStore();
  const toast = useToast();
  const always = useSettings().modules?.includes(id) ?? false;
  async function setAlways(on: boolean) {
    const saved = await setModuleAlways(store, id, on);
    if (!saved.ok) toast.failed(saved, '저장하지 못했어요.');
  }
  return (
    <SettingGroup label={ALWAYS_ON}>
      <SettingRow label={ALWAYS_ON} help="켜면 모든 채팅에 적용돼요." control={<Switch label={ALWAYS_ON} checked={always} onChange={(on) => void setAlways(on)} />} />
    </SettingGroup>
  );
}

export function UsedBy({ id }: { id: string }) {
  const wide = useWide();
  const owners = useModuleOwners();
  const always = owners.always.includes(id);
  const users = owners.characters.filter(({ character }) => character.modules?.includes(id));
  const prompts = owners.prompts.filter(({ value }) => value.modules?.includes(id));
  const personas = owners.personas.filter(({ value }) => value.modules?.includes(id));
  const usedBy = [
    {
      title: PROMPTS_USING,
      items: prompts.map(({ id: prompt, value: { name } }) => <ListItem key={prompt} title={promptName(name)} onClick={() => navigate({ kind: 'prompt', id: prompt, pane: null })} />),
      none: always ? '직접 켠 프롬프트가 없어요.' : '켜 둔 프롬프트가 없어요.',
    },
    {
      title: USED_BY,
      items: users.map(({ id: character, character: { card, alias }, face }) => <ListItem key={character} leading={<Avatar face={card.name} image={face} />} title={aliased(card.name, alias)} onClick={() => navigate(characterPage(character, wide))} />),
      none: always ? '직접 켠 캐릭터가 없어요.' : '켜 둔 캐릭터가 없어요.',
    },
    {
      title: PERSONAS_USING,
      items: personas.map(({ id: persona, value: { name, alias, picture } }) => <ListItem key={persona} leading={<Avatar face={name} image={picture} tone="you" />} title={aliased(name, alias)} onClick={() => navigate({ kind: 'persona', id: persona })} />),
      none: always ? '직접 켠 페르소나가 없어요.' : '켜 둔 페르소나가 없어요.',
    },
  ];
  return usedBy.map(({ title, items, none }) => (
    <Section key={title} title={title}>
      {items.length > 0 ? <List label={title}>{items}</List> : <Empty variant="section">{none}</Empty>}
    </Section>
  ));
}

export function ModuleScreen({ stored, pane, back }: { stored: Stored<'module'>; pane: 'toggles' | null; back: Back }) {
  const wide = useWide();
  const [exporting, setExporting] = useState(false);
  const { id, value } = stored;
  const holds = holdsLine(useModuleParts([stored])[0]!);
  // A module of scripts alone describes no one, so it offers no 삽화 profiles.
  const describes = useChildren('lore', id).length + useChildren('asset', id).length > 0 || useStored('likeness', likenessId(id)) !== null;
  const store = useStore();
  const toast = useToast();

  async function copy(flush: () => Promise<boolean>) {
    if (!(await flush())) return;
    const made = crypto.randomUUID();
    const copying = copyModule(store, id, copyName(moduleName(name)), made);
    navigate({ kind: 'module', id: made, pane: null });
    const copied = await copying;
    if (!copied.ok) return toast.failed(copied, '사본을 만들지 못했어요.');
    toast.show('사본을 만들었어요.');
  }

  const { name, top, describing } = useModuleEditor(stored, 'modules', back, (flush) => (
    <>
      <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} onClick={() => void copy(flush)} />
      <MenuItem icon={ACTS.export.icon} label={ACTS.export.label} onClick={() => setExporting(true)} />
    </>
  ));

  if (pane === 'toggles')
    return (
      <Screen width="form" top={<NavBar title={moduleName(name)} {...backBar(back)} />}>
        <PackToggles owner={{ kind: 'module', id }} lines={value.toggles} />
      </Screen>
    );

  return (
    <Screen width="form" top={top}>
      {describing}
      <Text variant="note">{holds}</Text>
      <AlwaysSwitch id={id} />
      <ModelsConsent module={stored} />
      <UsedBy id={id} />
      <List box places label="토글">
        <ListItem title="토글" note={`${value.toggles.filter(isToggle).length}개`} onClick={() => navigate({ kind: 'module', id, pane: 'toggles' })} />
      </List>
      <LoreEditor owner={{ kind: 'module', id }} folders={value.loreFolders} />
      <ScriptsEditor owner={{ kind: 'module', id }} pack={value} drill={!wide} />
      <AssetsEditor owner={id} />
      {describes && <PortraitsEditor owner={id} />}
      {exporting && <ModuleExport id={id} name={name} onClose={() => setExporting(false)} />}
    </Screen>
  );
}
