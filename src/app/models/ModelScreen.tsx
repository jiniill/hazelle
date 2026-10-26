import { useMemo, type ReactNode } from 'react';
import { modelSettings } from '../../connectors/registry';
import { fit } from '../../connectors/settings';
import { entriesOf, entryKey, entryName, type Starred } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { modelUsage } from '../../model/usage';
import { refOf, rolesOf } from '../../connectors/assignment';
import { imageOnly } from '../../runtime/assignment';
import { renameModel, retriesOf, setModelPictures } from '../../runtime/connections';
import { modelProfile, ownProfile, profileUsers, setModelProfile } from '../../runtime/profiles';
import { illustrationPrompt } from '../../runtime/prompts';
import { LedgerWait, useLedger } from '../common/useLedger';
import type { SaveStatus } from '../common/saveQueue';
import { mergeStatus, saveWords, useAutosave } from '../common/useAutosave';
import { defaultMark, MODEL_ROLES, MODEL_SETTINGS, PICTURE_INPUT } from '../common/words';
import { spent } from '../common/usage';
import { ago } from '../common/time';
import { useConnections, useProfiles, useSettings, useSession } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, ChipButton, Divider, Empty, Facts, Menu, MenuItem, NavBar, Row, Screen, Section, SettingGroup, SettingRow, Switch, Tag } from '../ui';
import { changeWords, defaultFirst, inputs, MODALITY, NOT_CALLABLE } from '../common/settingWords';
import { useProfileEditor } from './useProfileEditor';
import { count } from '../common/typedNumber';

type Props = { connection: Stored<'connection'>; model: Starred; back: Back };

export const ModelScreen = (props: Props) => (imageOnly(props.model) ? <ImageModelScreen {...props} /> : <ChatModelScreen {...props} />);

// A blank clears the entry's own name, so the list's name shows again (a ruling; runtime/connections renameModel).
function useRename(connection: Stored<'connection'>, model: Starred) {
  const { store } = useSession();
  const key = entryKey(model);
  const naming = useAutosave<{ label: string }>(`model:${connection.id}:${key}`, ({ label }) => renameModel(store, connection.id, key, label!));
  const title = naming.unsaved.label ?? entryName(model);
  const rename = { label: '모델 이름', placeholder: model.name, blank: '비워 두면 원래 모델 이름으로 표시돼요.', onChange: (label: string) => naming.change({ label }) };
  return { title, status: naming.status, rename };
}

// A model that only draws takes no 모델 설정 and leaves no reply to count: how it draws is the 삽화 prompt's (design §6.6),
// and its allowance is its connection's meter.
function ImageModelScreen({ connection, model, back }: Props) {
  const { store } = useSession();
  const naming = useRename(connection, model);
  // A binned or missing default opens the list, never the missing page.
  const openPrompt = () => {
    const prompt = illustrationPrompt(store, undefined);
    navigate(prompt.kind === 'prompt' ? { kind: 'prompt', id: prompt.prompt.id, pane: 'picture' } : { kind: 'prompts', place: null, sort: 'illustrate' });
  };
  return (
    <Screen
      width="form"
      top={<NavBar title={naming.title} rename={naming.rename} subtitle={connection.value.label} status={saveWords(naming.status)} {...backBar(back)} />}
      aside={
        <SettingGroup label="이미지 설정">
          <SettingRow
            label="이미지 설정"
            help="태그와 샘플러, 스텝 같은 값은 삽화 프롬프트에서 정해요."
            control={
              <Button variant="secondary" size="sm" onClick={openPrompt}>
                삽화 프롬프트 열기
              </Button>
            }
          />
        </SettingGroup>
      }
    >
      <Section title="모델">
        <Facts
          items={[
            { label: '연결', value: connection.value.label },
            { label: '모델 ID', value: model.id },
            { label: '출력', value: MODALITY.image },
          ]}
        />
        <Row kind="actions">
          <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'connection', id: connection.id })}>
            연결 열기
          </Button>
        </Row>
      </Section>
    </Screen>
  );
}

