import { useState } from 'react';
import type { Stored } from '../../model/kinds';
import { installedFile } from '../../runtime/tools/drafts';
import { useLoaded } from '../common/useLoaded';
import { moduleName, TRIAL } from '../common/words';
import { useFiles, useStore, useTool } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { TestPane, type TestSetup } from './StudioTest';

// 테스트 on the plugin's installed file, with no draft: a file past a draft's size has no other way to be tried.
export function PluginTestScreen({ stored, back }: { stored: Stored<'module'>; back: Back }) {
  const store = useStore();
  const files = useFiles();
  const installed = useTool(stored.id)?.value.file.id;
  const file = useLoaded(() => installedFile(store, files, stored.id), [store, files, stored.id, installed]);
  const [setup, setSetup] = useState<TestSetup>({ chat: null, calling: false, model: null });
  return (
    <Screen width="form" top={<NavBar title={TRIAL.name} description={moduleName(stored.value.name)} {...backBar(back)} />}>
      {file.failure ?? file.loading}
      {file.data && <TestPane draft={file.data} setup={setup} onSetup={setSetup} />}
    </Screen>
  );
}
