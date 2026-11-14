import { useEffect, useState } from 'react';
import { usePersisted } from '../common/usePersisted';
import { useDisplay } from '../display';
import { keysOf, Quiet, SHORTCUT_GROUPS, SHORTCUTS, useShortcut } from '../shortcuts';
import { useChatOpening } from '../session';
import { backLayers, Dialog, LayerWindow, Section, Shell, Shortcuts, Stack, Text, useLingering, useWide } from '../ui';
import { Page } from './Page';
import { closeLayer, holdBack, navigate, ShownRoute, useAddress } from './router';
import { HOME, settingsPage, sidebarPage, type Route } from './routes';
import { SETTINGS } from '../common/words';
import { settingsEntry, SettingsSidebar } from './settings/SettingsNav';
import { LibrarySidebar } from './sidebar/LibrarySidebar';

const COLLAPSED = 'risu-alpha:sidebar-collapsed';

export function Layout() {
  const asked = useAddress();
  // What is on screen stays while the chat asked for opens: one that opens soon follows it with no loading screen
  // between. The sidebar beside it reads the route asked for, and marks that chat at once.
  const { route, under } = useLingering(asked, useChatOpening(asked.route.kind === 'chat' ? asked.route.id : null));
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
  const [listing, setListing] = useState(false);
  const { display, changeDisplay } = useDisplay();

  const fallback = { fallback: true };
  useShortcut('settings', () => (settings === null ? navigate(settingsEntry(wide)) : closeLayer()), fallback);
  useShortcut('personas', () => navigate({ kind: 'personas', place: null }), fallback);
  useShortcut('prompts', () => navigate({ kind: 'prompts', place: null, sort: null }), fallback);
  useShortcut('search', () => navigate({ kind: 'search', query: '' }), fallback);
  useShortcut('shortcutList', () => setListing((open) => !open), fallback);
  useShortcut('sidebar', () => (wide && settings === null ? fold(!folded) : false), fallback);
  useShortcut('pictures', () => changeDisplay({ hidePictures: !display.hidePictures }), fallback);

  const listed = listing && <ShortcutList enterSends={display.enterSends} onClose={() => setListing(false)} />;
  // The route a page is given is the one everything in it reads.
  const drawn = (at: Route) => <ShownRoute.Provider value={at}><Page route={at} onPaired={setPaired} /></ShownRoute.Provider>;
  const page = (
    <>
      {drawn(route)}
      {listed}
    </>
  );

  const sidebar = (asPage: boolean) => <LibrarySidebar page={asPage} collapsed={folded} onCollapse={fold} />;
  if (!wide) return settings !== null || !sidebarPage(route) ? page : <ShownRoute.Provider value={route}>{sidebar(true)}</ShownRoute.Provider>;
  const layer = settings !== null ? { label: SETTINGS, side: <SettingsSidebar current={settings} onClose={closeLayer} /> } : null;
  const held = layer !== null;
  const outside = under ?? HOME;
  // The page a layer is opened from keeps its place in the tree, so it stays as it was behind the window.
  return (
    <>
      <ShownRoute.Provider value={held ? outside : null}>
        <Quiet.Provider value={held}>
          <Shell side={sidebar(false)} held={held}>
            {drawn(held ? outside : route)}
            {!held && listed}
          </Shell>
        </Quiet.Provider>
      </ShownRoute.Provider>
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
