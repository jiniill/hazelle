import { useState, type ReactNode } from 'react';
import { refOf, sameModelRef } from '../../connectors/assignment';
import { entryKey, entryName } from '../../connectors/types';
import type { IllustrateSwitches, Rung } from '../../model/illustration';
import type { IllustrateSetup } from '../../runtime/characters';
import { drawingModels, type ImageRoute, type sceneWriterOf } from '../../runtime/illustrate';
import { illustrationPrompt } from '../../runtime/prompts';
import { useConnections, useSession } from '../session';
import { navigate } from '../shell/router';
import { Button, ChipButton, Menu, MenuHeading, MenuItem, NumberInput, SettingGroup, SettingRow, Switch } from '../ui';
import { ACTS, addOf, newOf } from './acts';
import { DetailFold } from './DetailFold';
import { EntryList } from './EntryList';
import { describeIllustrateFailure } from './failure';
import { readTyped } from './typedNumber';
import { appliesTo, TaskModelRow, TaskPromptMenu, type PromptDoor } from './TaskPrompt';
import { follows, NOT_STARRED } from './words';

type Props = {
  illustrate: IllustrateSetup;
  sceneWriter: ReturnType<typeof sceneWriterOf>;
  card: { name: string } | null;
  opens: 'up' | 'down';
  onChange: (change: Partial<IllustrateSwitches>) => void;
  onEditPrompt: (door: PromptDoor) => void;
  // Rows that belong with the switch, such as the chat's 캐릭터별 설정.
  children?: ReactNode;
};

// Share these rows between chat dialog and global settings; details count only explicitly set values.
export function IllustrateRows({ illustrate, sceneWriter, card, opens, onChange, onEditPrompt, children }: Props) {
  const { store } = useSession();
  const routes = drawingModels(useConnections());
  const prompt = illustrationPrompt(store, illustrate.prompt);
  const set = [illustrate.ladder.length > 0, illustrate.pov, illustrate.comic, illustrate.spend, illustrate.model !== undefined, illustrate.prompt !== undefined].filter(Boolean).length;
  return (
    <>
      <SettingGroup label="삽화">
        <SettingRow
          label="자동 삽화"
          help="응답을 받을 때마다 삽화를 만들어요. 만들 때마다 연결된 이미지 모델의 사용량이 차감돼요."
          control={<Switch label="자동 삽화" checked={illustrate.auto} onChange={(auto) => onChange({ auto })} />}
        />
        <SettingRow
          label="이미지 모델"
          sub={routes.length ? undefined : '이미지를 만들 모델이 없어요'}
          control={
            routes.length ? (
              <ImageModelMenu routes={routes} illustrate={illustrate} card={card} opens={opens} onPick={onChange} />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => navigate({ kind: 'add-connection' })}>
                {newOf('연결')}
              </Button>
            )
          }
        />
        {children}
      </SettingGroup>
      <DetailFold set={set}>
        <PictureLadder ladder={illustrate.ladder} onChange={(ladder) => onChange({ ladder: ladder.length ? ladder : undefined })} />
        <SettingRow
          label="페르소나 시점"
          help="페르소나의 눈으로 보는 장면을 그려요. 페르소나는 삽화에 나오지 않아요."
          control={<Switch label="페르소나 시점" checked={illustrate.pov} onChange={(pov) => onChange({ pov })} />}
        />
        <SettingRow
          label="만화 형식"
          help="한 장을 여러 컷이 있는 만화 페이지로 그려요. 말풍선 글자는 모델이 그려서 읽을 수 없어요."
          control={<Switch label="만화 형식" checked={illustrate.comic} onChange={(comic) => onChange({ comic })} />}
        />
        <SettingRow
          label="유료 생성 시 확인 생략"
          help="요금이 나갈 때도 물어보지 않고 만들어요."
          control={<Switch label="유료 생성 시 확인 생략" checked={illustrate.spend} onChange={(spend) => onChange({ spend })} />}
        />
        <SettingRow
          label="삽화 프롬프트"
          control={<TaskPromptMenu task="illustrate" chosen={illustrate.prompt} heading={appliesTo(card, illustrate.own)} opens={opens} onPick={(prompt) => onChange({ prompt })} onEdit={onEditPrompt} />}
        />
        <TaskModelRow label="장면 모델" noun="삽화" choice={prompt} model={'kind' in sceneWriter ? describeIllustrateFailure(sceneWriter) : entryName(sceneWriter.route.model)} onEdit={onEditPrompt} />
      </DetailFold>
    </>
  );
}

const RUNG = 3000;

type Draft = { from: string; count: string };
type Read = { ok: true; rung: Rung } | { ok: false; error: string };
type Readable = Extract<Read, { ok: true }>;

