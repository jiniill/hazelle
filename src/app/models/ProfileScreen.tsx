import { refOf } from '../../connectors/assignment';
import { entryKey, entryName, entryTerms } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { addProfile, modelProfile, removeProfile, restoreProfile, setDefaultProfile, setModelProfile, setProfileSettings, type ProfileUser } from '../../runtime/profiles';
import { ACTS, addOf } from '../common/acts';
import { useSearch } from '../common/useSearch';
import { saveWords } from '../common/useAutosave';
import { BIN_KEEPS, cannotRemove, copyName, defaultMark, MODEL_SETTINGS, ORIGINAL, resetTo, SET_DEFAULT } from '../common/words';
import { useConnections, useProfiles, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Empty, List, ListItem, Menu, MenuHeading, MenuItem, NavBar, Screen, Section, Tag } from '../ui';
import { changeWords, NOT_CALLABLE } from '../common/settingWords';
import { useProfileEditor, type User } from './useProfileEditor';

// Under the page's own 모델 설정, so it needs no 이 설정.
const USERS = '사용 중인 모델';

export function ProfileScreen({ stored, back }: { stored: Stored<'profile'>; back: Back }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const connections = useConnections();
  // modelProfile reads the store directly; profile edits must still refresh the attach-menu labels.
  useProfiles();
  const { id } = stored;
  const isDefault = settings.profile === id;
  const { status, name, rename, flush, clear, removing, shown, users, rows } = useProfileEditor(stored);
  const summary = (user: User) => (user.schema ? changeWords(user.changes) : NOT_CALLABLE);

  const using = new Set(users.map((user) => `${user.connection.id}/${entryKey(user.model)}`));
  const profileName = (model: ProfileUser['model']) => {
    const choice = modelProfile(store, model);
    return choice.kind === 'profile' ? choice.profile.value.name : '없음';
  };
  const others = connections.map((connection) => ({ connection, models: connection.value.starred.filter((model) => !using.has(`${connection.id}/${entryKey(model)}`)) })).filter((group) => group.models.length > 0);
  const attach = (connection: string, model: string) => void setModelProfile(store, connection, model, id).then((done) => done.ok || toast.failed(done, '저장하지 못했어요.'));

  async function copy() {
    if (!(await flush())) return;
    const copied = crypto.randomUUID();
    const making = addProfile(store, { name: copyName(name), settings: shown }, copied);
    navigate({ kind: 'profile', id: copied });
    const made = await making;
    if (!made.ok) return toast.failed(made, '사본을 만들지 못했어요.');
    toast.show('사본을 만들었어요.');
  }

  async function clearAll() {
    const previous = await clear();
    if (previous) toast.undoable(`'${stored.value.name}' ${MODEL_SETTINGS}을 ${ORIGINAL}으로 되돌렸어요.`, () => setProfileSettings(store, id, previous));
  }

  async function remove() {
    const removed = await removing(() => removeProfile(store, id));
    if (!removed) return;
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    navigate({ kind: 'models' });
    const note = users.length ? `이 ${MODEL_SETTINGS}을 쓰던 모델 ${users.length}개는 다른 ${MODEL_SETTINGS}을 선택해야 쓸 수 있어요. ${BIN_KEEPS}` : BIN_KEEPS;
    toast.undoable(`'${removed.data.value.name}' ${MODEL_SETTINGS}을 삭제했어요.`, () => restoreProfile(store, id), note);
  }

  const mark = defaultMark(isDefault, stored.value.name);

  return (
    <Screen
      width="form"
      top={
        <NavBar
          title={name}
          rename={{ label: `${MODEL_SETTINGS} 이름`, placeholder: name, onChange: rename }}
          subtitle={
            <>
              {MODEL_SETTINGS} {mark && <Tag tone="accent">{mark}</Tag>}
            </>
          }
          {...backBar(back)}
          status={saveWords(status)}
          menu={{
            of: MODEL_SETTINGS,
            items: (
              <>
                <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} onClick={() => void copy()} />
                {!isDefault && (
                  <MenuItem
                    label={SET_DEFAULT}
                    sub={`${MODEL_SETTINGS}을 따로 선택하지 않은 모델은 이걸 써요`}
                    onClick={() => void setDefaultProfile(store, id).then((done) => done.ok || toast.failed(done, '기본으로 정하지 못했어요.'))}
                  />
                )}
                <MenuItem label={resetTo(ORIGINAL)} disabled={Object.keys(shown).length === 0} onClick={() => void clearAll()} />
                <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} sub={isDefault ? cannotRemove(`기본 ${MODEL_SETTINGS}`) : undefined} tone="warn" disabled={isDefault} onClick={() => void remove()} />
              </>
            ),
          }}
        />
      }
    >

      <Section
        title={USERS}
        note={users.length ? `${users.length}개` : undefined}
        action={
          others.length > 0 && (
            <Menu
              place="below-end"
              size="lg"
              label={addOf('모델')}
              trigger={(opener) => (
                <Button variant="secondary" icon={ACTS.create.icon} {...opener}>
                  {addOf('모델')}
                </Button>
              )}
            >
              <AddChoices groups={others} now={profileName} onPick={attach} />
            </Menu>
          )
        }
      >
        {users.length > 0 ? (
          <List label={USERS}>
            {users.map((user) => (
              <ListItem
                key={`${user.connection.id}/${entryKey(user.model)}`}
                title={entryName(user.model)}
                tags={[user.connection.value.label]}
                description={summary(user)}
                onClick={() => navigate({ kind: 'model', ...refOf(user.connection.id, user.model) })}
              />
            ))}
          </List>
        ) : (
          <Empty variant="section">쓰는 모델이 없어요.</Empty>
        )}
      </Section>

      {rows}
    </Screen>
  );
}

type Group = { connection: Stored<'connection'>; models: ProfileUser['model'][] };

// Mounted only while the menu is open, so each opening starts with an empty search.
function AddChoices({ groups, now, onPick }: { groups: Group[]; now: (model: Group['models'][number]) => string; onPick: (connection: string, model: string) => void }) {
  const choices = groups.flatMap(({ connection, models }) => models.map((model) => ({ connection, model })));
  const search = useSearch(choices, '모델 검색', ({ connection, model }) => [...entryTerms(model), connection.value.label]);
  const shown = groups.flatMap(({ connection }) => {
    const found = search.found.filter((choice) => choice.connection === connection);
    return found.length === 0 ? [] : [
      <MenuHeading key={connection.id}>{connection.value.label}</MenuHeading>,
      ...found.map(({ model }) => <MenuItem key={`${connection.id}/${entryKey(model)}`} label={entryName(model)} sub={`현재: ${now(model)}`} onClick={() => onPick(connection.id, entryKey(model))} />),
    ];
  });
  return (
    <>
      {search.field}
      {search.none ? <Empty variant="menu">{search.none}</Empty> : shown}
    </>
  );
}
