import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { storyHtml } from '../../engine/display';
import { setUsageShown } from '../../runtime/chat/chat-context';
import { STARTER_PRESETS, presetsOf } from '../../model/settings';
import { addLook, addStarters, editLook, moveLook, removeLook, restoreLook } from '../../runtime/library/looks';
import { CacheNoteRow } from '../common/CacheNoteRow';
import { ACTS } from '../common/acts';
import { NameDialog } from '../common/NameDialog';
import { readPicturePercent } from '../common/picturePercent';
import { HidePicturesRow, presetChoices, ReadingRows } from '../common/ReadingRows';
import { choices, LOOK_SAMPLE, SIDE, lookOf, presetOf, type Preset } from '../common/reading';
import { useTypedNumber } from '../common/typed';
import { reader } from '../common/typedNumber';
import { CHAT_LOOK, DETAIL, detailLabel, PAGES, PICTURE_PLACE, PRESET, PRESET_GONE, PRESET_GONE_CHIP, SAVE_FAILED } from '../common/words';
import { useDisplay } from '../display';
import { useSettings, useStore } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useRemoval } from '../common/useRemoval';
import { useToast } from '../toast';
import { ACCENT, BG, Button, DIALOGUE, QUOTE_SHAPE, ChoiceGroup, ColorDot, Disclosure, INK, MenuItem, NavBar, NumberInput, ReadingPreview, Screen, Section, SettingGroup, SettingRow, Swatches, Switch, MODE, type Mode, type PreviewRow } from '../ui';

const SAMPLE: PreviewRow[] = [
  { name: '캐릭터', mine: false, html: storyHtml(`*창밖으로 늦은 오후의 햇살이 기울어 든다.* 그녀는 찻잔을 내려놓고 고개를 들었다. "오늘은 어디까지 읽었어? 지난번엔 중간에 잠들었잖아." '또 잠든 건 아니겠지.'`, true) },
  { name: '나', mine: true, html: storyHtml('"이번엔 끝까지 읽었어. 결말이 좀 의외던데."', false) },
];


const SLOTS: Record<Mode, string> = { light: '밝은 모드일 때', dark: '어두운 모드일 때' };
const SLOT_KEYS = Object.keys(SLOTS) as Mode[];

const colorChoices = <T extends string>(pick: 'bg' | 'ink' | 'accent' | 'dialogue', labels: Record<T, string>) =>
  choices(labels).map((option) => ({ ...option, mark: <ColorDot pick={pick} value={option.value} /> }));

