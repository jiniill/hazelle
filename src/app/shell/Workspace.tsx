import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { hearServedVersion } from '../../runtime/api';
import { markSeen } from '../../runtime/chat-context';
import type { AccountFacts } from '../../runtime/account';
import { Drafts } from '../../runtime/drafts';
import { selfHost } from '../../runtime/installation';
import { openGuestSession, openSession, type Session } from '../../runtime/session';
import type { PullProgress } from '../../runtime/store';
import type { Unlocked } from '../account/AccountFlow';
import { UnreachableScreen } from '../account/UnreachableScreen';
import { describeFailure } from '../common/failure';
import { readPosts } from '../../runtime/board';
import { carryDeviceValues } from '../common/carryDeviceValues';
import { BUILT_VERSION, openedNewRelease, TOURS, tourToShow, type Tour } from '../common/release';
import { TourDialog } from '../common/Tour';
import { TutorialProvider, useTutorials } from '../common/Tutorial';
import { count } from '../common/typedNumber';
import { playSound, unlockSound } from '../common/sounds';
import { DisplayProvider, useDisplay } from '../display';
import { BIN, BOARD, inSettings, NOTICES } from '../common/words';
import { ImportProvider } from '../library/ImportFlow';
import { SessionProvider, useHeldLeave, useSaves, useSession, useSettings, useStore } from '../session';
import { notePlace } from '../../runtime/diagnostics';
import { ToastProvider, useToast, type Standing } from '../toast';
import { Brand, Progress, Screen, Text } from '../ui';
import { BotNotes } from './BotNotes';
import { Layout } from './Layout';
import { navigate, useRoute } from './router';
import { reportedPlace, type Route } from './routes';

const RECONNECTING: Standing = { message: '연결이 불안정해요', detail: '다시 연결되면 이어서 읽고 저장해요.' };
const SUSPENDED: Standing = {
  message: '운영자가 이 계정을 정지했어요',
  detail: `읽기만 할 수 있고 저장과 모델 요청은 막혀 있어요. ${inSettings('account')}에서 ${NOTICES.from}을 확인할 수 있어요.`,
};
// Said once, and standing until the account shrinks: each refused write saying it again would be a stream of toasts.
const FULL: Standing = { message: '저장 공간이 가득 찼어요', detail: `새로 만든 내용은 저장되지 않아요. ${BIN}에서 영구 삭제하면 공간이 생겨요.` };
// Ahead of 연결이 불안정해요: calls wait out a restore as they wait out a dropped connection.
const RESTORING: Standing = { message: '계정 복원 중', detail: '' };
const subscribeNothing = () => () => {};
const NOT_PULLED: PullProgress = { objects: 0, pages: 0, waiting: false };
const FIRST_LOAD = '처음에만 오래 걸려요.';
const notWaiting = () => false;

// Said once in the session opened after the last one heard the account was restored, with the writes the restore
// dropped. The ref: StrictMode runs a mount's effect twice.
function Restored({ dropped }: { dropped: number }) {
  const toast = useToast();
  const said = useRef(false);
  useEffect(() => {
    if (said.current) return;
    said.current = true;
    toast.show('계정을 복원해서 다시 열었어요', dropped ? { detail: `방금 바꾼 내용 ${dropped}개는 저장되지 않았어요` } : {});
  }, []);
  return null;
}

type UnreadKind = 'unreadNotices' | 'unreadBoard';
const UNREAD: Record<UnreadKind, { says: (unread: number) => string; to: Route }> = {
  unreadNotices: { says: (unread) => `${NOTICES.from}이 ${count(unread)}개 있어요`, to: { kind: 'account', section: 'notices' } },
  unreadBoard: { says: (unread) => `${BOARD.title} 새 알림 ${count(unread)}개`, to: { kind: 'board-activity' } },
};

// Notify new unread counts on open/sync; seen counts lower the watermark.
// Ref prevents duplicate StrictMode effect notifications.
function Unread({ facts, kind }: { facts: AccountFacts; kind: UnreadKind }) {
  const toast = useToast();
  const unread = useSyncExternalStore(facts.subscribe, () => facts.snapshot()[kind]);
  const said = useRef(0);
  useEffect(() => {
    const { says, to } = UNREAD[kind];
    if (unread > said.current) toast.show(says(unread), { action: { label: '보기', onClick: () => navigate(to) } });
    said.current = unread;
  }, [unread]);
  return null;
}

