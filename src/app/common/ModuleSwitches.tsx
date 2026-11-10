import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { Stored } from '../../model/kinds';
import { setModuleAt, type ModulePlace } from '../../runtime/library/modules';
import { useModules, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { IconButton, Section, SettingGroup, SettingRow, Switch, Text } from '../ui';
import { folderNote, placeIn, useFolderIndex } from './folders/filing';
import { FolderPath } from './folders/FolderParts';
import { ALWAYS, moduleName, PAGES, SAVE_FAILED } from './words';

type Owner = Exclude<ModulePlace, { kind: 'always' }>;

const WORKS: Record<Owner['kind'], string> = {
  character: '켜 둔 모듈은 이 캐릭터의 모든 채팅에 적용돼요.',
  prompt: '켜 둔 모듈은 이 프롬프트를 쓰는 채팅에 적용돼요.',
  persona: '켜 둔 모듈은 이 페르소나로 대화하는 모든 채팅에 적용돼요.',
};

const folderOf = ({ value }: Stored<'module'>) => value.folder ?? null;

// own: the owner's modules as stored.
export function ModuleSwitches({ owner, own }: { owner: Owner; own: string[] }) {
  const store = useStore();
  const toast = useToast();
  const modules = useModules();
  const always = useSettings().modules ?? [];
  const index = useFolderIndex('module', modules, folderOf);
  const [place, setPlace] = useState<string | null>(null);
  const at = placeIn(index, place, false);
  const on = (id: string) => always.includes(id) || own.includes(id);

  async function change(module: string, on: boolean) {
    const saved = await setModuleAt(store, owner, module, on);
    if (!saved.ok) toast.failed(saved, SAVE_FAILED);
  }

  if (modules.length === 0) return null;
  return (
    <Section title={PAGES.modules} help={WORKS[owner.kind]}>
      {index.folders.length > 0 && <FolderPath kind="module" path={at.path} onGo={setPlace} />}
      <SettingGroup label={PAGES.modules}>
        {at.folders.map((folder) => {
          const contents = index.byFolder.get(folder.id)!;
          const lit = contents.inside.filter(({ id }) => on(id)).length;
          return (
            <SettingRow
              key={folder.id}
              folder
              label={folder.value.name}
              description={[folderNote('module', contents), lit > 0 && `${lit}개 켜짐`].filter(Boolean).join(' · ')}
              control={<IconButton icon={ChevronRight} label={`'${folder.value.name}' 폴더 열기`} size="sm" onClick={() => setPlace(folder.id)} />}
            />
          );
        })}
        {at.placed(modules).map(({ id: module, value }) => (
          <SettingRow
            key={module}
            label={moduleName(value.name)}
            control={
              always.includes(module) ? (
                <Text variant="note">{ALWAYS} 켜짐</Text>
              ) : (
                <Switch label={moduleName(value.name)} checked={own.includes(module)} onChange={(on) => void change(module, on)} />
              )
            }
          />
        ))}
      </SettingGroup>
    </Section>
  );
}
