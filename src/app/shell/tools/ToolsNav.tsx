import { Calculator, Languages, type LucideIcon } from 'lucide-react';
import { TOOL_PAGES, TOOLS } from '../../common/words';
import { LayerSidebar, List, ListItem, NavBar, NavGroup, NavRow, Screen } from '../../ui';
import { navigate } from '../router';
import type { Route, ToolsPage } from '../routes';

type Place = { page: ToolsPage; label: string; icon: LucideIcon; route: Route };

// Only built tools are listed.
const PLACES: Place[] = [
  { page: 'translator', label: TOOL_PAGES.translator, icon: Languages, route: { kind: 'translator' } },
  { page: 'calculator', label: TOOL_PAGES.calculator, icon: Calculator, route: { kind: 'calculator' } },
];

export const toolsEntry = (wide: boolean): Route => (wide ? PLACES[0]!.route : { kind: 'tools' });

export function ToolsSidebar({ current, onClose }: { current: ToolsPage | 'list'; onClose: () => void }) {
  return (
    <LayerSidebar title={TOOLS} onClose={onClose}>
      <NavGroup>
        {PLACES.map((place) => (
          <NavRow key={place.page} icon={place.icon} label={place.label} current={place.page === current} onClick={() => navigate(place.route)} />
        ))}
      </NavGroup>
    </LayerSidebar>
  );
}

export function ToolsList({ onClose }: { onClose: () => void }) {
  return (
    <Screen top={<NavBar title={TOOLS} close backLabel={`${TOOLS} 닫기`} onBack={onClose} />}>
      <List places label={TOOLS}>
        {PLACES.map((place) => (
          <ListItem key={place.page} title={place.label} onClick={() => navigate(place.route)} />
        ))}
      </List>
    </Screen>
  );
}