// A tab left open across a deploy runs the old release, whose chunks the new image no longer serves; said once for each
// release the server starts saying it runs.
function Stale() {
  const toast = useToast();
  useEffect(() => {
    if (BUILT_VERSION === null) return;
    hearServedVersion((served) => {
      if (served !== BUILT_VERSION) toast.show('새 버전이 나왔어요', { action: { label: '새로고침', onClick: () => location.reload() } });
    });
    return () => hearServedVersion(null);
  }, [toast]);
  return null;
}

// 설정 › 소리: each cue the session tells rings as this device chose. While any rings, the first press on the page
// unlocks the sound, since a phone plays none before.
function Chimes() {
  const { cues } = useSession();
  const { chimes, chimeSounds } = useDisplay().display;
  const ringing = chimes && Object.values(chimeSounds).some((chime) => chime !== 'off');
  useEffect(() => {
    if (!chimes) return;
    return cues.subscribe((cue) => {
      const chime = chimeSounds[cue];
      if (chime !== 'off') void playSound(chime);
    });
  }, [cues, chimes, chimeSounds]);
  useEffect(() => {
    if (!ringing) return;
    const unlock = () => {
      unlockSound();
      stop();
    };
    const stop = () => {
      removeEventListener('pointerdown', unlock);
      removeEventListener('keydown', unlock);
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    return stop;
  }, [ringing]);
  return null;
}

// A reply that streams in this page ends with it (a guest's, design §6.14): while one is written the browser asks
// before the tab goes.
function ReplyHold() {
  const { transport, talk } = useSession();
  const saves = useSaves();
  useEffect(() => {
    if (transport.detached) return;
    let release: (() => void) | null = null;
    const leave = talk.subscribe(() => {
      const writing = talk.writing().size > 0;
      if (writing && !release) release = saves.hold();
      if (!writing && release) {
        release();
        release = null;
      }
    });
    return () => {
      leave();
      release?.();
    };
  }, [transport, talk, saves]);
  return null;
}

function LeaveHold() {
  const held = useHeldLeave();
  const toast = useToast();
  useEffect(() => {
    if (!held) return;
    const go = () => void Promise.resolve(held.go()).then((failure) => failure && toast.error(failure));
    toast.error('저장하지 못한 내용이 있어요', { detail: '저장이 끝날 때까지 잠시 기다려 주세요. 지금 나가면 그 내용이 사라져요.', action: { label: '그래도 나가기', onClick: go } });
  }, [held, toast]);
  return null;
}

// StrictMode-safe: any tour close marks it seen. Prefer tutorial welcome, then tour,
// else a release toast only when its news post exists; never show both for the same open.
function News() {
  const toast = useToast();
  const tutorials = useTutorials();
  const store = useStore();
  const { opened: lastOpened = '', tour: tourSeen = '' } = useSettings().seen ?? {};
  const [tour, setTour] = useState<Tour | null>(null);
  const said = useRef(false);
  useEffect(() => {
    if (BUILT_VERSION === null || said.current) return;
    said.current = true;
    const settled = tutorials.offered.length === 0;
    const showing = tourToShow(BUILT_VERSION, tourSeen, TOURS, settled);
    const welcoming = !settled && tutorials.welcome();
    if (showing) setTour(showing);
    else if (!welcoming && openedNewRelease(BUILT_VERSION, lastOpened)) {
      // A self-host publishes no 소식 of its own; its board link opens hazelle.app's.
      if (selfHost()) toast.show('새 버전으로 바뀌었어요', { action: { label: '바뀐 점 보기', onClick: () => navigate({ kind: 'board', operator: false, category: 'news' }) } });
      else void readPosts(null, { sort: 'new', category: 'news', limit: 1 }).then((read) => {
        const news = read.ok ? read.data.rows[0] : undefined;
        if (news?.version === BUILT_VERSION) toast.show('새 버전으로 바뀌었어요', { action: { label: '바뀐 점 보기', onClick: () => navigate({ kind: 'post', id: news.id }) } });
      });
    }
    if (lastOpened !== BUILT_VERSION) void markSeen(store, { opened: BUILT_VERSION });
  }, []);
  if (!tour) return null;
  return (
    <TourDialog
      tour={tour}
      onClose={() => {
        void markSeen(store, { tour: tour.version });
        setTour(null);
      }}
    />
  );
}

// Unmount closes the unlocked session; restore replaces it on the new store timeline.
// Keep typed drafts outside that lifetime.
export function Workspace({ accountId, vaultKey, username, ...account }: Unlocked) {
  const [session, setSession] = useState<Session | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [rewound, setRewound] = useState<number | null>(null);
  const drafts = useMemo(() => new Drafts(), [accountId]);
  useEffect(() => {
    void drafts.persist(accountId, vaultKey);
    return () => { void drafts.close(); };
  }, [drafts, accountId, vaultKey]);
  const [progress, setProgress] = useState<PullProgress>(NOT_PULLED);
  const waiting = useSyncExternalStore(session?.store.subscribeWaiting ?? subscribeNothing, session?.store.waiting ?? notWaiting, notWaiting);
  // The notice alone, not the facts, so the counts every write brings render nothing here.
  const { facts } = account;
  const noticeOf = () => {
    const { restoring, suspended, full } = facts.snapshot();
    return restoring ? RESTORING : suspended ? SUSPENDED : full ? FULL : null;
  };
  const notice = useSyncExternalStore(facts.subscribe, noticeOf, noticeOf);

  useEffect(() => {
    const abandon = new AbortController();
    let opened: Session | null = null;
    setFailure(null);
    setProgress(NOT_PULLED);
    const progress = (progress: PullProgress) => {
      if (!abandon.signal.aborted) setProgress(progress);
    };
    const opening = account.guest ? openGuestSession(abandon.signal, progress, { drafts }) : openSession(accountId, vaultKey, username, abandon.signal, progress, undefined, { drafts });
    void opening.then((result) => {
      if (abandon.signal.aborted) return;
      if (!result.ok) return setFailure(describeFailure(result));
      opened = result.data;
      carryDeviceValues(opened.store);
      setSession(opened);
    });
    return () => {
      abandon.abort();
      opened?.close();
    };
  }, [accountId, vaultKey, username, drafts, attempt]);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => session.startBackground(), 0);
    const unrewound = session.store.subscribeRewound((dropped) => {
      setRewound(dropped);
      setSession(null);
      setAttempt((held) => held + 1);
    });
    return () => {
      clearTimeout(timer);
      unrewound();
    };
  }, [session]);

  if (failure) return <UnreachableScreen message={failure} onRetry={() => setAttempt((held) => held + 1)} />;
  if (!session) return (
    <Screen top={<Brand />} align="center">
      <Progress hero title="불러오는 중" note={FIRST_LOAD} steps={[{ label: '계정 확인', finished: true }, { label: '잠금 해제', finished: true }, { label: '내용 받기', done: progress.objects, total: progress.total }, { label: '화면 준비' }]} />
      {progress.waiting && <Text variant="note" align="center">{RECONNECTING.message} · {RECONNECTING.detail}</Text>}
    </Screen>
  );
  return (
    <SessionProvider session={session} account={account}>
      {/* Around the toasts, which show a character's picture that 이미지 가리기 covers. */}
      <DisplayProvider>
        <ToastProvider standing={notice !== RESTORING && waiting ? RECONNECTING : notice} onReport={() => navigate({ kind: 'board-write', operator: true })}>
          <PlaceNote />
          {rewound !== null && <Restored dropped={rewound} />}
          <Unread facts={account.facts} kind="unreadNotices" />
          <Unread facts={account.facts} kind="unreadBoard" />
          <Stale />
          <ReplyHold />
          <LeaveHold />
          <Chimes />
          <TutorialProvider>
            <News />
            <BotNotes />
            <ImportProvider>
              <Layout />
            </ImportProvider>
          </TutorialProvider>
        </ToastProvider>
      </DisplayProvider>
    </SessionProvider>
  );
}

// Apart, so a navigation does not draw the whole workspace again.
function PlaceNote() {
  const route = useRoute();
  useEffect(() => notePlace(reportedPlace(route)), [route]);
  return null;
}
