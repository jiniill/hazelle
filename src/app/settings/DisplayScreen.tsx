import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { useState } from 'react';
import { storyHtml } from '../../engine/display';
import { EMPTY_SETTINGS, type SavedLook } from '../../model/settings';
import { ACTS } from '../common/acts';
import { NameDialog } from '../common/NameDialog';
import { PICTURE_PERCENT_ERROR, readPicturePercent } from '../common/picturePercent';
import { HidePicturesRow, presetChoices, ReadingRows } from '../common/ReadingRows';
import { choices, SIDE, lookOf, moveLook, presetOf, type Preset } from '../common/reading';
import { useTypedNumber } from '../common/typed';
import { DETAIL, detailLabel, PAGES } from '../common/words';
import { useDisplay } from '../display';
import { useStore } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { ACCENT, BG, Button, DIALOGUE, QUOTE_SHAPE, ChoiceGroup, ColorDot, Disclosure, INK, MenuItem, NavBar, NumberInput, ReadingPreview, Screen, Section, SettingGroup, SettingRow, Swatches, Switch, THEME, type PreviewRow, type Theme } from '../ui';

const SAMPLE: PreviewRow[] = [
  { name: '캐릭터', mine: false, html: storyHtml(`*창밖으로 늦은 오후의 햇살이 기울어 든다.* 그녀는 찻잔을 내려놓고 고개를 들었다. "오늘은 어디까지 읽었어? 지난번엔 중간에 잠들었잖아." '또 잠든 건 아니겠지.'`, true) },
  { name: '나', mine: true, html: storyHtml('"이번엔 끝까지 읽었어. 결말이 좀 의외던데."', false) },
];

const SWATCH_SAMPLE = '그녀는 찻잔을 내려놓고 고개를 들었다.';

const MODES: Record<Theme, string> = { light: '밝은 모드일 때', dark: '어두운 모드일 때' };
const MODE_KEYS = Object.keys(MODES) as Theme[];

const colorChoices = <T extends string>(pick: 'bg' | 'ink' | 'accent' | 'dialogue', labels: Record<T, string>) =>
  choices(labels).map((option) => ({ ...option, mark: <ColorDot pick={pick} value={option.value} /> }));

