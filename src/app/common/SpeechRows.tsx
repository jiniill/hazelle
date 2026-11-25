import { useEffect, useState, type ReactNode } from 'react';
import { refOf, sameModelRef } from '../../connectors/assignment';
import type { Voice } from '../../connectors/types';
import type { SpeechSwitches } from '../../model/speech';
import type { SpeechSetup } from '../../runtime/library/characters';
import { speakingModels, speechRoute, voicesOf, type SpeechFailure, type SpeechRoute } from '../../runtime/tasks/speech';
import { useConnections, useSession, useStore } from '../session';
import { navigate } from '../shell/router';
import { Button, ChipButton, Empty, Menu, MenuHeading, MenuItem, SettingGroup, SettingRow, Switch, useMenuClose } from '../ui';
import { newOf } from './acts';
import { DetailFold } from './DetailFold';
import { describeSpeechFailure } from './failure';
import { appliesTo } from './TaskPrompt';
import { useSearch } from './useSearch';
import { AUTO_SPEECH, FEATURE_NAMES, follows, NO_SPEECH_MODEL, NOT_PICKED, QUOTES_ONLY, searchOf, SPEECH_MODEL, VOICE } from './words';

type Props = {
  speech: SpeechSetup;
  card: { name: string } | null;
  opens: 'up' | 'down';
  onChange: (change: Partial<SpeechSwitches>) => void;
  // Rows that belong with the switch, such as the chat's 캐릭터별 설정.
  children?: ReactNode;
};

// The rows of 음성 the chat's dialog and 설정 › 음성 share.
export function SpeechRows({ speech, card, opens, onChange, children }: Props) {
  const routes = speakingModels(useConnections());
  const route = speechRoute(useStore(), speech.model);
  const group = (
    <SettingGroup label={FEATURE_NAMES.speech}>
      <SettingRow
        label={AUTO_SPEECH}
        help="응답이 오면 바로 소리 내어 읽어요. 읽을 때마다 음성 모델 사용량이 차감돼요."
        control={<Switch label={AUTO_SPEECH} checked={speech.auto} onChange={(auto) => onChange({ auto })} />}
      />
      <SettingRow
        label={SPEECH_MODEL}
        error={routes.length ? undefined : NO_SPEECH_MODEL}
        control={
          routes.length ? (
            <SpeechModelMenu routes={routes} speech={speech} card={card} opens={opens} onChange={onChange} />
          ) : (
            <Button variant="ghost" size="sm" onClick={() => navigate({ kind: 'add-connection' })}>
              {newOf('연결')}
            </Button>
          )
        }
      />
      {!('kind' in route) && <VoiceRow route={route} speech={speech} card={card} opens={opens} onChange={onChange} />}
      {children}
    </SettingGroup>
  );
  return (
    <DetailFold set={speech.quotes ? 1 : 0} above={group}>
      <SettingRow
        label={QUOTES_ONLY}
        help="따옴표 안의 대사만 읽고 서술은 건너뛰어요."
        control={<Switch label={QUOTES_ONLY} checked={speech.quotes} onChange={(quotes) => onChange({ quotes })} />}
      />
    </DetailFold>
  );
}

// A voice is a connection's, so a model on another connection leaves none picked.
function SpeechModelMenu({ routes, speech, card, opens, onChange }: Omit<Props, 'children'> & { routes: SpeechRoute[] }) {
  const own = speech.model;
  const choice = speechRoute(useStore(), own);
  const pick = (route: SpeechRoute | null) => {
    const connection = (route ?? routes[0]!).connection.id;
    onChange({ model: route ? refOf(route.connection.id, route.model) : undefined, ...(speech.voice && speech.voice.connection !== connection && { voice: undefined }) });
  };
  return (
    <Menu
      place={opens === 'up' ? 'above-end' : 'below-end'}
      label={SPEECH_MODEL}
      trigger={(opener) => <ChipButton variant="field" opens={opens} label={'kind' in choice ? '연결된 모델에 없음' : choice.model.name} title={SPEECH_MODEL} tone={'kind' in choice ? 'warn' : 'plain'} {...opener} />}
    >
      <MenuHeading>{appliesTo(card, speech.own)}</MenuHeading>
      <MenuItem label={follows(`첫 ${SPEECH_MODEL}`)} description={routes[0]!.model.name} checked={!own} onClick={() => pick(null)} />
      {routes.flatMap((route, at) => {
        const item = <MenuItem key={`${route.connection.id}/${route.model.id}`} label={route.model.name} checked={!!own && sameModelRef(refOf(route.connection.id, route.model), own)} onClick={() => pick(route)} />;
        return routes[at - 1]?.connection.id === route.connection.id ? [item] : [<MenuHeading key={`heading/${route.connection.id}`}>{route.connection.value.label}</MenuHeading>, item];
      })}
    </Menu>
  );
}

function VoiceRow({ route, speech, card, opens, onChange }: Omit<Props, 'children'> & { route: SpeechRoute }) {
  const voice = speech.voice?.connection === route.connection.id ? speech.voice : null;
  return (
    <SettingRow
      label={VOICE}
      error={voice ? undefined : '목소리를 선택해 주세요.'}
      control={
        <Menu
          place={opens === 'up' ? 'above-end' : 'below-end'}
          label={VOICE}
          trigger={(opener) => <ChipButton variant="field" opens={opens} label={voice?.name ?? NOT_PICKED} title={VOICE} tone={voice ? 'plain' : 'warn'} {...opener} />}
        >
          <MenuHeading>{appliesTo(card, speech.own)}</MenuHeading>
          <Voices route={route} current={voice?.id ?? null} onPick={({ id, name }) => onChange({ voice: { connection: route.connection.id, id, name } })} />
        </Menu>
      }
    />
  );
}

// Mounted only while the menu is open, so each opening reads the account's voices again.
function Voices({ route, current, onPick }: { route: SpeechRoute; current: string | null; onPick: (voice: Voice) => void }) {
  const { credentials } = useSession();
  const [voices, setVoices] = useState<Voice[] | SpeechFailure | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void voicesOf(credentials, route.connection, abort.signal).then((read) => {
      if (!abort.signal.aborted) setVoices(read.ok ? read.voices : read.failure);
    });
    return () => abort.abort();
  }, [credentials, route.connection]);
  if (voices === null) return <Empty variant="menu">목소리를 불러오는 중…</Empty>;
  if (!Array.isArray(voices)) return <Empty variant="menu">{describeSpeechFailure(voices)}</Empty>;
  if (!voices.length) return <Empty variant="menu">이 연결에 목소리가 없어요.</Empty>;
  return <VoiceChoices voices={voices} current={current} onPick={onPick} />;
}

function VoiceChoices({ voices, current, onPick }: { voices: Voice[]; current: string | null; onPick: (voice: Voice) => void }) {
  const close = useMenuClose();
  const search = useSearch(voices, searchOf(VOICE), ({ name, about }) => [name, about ?? ''], {
    onEnter: (voice) => {
      close();
      onPick(voice);
    },
  });
  return (
    <>
      {search.field}
      {search.none && <Empty variant="menu">{search.none}</Empty>}
      {search.found.map((voice) => (
        <MenuItem key={voice.id} label={voice.name} description={voice.about ?? undefined} checked={voice.id === current} onClick={() => onPick(voice)} />
      ))}
    </>
  );
}
