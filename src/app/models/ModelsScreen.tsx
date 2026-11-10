import { refOf, rolesOf, sameModelRef, type ModelRef, type Role } from '../../connectors/assignment';
import { entryKey, entryName, entryTerms } from '../../connectors/types';
import { pinsModels } from '../../model/prompt';
import { imageOnly, setDefaultModel } from '../../runtime/models/assignment';
import { overviewOf } from '../../runtime/tasks/overview';
import { availableFeatures } from '../../runtime/tasks/features';
import { ofSort, type StoredPrompt } from '../../runtime/library/prompts';
import { addDefaultProfile, modelProfile, profileUsers } from '../../runtime/models/profiles';
import { findStarred, ROLE_ROWS, RoleCard } from '../common/RolePicker';
import { defaultFirst, NO_PROFILE, NO_PROFILE_VALUES, profileLine, valuesLine } from '../common/settingWords';
import { useSearch } from '../common/useSearch';
import { ACTS, addOf, newOf } from '../common/acts';
import { DEFAULT_MODELS_FAILED, defaultMark, makeFailed, FEATURE_NAMES, follows, MODEL_ROLES, MODEL_SETTINGS, noStarred, NOT_STARRED, PAGES, ROLE_TAGS, SCOPE, STARRED, PROMPT_MODELS } from '../common/words';
import { useConnections, useProfiles, usePrompts, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Beside, Button, Callout, Divider, Empty, List, ListItem, Menu, MenuItem, NavBar, PickCards, Row, Screen, Section } from '../ui';

