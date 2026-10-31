import { useDisplay } from '../display';
import { ChoiceGroup, FontPicker, SettingRow, Stepper, Switch } from '../ui';
import { choices, presetOf, REPLY, SIZE, SPACING, type Preset } from './reading';

export const presetChoices = (presets: Preset[]) => presets.map(({ id, name }) => ({ value: id, label: name }));

export function PresetRow() {
  const { reading, display, presets, own, pick } = useDisplay();
  const all = [...presets, ...own.presets];
  return (
    <SettingRow
      label="프리셋"
      control={<ChoiceGroup layout="fit" label="프리셋" options={presetChoices(all)} value={presetOf(all, reading, display)?.id ?? null} empty="직접 설정" onChange={(id) => pick(all.find((preset) => preset.id === id)!)} />}
    />
  );
}

export function ReadingRows() {
  const { reading, changeReading } = useDisplay();
  return (
    <>
      <SettingRow
        label="글꼴"
        control={<FontPicker label="글꼴" value={reading.font} onChange={(font) => changeReading({ font })} />}
      />
      <SettingRow
        label="글자 크기"
        control={<Stepper label="글자 크기" less="글자 작게" more="글자 크게" value={reading.size} min={SIZE.min} max={SIZE.max} onChange={(size) => changeReading({ size })} />}
      />
      <SettingRow
        label="줄 간격"
        control={<ChoiceGroup layout="segmented" label="줄 간격" options={choices(SPACING)} value={reading.leading} onChange={(leading) => changeReading({ leading })} />}
      />
      <SettingRow
        label="읽기 폭"
        control={<ChoiceGroup layout="segmented" label="읽기 폭" options={choices(SPACING)} value={reading.width} onChange={(width) => changeReading({ width })} />}
      />
    </>
  );
}

export function ReplyRow() {
  const { reading, changeReading } = useDisplay();
  return (
    <SettingRow
      label="응답 수신 시"
      wide
      control={<ChoiceGroup layout="segmented" label="응답 수신 시" options={choices(REPLY)} value={reading.reply} onChange={(reply) => changeReading({ reply })} />}
    />
  );
}

export function CacheNoteRow() {
  const { display, changeDisplay } = useDisplay();
  return (
    <SettingRow
      label="캐시 표시"
      help="보내기 버튼 옆에 남은 시간과 경고를 보여 줘요. 꺼도 캐시는 그대로 쓰고, 점검에서 볼 수 있어요."
      control={<Switch label="캐시 표시" checked={display.cacheNote} onChange={(cacheNote) => changeDisplay({ cacheNote })} />}
    />
  );
}

export function HidePicturesRow() {
  const { display, changeDisplay } = useDisplay();
  return (
    <SettingRow
      label="이미지 가리기"
      help="채팅에 있는 이미지는 눌러서 하나씩 크게 볼 수 있어요."
      control={<Switch label="이미지 가리기" checked={display.hidePictures} onChange={(hidePictures) => changeDisplay({ hidePictures })} />}
    />
  );
}
