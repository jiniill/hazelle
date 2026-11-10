import { useEffect, useState } from 'react';
import type { Notice } from '../../contracts/accounts';
import { markNoticesSeen, readNotices } from '../../runtime/account/account';
import { ago } from '../common/time';
import { HEAD_ROWS, PagedList, SeeAll, usePages } from '../common/useLoaded';
import { NOTICES } from '../common/words';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Dialog, ListItem, NavBar, Panel, Screen, Text } from '../ui';

// A message's row: its first line leads and the rest previews, since a title folds the line breaks the dialog keeps.
export function messageRow(text: string): { title: string; description?: string } {
  const end = text.indexOf('\n');
  if (end < 0) return { title: text };
  const description = text.slice(end + 1).trim();
  return description ? { title: text.slice(0, end), description } : { title: text.slice(0, end) };
}

export function NoticesScreen({ back }: { back: Back | null }) {
  return (
    <Screen width="form" top={<NavBar title={NOTICES.from} {...backBar(back)} />}>
      <NoticesSection head={false} seek={false} />
    </Screen>
  );
}

// head: the newest few, which 설정 › 계정 shows.
export function NoticesSection({ head, seek }: { head: boolean; seek: boolean }) {
  const pages = usePages((after) => readNotices(after, head ? { limit: HEAD_ROWS } : {}));
  const [open, setOpen] = useState<Notice | null>(null);
  const { rows } = pages;
  // A head with more behind 모두 보기 marks nothing: an unread notice past its five was not shown.
  const newest = head && !pages.whole ? undefined : rows?.[0]?.id;
  useEffect(() => {
    if (newest !== undefined) void markNoticesSeen(newest);
  }, [newest]);
  return (
    <Panel
      title={NOTICES.from}
      help="이 알림은 종단 간 암호화되지 않아요."
      action={head && !pages.whole ? <SeeAll onClick={() => navigate({ kind: 'notices' })} /> : undefined}
      seek={seek}
    >
      <PagedList pages={pages} head={head} label={NOTICES.from} empty={`${NOTICES.from}이 없어요.`}>
        {(notice) => <ListItem key={notice.id} {...messageRow(notice.text)} note={ago(notice.createdAt)} onClick={() => setOpen(notice)} />}
      </PagedList>
      {open && (
        <Dialog title={NOTICES.from} note={ago(open.createdAt)} onClose={() => setOpen(null)}>
          <Text variant="prose">{open.text}</Text>
        </Dialog>
      )}
    </Panel>
  );
}
