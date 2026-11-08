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
      help={{ text: '응답이 길어져 화면 아래로 넘어갈 때 새 줄을 따라 내려갈지, 읽던 위치를 유지할지 정해요.', demo: { name: 'replyScroll', ways: { labels: [REPLY.follow, REPLY.stay], now: reading.reply === 'follow' ? 0 : 1 } } }}
      control={<ChoiceGroup layout="segmented" label="응답 수신 시" options={choices(REPLY)} value={reading.reply} onChange={(reply) => changeReading({ reply })} />}
    />
  );
}

export function HidePicturesRow() {
  const { display, changeDisplay } = useDisplay();
  return (
    <SettingRow
      label="이미지 가리기"
      help={{ text: '채팅에 있는 이미지는 눌러서 하나씩 크게 볼 수 있어요.', demo: { name: 'hidePictures', ways: { on: display.hidePictures } } }}
      control={<Switch label="이미지 가리기" checked={display.hidePictures} onChange={(hidePictures) => changeDisplay({ hidePictures })} />}
    />
  );
}
