import { ExternalLink } from 'lucide-react';
import type { Stored } from '../../model/kinds';
import { setModels, setModuleModel, setNetwork, setTakesMemory } from '../../runtime/library/pack';
import { sharedModel } from '../../runtime/models/assignment';
import { writerOf } from '../../runtime/models/profiles';
import { scriptsOf } from '../../runtime/scripts/selection';
import { describeModuleModelFailure } from '../common/failure';
import { TaskModelRow } from '../common/TaskPrompt';
import { ToolSetting } from '../common/ToolSetting';
import { opensPage } from '../common/ToolView';
import type { Write } from '../common/saveQueue';
import { useAutosave } from '../common/useAutosave';
import { MEMORY_CLAIM_HELP, MODEL_ROLES, MODULE_MODEL_HELP, MODULE_MODELS, modelsHelp, NETWORK, NETWORK_CALLED, NETWORK_HELP, SAVE_FAILED, TOOL, toolVersion, type Asker } from '../common/words';
import { useSession, useSettings, useTool, useToolHosts } from '../session';
import { useToast } from '../toast';
import { navigate } from '../shell/router';
import { Button, Disclosure, Facts, Section, SettingGroup, SettingRow, Stack, Switch } from '../ui';

const hasLua = ({ id, value }: Stored<'module'>) => scriptsOf([{ id, pack: value, module: { namespace: value.namespace } }]).length > 0;

function ModelsRow({ module, asker }: { module: Stored<'module'>; asker: Asker }) {
  const { store } = useSession();
  return (
    <FlagRow
      saveKey={`module-models:${module.id}`}
      label={MODULE_MODELS}
      help={modelsHelp(asker)}
      stored={module.value.botModels === true}
      write={(on) => setModels(store, { kind: 'module', id: module.id }, on)}
    />
  );
}

// What the module's 보조 calls run on outside a chat's own pick: the row cannot know which chat will call.
function OwnModel({ module }: { module: Stored<'module'> }) {
  const { store } = useSession();
  const toast = useToast();
  // Subscribed for sharedModel, which reads the settings from the store.
  useSettings();
  const own = module.value.model;
  const route = sharedModel(store, 'aux', own ?? null);
  const writer = 'kind' in route ? route : writerOf(store, route);
  return (
    <TaskModelRow
      label={MODEL_ROLES.aux}
      help={MODULE_MODEL_HELP}
      own={own}
      runs={'kind' in writer ? { why: describeModuleModelFailure(writer, own !== undefined) } : writer}
      onPick={(ref) => toast.settled(setModuleModel(store, module.id, ref), SAVE_FAILED)}
    />
  );
}

// A module's Lua may call a model; a plugin's switch sits in its own section.
export function ModelsConsent({ module }: { module: Stored<'module'> }) {
  return hasLua(module) ? <SettingGroup label={MODULE_MODELS}><ModelsRow module={module} asker="module" /><OwnModel module={module} /></SettingGroup> : null;
}

export function PluginSection({ module }: { module: Stored<'module'> }) {
  const { store } = useSession();
  const stored = useTool(module.id);
  if (!stored) return null;
  const { manifest, settings } = stored.value;
  const models = hasLua(module) || manifest.uses.some((use) => use === 'model' || use === 'embed');
  const memory = manifest.uses.includes('memory');
  const network = manifest.uses.includes('network');
  return (
    <Section
      title={TOOL}
      action={opensPage(manifest) && <Button variant="secondary" icon={ExternalLink} onClick={() => navigate({ kind: 'plugin-page', id: module.id })}>열기</Button>}
    >
      <Stack gap="group">
        <Facts items={[{ label: '버전', value: toolVersion(manifest.version) }, { label: '제작자', value: manifest.author }]} />
        {(models || memory || network || manifest.settings.length > 0) && <SettingGroup label={`${TOOL} 설정`}>
          {models && <ModelsRow module={module} asker="plugin" />}
          {(hasLua(module) || manifest.uses.includes('model')) && <OwnModel module={module} />}
          {network && (
            <FlagRow
              saveKey={`module-network:${module.id}`}
              label={NETWORK}
              help={NETWORK_HELP}
              stored={module.value.network === true}
              write={(on) => setNetwork(store, module.id, on)}
            />
          )}
          {memory && (
            <FlagRow
              saveKey={`module-memory:${module.id}`}
              label={MEMORY_CLAIM_LABEL}
              help={MEMORY_CLAIM_HELP}
              stored={module.value.takesMemory === true}
              write={(on) => setTakesMemory(store, module.id, on)}
            />
          )}
          {manifest.settings.map((field) => <ToolSetting key={field.key} module={module.id} field={field} value={settings[field.key]} />)}
        </SettingGroup>}
        {network && <CalledHosts module={module.id} />}
      </Stack>
    </Section>
  );
}

const MEMORY_CLAIM_LABEL = '장기 기억 맡기기';

// Only since this page loaded, and only where and how often: what was sent is never kept.
function CalledHosts({ module }: { module: string }) {
  const hosts = useToolHosts(module);
  if (!hosts) return null;
  return (
    <Disclosure label={NETWORK_CALLED}>
      <Facts items={[...hosts].map(([host, count]) => ({ label: host, value: `${count}번` }))} />
    </Disclosure>
  );
}

type FlagProps = { saveKey: string; label: string; help: string; stored: boolean; write: (on: boolean) => ReturnType<Write<{ on: boolean }>> };

function FlagRow({ saveKey, label, help, stored, write }: FlagProps) {
  const save = useAutosave<{ on: boolean }>(saveKey, ({ on }) => write(on!));
  return <SettingRow label={label} help={help} control={<Switch label={label} checked={save.unsaved.on ?? stored} onChange={(on) => void save.save({ on })} />} />;
}
