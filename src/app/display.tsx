import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { presetsOf } from '../model/settings';
import { DISPLAY, DISPLAY_DEFAULT, effectiveEnterSends, lookOf, wornLook, parseStoredDisplay, presetOf, savedPresets, systemMode, type Display, type Follow, type Look, type Preset } from './common/reading';
import { useReading } from './common/useReading';
import { usePersisted } from './common/usePersisted';
import { useSettings } from './session';
import { applyScheme, QuoteShapeContext, SchemeContext, ThemeContext, THEMES, useCoarsePointer, useDarkScheme, VeilContext, type Letters, type Mode, type Reading, type ThemeId } from './ui';

type DisplayControl = {
  // The worn theme's: its own letters where it states them.
  reading: Reading;
  // The letters a theme would be read in, for its card.
  lettersIn: (theme: ThemeId) => Letters;
  // enterSends is what Enter does now, resolved here; only enterSendsChoice is stored.
  display: Display & { enterSends: boolean };
  presets: Preset[];
  // Saved presets this version cannot read, left out of presets.
  unread: number;
  // A preset by id; undefined for none or one that is gone.
  find: (id: string | undefined) => Preset | undefined;
  changeReading: (change: Partial<Reading>) => void;
  changeDisplay: (change: Partial<Display>) => void;
  // While following the system, a pick becomes the current mode's preset.
  pick: (preset: Preset) => void;
  reset: () => void;
  followSystem: (on: boolean) => void;
  assign: (mode: Mode, preset: Preset) => void;
};

const DisplayContext = createContext<DisplayControl | null>(null);

// The one owner of the stores: two usePersisted on one key would not see each other's writes, so the chat's 읽기 설정
// and 설정 › 디스플레이 both edit through this.
export function DisplayProvider({ children }: { children: ReactNode }) {
  const [display, setDisplay] = usePersisted(DISPLAY, parseStoredDisplay, DISPLAY_DEFAULT);
  const theme = THEMES[display.theme];
  const { reading, setReading, first, lettersIn } = useReading(theme);
  const saved = presetsOf(useSettings());
  const { presets, unread } = useMemo(() => savedPresets(saved), [saved]);
  const system = systemMode(useDarkScheme());
  const coarsePointer = useCoarsePointer();
  const { mode, bg, ink, accent, dialogue, follow } = display;
  const scheme = useMemo(() => ({ mode, bg, ink, accent, dialogue }), [mode, bg, ink, accent, dialogue]);
  useLayoutEffect(() => applyScheme(scheme, theme), [scheme, theme]);
  const veil = useMemo(() => (display.hidePictures ? { revealed: new Set<string>() } : null), [display.hidePictures]);
  const find = (id: string | undefined) => (id === undefined ? undefined : presets.find((preset) => preset.id === id));
  const wear = ({ mode, bg, ink, accent, dialogue, ...look }: Look, follow: Follow | null) => {
    setReading({ ...reading, ...look });
    setDisplay({ ...display, mode, bg, ink, accent, dialogue, follow });
  };
  const due = follow && follow.applied !== system ? find(follow[system]) : undefined;
  useLayoutEffect(() => {
    if (due && follow) wear(due.look, { ...follow, applied: system });
  }, [due]);
  const pick = (preset: Preset) => wear(preset.look, follow && { ...follow, [system]: preset.id, applied: system });
  // Called only while there is a preset: its switch is off without one.
  function followSystem(on: boolean) {
    if (!on) return setDisplay({ ...display, follow: null });
    const current = presetOf(presets, reading, display);
    const slot = (of: Mode) => ((current?.look.mode === of ? current : presets.find(({ look }) => look.mode === of)) ?? current ?? presets[0]!).id;
    const next = { light: slot('light'), dark: slot('dark'), applied: system };
    wear(find(next[system])!.look, next);
  }
  const control: DisplayControl = {
    reading,
    lettersIn: (id) => lettersIn(THEMES[id]),
    display: { ...display, enterSends: effectiveEnterSends(display.enterSendsChoice, coarsePointer) },
    presets,
    unread,
    find,
    changeReading: (change) => setReading({ ...reading, ...change }),
    changeDisplay: (change) => setDisplay({ ...display, ...change }),
    pick,
    reset: () => wear(lookOf(first, DISPLAY_DEFAULT), follow),
    followSystem,
    assign: (slot, preset) => {
      if (!follow) return;
      if (slot === system) pick(preset);
      else setDisplay({ ...display, follow: { ...follow, [slot]: preset.id } });
    },
  };
  return (
    <DisplayContext value={control}>
      <ThemeContext value={theme}>
        <SchemeContext value={scheme}>
          <VeilContext value={veil}>
            <QuoteShapeContext value={display.quotes}>{children}</QuoteShapeContext>
          </VeilContext>
        </SchemeContext>
      </ThemeContext>
    </DisplayContext>
  );
}

export function useDisplay(): DisplayControl {
  const control = useContext(DisplayContext);
  if (!control) throw new Error('display hook outside DisplayProvider');
  return control;
}

// What the chats of a character holding the preset look wear.
export function useWorn(look: string | undefined) {
  const { reading, display, find } = useDisplay();
  return wornLook(find(look), reading, display.mode);
}
