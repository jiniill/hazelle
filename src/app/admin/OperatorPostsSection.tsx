import { readPosts } from '../../runtime/service/board';
import { PostItem } from '../common/postRow';
import { HEAD_ROWS, PagedList, SeeAll, usePages } from '../common/useLoaded';
import { navigate } from '../shell/router';
import { Panel } from '../ui';

const TITLE = '운영자에게만 온 글';

// The operator-only posts still open; the rest, and what is done about each, are on the board.
export function OperatorPostsSection() {
  const pages = usePages((after) => readPosts(after, { visibility: 'operator', status: 'open', sort: 'new', limit: HEAD_ROWS }));
  return (
    <Panel title={TITLE} help="열림 상태인 글만 여기에 보여요." action={<SeeAll onClick={() => navigate({ kind: 'board', operator: true })} />}>
      <PagedList pages={pages} head label={TITLE} empty="확인할 글이 없어요." feed>
        {(row) => <PostItem key={row.id} row={row} />}
      </PagedList>
    </Panel>
  );
}