// The bottom rung of every chat's settings: what a prompt, a character or a chat does not set reads from here.
const DEFAULTS = SCOPE.default;
const SETTINGS_HELP = '온도나 추론, 캐시 같은 값이에요. 모델마다 따로 정해 둘 수도 있어요.';
const PINNED_ROLES = ['main', 'aux'] as const satisfies Role[];
export function ModelsScreen({ back }: { back: Back | null }) {
  const store = useStore();
  const toast = useToast();
  const profiles = useProfiles();
  const connections = useConnections();
  const settings = useSettings();
  const prompts = usePrompts();

  const main = settings.models.main;
  const pickModel = (role: Role, ref: ModelRef | null) =>
    void setDefaultModel(store, role, ref).then((result) => {
      if (!result.ok) toast.failed(result, DEFAULT_MODELS_FAILED);
    });
  const makeDefault = () => toast.settled(addDefaultProfile(store), makeFailed('profile'));
  const models = connections.flatMap((connection) => connection.value.starred.map((model) => ({ connection, model, choice: modelProfile(store, model) })));
  const cardOf = (ref: ModelRef | undefined) => {
    const found = ref && models.find(({ connection, model }) => sameModelRef(refOf(connection.id, model), ref));
    if (!found) return {};
    return { values: imageOnly(found.model) ? undefined : profileLine(found.choice, settings.profile, NO_PROFILE_VALUES), open: () => navigate({ kind: 'model', ...refOf(found.connection.id, found.model) }) };
  };
  const search = useSearch(models, `${STARRED} 검색`, ({ connection, model }) => [...entryTerms(model), connection.value.label]);
  const sorted = defaultFirst(profiles, settings.profile);
  const defaultProfile = profiles.find((profile) => profile.id === settings.profile);
  const pinned = prompts.filter((prompt): prompt is StoredPrompt<'conversation'> => ofSort(prompt, 'conversation') && pinsModels(prompt.value));
  const available = availableFeatures(settings);
  const tasks = overviewOf(store, null).tasks.filter(({ feature }) => available.includes(feature));
  const nameOf = (ref: ModelRef) => findStarred(ref, connections)?.name ?? NOT_STARRED;

  const side = (
    <>
      <Section title="기능별 모델">
        <List label="기능별 모델" box places>
          {tasks.map(({ feature, own }) => (
            <ListItem key={feature} title={FEATURE_NAMES[feature]} note={own ? nameOf(own) : follows(MODEL_ROLES.aux)} onClick={() => navigate({ kind: 'feature', feature })} />
          ))}
        </List>
      </Section>
      <Section title={MODEL_SETTINGS} help={SETTINGS_HELP}>
        {!defaultProfile && (
          <Callout tone="warn" action={sorted.length ? undefined : { label: newOf(MODEL_SETTINGS), onClick: makeDefault }}>
            {`기본 ${MODEL_SETTINGS}이 없어요.`}
          </Callout>
        )}
        <List label={MODEL_SETTINGS} box places>
          {sorted.map((profile) => {
            const used = profileUsers(connections, settings.profile, profile.id).length;
            return (
              <ListItem
                key={profile.id}
                title={profile.value.name}
                badge={defaultMark(profile.id === settings.profile, profile.value.name)}
                description={valuesLine(profile.value.settings)}
                note={used ? `모델 ${used}개` : undefined}
                onClick={() => navigate({ kind: 'profile', id: profile.id })}
              />
            );
          })}
        </List>
      </Section>
      {pinned.length > 0 && (
        <Section title={PROMPT_MODELS} help={`이 프롬프트로 대화하는 채팅은 ${DEFAULTS} 모델 대신 이 모델을 써요.`}>
          <List label={PROMPT_MODELS} box places>
            {pinned.map((prompt) => {
              const roles = PINNED_ROLES.flatMap((role) => (prompt.value.models[role] ? [{ role, ref: prompt.value.models[role] }] : []));
              return (
                <ListItem
                  key={prompt.id}
                  title={prompt.value.name}
                  tags={roles.map(({ role }) => ROLE_TAGS[role])}
                  note={roles.map(({ ref }) => nameOf(ref)).join(' · ')}
                  onClick={() => navigate({ kind: 'prompt', id: prompt.id, pane: 'model' })}
                />
              );
            })}
          </List>
        </Section>
      )}
    </>
  );

  // Models are added on their connection's page; with none yet, adding one starts with a connection.
  const adding = connections.length ? (
    <Menu label={addOf('모델')} place="below-end" trigger={(opener) => <Button variant="secondary" icon={ACTS.create.icon} {...opener}>{addOf('모델')}</Button>}>
      {connections.map((connection) => (
        <MenuItem key={connection.id} label={connection.value.label} onClick={() => navigate({ kind: 'connection', id: connection.id })} />
      ))}
      <Divider variant="menu" />
      <MenuItem icon={ACTS.create.icon} label={newOf('연결')} onClick={() => navigate({ kind: 'add-connection' })} />
    </Menu>
  ) : (
    <Button variant="secondary" icon={ACTS.create.icon} onClick={() => navigate({ kind: 'add-connection' })}>
      {addOf('모델')}
    </Button>
  );

  return (
    <Screen width="page" top={<NavBar title={PAGES.models} {...backBar(back)} actions={adding} />}>
      <Section title={DEFAULTS}>
        <PickCards>
          <RoleCard role="main" {...ROLE_ROWS.main} own={main} connections={connections} onPick={(ref) => ref && pickModel('main', ref)} {...cardOf(main)} />
          <RoleCard role="aux" {...ROLE_ROWS.aux} own={settings.models.aux} connections={connections} onPick={(ref) => pickModel('aux', ref)} {...cardOf(settings.models.aux)} />
          <RoleCard role="embed" {...ROLE_ROWS.embed} own={settings.models.embed} connections={connections} onPick={(ref) => pickModel('embed', ref)} />
        </PickCards>
        {main && !findStarred(main, connections) && <Callout tone="warn">{`${MODEL_ROLES.main}로 정한 모델이 ${STARRED}에 없어요.`}</Callout>}
      </Section>
      <Beside side={side}>
        <Section title={STARRED}>
          {search.field && <Row kind="toolbar">{search.field}</Row>}
          {search.none ? (
            <Empty variant="section">{search.none}</Empty>
          ) : models.length > 0 ? (
            <List label={STARRED} box places>
              {search.found.map(({ connection, model, choice }) => {
                const ref = refOf(connection.id, model);
                // List only distinguishing roles/nondefault profile; neighbouring profile list already shows values.
                // Image-only models have no profile.
                const apart = imageOnly(model) ? '이미지 모델' : choice.kind !== 'profile' ? NO_PROFILE : choice.profile.id === settings.profile ? undefined : choice.profile.value.name;
                return (
                  <ListItem
                    key={`${connection.id}/${entryKey(model)}`}
                    title={entryName(model)}
                    tags={rolesOf(settings.models, ref).map((role) => ROLE_TAGS[role])}
                    description={connection.value.label}
                    note={apart}
                    onClick={() => navigate({ kind: 'model', ...ref })}
                  />
                );
              })}
            </List>
          ) : (
            <Empty variant="section" action={adding}>{noStarred('설정할 수 있어요')}</Empty>
          )}
        </Section>
      </Beside>
    </Screen>
  );
}
