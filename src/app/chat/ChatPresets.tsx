import type { ChatPreset } from '../../model/settings';
import { chatPresets, chatSetup, holds, partsOf, presetNames, togglesApart } from '../../runtime/chat/presets';
import { translateSwitches } from '../../runtime/library/characters';
import { PresetList } from '../common/PresetList';
import { usePresetActs } from '../common/usePresetActs';
import { ACTS } from '../common/acts';
import { CHAT_PRESET, FEATURE_NAMES, MOVE_FAILED, namedObject, onOff, PRESET, promptName } from '../common/words';
import { useCaptured, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Button, Dialog, Divider, MenuHeading, MenuItem } from '../ui';
import type { OpenChat } from './useChat';

const GONE = { model: '추가한 모델에 없는 모델이에요.', prompt: '삭제된 프롬프트예요.' };
const NOTHING_TO_KEEP = { model: '대화 모델이 없어서 저장할 수 없어요.', prompt: '프롬프트를 보내지 않는 채팅이라 저장할 수 없어요.' };

// A chat's presets as its rows say them, and the one it runs on now. A row names what a pick changes, and the toggles
// that stand otherwise, which nothing else on it would show.
export function useChatPresets({ place, actions }: OpenChat) {
  const toast = useToast();
  const presets = useSettings().chatPresets;
  const read = useCaptured(
    (store) => {
      const setup = chatSetup(store, place);
      const { replies, input, reverse } = translateSwitches(store, place.character);
      const rows = (presets ?? []).map((preset) => {
        const names = presetNames(store, preset);
        if ('lacks' in names) return { preset, words: { error: GONE[names.lacks] } };
        const apart = 'lacks' in setup ? 0 : togglesApart(setup, preset);
        return { preset, words: { description: [names.model, promptName(names.prompt), `${FEATURE_NAMES.translate} ${onOff(preset.translate)}`, ...(apart ? [`토글 ${apart}개 다름`] : [])].join(' · ') } };
      });
      return { setup, rows, current: 'lacks' in setup ? null : (rows.find(({ preset }) => holds(setup, preset))?.preset ?? null), idle: !(replies || input || reverse) };
    },
    [place, presets],
  );

  async function pick(preset: ChatPreset) {
    const picked = await actions.pickChatPreset(preset);
    if (!picked.ok) return toast.failed(picked, '프리셋을 적용하지 못했어요.');
    toast.undoable(`${namedObject(preset.name, PRESET.noun)} 적용했어요.`, picked.data, preset.translate && read.idle ? '자동 번역은 꺼져 있어요. 입력창의 번역에서 켤 수 있어요.' : undefined);
  }

  return { ...read, pick };
}

// At the head of the chat's model menu: a pick of one, and the door to keeping and managing them.
export function ChatPresetItems({ presets: { rows, current, pick }, onManage }: { presets: ReturnType<typeof useChatPresets>; onManage: () => void }) {
  return (
    <>
      {rows.length > 0 && <MenuHeading>{CHAT_PRESET}</MenuHeading>}
      {rows.map(({ preset, words }) => (
        <MenuItem key={preset.id} label={preset.name} description={'error' in words ? words.error : words.description} checked={preset === current} disabled={'error' in words} onClick={() => void pick(preset)} />
      ))}
      <MenuItem tone="muted" label={`${CHAT_PRESET} 저장·관리`} onClick={onManage} />
      <Divider variant="menu" />
    </>
  );
}

export function ChatPresetsDialog({ chat }: { chat: OpenChat }) {
  const list = chatPresets(useStore());
  const toast = useToast();
  const { setup, rows, current, pick } = useChatPresets(chat);
  const kept = 'lacks' in setup ? null : partsOf(setup);
  const acts = usePresetActs({
    count: rows.length,
    current,
    keep: kept && { add: (name) => list.add({ id: crypto.randomUUID(), name, ...kept }), over: ({ id }) => list.edit(id, kept) },
    rename: ({ id }: ChatPreset, name) => list.edit(id, { name }),
    remove: ({ id }) => list.remove(id),
    restore: list.restore,
  });
  const close = chat.actions.closeDialog;
  const move = (from: number, to: number) => toast.settled(list.move(rows[from]!.preset.id, rows[to]!.preset.id), MOVE_FAILED);
  const menu = (preset: ChatPreset) => {
    const at = rows.findIndex((row) => row.preset === preset);
    return acts.items(
      preset,
      <>
        {at > 0 && <MenuItem icon={ACTS.moveUp.icon} label={ACTS.moveUp.label} onClick={() => move(at, at - 1)} />}
        {at < rows.length - 1 && <MenuItem icon={ACTS.moveDown.icon} label={ACTS.moveDown.label} onClick={() => move(at, at + 1)} />}
      </>,
    );
  };
  return (
    <>
      <Dialog
        title={CHAT_PRESET}
        note={'lacks' in setup ? NOTHING_TO_KEEP[setup.lacks] : undefined}
        onClose={close}
        actionsLayout="full"
        actions={
          !current && (
            <Button variant="secondary" disabled={!acts.save} onClick={acts.save ?? undefined}>
              {PRESET.save}
            </Button>
          )
        }
      >
        <PresetList
          label={CHAT_PRESET}
          presets={rows.map(({ preset }) => preset)}
          current={current}
          words={(preset) => rows.find((row) => row.preset === preset)!.words}
          onPick={(preset) => {
            close();
            void pick(preset);
          }}
          menu={menu}
        />
      </Dialog>
      {acts.dialog}
    </>
  );
}
