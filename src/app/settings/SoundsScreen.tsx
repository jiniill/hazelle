import type { Cue } from '../../runtime/cues';
import { DetailFold } from '../common/DetailFold';
import { choices } from '../common/reading';
import { CHIMES, playSound } from '../common/sounds';
import { PAGES } from '../common/words';
import { useDisplay } from '../display';
import { useToast } from '../toast';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { ChoiceGroup, NavBar, Screen, Section, SettingGroup, SettingRow, Switch } from '../ui';

const ALERTS = '알림음';

const ROWS: { cue: Cue; label: string; help: string }[] = [
  { cue: 'reply-started', label: '응답이 시작될 때', help: '추론을 마치고 본문이 나오기 시작하면 울려요.' },
  { cue: 'reply-received', label: '응답이 도착했을 때', help: '멈추기로 끊은 응답과 실패한 응답에는 울리지 않아요.' },
  { cue: 'translated', label: '번역이 끝났을 때', help: '채팅 메시지의 번역이 끝나면 울려요.' },
];

export function SoundsScreen({ back }: { back: Back | null }) {
  const { display, changeDisplay } = useDisplay();
  const toast = useToast();
  return (
    <Screen width="form" top={<NavBar title={PAGES.sounds} {...backBar(back)} />}>
      <Section title={ALERTS}>
        <SettingGroup label={ALERTS}>
          <SettingRow
            label={ALERTS}
            help="응답이 도착하거나 번역이 끝나면 소리로 알려요."
            control={<Switch label={ALERTS} checked={display.chimes} onChange={(chimes) => changeDisplay({ chimes })} />}
          />
        </SettingGroup>
        {display.chimes && (
          <DetailFold set={0}>
            {ROWS.map(({ cue, label, help }) => (
              <SettingRow
                key={cue}
                label={label}
                help={help}
                control={
                  <ChoiceGroup
                    layout="fit"
                    label={label}
                    options={choices(CHIMES)}
                    value={display.chimeSounds[cue]}
                    // Played on the pick, inside the press, which also unlocks a phone's sound.
                    onChange={(chime) => {
                      changeDisplay({ chimeSounds: { ...display.chimeSounds, [cue]: chime } });
                      if (chime !== 'off') void playSound(chime).then((played) => played || toast.error('소리를 재생하지 못했어요.'));
                    }}
                  />
                }
              />
            ))}
          </DetailFold>
        )}
      </Section>
    </Screen>
  );
}
