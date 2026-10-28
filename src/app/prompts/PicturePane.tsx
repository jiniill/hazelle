import { useState } from 'react';
import type { Draws } from '../../connectors/types';
import { PICTURE_DEFAULTS } from '../../engine/illustrate';
import type { PictureSettings, PictureSize, PictureTags } from '../../model/prompt';
import { drawingModels } from '../../runtime/illustrate';
import { typedText } from '../common/typed';
import { readTyped } from '../common/typedNumber';
import { ORIGINAL, RESET, UNSET } from '../common/words';
import { useConnections } from '../session';
import { Button, ChipButton, MarkupArea, Menu, MenuHeading, MenuItem, NumberInput, Section, SettingGroup, SettingRow, Stack } from '../ui';

type Props = { tags: PictureTags | undefined; picture: PictureSettings | undefined; onTags: (tags: PictureTags | undefined) => void; onPicture: (picture: PictureSettings) => void };

type NumberField = Exclude<keyof PictureSettings, 'sampler' | 'size'>;

const SIZE_LABELS: Record<PictureSize, string> = { normal: '기본', large: '크게' };

// Bounds only where a source states them; NovelAI answers a value past its own with a refusal the 삽화 slot shows.
const NUMBERS: Record<NumberField, { label: string; help?: string; whole: boolean; check: (value: number) => boolean; error: string; unset: string }> = {
  steps: { label: '스텝', whole: true, check: (value) => value >= 1, error: '1 이상의 값을 입력해 주세요.', unset: UNSET },
  scale: { label: '프롬프트 가이던스', whole: false, check: (value) => value >= 0, error: '0 이상의 값을 입력해 주세요.', unset: UNSET },
  rescale: { label: '가이던스 리스케일', whole: false, check: (value) => value >= 0 && value <= 1, error: '0부터 1 사이의 값을 입력해 주세요.', unset: UNSET },
  seed: { label: '시드', help: '값을 정해 두면 같은 장면은 늘 같은 이미지로 만들어요.', whole: true, check: (value) => value >= 0 && value <= 0xffffffff, error: '0부터 4294967295 사이의 값을 입력해 주세요.', unset: '무작위' },
};

const TAG_FIELDS: { field: keyof PictureTags; label: string; placeholder?: string }[] = [
  { field: 'artist', label: '작가 태그', placeholder: 'artist:이름, 1.2::artist:이름::' },
  { field: 'quality', label: '품질 태그' },
  { field: 'negative', label: '제외할 태그' },
];

// The tag fields show the app's tags while the prompt sets none, since those are what is sent; the first edit stores
// all three, and an emptied field sends none rather than the app's.
export function PicturePane({ tags, picture = {}, onTags, onPicture }: Props) {
  const shown = tags ?? PICTURE_DEFAULTS;
  const setTag = (field: keyof PictureTags) => (value: string) => onTags({ ...shown, [field]: value });
  const draws = drawingModels(useConnections())[0]?.draws;
  const [drafts, setDrafts] = useState<Partial<Record<NumberField, string>>>({});

  const read = (field: NumberField, text: string) => {
    const typed = readTyped(text, NUMBERS[field].whole);
    if (!typed.ok) return typed;
    return NUMBERS[field].check(typed.value) ? typed : { ok: false as const, error: NUMBERS[field].error };
  };
  const numberRow = (field: NumberField) => {
    const { label, help, unset } = NUMBERS[field];
    const value = picture[field];
    const draft = typedText(drafts[field], (text) => (text.trim() === '' ? undefined : read(field, text).ok ? Number(text) : null), value, (number) => (number === undefined ? '' : String(number)));
    const typed = draft.trim() === '' ? null : read(field, draft);
    const type = (text: string) => {
      setDrafts((current) => ({ ...current, [field]: text }));
      const next = text.trim() === '' ? null : read(field, text);
      if (next === null) onPicture({ ...picture, [field]: undefined });
      else if (next.ok) onPicture({ ...picture, [field]: next.value });
    };
    return (
      <SettingRow
        key={field}
        label={label}
        help={help}
        changed={value !== undefined}
        error={typed && !typed.ok ? typed.error : undefined}
        control={<NumberInput label={label} value={draft} placeholder={unset} invalid={typed?.ok === false} onChange={type} />}
      />
    );
  };

  return (
    <Stack gap="section">
      <Section
        title="태그"
        note={tags ? '직접 지정' : '기본값'}
        help="작가 태그는 맨 앞에, 품질 태그는 장면 설명 뒤에 붙어요."
        action={
          tags && (
            <Button variant="link" onClick={() => onTags(undefined)}>
              {RESET}
            </Button>
          )
        }
      >
        <Stack gap="related">
          {TAG_FIELDS.map(({ field, label, placeholder }) => (
            <Section key={field} title={label} level={3}>
              <MarkupArea label={label} variant="field" kind="tags" value={shown[field]} onChange={setTag(field)} placeholder={placeholder} />
            </Section>
          ))}
        </Stack>
      </Section>
      <Section title="생성" help={`비워 두면 이미지 모델의 ${ORIGINAL}을 써요.`}>
        <SettingGroup label="생성">
          <SettingRow
            label="크기"
            help="크게는 NovelAI 무료 범위를 넘어서, 만들 때마다 Anlas가 차감돼요."
            sub={picture.size === 'large' ? '생성할 때마다 Anlas가 차감돼요.' : undefined}
            changed={picture.size !== undefined}
            control={
              <Menu place="below-end" label="크기" trigger={(opener) => <ChipButton variant="field" opens="down" label={SIZE_LABELS[picture.size ?? 'normal']} title="크기" {...opener} />}>
                <MenuItem label={SIZE_LABELS.normal} checked={picture.size === undefined} onClick={() => onPicture({ ...picture, size: undefined })} />
                <MenuItem label={SIZE_LABELS.large} checked={picture.size === 'large'} onClick={() => onPicture({ ...picture, size: 'large' })} />
              </Menu>
            }
          />
          <SettingRow label="샘플러" changed={picture.sampler !== undefined} control={<SamplerMenu draws={draws} chosen={picture.sampler} onPick={(sampler) => onPicture({ ...picture, sampler })} />} />
          {numberRow('steps')}
          {numberRow('scale')}
          {numberRow('rescale')}
          {numberRow('seed')}
        </SettingGroup>
      </Section>
    </Stack>
  );
}

// The samplers are the first image model's connection type's; without one, only a choice already made shows.
function SamplerMenu({ draws, chosen, onPick }: { draws: Draws | undefined; chosen: string | undefined; onPick: (sampler: string | undefined) => void }) {
  const samplers = draws?.samplers ?? [];
  const label = chosen === undefined ? UNSET : (samplers.find(({ id }) => id === chosen)?.label ?? chosen);
  return (
    <Menu place="below-end" label="샘플러" trigger={(opener) => <ChipButton variant="field" opens="down" label={label} title="샘플러" {...opener} />}>
      {!draws && <MenuHeading>이미지를 만들 모델이 없어요</MenuHeading>}
      <MenuItem label={UNSET} checked={chosen === undefined} onClick={() => onPick(undefined)} />
      {samplers.map(({ id, label: name }) => (
        <MenuItem key={id} label={name} checked={chosen === id} onClick={() => onPick(id)} />
      ))}
    </Menu>
  );
}
