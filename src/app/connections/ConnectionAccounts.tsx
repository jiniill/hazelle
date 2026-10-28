import { ArrowDown, ArrowUp, ExternalLink, LogIn, UserMinus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { resolveConnection } from '../../connectors/registry';
import type { Account, Connection, Group, SignIn, Turns } from '../../connectors/types';
import { addGroup, moveAccount, moveAccountOrder, moveGroup, removeGroup, renameGroup, schedule, setDay, takeTurn } from '../../model/turns';
import type { MetersResult } from '../../runtime/meters';
import { addAccount, changeTurns, newAccount, putAccountBack, removeAccount } from '../../runtime/connections';
import { accountName } from '../../runtime/pool';
import { ACTS, addOf } from '../common/acts';
import { describeMetersFailure } from '../common/failure';
import { NameDialog } from '../common/NameDialog';
import { withParticle } from '../common/particles';
import { monthDay } from '../common/time';
import { readTyped } from '../common/typedNumber';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Button, Callout, ChipButton, CodeCard, Link, List, ListItem, Menu, MenuItem, MoreMenu, NumberInput, Panel, Row, Section, Stack, Text, useMenuClose } from '../ui';
import { MeterGauge, useMeters } from './ConnectionMeters';
import { useDeviceSignIn } from './useDeviceSignIn';

// Who serves a reply: the current group's first account with allowance left (runtime/pool).
const HELP =
  '현재 그룹에서 한도가 남은 첫 계정으로 요청을 보내요. 한도를 다 썼을 때 초과 사용 여부는 GitHub 설정을 따라요.';

export function ConnectionAccounts({ id, connection, signIn, level }: { id: string; connection: Connection & { turns: Turns }; signIn: SignIn; level: 2 | 3 }) {
  const { store } = useSession();
  const toast = useToast();
  const [signing, setSigning] = useState<{ for: Account | null } | null>(null);
  const [renaming, setRenaming] = useState<Group | null>(null);
  const now = Date.now();
  const { timeline, window } = schedule(connection.turns, now);
  const next = timeline[1];
  const usagePage = resolveConnection(connection)?.type?.usagePage;

  const turns = (change: (turns: Turns) => Turns | null) => void changeTurns(store, id, change).then((result) => result.ok || toast.failed(result));

  function remove(account: Account) {
    void removeAccount(store, id, account.id).then((result) => {
      if (!result.ok) return toast.failed(result);
      toast.undoable(`${accountName(account)} 계정을 뺐어요.`, () => putAccountBack(store, id, result.data));
    });
  }

  return (
    <Panel
      title="계정"
      level={level}
      help={HELP}
      action={
        <Button variant="secondary" icon={ACTS.create.icon} onClick={() => setSigning({ for: null })}>
          {addOf('계정')}
        </Button>
      }
    >
      {next && <Text variant="note">{`${monthDay(next.startsAt)}에 ${next.group.name} 차례`}</Text>}
      <Stack gap="group">
        {signing && (
          <AccountSignIn
            key={signing.for?.id ?? 'new'}
            signIn={signIn}
            again={signing.for}
            onClose={() => setSigning(null)}
            onApproved={(secret, name) => {
              const known = connection.accounts.some((account) => account.name === name);
              void addAccount(store, id, newAccount(secret, name)).then((result) => result.ok || toast.failed(result));
              toast.show(known ? `${name} 계정에 다시 로그인했어요.` : `${name} 계정을 추가했어요.`);
              setSigning(null);
            }}
          />
        )}
        {timeline.map(({ group, startsAt, endsAt }, index) => (
          <List key={group.id} label={group.name} box>
            <ListItem
              title={group.name}
              tags={index === 0 ? ['현재 차례'] : []}
              description={index === 0 ? undefined : `${monthDay(startsAt)}부터`}
              trailing={<GroupMenu turns={connection.turns} group={group} position={index} change={turns} onRename={() => setRenaming(group)} />}
            >
              {group.accounts.length ? (
                group.accounts.map((accountId, at) => {
                  const account = connection.accounts.find((entry) => entry.id === accountId);
                  return account ? (
                    <AccountRow
                      key={account.id}
                      connection={connection}
                      account={account}
                      group={group}
                      at={at}
                      // One group's turn never ends, so only the reset bounds its pace.
                      turn={window ? { start: startsAt, end: endsAt } : null}
                      waiting={index > 0}
                      change={turns}
                      onSignIn={() => setSigning({ for: account })}
                      onRemove={() => remove(account)}
                    />
                  ) : null;
                })
              ) : (
                <ListItem title="계정 없음" description={index === 0 ? '연결된 계정이 없어서 응답을 받을 수 없어요.' : undefined} />
              )}
            </ListItem>
          </List>
        ))}
        <Row kind="actions">
          <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={() => turns((current) => addGroup(current, crypto.randomUUID(), Date.now()))}>
            {addOf('그룹')}
          </Button>
          <DayMenu day={connection.turns.day} change={turns} />
          {usagePage && <Link href={usagePage}>사용량 페이지</Link>}
        </Row>
      </Stack>
      {renaming && (
        <NameDialog
          title={`그룹 ${ACTS.rename.label}`}
          value={renaming.name}
          onSave={(name) => {
            turns((current) => renameGroup(current, renaming.id, name));
            setRenaming(null);
          }}
          onClose={() => setRenaming(null)}
        />
      )}
    </Panel>
  );
}

