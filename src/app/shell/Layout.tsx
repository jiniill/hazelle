import { useEffect, useState } from 'react';
import { usePersisted } from '../common/usePersisted';
import { useDisplay } from '../display';
import { keysOf, Quiet, SHORTCUT_GROUPS, SHORTCUTS, useShortcut } from '../shortcuts';
import { backLayers, Dialog, LayerWindow, Section, Shell, Shortcuts, Stack, Text, useWide } from '../ui';
import { Page } from './Page';
import { HeldRoute, holdBack, navigate, useRoute } from './router';
import { HOME, settingsPage, sidebarPage, toolsPage, type Route } from './routes';
import { SETTINGS, TOOLS } from '../common/words';
import { settingsEntry, SettingsSidebar } from './settings/SettingsNav';
import { ToolsSidebar } from './tools/ToolsNav';
import { LibrarySidebar } from './sidebar/LibrarySidebar';

const COLLAPSED = 'risu-alpha:sidebar-collapsed';

export function Layout() {
  const route = useRoute();
  const wide = useWide();
  useEffect(() => holdBack(backLayers), []);
  const [collapsed, setCollapsed] = usePersisted(COLLAPSED, (stored) => stored === '1', false, (folded) => (folded ? '1' : '0'));
  // Two panels beside a chat fold the list for their room without touching the stored choice; opening it then keeps it
  // open until the pair closes.
  const [paired, setPaired] = useState(false);
  const [keptOpen, setKeptOpen] = useState(false);
  if (!paired && keptOpen) setKeptOpen(false);
  const folded = collapsed || (paired && !keptOpen);
  const fold = (to: boolean) => {
    if (paired) setKeptOpen(!to);
    setCollapsed(to);
  };
  const settings = settingsPage(route);
  const tools = toolsPage(route);
  // Where the × of 설정 or 도구 goes: the last place outside both, or home after a reload inside one.
  const [outside, setOutside] = useState<Route>(HOME);
  if (settings === null && tools === null && outside !== route) setOutside(route);
  const closeLayer = () => navigate(outside);
  const [listing, setListing] = useState(false);
  const { display, changeDisplay } = useDisplay();

  const fallback = { fallback: true };
  useShortcut('settings', () => (settings === null ? navigate(settingsEntry(wide)) : closeLayer()), fallback);
  useShortcut('personas', () => navigate({ kind: 'personas', place: null }), fallback);
  useShortcut('prompts', () => navigate({ kind: 'prompts', place: null, sort: null }), fallback);
  useShortcut('search', () => navigate({ kind: 'search', query: '' }), fallback);
  useShortcut('shortcutList', () => setListing((open) => !open), fallback);
  useShortcut('sidebar', () => (wide && settings === null && tools === null ? fold(!folded) : false), fallback);
  useShortcut('pictures', () => changeDisplay({ hidePictures: !display.hidePictures }), fallback);

  const listed = listing && <ShortcutList enterSends={display.enterSends} onClose={() => setListing(false)} />;
  const page = (
    <>
      <Page route={route} closeLayer={closeLayer} onPaired={setPaired} />
      {listed}
    </>
  );

  const sidebar = (asPage: boolean) => <LibrarySidebar page={asPage} collapsed={folded} onCollapse={fold} />;
  if (!wide) return settings !== null || tools !== null || !sidebarPage(route) ? page : sidebar(true);
  const layer = settings !== null ? { label: SETTINGS, side: <SettingsSidebar current={settings} onClose={closeLayer} /> } : tools !== null ? { label: TOOLS, side: <ToolsSidebar current={tools} onClose={closeLayer} /> } : null;
  const held = layer !== null;
  // The page a layer is opened from keeps its place in the tree, so it stays as it was behind the window.
  return (
    <>
      <HeldRoute.Provider value={held ? outside : null}>
        <Quiet.Provider value={held}>
          <Shell side={sidebar(false)} held={held}>
            <Page route={held ? outside : route} closeLayer={closeLayer} onPaired={setPaired} />
            {!held && listed}
          </Shell>
        </Quiet.Provider>
      </HeldRoute.Provider>
      {layer && (
        <LayerWindow label={layer.label} side={layer.side} onClose={closeLayer}>
          {page}
        </LayerWindow>
      )}
    </>
  );
}

function ShortcutList({ enterSends, onClose }: { enterSends: boolean; onClose: () => void }) {
  return (
    <Dialog title="단축키" onClose={onClose}>
      <Stack gap="section">
        {SHORTCUT_GROUPS.map(({ title, note, names }) => (
          <Section key={title} title={title} level={3}>
            {note && (
              <Text variant="note">
                {note}
              </Text>
            )}
            <Shortcuts items={names.map((name) => ({ label: SHORTCUTS[name].label, keys: keysOf(name, enterSends) }))} />
          </Section>
        ))}
      </Stack>
    </Dialog>
  );
}
