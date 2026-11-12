import { setLook } from '../../runtime/library/characters';
import { presetOf } from '../common/reading';
import { HidePicturesRow, presetChoices, ReadingRows, ReplyRow } from '../common/ReadingRows';
import { PRESET, PRESET_GONE, PRESET_GONE_CHIP, RESET, SAVE_FAILED, READING_SETTINGS } from '../common/words';
import { useDisplay } from '../display';
import { useStore } from '../session';
import { useToast } from '../toast';
import { Button, ChoiceGroup, Dialog, Row, SettingRow, Stack, Switch } from '../ui';

type Held = { id: string; look: string | undefined } | null;

// character: the chat's, null for a chat with none.
export function ReadingDialog({ character, onClose }: { character: Held; onClose: () => void }) {
  const { reset, find } = useDisplay();
  return (
    <Dialog title={READING_SETTINGS} onClose={onClose}>
      <Stack gap="related">
        <PresetRow character={character} />
        <HidePicturesRow />
        <ReadingRows fontHeld={find(character?.look) !== undefined} />
        <ReplyRow />
        <Row kind="actions">
          <Button variant="link" size="sm" onClick={reset}>
            {RESET}
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}

// A chat's: while its character holds a preset (이 캐릭터에 고정, design §6.4) a pick changes the character's, else the
// device's. character: null for a chat with none.
function PresetRow({ character }: { character: Held }) {
  const store = useStore();
  const toast = useToast();
  const { reading, display, presets, own, pick, find } = useDisplay();
  const all = [...presets, ...own.presets];
  const current = presetOf(all, reading, display);
  const held = character?.look !== undefined;
  const gone = held && find(character!.look) === undefined;
  const hold = (look: string | null) => toast.settled(setLook(store, character!.id, look), SAVE_FAILED);
  return (
    <>
      <SettingRow
        label={PRESET.noun}
        error={gone ? PRESET_GONE : undefined}
        control={
          <ChoiceGroup
            layout="fit"
            label={PRESET.noun}
            options={presetChoices(all)}
            value={held ? (gone ? null : character!.look!) : (current?.id ?? null)}
            empty={gone ? PRESET_GONE_CHIP : '직접 설정'}
            onChange={(id) => (held ? hold(id) : pick(all.find((preset) => preset.id === id)!))}
          />
        }
      />
      {character && (
        <SettingRow
          label="이 캐릭터에 고정"
          help="프리셋을 선택해 켜면 그 색과 글꼴을 이 캐릭터의 채팅에만 적용해요."
          control={<Switch label="이 캐릭터에 고정" checked={held} disabled={!held && !current} onChange={(on) => hold(on ? current!.id : null)} />}
        />
      )}
    </>
  );
}
