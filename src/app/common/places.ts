import { LayoutGrid, MessagesSquare, Search, Settings, Wrench, type LucideIcon } from 'lucide-react';
import { BOARD, CHAT_SEARCH, SETTINGS, TOOLS } from './words';

// The ways to the app's other parts, one word and one icon each wherever one is offered: the rail, the list page on a
// phone, a theme's picture of the rail.
export const PLACES = {
  gallery: { label: '캐릭터 둘러보기', icon: LayoutGrid },
  search: { label: CHAT_SEARCH, icon: Search },
  board: { label: BOARD.title, icon: MessagesSquare },
  tools: { label: TOOLS, icon: Wrench },
  settings: { label: SETTINGS, icon: Settings },
} satisfies Record<string, { label: string; icon: LucideIcon }>;
