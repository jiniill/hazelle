import { CloudOff, Eraser, HardDriveDownload, MonitorSmartphone, Smartphone, Unplug } from 'lucide-react';
import { selfHost } from '../../runtime/installation';
import { CONTACT, PRIVACY, REPOSITORY, TERMS } from './legal';
import { evictsUnlessInstalled } from './platform';
import { useAccount, type GuestDoors } from '../session';
import { Button, Link, NoticeBar, NoticeCard, Text } from '../ui';

// The four limits a guest lives with (design §6.14), said in the user's ruled words; a file backup softens the second.
const POINTS = [
  { icon: Unplug, text: '응답을 받는 중에 나가면 끊겨요' },
  { icon: HardDriveDownload, text: '자동 백업이 안 돼요 · 파일로는 저장할 수 있어요' },
  { icon: MonitorSmartphone, text: '다른 기기에서 열 수 없어요' },
  { icon: Eraser, text: '이 브라우저의 데이터를 지우면 사라져요' },
];
const TITLE = '손님 모드';
const NOTE = '만든 내용은 이 브라우저에만 저장돼요.';
const SAFARI = { icon: Smartphone, text: 'Safari는 7일 동안 열지 않으면 데이터를 지워요 · 공유 › 홈 화면에 추가하면 지우지 않아요' };

export function GuestNotice({ guest, onClose }: { guest: GuestDoors; onClose?: () => void }) {
  return (
    <NoticeCard
      title={TITLE}
      note={NOTE}
      points={evictsUnlessInstalled() ? [...POINTS, SAFARI] : POINTS}
      onClose={onClose}
      actions={<Doors guest={guest} signIn="계정이 있으면 로그인" />}
      foot={
        selfHost() ? undefined : (
          <>
            쓰면 <Link href={TERMS.path}>{TERMS.title}</Link>과 <Link href={PRIVACY.path}>{PRIVACY.title}</Link>에 동의하게 돼요.
          </>
        )
      }
    />
  );
}

// Keep signup doors visible after the card is dismissed or empty-home disappears; note names the blocked action.
export function GuestLine({ note = NOTE }: { note?: string }) {
  const { guest } = useAccount();
  if (!guest) return null;
  return <NoticeBar icon={CloudOff} title={TITLE} note={note} actions={<Doors guest={guest} signIn="로그인" />} />;
}

// Until guests can write on the board, the way out for a failure, a failed 계정 만들기 above all.
export function ReportElsewhere() {
  return (
    <Text variant="note">
      계정 없이 알리려면 <Link href={`${REPOSITORY}/issues/new`}>GitHub 이슈</Link>나 <Link href={`mailto:${CONTACT}`}>메일</Link>로 보내 주세요.
    </Text>
  );
}

function Doors({ guest, signIn }: { guest: GuestDoors; signIn: string }) {
  return (
    <>
      {guest.signupOpen ? (
        <Button size="sm" onClick={guest.onSignup}>
          계정 만들기
        </Button>
      ) : (
        <Text variant="note">지금은 정원이 차서 계정을 만들 수 없어요</Text>
      )}
      <Button variant="secondary" size="sm" onClick={guest.onSignIn}>
        {signIn}
      </Button>
    </>
  );
}
