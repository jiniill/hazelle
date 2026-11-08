import { PAGES } from '../common/words';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { ChatDetailDefaults } from './ChatDetailDefaults';

export function ChatSettingsScreen({ back }: { back: Back | null }) {
  return (
    <Screen width="form" top={<NavBar title={PAGES.chat} {...backBar(back)} />}>
      <ChatDetailDefaults />
    </Screen>
  );
}
