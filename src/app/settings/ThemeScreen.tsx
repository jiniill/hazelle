import { LOOK_SAMPLE } from '../common/reading';
import { PAGES } from '../common/words';
import { useDisplay } from '../display';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen, Section, Swatches, THEMES, type ThemeId } from '../ui';

export function ThemeScreen({ back }: { back: Back | null }) {
  const { reading, display, changeDisplay } = useDisplay();
  const { mode, bg, ink, accent, dialogue } = display;
  const items = (Object.keys(THEMES) as ThemeId[]).map((id) => ({ name: THEMES[id].name, theme: THEMES[id], mode, bg, ink, accent, dialogue, font: reading.font, size: reading.size, pressed: id === display.theme, onPick: () => changeDisplay({ theme: id }) }));
  return (
    <Screen width="page" top={<NavBar title={PAGES.theme} {...backBar(back)} />}>
      <Section title="기본 제공">
        <Swatches label={PAGES.theme} sample={LOOK_SAMPLE} items={items} />
      </Section>
    </Screen>
  );
}
