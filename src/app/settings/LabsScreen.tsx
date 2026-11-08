import type { LabId } from '../../model/settings';
import { switchLab } from '../../runtime/prompts';
import { LABS } from '../common/labs';
import { BOARD, PAGES } from '../common/words';
import { useSettings, useStore } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Empty, NavBar, Panel, Screen, SettingGroup, SettingRow, Switch } from '../ui';

const RUNNING = '실험 중인 기능';

export function LabsScreen({ back }: { back: Back | null }) {
  const on = useSettings().labs ?? [];
  const store = useStore();
  const toast = useToast();

  const flip = (id: LabId, next: boolean) => toast.settled(switchLab(store, id, next));

  return (
    <Screen width="page" top={<NavBar title={PAGES.labs} {...backBar(back)} />}>
      <Panel title={RUNNING} help={`먼저 써 보는 새 기능이에요. 의견은 ${BOARD.title}에 남겨 주세요.`}>
        {LABS.length === 0 ? (
          <Empty variant="section">지금은 {RUNNING}이 없어요.</Empty>
        ) : (
          <SettingGroup label={RUNNING}>
            {LABS.map((lab) => (
              <SettingRow key={lab.id} label={lab.name} help={lab.help} control={<Switch label={lab.name} checked={on.includes(lab.id)} onChange={(next) => flip(lab.id, next)} />} />
            ))}
          </SettingGroup>
        )}
      </Panel>
    </Screen>
  );
}
