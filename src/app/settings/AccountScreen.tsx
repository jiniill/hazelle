import { logOutOthers } from '../../runtime/account';
import { readRelease, selfHost } from '../../runtime/installation';
import { setPulseSharing, sharesPulse } from '../../runtime/pulse';
import { sizeText } from '../common/size';
import { count } from '../common/typedNumber';
import { GuestNotice } from '../common/GuestNotice';
import { useAccount, useSession, useSettings, useSignedIn, useStanding, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { AccountSection, Back } from '../shell/routes';
import { useToast } from '../toast';
import { LegalNotice } from '../common/LegalNotice';
import { INSTALL_GUIDE } from '../common/legal';
import { useLoaded } from '../common/useLoaded';
import { BUILT_VERSION } from '../common/release';
import { BIN, BOARD, PAGES, PULSE, UNKNOWN } from '../common/words';
import { Avatar, Button, Columns, FaceRow, Gauge, NavBar, Panel, Screen, SettingGroup, SettingRow, Stack, Switch, Text } from '../ui';
import { BackupSection } from './BackupSection';
import { Diagnostics } from './Diagnostics';
import { LeaveSection } from './LeaveSection';
import { NoticesSection } from './NoticesSection';
import { SharedLinksSection } from './SharedLinksSection';

// bytes is null while the server could not read it; a meter only where both it and the cap are known.
function Used({ label, bytes, cap }: { label: string; bytes: number | null; cap: number | null }) {
  const share = bytes !== null && cap ? bytes / cap : undefined;
  return <Gauge label={label} share={share} amount={bytes === null ? UNKNOWN : sizeText(bytes)} of={cap === null ? undefined : `/ ${sizeText(cap)}`} />;
}

// A guest's rows: the browser's own copy, its file backup, board and app facts; account-only features greyed until
// 계정 만들기 (design §6.14), and 잠그기, 로그아웃, 알림 and 탈퇴, which only an account has, left out.
export function AccountScreen({ section, back }: { section: AccountSection | null; back: Back | null }) {
  const { guest } = useAccount();
  return (
    <Screen width="page" top={<NavBar title={PAGES.account} {...backBar(back)} />}>
      {guest ? <GuestNotice guest={guest} /> : <SignedIn />}
      <Columns min="panel">
        <Stack gap="section">
          <Storage />
          {!selfHost() && <SharedLinksSection />}
        </Stack>
        <BackupSection />
      </Columns>
      <Columns min="panel">
        <Stack gap="section">
          {!guest && <NoticesSection head seek={section === 'notices'} />}
          <BoardRows />
        </Stack>
        <AppInfo />
      </Columns>
      {!guest && <LeaveSection />}
    </Screen>
  );
}

function SignedIn() {
  const { username } = useSession();
  const { onLock, onLogout } = useSignedIn();
  const { suspended } = useStanding();
  const toast = useToast();
  async function logOutElsewhere() {
    const ended = await logOutOthers();
    if (!ended.ok) return toast.failed(ended, '다른 기기에서 로그아웃하지 못했어요.');
    toast.show(ended.data.ended ? `다른 기기 ${count(ended.data.ended)}곳에서 로그아웃했어요.` : '로그인한 다른 기기가 없어요.');
  }
  return (
    <Stack gap="group">
      <FaceRow face={<Avatar face={username} tone="you" />}>
        <Text>{username}</Text>
        <Text variant="note">
          {suspended ? '로그인한 계정 · 정지됨' : '로그인한 계정'}
        </Text>
      </FaceRow>
      <SettingGroup label="계정">
        <SettingRow
          label="잠그기"
          help="다시 열 때 비밀번호가 필요해요."
          control={
            <Button variant="secondary" size="sm" onClick={onLock}>
              잠그기
            </Button>
          }
        />
        <SettingRow
          label="로그아웃"
          help="저장한 내용은 암호화된 채로 서버에 남아요."
          control={
            <Button variant="secondary" size="sm" onClick={() => void onLogout().then((failure) => failure && toast.error(failure))}>
              로그아웃
            </Button>
          }
        />
        <SettingRow
          label="다른 기기에서 로그아웃"
          help="지금 쓰는 기기는 로그인한 채로 남아요."
          control={
            <Button variant="secondary" size="sm" onClick={() => void logOutElsewhere()}>
              로그아웃
            </Button>
          }
        />
      </SettingGroup>
    </Stack>
  );
}

function Storage() {
  const { guest } = useAccount();
  const { storage } = useStanding();
  const usage = (
    <SettingRow
      label={PAGES.usage}
      control={
        <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'usage' })}>
          보기
        </Button>
      }
    />
  );
  if (guest) return <Panel title="저장 공간" help="이 브라우저에만 저장돼요.">{usage}</Panel>;
  return (
    <Panel title="저장 공간" help={`${BIN}에서 영구 삭제하면 공간이 생겨요.`}>
      <Used label="텍스트" bytes={storage.bytes} cap={storage.bytesCap} />
      <Used label="이미지" bytes={storage.fileBytes} cap={storage.fileBytesCap} />
      {usage}
    </Panel>
  );
}

function BoardRows() {
  const open = (label: string, help: string | undefined, go: () => void, act: string) => (
    <SettingRow
      label={label}
      help={help}
      control={
        <Button variant="secondary" size="sm" onClick={go}>
          {act}
        </Button>
      }
    />
  );
  return (
    <Panel title={BOARD.title}>
      <SettingGroup label={BOARD.title}>
        {open(BOARD.mine, undefined, () => navigate({ kind: 'board-mine' }), '보기')}
        {open(BOARD.toOperator, '운영자만 읽을 수 있는 글로 보내요.', () => navigate({ kind: 'board-write', operator: true }), '쓰기')}
      </SettingGroup>
    </Panel>
  );
}

// A self-host updates itself the way it was installed, which the guide says per way.
function NewerRelease() {
  const release = useLoaded(readRelease);
  const newer = release.data?.newer;
  if (!newer) return null;
  return (
    <SettingRow
      label={`새 버전 ${newer}이 나왔어요`}
      control={
        <Button variant="secondary" size="sm" onClick={() => window.open(INSTALL_GUIDE, '_blank', 'noopener')}>
          업데이트 방법
        </Button>
      }
    />
  );
}

// 헤이젤 나우 counts accounts of hazelle.app only (design §6.12), so a guest or a self-host has no switch for it.
function AppInfo() {
  const { guest } = useAccount();
  const toast = useToast();
  const store = useStore();
  const sharing = sharesPulse(useSettings());
  async function share(on: boolean) {
    const done = await setPulseSharing(store, on);
    if (!done.ok) toast.failed(done, '바꾸지 못했어요.');
  }
  return (
    <Panel title="앱 정보">
      <SettingGroup label="앱 정보">
        <SettingRow label="버전" control={<Text>{BUILT_VERSION ?? UNKNOWN}</Text>} />
        {selfHost() && <NewerRelease />}
        <SettingRow
          label="새 소식"
          control={
            <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'board', operator: false, category: 'news' })}>
              보기
            </Button>
          }
        />
        {!guest && !selfHost() && (
          <SettingRow
            label={PULSE.sharing}
            help={`켜 두면 쓰는 모델과 제공자, 응답 수가 ${PULSE.title} 집계에 더해져요. 누가 썼는지와 대화 내용은 남지 않아요.`}
            control={<Switch label={PULSE.sharing} checked={sharing} onChange={(on) => void share(on)} />}
          />
        )}
        <Diagnostics />
      </SettingGroup>
      <LegalNotice />
    </Panel>
  );
}
