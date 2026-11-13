import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { presetsOf } from '../model/settings';
import { DISPLAY, DISPLAY_DEFAULT, effectiveEnterSends, lookOf, wornLook, parseReading, parseStoredDisplay, presetOf, READING, savedPresets, systemMode, type Display, type Follow, type Look, type Preset } from './common/reading';
import { usePersisted } from './common/usePersisted';
import { useSettings } from './session';
import { applyScheme, QuoteShapeContext, readingDefault, useCoarsePointer, useDarkScheme, VeilContext, type Reading, type Theme } from './ui';

type DisplayControl = {
  reading: Reading;
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
  assign: (mode: Theme, preset: Preset) => void;
};

const DisplayContext = createContext<DisplayControl | null>(null);

// The one owner of both stores: two usePersisted on one key would not see each other's writes, so the chat's 읽기 설정
// and 설정 › 디스플레이 both edit through this.
export function DisplayProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readingDefault);
  const [reading, setReading] = usePersisted(READING, (stored) => parseReading(stored, initial), initial);
  const [display, setDisplay] = usePersisted(DISPLAY, parseStoredDisplay, DISPLAY_DEFAULT);
  const saved = presetsOf(useSettings());
  const { presets, unread } = useMemo(() => savedPresets(saved), [saved]);
  const mode = systemMode(useDarkScheme());
  const coarsePointer = useCoarsePointer();
  const { theme, bg, ink, accent, dialogue, follow } = display;
  useLayoutEffect(() => applyScheme({ theme, bg, ink, accent, dialogue }), [theme, bg, ink, accent, dialogue]);
  const veil = useMemo(() => (display.hidePictures ? { revealed: new Set<string>() } : null), [display.hidePictures]);
  const find = (id: string | undefined) => (id === undefined ? undefined : presets.find((preset) => preset.id === id));
  const wear = ({ theme, bg, ink, accent, dialogue, ...look }: Look, follow: Follow | null) => {
    setReading({ ...reading, ...look });
    setDisplay({ ...display, theme, bg, ink, accent, dialogue, follow });
  };
  const due = follow && follow.applied !== mode ? find(follow[mode]) : undefined;
  useLayoutEffect(() => {
    if (due && follow) wear(due.look, { ...follow, applied: mode });
  }, [due]);
  const pick = (preset: Preset) => wear(preset.look, follow && { ...follow, [mode]: preset.id, applied: mode });
  // Called only while there is a preset: its switch is off without one.
  function followSystem(on: boolean) {
    if (!on) return setDisplay({ ...display, follow: null });
    const current = presetOf(presets, reading, display);
    const slot = (theme: Theme) => ((current?.look.theme === theme ? current : presets.find(({ look }) => look.theme === theme)) ?? current ?? presets[0]!).id;
    const next = { light: slot('light'), dark: slot('dark'), applied: mode };
    wear(find(next[mode])!.look, next);
  }
  const control: DisplayControl = {
    reading,
    display: { ...display, enterSends: effectiveEnterSends(display.enterSendsChoice, coarsePointer) },
    presets,
    unread,
    find,
    changeReading: (change) => setReading({ ...reading, ...change }),
    changeDisplay: (change) => setDisplay({ ...display, ...change }),
    pick,
    reset: () => wear(lookOf(initial, DISPLAY_DEFAULT), follow),
    followSystem,
    assign: (slot, preset) => {
      if (!follow) return;
      if (slot === mode) pick(preset);
      else setDisplay({ ...display, follow: { ...follow, [slot]: preset.id } });
    },
  };
  return (
    <DisplayContext value={control}>
      <VeilContext value={veil}>
        <QuoteShapeContext value={display.quotes}>{children}</QuoteShapeContext>
      </VeilContext>
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
  return wornLook(find(look), reading, display.theme);
}