export function DisplayScreen({ back }: { back: Back | null }) {
  const { reading, display, presets, own, changeDisplay, pick, followSystem, assign } = useDisplay();
  const store = useStore();
  const toast = useToast();
  const all = [...presets, ...own.presets];
  const current = presetOf(all, reading, display);
  const [naming, setNaming] = useState<{ preset: Preset | null } | null>(null);
  const missing = (mode: Theme) => display.follow !== null && !all.some((preset) => preset.id === display.follow![mode]);
  // Folded, a slot whose preset is gone would say so to no one.
  const [detailOpen, setDetailOpen] = useState(() => MODE_KEYS.some(missing));

  async function change(looks: (looks: SavedLook[]) => SavedLook[], failure: string) {
    const done = await store.upsert('settings', (settings = EMPTY_SETTINGS) => ({ ...settings, looks: looks(settings.looks ?? []) }));
    if (!done.ok) toast.failed(done, failure);
    return done.ok;
  }

  function name(typed: string) {
    const preset = naming?.preset;
    setNaming(null);
    if (preset) return void change((looks) => looks.map((look) => (look.id === preset.id ? { ...look, name: typed.trim() || preset.name } : look)), '이름을 바꾸지 못했어요.');
    const look = { id: crypto.randomUUID(), name: typed.trim() || `내 프리셋 ${own.presets.length + 1}`, look: lookOf(reading, display) };
    void change((looks) => [...looks, look], '저장하지 못했어요.');
  }

  async function remove({ id, name, look }: Preset) {
    let at = 0;
    const removed = await change((looks) => {
      at = looks.findIndex((saved) => saved.id === id);
      return looks.filter((saved) => saved.id !== id);
    }, '삭제하지 못했어요.');
    if (removed) toast.undoable(`'${name}' 프리셋을 삭제했어요.`, () => store.upsert('settings', (settings = EMPTY_SETTINGS) => ({ ...settings, looks: (settings.looks ?? []).toSpliced(at, 0, { id, name, look }) })));
  }

  const move = (from: number, to: number) => void change((looks) => moveLook(looks, own.presets[from]!.id, own.presets[to]!.id), '옮기지 못했어요.');

  const swatch = (preset: Preset) => ({ name: preset.name, ...preset.look, pressed: preset === current, onPick: () => pick(preset) });
  const menu = (preset: Preset, index: number) => (
    <>
      <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setNaming({ preset })} />
      {preset !== current && <MenuItem icon={Save} label="지금 설정으로 덮어쓰기" onClick={() => void change((looks) => looks.map((look) => (look.id === preset.id ? { ...look, look: lookOf(reading, display) } : look)), '저장하지 못했어요.')} />}
      {index > 0 && <MenuItem icon={ArrowLeft} label="앞으로 옮기기" onClick={() => move(index, index - 1)} />}
      {index < own.presets.length - 1 && <MenuItem icon={ArrowRight} label="뒤로 옮기기" onClick={() => move(index, index + 1)} />}
      <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => void remove(preset)} />
    </>
  );
  return (
    <Screen
      width="page"
      top={<NavBar title={PAGES.display} {...backBar(back)} />}
      aside={
        <Section title="미리보기">
          <ReadingPreview label="미리보기" reading={reading} rows={SAMPLE} />
        </Section>
      }
      stickyAside
    >
      <Section
        title="프리셋"
        action={
          !current && (
            <Button variant="ghost" onClick={() => setNaming({ preset: null })}>
              지금 설정 저장
            </Button>
          )
        }
      >
        <Swatches label="프리셋" sample={SWATCH_SAMPLE} items={presets.map(swatch)} />
        {(own.presets.length > 0 || own.unread > 0) && (
          <Section title="내 프리셋" level={3} note={own.unread > 0 ? `읽지 못한 프리셋 ${own.unread}개` : undefined}>
            <Swatches label="내 프리셋" sample={SWATCH_SAMPLE} items={own.presets.map((preset, index) => ({ ...swatch(preset), menu: menu(preset, index) }))} onMove={move} />
          </Section>
        )}
        <Disclosure label={detailLabel(display.follow ? 1 : 0)} open={detailOpen} onOpen={setDetailOpen}>
          <SettingGroup label={DETAIL}>
            <SettingRow
              label="시스템 따라 바꾸기"
              help="기기의 밝은·어두운 모드에 맞춰 프리셋을 자동 전환해요. 직접 수정한 값은 모드가 바뀔 때 프리셋대로 돌아가요."
              control={<Switch label="시스템 따라 바꾸기" checked={display.follow !== null} onChange={followSystem} />}
            />
            {display.follow &&
              MODE_KEYS.map((mode) => (
                <SettingRow
                  key={mode}
                  label={MODES[mode]}
                  error={missing(mode) ? '이 프리셋을 찾을 수 없어요. 다른 프리셋을 선택해 주세요.' : undefined}
                  control={<ChoiceGroup layout="fit" label={MODES[mode]} options={presetChoices(all)} value={missing(mode) ? null : display.follow![mode]} empty="없는 프리셋" onChange={(picked) => assign(mode, all.find((preset) => preset.id === picked)!)} />}
                />
              ))}
          </SettingGroup>
        </Disclosure>
      </Section>
      {naming && (
        <NameDialog
          title={naming.preset ? '프리셋 이름 바꾸기' : '프리셋으로 저장'}
          value={naming.preset?.name ?? `내 프리셋 ${own.presets.length + 1}`}
          onSave={name}
          onClose={() => setNaming(null)}
        />
      )}
      <Section title="색">
        <SettingGroup label="색">
          <SettingRow label="테마" control={<ChoiceGroup layout="fit" label="테마" options={choices(THEME)} value={display.theme} onChange={(theme) => changeDisplay({ theme })} />} />
          <SettingRow
            label="배경"
            help="봇이 직접 꾸민 부분은 기본 배경에 맞춰져 있어서, 다른 배경에선 어색할 수 있어요."
            control={<ChoiceGroup label="배경" options={colorChoices('bg', BG)} value={display.bg} onChange={(bg) => changeDisplay({ bg })} />}
          />
          <SettingRow label="글자" control={<ChoiceGroup label="글자" options={colorChoices('ink', INK)} value={display.ink} onChange={(ink) => changeDisplay({ ink })} />} />
          <SettingRow label="대사" control={<ChoiceGroup label="대사" options={colorChoices('dialogue', DIALOGUE)} value={display.dialogue} onChange={(dialogue) => changeDisplay({ dialogue })} />} />
          <SettingRow label="강조" control={<ChoiceGroup label="강조" options={colorChoices('accent', ACCENT)} value={display.accent} onChange={(accent) => changeDisplay({ accent })} />} />
        </SettingGroup>
      </Section>
      <Section title="이미지">
        <SettingGroup label="이미지">
          <HidePicturesRow />
          <PictureWidestRow />
          <SettingRow
            label="가로 이미지는 꽉 채우기"
            help="가로가 세로보다 긴 이미지는 최대 폭과 상관없이 글 폭을 꽉 채워요."
            control={<Switch label="가로 이미지는 꽉 채우기" checked={display.wideFill} onChange={(wideFill) => changeDisplay({ wideFill })} />}
          />
          <SettingRow
            label="삽화를 본문에 넣기"
            help="넓은 화면에서도 삽화를 옆에 띄우지 않고 그 문단 바로 뒤에 넣어요."
            control={<Switch label="삽화를 본문에 넣기" checked={display.inlineIllustrations} onChange={(inlineIllustrations) => changeDisplay({ inlineIllustrations })} />}
          />
          <SettingRow
            label="이미지 위치"
            help="넓은 화면에서 삽화와 캐릭터 이미지를 채팅 어느 쪽에 둘지 정해요."
            control={<ChoiceGroup layout="fit" label="이미지 위치" options={choices(SIDE)} value={display.pictureSide} onChange={(pictureSide) => changeDisplay({ pictureSide })} />}
          />
          <SettingRow
            label="캐릭터 이미지 크게 보기"
            help="넓은 화면에서 채팅 옆에 캐릭터 이미지를 크게 띄워요."
            control={<Switch label="캐릭터 이미지 크게 보기" checked={display.portrait} onChange={(portrait) => changeDisplay({ portrait })} />}
          />
        </SettingGroup>
      </Section>
      <Section title="텍스트">
        <SettingGroup label="텍스트">
          <ReadingRows />
          <SettingRow label="대사 모양" control={<ChoiceGroup layout="fit" label="대사 모양" options={choices(QUOTE_SHAPE)} value={display.quotes} onChange={(quotes) => changeDisplay({ quotes })} />} />
        </SettingGroup>
      </Section>
    </Screen>
  );
}

// Unlike a character's, this one is never empty: it is what an empty one follows.
const readWidest = (draft: string) => readPicturePercent(draft) ?? null;

function PictureWidestRow() {
  const { display, changeDisplay } = useDisplay();
  const widest = useTypedNumber(readWidest, display.pictureWidest, { error: PICTURE_PERCENT_ERROR, onChange: (pictureWidest) => changeDisplay({ pictureWidest }) });
  return (
    <SettingRow
      label="이미지 최대 폭"
      help="글 폭 대비 비율이에요."
      error={widest.error}
      control={<NumberInput label="이미지 최대 폭" value={widest.text} unit="%" invalid={widest.error !== undefined} onChange={widest.change} />}
    />
  );
}
