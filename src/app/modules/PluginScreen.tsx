import { Code2 } from 'lucide-react';
import { useState } from 'react';
import { draftOfTool } from '../../runtime/tools/drafts';
import type { Stored } from '../../model/kinds';
import { ACTS } from '../common/acts';
import { useFiles, useStore, useTool } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import type { Back } from '../shell/routes';
import { MenuItem, Screen } from '../ui';
import { AlwaysSwitch, UsedBy, useModuleEditor } from './ModuleScreen';
import { PluginExport } from './PluginExport';
import { PluginSection } from './PluginSection';

export function PluginScreen({ stored, back }: { stored: Stored<'module'>; back: Back }) {
  const [exporting, setExporting] = useState(false);
  const tool = useTool(stored.id);
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  // A plugin made for Hazelle opens in the studio; a Risu one does not (ruled 2026-10-29).
  async function edit() {
    const opened = await draftOfTool(store, files, stored.id);
    if (!opened.ok) return toast.failed(opened, '코드를 열지 못했어요.');
    navigate({ kind: 'plugin-draft', id: opened.data });
  }
  const { name, top, describing } = useModuleEditor(stored, 'plugins', back, () => tool && (
    <>
      {!tool.value.manifest.risu && <MenuItem icon={Code2} label="코드 편집" onClick={() => void edit()} />}
      <MenuItem icon={ACTS.export.icon} label={ACTS.export.label} onClick={() => setExporting(true)} />
    </>
  ));
  return (
    <Screen width="form" top={top}>
      {describing}
      <AlwaysSwitch id={stored.id} />
      <PluginSection module={stored} />
      <UsedBy id={stored.id} />
      {exporting && tool && <PluginExport id={stored.id} name={name} manifest={tool.value.manifest} onClose={() => setExporting(false)} />}
    </Screen>
  );
}