function MeterLines({ result, turn, waiting }: { result: MetersResult; turn: { start: number; end: number } | null; waiting: boolean }) {
  return (
    <Stack gap="related">
      {result.meters.map((meter) => (
        <MeterGauge key={`${meter.kind}:${meter.label}`} meter={meter} turn={turn} waiting={waiting} labeled={result.meters.length > 1} />
      ))}
    </Stack>
  );
}

function meterProblem(result: MetersResult): string | undefined {
  const [failure] = result.failures;
  if (!result.meters.length) return failure ? describeMetersFailure(failure) : '한도 정보 없음';
  return failure ? '사용량 일부를 불러오지 못했어요.' : undefined;
}

type RowProps = {
  connection: Connection & { turns: Turns };
  account: Account;
  group: Group;
  at: number;
  turn: { start: number; end: number } | null;
  waiting: boolean;
  change: (change: (turns: Turns) => Turns | null) => void;
  onSignIn: () => void;
  onRemove: () => void;
};

function AccountRow({ connection, account, group, at, turn, waiting, change, onSignIn, onRemove }: RowProps) {
  const { result, retry } = useMeters(connection, account);
  const name = accountName(account);
  const others = connection.turns.groups.filter((entry) => entry.id !== group.id);
  return (
    <ListItem
      title={name}
      tags={result?.plan ? [result.plan] : []}
      description={result ? meterProblem(result) : '사용량 불러오는 중…'}
      detail={result && result.meters.length > 0 && <MeterLines result={result} turn={turn} waiting={waiting} />}
      trailing={
        <MoreMenu of={name}>
          <MenuItem icon={ArrowUp} label="위로" disabled={at === 0} onClick={() => change((turns) => moveAccountOrder(turns, account.id, -1))} />
          <MenuItem icon={ArrowDown} label="아래로" disabled={at === group.accounts.length - 1} onClick={() => change((turns) => moveAccountOrder(turns, account.id, 1))} />
          {others.map((other) => (
            <MenuItem key={other.id} label={`${withParticle(other.name, '으로/로')} 옮기기`} onClick={() => change((turns) => moveAccount(turns, account.id, other.id))} />
          ))}
          <MenuItem icon={ACTS.retry.icon} label="사용량 다시 확인" onClick={retry} />
          <MenuItem icon={LogIn} label="다시 로그인" onClick={onSignIn} />
          <MenuItem icon={UserMinus} label="빼기" tone="warn" disabled={connection.accounts.length === 1} onClick={onRemove} />
        </MoreMenu>
      }
    />
  );
}

