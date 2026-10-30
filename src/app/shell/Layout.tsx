import { useEffect, useState } from 'react';
import { usePersisted } from '../common/usePersisted';
import { useDisplay } from '../display';
import { keysOf, SHORTCUT_GROUPS, SHORTCUTS, useShortcut } from '../shortcuts';
import { backLayers, Dialog, Section, Shell, Shortcuts, Stack, Text, useWide } from '../ui';
import { Page } from './Page';
import { holdBack, navigate, useRoute } from './router';
import { HOME, settingsPage, sidebarPage, toolsPage, type Route } from './routes';
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
  useShortcut('shortcutList', () => setListing((open) => !open), fallback);
  useShortcut('sidebar', () => (wide && settings === null && tools === null ? fold(!folded) : false), fallback);
  useShortcut('pictures', () => changeDisplay({ hidePictures: !display.hidePictures }), fallback);

  const page = (
    <>
      <Page route={route} closeLayer={closeLayer} onPaired={setPaired} />
      {listing && <ShortcutList enterSends={display.enterSends} onClose={() => setListing(false)} />}
    </>
  );

  if (settings !== null) return wide ? <Shell align="start" side={<SettingsSidebar current={settings} onClose={closeLayer} />}>{page}</Shell> : page;
  if (tools !== null) return wide ? <Shell align="start" side={<ToolsSidebar current={tools} onClose={closeLayer} />}>{page}</Shell> : page;
  const sidebar = (asPage: boolean) => <LibrarySidebar page={asPage} collapsed={folded} onCollapse={fold} />;
  if (!wide) return sidebarPage(route) ? sidebar(true) : page;
  return <Shell side={sidebar(false)}>{page}</Shell>;
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