function ChatModelScreen({ connection, model, back }: Props) {
  const { store } = useSession();
  const toast = useToast();
  const profiles = useProfiles();
  const settings = useSettings();
  const connections = useConnections();
  const ledger = useLedger();
  const naming = useRename(connection, model);
  // Usage counts the provider's model, so every copy's page shows one total.
  const usage = useMemo(() => (ledger.view.kind === 'read' ? modelUsage(ledger.view.calls, connection.id, model.id) : null), [ledger.view, connection.id, model.id]);
  const copies = entriesOf(connection.value, model.id).length;
  const choice = modelProfile(store, model);
  const current = choice.kind === 'profile' ? choice.profile : null;
  const schema = modelSettings(connection.value, model);
  const sorted = defaultFirst(profiles, settings.profile);
  const roles = rolesOf(settings.models, refOf(connection.id, model));

  async function choose(id: string) {
    const saved = await setModelProfile(store, connection.id, entryKey(model), id);
    if (!saved.ok) toast.failed(saved, '바꾸지 못했어요.');
  }

  // The new 설정 shows in place: the page stays this model's, and its rows edit the 설정 just made.
  async function own() {
    const made = await ownProfile(store, model, current?.value.settings ?? {});
    if (!made.ok) return toast.failed(made, `${MODEL_SETTINGS}을 만들지 못했어요.`);
    const saved = await setModelProfile(store, connection.id, entryKey(model), made.data);
    if (!saved.ok) toast.failed(saved, '바꾸지 못했어요.');
  }

  const sent = current && (schema ? changeWords(fit(schema, current.value.settings).changes) : NOT_CALLABLE);
  // The chip says how many models the 설정 reaches, since an edit here changes every one of them.
  const using = current ? profileUsers(connections, settings.profile, current.id).length : 0;
  const chip = current ? (using > 1 ? `${current.value.name} · 모델 ${using}개` : current.value.name) : '없음';

  const picker = (
    <Menu
      place="below-end"
      label={`${MODEL_SETTINGS} 선택`}
      trigger={(opener) => <ChipButton variant="field" tone={current ? 'plain' : 'warn'} label={chip} title={MODEL_SETTINGS} {...opener} />}
    >
      {current && <MenuItem tone="muted" label={`'${current.value.name}' 페이지 열기`} onClick={() => navigate({ kind: 'profile', id: current.id })} />}
      {sorted.map((profile) => (
        <MenuItem key={profile.id} label={profile.value.name} tag={defaultMark(profile.id === settings.profile, profile.value.name)} checked={profile.id === current?.id} onClick={() => void choose(profile.id)} />
      ))}
      <Divider variant="menu" />
      <MenuItem label="이 모델 전용 설정 만들기" onClick={() => void own()} />
    </Menu>
  );

  const frame = (status: SaveStatus | null, rows: ReactNode) => (
    <Screen
      width="form"
      top={
        <NavBar
          title={naming.title}
          rename={naming.rename}
          subtitle={
            <>
              {connection.value.label}{' '}
              {roles.map((role) => (
                <Tag key={role} tone="accent">
                  {MODEL_ROLES[role]}
                </Tag>
              ))}
            </>
          }
          {...backBar(back)}
          status={saveWords(mergeStatus(naming.status, status))}
          menu={{
            of: '모델',
            items: (
              <>
                <MenuItem label="연결 열기" onClick={() => navigate({ kind: 'connection', id: connection.id })} />
                <MenuItem label="사용량 열기" onClick={() => navigate({ kind: 'usage' })} />
              </>
            ),
          }}
        />
      }
    >
      <Section title={MODEL_SETTINGS} action={picker}>
        {current ? (
          <>
            {sent && <Callout tone="warn">{sent}</Callout>}
            {rows}
          </>
        ) : (
          <Callout tone="warn">{`쓰던 ${MODEL_SETTINGS}이 삭제돼서 이 모델을 사용할 수 없어요. 다른 ${MODEL_SETTINGS}을 선택해 주세요.`}</Callout>
        )}
      </Section>

      <Section title="모델">
        <Facts
          variant="row"
          items={[
            { label: '입력', value: inputs(model) },
            { label: '모델 ID', value: model.id },
          ]}
        />
        {model.input === null && (
          <SettingRow
            label={PICTURE_INPUT}
            help="켜면 메시지에 넣은 이미지를 이 모델에게 보내요."
            control={<Switch label={PICTURE_INPUT} checked={model.pictures === true} onChange={(on) => void setModelPictures(store, connection.id, entryKey(model), on).then((saved) => saved.ok || toast.failed(saved, '바꾸지 못했어요.'))} />}
          />
        )}
      </Section>

      <Section title="사용량" note={copies > 1 ? `같은 모델 ${copies}개 합계` : undefined}>
        {ledger.view.kind !== 'read' ? (
          <LedgerWait view={ledger.view} retry={ledger.retry} failed="사용량을 불러오지 못했어요." />
        ) : usage && usage.last !== null ? (
          <Facts
            variant="row"
            items={[
              { label: '응답', value: `${count(usage.calls)}번` },
              { label: '마지막', value: ago(usage.last) },
              { label: '비용', value: spent(usage) },
            ]}
          />
        ) : (
          <Empty variant="section">이 모델로 받은 응답이 없어요.</Empty>
        )}
      </Section>
    </Screen>
  );

  // The model's own 모델 설정 is left out: the count shown is what an empty field falls to.
  return current ? <Editing stored={current} model={model} retries={retriesOf(store, connection.value, {})} frame={frame} /> : frame(null, null);
}

// The hook needs a 설정 to edit, so a model whose 설정 is gone renders the frame without it.
function Editing({ stored, model, retries, frame }: { stored: Stored<'profile'>; model: Starred; retries: number; frame: (status: SaveStatus | null, rows: ReactNode) => ReactNode }) {
  const { status, rows } = useProfileEditor(stored, { model, retries });
  return frame(status, rows);
}