export function DisplayScreen({ back }: { back: Back | null }) {
  const { reading, display, presets, unread, changeDisplay, pick, followSystem, assign } = useDisplay();
  const store = useStore();
  const toast = useToast();
  const removal = useRemoval();
  const saved = presetsOf(useSettings());
  const current = presetOf(presets, reading, display);
  const [naming, setNaming] = useState<{ preset: Preset | null } | null>(null);
  const missing = (mode: Mode) => display.follow !== null && !presets.some((preset) => preset.id === display.follow![mode]);
  // Folded, a slot whose preset is gone would say so to no one.
  const [detailOpen, setDetailOpen] = useState(() => SLOT_KEYS.some(missing));

  function name(typed: string) {
    const preset = naming?.preset;
    setNaming(null);
    if (preset) return toast.settled(editLook(store, preset.id, { name: typed.trim() || preset.name }), '이름을 바꾸지 못했어요.');
    toast.settled(addLook(store, { id: crypto.randomUUID(), name: typed.trim() || PRESET.named(presets.length), look: lookOf(reading, display) }), SAVE_FAILED);
  }

  const remove = ({ id, name }: Preset) => removal({ name: () => name, noun: PRESET.noun, task: () => removeLook(store, id), restore: (removed) => restoreLook(store, removed) });

  const move = (from: number, to: number) => toast.settled(moveLook(store, presets[from]!.id, presets[to]!.id), '옮기지 못했어요.');

  const swatch = (preset: Preset) => ({ name: preset.name, ...preset.look, pressed: preset === current, onPick: () => pick(preset) });
  const menu = (preset: Preset, index: number) => (
    <>
      <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setNaming({ preset })} />
      {preset !== current && <MenuItem icon={ACTS.overwrite.icon} label={ACTS.overwrite.label} onClick={() => toast.settled(editLook(store, preset.id, { look: lookOf(reading, display) }), SAVE_FAILED)} />}
      {index > 0 && <MenuItem icon={ArrowLeft} label="앞으로 옮기기" onClick={() => move(index, index - 1)} />}
      {index < presets.length - 1 && <MenuItem icon={ArrowRight} label="뒤로 옮기기" onClick={() => move(index, index + 1)} />}
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
        title={PRESET.noun}
        note={unread > 0 ? `읽지 못한 ${PRESET.noun} ${unread}개` : undefined}
        action={
          !current && (
            <Button variant="ghost" onClick={() => setNaming({ preset: null })}>
              현재 설정 저장
            </Button>
          )
        }
      >
        <Swatches label={PRESET.noun} sample={LOOK_SAMPLE} items={presets.map((preset, index) => ({ ...swatch(preset), menu: menu(preset, index) }))} onMove={move} />
        {STARTER_PRESETS.some(({ id }) => !saved.some((look) => look.id === id)) && (
          <Button variant="link" onClick={() => toast.settled(addStarters(store), SAVE_FAILED)}>
            {`기본 ${PRESET.noun} ${ACTS.restore.label}`}
          </Button>
        )}
        <Disclosure label={detailLabel(display.follow ? 1 : 0)} open={detailOpen} onOpen={setDetailOpen}>
          <SettingGroup label={DETAIL}>
            <SettingRow
              label="시스템 설정 연동"
              help={{ text: '기기의 밝은·어두운 모드에 맞춰 프리셋을 자동으로 전환해요. 직접 변경한 값은 모드가 바뀔 때 프리셋 설정으로 돌아가요.', demo: { name: 'followSystem' } }}
              control={<Switch label="시스템 설정 연동" checked={display.follow !== null} disabled={display.follow === null && presets.length === 0} onChange={followSystem} />}
            />
            {display.follow &&
              SLOT_KEYS.map((mode) => (
                <SettingRow
                  key={mode}
                  label={SLOTS[mode]}
                  error={missing(mode) ? PRESET_GONE : undefined}
                  control={<ChoiceGroup layout="fit" label={SLOTS[mode]} options={presetChoices(presets)} value={missing(mode) ? null : display.follow![mode]} empty={PRESET_GONE_CHIP} onChange={(picked) => assign(mode, presets.find((preset) => preset.id === picked)!)} />}
                />
              ))}
          </SettingGroup>
        </Disclosure>
      </Section>
      {naming && (
        <NameDialog
          title={naming.preset ? PRESET.rename : PRESET.save}
          value={naming.preset?.name ?? PRESET.named(presets.length)}
          onSave={name}
          onClose={() => setNaming(null)}
        />
      )}
      <Section title="색">
        <SettingGroup label="색">
          <SettingRow label="모드" control={<ChoiceGroup layout="fit" label="모드" options={choices(MODE)} value={display.mode} onChange={(mode) => changeDisplay({ mode })} />} />
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
            help={{ text: '가로가 세로보다 긴 이미지는 최대 폭과 상관없이 읽기 폭을 꽉 채워요.', demo: { name: 'wideFill', ways: { on: display.wideFill } } }}
            control={<Switch label="가로 이미지는 꽉 채우기" checked={display.wideFill} onChange={(wideFill) => changeDisplay({ wideFill })} />}
          />
          <SettingRow
            label="삽화를 본문에 넣기"
            help={{ text: '넓은 화면에서도 삽화를 옆에 띄우지 않고 그 문단 바로 뒤에 넣어요.', demo: { name: 'inlineIllustrations', ways: { on: display.inlineIllustrations } } }}
            control={<Switch label="삽화를 본문에 넣기" checked={display.inlineIllustrations} onChange={(inlineIllustrations) => changeDisplay({ inlineIllustrations })} />}
          />
          <SettingRow
            label={PICTURE_PLACE}
            help={{ text: '넓은 화면에서 삽화와 캐릭터 이미지를 채팅 어느 쪽에 둘지 정해요.', demo: { name: 'pictureSide', ways: { labels: [SIDE.right, SIDE.left], now: display.pictureSide === 'right' ? 0 : 1 } } }}
            control={<ChoiceGroup layout="fit" label={PICTURE_PLACE} options={choices(SIDE)} value={display.pictureSide} onChange={(pictureSide) => changeDisplay({ pictureSide })} />}
          />
          <SettingRow
            label="캐릭터 이미지 크게 보기"
            help={{ text: '넓은 화면에서 채팅 옆에 캐릭터 이미지를 크게 띄워요.', demo: { name: 'portrait' } }}
            control={<Switch label="캐릭터 이미지 크게 보기" checked={display.portrait} onChange={(portrait) => changeDisplay({ portrait })} />}
          />
        </SettingGroup>
      </Section>
      <Section title="텍스트">
        <SettingGroup label="텍스트">
          <ReadingRows />
          <SettingRow label="대사 따옴표" control={<ChoiceGroup layout="fit" label="대사 따옴표" options={choices(QUOTE_SHAPE)} value={display.quotes} onChange={(quotes) => changeDisplay({ quotes })} />} />
        </SettingGroup>
      </Section>
      <Section title={CHAT_LOOK}>
        <SettingGroup label={CHAT_LOOK}>
          <UsageShownRow />
          <CacheNoteRow />
        </SettingGroup>
      </Section>
    </Screen>
  );
}

// Unlike a character's, this one is never empty: it is what an empty one follows.
const readWidest = reader((draft) => readPicturePercent(draft) ?? null, readPicturePercent.error);

function PictureWidestRow() {
  const { display, changeDisplay } = useDisplay();
  const widest = useTypedNumber(readWidest, display.pictureWidest, { onChange: (pictureWidest) => changeDisplay({ pictureWidest }) });
  return (
    <SettingRow
      label="이미지 최대 폭"
      help="읽기 폭 대비 비율이에요."
      error={widest.error}
      control={<NumberInput label="이미지 최대 폭" value={widest.text} unit="%" invalid={widest.error !== undefined} onChange={widest.change} />}
    />
  );
}

// An account's setting, not this device's: the usage line is part of the reply wherever it is read.
function UsageShownRow() {
  const store = useStore();
  const toast = useToast();
  const { usageShown } = useSettings();
  return (
    <SettingRow
      label="사용량 표시"
      help={{ text: '응답 아래에 비용과 토큰을 한 줄로 보여 줘요. 누르면 자세한 내용이 펼쳐져요.', demo: { name: 'usage' } }}
      changed={usageShown !== undefined}
      control={<Switch label="사용량 표시" checked={usageShown !== undefined} onChange={(on) => toast.settled(setUsageShown(store, on))} />}
    />
  );
}
