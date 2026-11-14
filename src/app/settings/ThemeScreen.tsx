import { LOOK_SAMPLE } from '../common/reading';
import { PAGES } from '../common/words';
import { useDisplay } from '../display';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen, Section, SettingGroup, SettingRow, Swatches, Switch, THEMES, useSplitsReplies, type ThemeId } from '../ui';

export function ThemeScreen({ back }: { back: Back | null }) {
  const { lettersIn, display, changeDisplay } = useDisplay();
  const { mode, bg, ink, accent, dialogue } = display;
  const splits = useSplitsReplies();
  const items = (Object.keys(THEMES) as ThemeId[]).map((id) => ({ name: THEMES[id].name, theme: THEMES[id], mode, bg, ink, accent, dialogue, font: lettersIn(id).font, size: lettersIn(id).size, pressed: id === display.theme, onPick: () => changeDisplay({ theme: id }) }));
  return (
    <Screen width="page" top={<NavBar title={PAGES.theme} {...backBar(back)} />}>
      <Section title="기본 제공">
        <Swatches label={PAGES.theme} sample={LOOK_SAMPLE} items={items} />
      </Section>
      {splits && (
        <Section title={THEMES[display.theme].name}>
          <SettingGroup label={THEMES[display.theme].name}>
            <SettingRow
              label="응답 나누기"
              help={{ text: '응답을 문단마다 말풍선 하나로 나눠요. 끄면 응답 하나가 말풍선 하나예요.' }}
              control={<Switch label="응답 나누기" checked={display.splitReplies} onChange={(splitReplies) => changeDisplay({ splitReplies })} />}
            />
          </SettingGroup>
        </Section>
      )}
    </Screen>
  );
}