type GroupMenuProps = { turns: Turns; group: Group; position: number; change: (change: (turns: Turns) => Turns | null) => void; onRename: () => void };

function GroupMenu({ turns, group, position, change, onRename }: GroupMenuProps) {
  return (
    <MoreMenu of={group.name}>
      <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={onRename} />
      <MenuItem label="현재 차례로 지정" disabled={position === 0} onClick={() => change((current) => takeTurn(current, group.id, Date.now()))} />
      <MenuItem icon={ArrowUp} label="앞 차례로 이동" disabled={position < 2} onClick={() => change((current) => moveGroup(current, group.id, -1, Date.now()))} />
      <MenuItem icon={ArrowDown} label="뒤 차례로 이동" disabled={position < 1 || position === turns.groups.length - 1} onClick={() => change((current) => moveGroup(current, group.id, 1, Date.now()))} />
      <MenuItem icon={ACTS.remove.icon} label="그룹 삭제" tone="warn" disabled={group.accounts.length > 0 || turns.groups.length === 1} onClick={() => change((current) => removeGroup(current, group.id, Date.now()))} />
    </MoreMenu>
  );
}

function DayMenu({ day, change }: { day: number; change: (change: (turns: Turns) => Turns | null) => void }) {
  return (
    <Menu kind="dialog" label="전환일" trigger={(opener) => <ChipButton variant="field" title="전환일" label={`매달 ${day}일`} {...opener} />}>
      <DayForm day={day} onSave={(next) => change((turns) => setDay(turns, next, Date.now()))} />
    </Menu>
  );
}

function DayForm({ day, onSave }: { day: number; onSave: (day: number) => void }) {
  const close = useMenuClose();
  const [value, setValue] = useState(String(day));
  const typed = readTyped(value, true);
  const parsed = typed.ok && typed.value >= 1 && typed.value <= 28 ? typed.value : null;
  const valid = parsed !== null;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (parsed === null) return;
    onSave(parsed);
    close();
  }
  return (
    <form onSubmit={submit}>
      <Stack gap="related">
        <NumberInput label="전환일 (1~28일)" value={value} onChange={setValue} invalid={!valid} unit="일" />
        <Button type="submit" size="sm" disabled={!valid}>
          저장
        </Button>
      </Stack>
    </form>
  );
}

function AccountSignIn({ signIn, again, onClose, onApproved }: { signIn: SignIn; again: Account | null; onClose: () => void; onApproved: (secret: string, name: string) => void }) {
  const [attempt, setAttempt] = useState(0);
  const { stage, openSite } = useDeviceSignIn(signIn, attempt, async (secret, name) => {
    onApproved(secret, name);
    return null;
  });
  const title = again ? `${accountName(again)} 다시 로그인` : `${signIn.site} 계정 추가`;
  return (
    <Section level={3} title={title}>
      {stage.step === 'failed' ? (
        <Callout tone="warn" alert action={{ label: ACTS.retry.label, onClick: () => setAttempt((count) => count + 1) }}>
          {stage.message}
        </Callout>
      ) : stage.step === 'code' ? (
        <>
          <CodeCard label="코드" code={stage.code.userCode} />
          <Button icon={ExternalLink} onClick={() => openSite(stage.code)}>
            코드 복사하고 {signIn.site} 열기
          </Button>
        </>
      ) : (
        <Text variant="note">{stage.step === 'starting' ? '코드를 받는 중…' : `${signIn.site} 계정을 확인하는 중…`}</Text>
      )}
      <Row kind="actions">
        <Button variant="ghost" size="sm" onClick={onClose}>
          취소
        </Button>
      </Row>
    </Section>
  );
}
