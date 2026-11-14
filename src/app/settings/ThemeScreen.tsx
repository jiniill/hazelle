import { LOOK_SAMPLE, modeIn, wearing } from '../common/reading';
import { PAGES } from '../common/words';
import { useDisplay } from '../display';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen, Section, SettingGroup, SettingRow, Swatches, Switch, THEMES, useSplitsReplies, type ThemeId } from '../ui';

export function ThemeScreen({ back }: { back: Back | null }) {
  const { lettersIn, display, changeDisplay } = useDisplay();
  const { bg, ink, accent, dialogue } = display;
  const splits = useSplitsReplies();
  const items = (Object.keys(THEMES) as ThemeId[]).map((id) => ({ name: THEMES[id].name, theme: THEMES[id], mode: modeIn(display, id), bg, ink, accent, dialogue, font: lettersIn(id).font, size: lettersIn(id).size, pressed: id === display.theme, onPick: () => changeDisplay(wearing(display, id)) }));
  return (
    <Screen width="page" top={<NavBar title={PAGES.theme} {...backBar(back)} />}>
      <Swatches label={PAGES.theme} sample={LOOK_SAMPLE} items={items} />
      {splits && (
        <Section title={THEMES[display.theme].name}>
          <SettingGroup label={THEMES[display.theme].name}>
            <SettingRow
              label="말풍선 나누기"
              help={{ text: '응답을 문단마다 끊어 여러 말풍선으로 보여줘요. 끄면 말풍선 하나에 다 담겨요.' }}
              control={<Switch label="말풍선 나누기" checked={display.splitReplies} onChange={(splitReplies) => changeDisplay({ splitReplies })} />}
            />
          </SettingGroup>
        </Section>
      )}
    </Screen>
  );
}
