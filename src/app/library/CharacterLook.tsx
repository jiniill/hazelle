import { ImageIcon, ImageUp } from 'lucide-react';
import { mainOf } from '../../engine/assets';
import type { Character } from '../../model/library';
import type { ApiResult } from '../../runtime/api';
import { setBackdrop, setLook } from '../../runtime/library/characters';
import { addOf, ACTS } from '../common/acts';
import { useAssetFiles } from '../common/AssetsEditor';
import { backdropShades, choices } from '../common/reading';
import { presetChoices } from '../common/ReadingRows';
import { CHANGE_IMAGE, PRESET_GONE, PRESET_GONE_CHIP, SAVE_FAILED } from '../common/words';
import { useDisplay } from '../display';
import { useAssetUrl, useChildren, useStore } from '../session';
import { useToast } from '../toast';
import { Avatar, ChoiceGroup, FileButton, Row, SettingGroup, SettingRow, SHADE, Switch } from '../ui';

const LABEL = '분위기';
// 디스플레이's choice for none: the device's look.
const DEVICE = '';

// 표시's first group (design §6.4): the look its chats wear and the background drawn behind them.
export function CharacterLook({ id, character }: { id: string; character: Character }) {
  const store = useStore();
  const toast = useToast();
  const { presets, own, find } = useDisplay();
  const gone = character.look !== undefined && find(character.look) === undefined;
  const background = mainOf(useChildren('asset', id).flatMap((asset) => (asset.value.use === 'background' ? [{ ...asset, name: asset.value.name }] : [])));
  const url = useAssetUrl([background]);
  const files = useAssetFiles(id, 'background');
  const on = character.backdrop?.off !== true;
  const shades = backdropShades(character.backdrop);
  const save = (write: Promise<ApiResult<unknown>>) => toast.settled(write, SAVE_FAILED);
  return (
    <SettingGroup label={LABEL}>
      <SettingRow
        label="디스플레이"
        help="이 캐릭터의 채팅에서만 이 프리셋의 색과 글꼴을 써요. 글자 크기와 간격은 기기 설정을 따라요."
        error={gone ? PRESET_GONE : undefined}
        control={
          <ChoiceGroup
            layout="fit"
            label="디스플레이"
            options={[{ value: DEVICE, label: '기기 설정 따르기' }, ...presetChoices([...presets, ...own.presets])]}
            value={gone ? null : (character.look ?? DEVICE)}
            empty={PRESET_GONE_CHIP}
            onChange={(look) => save(setLook(store, id, look === DEVICE ? null : look))}
          />
        }
      />
      <SettingRow
        label="배경 이미지"
        help="채팅 화면 뒤에 깔리는 이미지예요. 여기서 올린 이미지는 에셋의 배경에도 들어가요."
        control={
          <Row kind="actions">
            <Avatar face={ImageIcon} image={background && url('asset', background.id)} />
            {background ? (
              <FileButton accept={files.accept} size="sm" icon={ImageUp} onFiles={([file]) => void files.replace(background.id, file!)}>
                {CHANGE_IMAGE}
              </FileButton>
            ) : (
              <FileButton accept={files.accept} size="sm" icon={ACTS.create.icon} busy={files.adding} onFiles={(picked) => void files.add(picked)}>
                {addOf('이미지')}
              </FileButton>
            )}
            {background && <Switch label="배경 이미지" checked={on} onChange={(next) => save(setBackdrop(store, id, { off: next ? undefined : true }))} />}
          </Row>
        }
      />
      {background && on && (
        <>
          <SettingRow
            label="배경 가림"
            help="이미지 위에 채팅 배경색을 덮어요. 진할수록 글자가 잘 보여요."
            control={<ChoiceGroup layout="segmented" label="배경 가림" options={choices(SHADE)} value={shades.veil} onChange={(veil) => save(setBackdrop(store, id, { veil }))} />}
          />
          <SettingRow
            label="배경 흐림"
            control={<ChoiceGroup layout="segmented" label="배경 흐림" options={choices(SHADE)} value={shades.blur} onChange={(blur) => save(setBackdrop(store, id, { blur }))} />}
          />
        </>
      )}
    </SettingGroup>
  );
}
