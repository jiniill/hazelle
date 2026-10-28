import { Bell, FileText, Inbox, ListFilter, PenLine, Send } from 'lucide-react';
import { useState } from 'react';
import { CATEGORIES, STATUSES, type Category, type Sort, type Status } from '../../contracts/board';
import { GuestLine } from '../common/GuestNotice';
import { AuthorLine, CATEGORY_LOOK } from '../common/postRow';
import { ago } from '../common/time';
import { count } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { ACCOUNT_ONLY, BOARD } from '../common/words';
import { useAccount, useStanding } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, ChoiceGroup, IconButton, Menu, MenuItem, NavBar, NavGroup, NavRow, NoticeBar, Row, Screen, Tabs, useSplit } from '../ui';
import { readNickname, readPosts } from '../../runtime/board';
import { NicknameDialog, useNicknameGate } from './nickname';
import { PostList } from './parts';

const ALL = 'all';
const SORTS: { value: Sort; label: string }[] = [{ value: 'new', label: '최신' }, { value: 'top', label: BOARD.vote }];

// operator: the operator-only posts, the only ones a suspended account reads (design §6.13).
// category: the tab open, held in the address so back and a reload return to it. Guests write without a nickname.
export function BoardScreen({ operator, category, back }: { operator: boolean; category: Category | null; back: Back | null }) {
  const { guest } = useAccount();
  const { unreadBoard, suspended } = useStanding();
  const split = useSplit();
  const { gate, dialog } = useNicknameGate();
  const [sort, setSort] = useState<Sort>('new');
  const [status, setStatus] = useState<Status | null>(null);
  const onlyOperator = operator || suspended;
  const news = category === 'news';
  const ask = { sort, category: category ?? undefined, status: news ? undefined : (status ?? undefined), visibility: onlyOperator ? ('operator' as const) : undefined };
  const write = () => gate(() => navigate({ kind: 'board-write', operator: onlyOperator }));
  return (
    <Screen
      width={split ? 'wide' : 'form'}
      aside={split && !guest ? <BoardAside operator={onlyOperator} /> : undefined}
      top={
        <NavBar
          title={onlyOperator ? BOARD.operatorOnly : BOARD.title}
          {...backBar(back)}
          actions={
            <>
              {(!split || guest) && (
                <>
                  {!guest && <IconButton icon={Bell} label={BOARD.activity} size="sm" count={unreadBoard} onClick={() => navigate({ kind: 'board-activity' })} />}
                  <Button variant="secondary" onClick={() => navigate({ kind: 'board-mine' })}>
                    {BOARD.mine}
                  </Button>
                </>
              )}
              <Button variant="primary" icon={PenLine} onClick={write}>
                {BOARD.write}
              </Button>
            </>
          }
        />
      }
    >
      <GuestLine note={`${BOARD.vote}은 ${ACCOUNT_ONLY}.`} />
      <Row kind="spread">
        <Tabs
          label="분류"
          items={[{ value: ALL, label: '전체' }, ...CATEGORIES.filter((value) => !onlyOperator || value !== 'news').map((value) => ({ value, label: BOARD.categories[value] }))]}
          value={category ?? ALL}
          onChange={(tab) => navigate({ kind: 'board', operator, ...(tab === ALL ? {} : { category: tab }) }, { replace: true })}
        />
        <Row kind="toolbar">
          <ChoiceGroup label="정렬" options={SORTS} value={sort} onChange={setSort} layout="segmented" />
          {!news && (
            <Menu
              label="상태 필터"
              place="below-end"
              trigger={(opener) => (
                <Button variant="ghost" size="sm" icon={ListFilter} {...opener}>
                  {status === null ? '상태' : BOARD.statuses[status]}
                </Button>
              )}
            >
              <MenuItem label="모든 상태" checked={status === null} onClick={() => setStatus(null)} />
              {STATUSES.map((each) => (
                <MenuItem key={each} label={BOARD.statuses[each]} checked={status === each} onClick={() => setStatus(each)} />
              ))}
            </Menu>
          )}
        </Row>
      </Row>
      {category === null && !onlyOperator && <LatestNews />}
      <PostList key={JSON.stringify(ask)} ask={ask} label={BOARD.title} empty="아직 글이 없어요." votes={!onlyOperator && !guest} />
      {dialog}
    </Screen>
  );
}

// 소식 stay out of 전체 (server/board); the newest one stands over it like a pinned notice.
function LatestNews() {
  const loaded = useLoaded(() => readPosts(null, { sort: 'new', category: 'news', limit: 1 }));
  const news = loaded.data?.rows[0];
  if (!news) return null;
  return (
    <NoticeBar
      icon={CATEGORY_LOOK.news.icon}
      title={news.title}
      note={[BOARD.categories.news, news.version, ago(news.createdAt)].filter(Boolean).join(' · ')}
      actions={
        <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'post', id: news.id })}>
          보기
        </Button>
      }
    />
  );
}

// Beside the feed where there is room: who one writes as, and the board's own places.
function BoardAside({ operator }: { operator: boolean }) {
  const { admin } = useAccount();
  const { unreadBoard } = useStanding();
  const nickname = useLoaded(readNickname);
  const [changing, setChanging] = useState(false);
  const name = nickname.data?.name ?? null;
  return (
    <>
      <NavGroup
        title="내 게시판"
        head={
          <>
            <AuthorLine author={{ name, operator: admin, mine: true, left: false }} note={admin ? undefined : BOARD.nickname} size="md" />
            {/* The operator writes as 운영자, which no one picks or changes. */}
            {!admin && nickname.data && (
              <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>
                {name ? '바꾸기' : '설정'}
              </Button>
            )}
          </>
        }
      >
        <NavRow icon={FileText} label={BOARD.mine} onClick={() => navigate({ kind: 'board-mine' })} />
        <NavRow icon={Bell} label={BOARD.activity} meta={unreadBoard ? count(unreadBoard) : undefined} onClick={() => navigate({ kind: 'board-activity' })} />
        {admin ? (
          <NavRow icon={Inbox} label={operator ? BOARD.title : BOARD.operatorOnly} onClick={() => navigate({ kind: 'board', operator: !operator })} />
        ) : (
          <NavRow icon={Send} label={BOARD.toOperator} onClick={() => navigate({ kind: 'board-write', operator: true })} />
        )}
      </NavGroup>
      {changing && (
        <NicknameDialog
          current={name}
          onSet={() => {
            setChanging(false);
            nickname.reload();
          }}
          onClose={() => setChanging(false)}
        />
      )}
    </>
  );
}
