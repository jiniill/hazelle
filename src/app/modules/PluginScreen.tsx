import { useState } from 'react';
import type { Stored } from '../../model/kinds';
import { ACTS } from '../common/acts';
import { useTool } from '../session';
import type { Back } from '../shell/routes';
import { MenuItem, Screen } from '../ui';
import { AlwaysSwitch, UsedBy, useModuleEditor } from './ModuleScreen';
import { PluginExport } from './PluginExport';
import { PluginSection } from './PluginSection';

export function PluginScreen({ stored, back }: { stored: Stored<'module'>; back: Back }) {
  const [exporting, setExporting] = useState(false);
  const tool = useTool(stored.id);
  const { name, top, describing } = useModuleEditor(stored, 'plugins', back, () => tool && <MenuItem icon={ACTS.export.icon} label={ACTS.export.label} onClick={() => setExporting(true)} />);
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