function readRung({ from, count }: Draft, before: Rung | null): Read {
  const least = { from: (before?.from ?? 0) + 1, count: (before?.count ?? 1) + 1 };
  const length = readTyped(from, true);
  if (!length.ok) return length;
  if (length.value < least.from) return { ok: false, error: `${least.from.toLocaleString('ko-KR')}자 이상으로 입력해 주세요.` };
  const pictures = readTyped(count, true);
  if (!pictures.ok) return pictures;
  if (pictures.value < least.count) return { ok: false, error: `${least.count}장 이상으로 입력해 주세요.` };
  return { ok: true, rung: { from: length.value, count: pictures.value } };
}

// Each read against the last rung that reads.
function readAll(drafts: Draft[]): Read[] {
  const read: Read[] = [];
  let before: Rung | null = null;
  for (const draft of drafts) {
    const rung = readRung(draft, before);
    if (rung.ok) before = rung.rung;
    read.push(rung);
  }
  return read;
}

const draftOf = ({ from, count }: Rung): Draft => ({ from: String(from), count: String(count) });

// 삽화 수 (model/illustration pictureCount): one picture, and each rung's count from its length on. The ladder is saved
// only while every rung reads.
function PictureLadder({ ladder, onChange }: { ladder: Rung[]; onChange: (ladder: Rung[]) => void }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const shown = drafts ?? ladder.map(draftOf);
  const read = readAll(shown);
  const change = (next: Draft[]) => {
    setDrafts(next);
    const rungs = readAll(next);
    if (rungs.every((rung) => rung.ok)) onChange(rungs.map((rung) => (rung as Readable).rung));
  };
  const last = read.findLast((rung): rung is Readable => rung.ok)?.rung;
  return (
    <EntryList
      entries={shown}
      onChange={change}
      name={(at) => `${at + 1}단계`}
      blank={draftOf({ from: (last?.from ?? 0) + RUNG, count: (last?.count ?? 1) + 1 })}
      addLabel={addOf('단계')}
      removed={(at) => `${at + 1}단계를 삭제했어요.`}
      head={(add) => (
        <SettingRow
          label="삽화 수"
          help="응답이 길면 삽화를 더 많이 만들어요. 글자 수는 태그를 빼고 세요."
          sub={ladder.length ? undefined : '응답마다 1장'}
          control={
            <Button variant="ghost" size="sm" icon={ACTS.create.icon} onClick={add.onClick}>
              {add.label}
            </Button>
          }
        />
      )}
    >
      {({ value: draft, index: at, name, set, remove }) => {
        const rung = read[at]!;
        return (
          <SettingRow
            label={name}
            sentence={
              <>
                <NumberInput label={`${name} 글자 수`} value={draft.from} unit="자" invalid={!rung.ok} onChange={(from) => set({ ...draft, from })} />
                {' 이상 '}
                <NumberInput label={`${name} 장 수`} value={draft.count} unit="장" invalid={!rung.ok} onChange={(count) => set({ ...draft, count })} />
              </>
            }
            error={rung.ok ? undefined : rung.error}
            control={remove}
          />
        );
      }}
    </EntryList>
  );
}

export const imageModelOf = (routes: ImageRoute[], illustrate: IllustrateSetup) => {
  const own = illustrate.model;
  return own ? routes.find(({ connection, model }) => sameModelRef(own, refOf(connection.id, model))) : routes[0];
};

// One no longer added shows as missing, never as another model.
function ImageModelMenu({ routes, illustrate, card, opens, onPick }: Pick<Props, 'illustrate' | 'card' | 'opens'> & { routes: ImageRoute[]; onPick: Props['onChange'] }) {
  const own = illustrate.model;
  const choice = imageModelOf(routes, illustrate);
  return (
    <Menu
      place={opens === 'up' ? 'above-end' : 'below-end'}
      label="이미지 모델"
      trigger={(opener) => <ChipButton variant="field" opens={opens} label={choice ? entryName(choice.model) : NOT_STARRED} title="이미지 모델" tone={choice ? 'plain' : 'warn'} {...opener} />}
    >
      <MenuHeading>{appliesTo(card, illustrate.own)}</MenuHeading>
      <MenuItem label={follows('첫 이미지 모델')} sub={entryName(routes[0]!.model)} checked={!own} onClick={() => onPick({ model: undefined })} />
      {routes.map(({ connection, model }) => (
        <MenuItem
          key={`${connection.id}/${entryKey(model)}`}
          label={entryName(model)}
          sub={connection.value.label}
          checked={!!own && sameModelRef(own, refOf(connection.id, model))}
          onClick={() => onPick({ model: refOf(connection.id, model) })}
        />
      ))}
    </Menu>
  );
}
