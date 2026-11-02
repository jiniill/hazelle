import { readPosts, type ListAsk } from '../../runtime/board';
import { PostItem } from '../common/postRow';
import { PagedList, usePages } from '../common/useLoaded';
import { useNicknameGate } from './nickname';
import { useVotes } from './vote';

// Every list of posts: asked again whole when its ask changes, as its caller keys it. votes: 추천 pressed in the feed,
// on the public posts that take one.
export function PostList({ ask, label, empty, votes = false }: { ask: ListAsk; label: string; empty: string; votes?: boolean }) {
  const pages = usePages((after) => readPosts(after, ask));
  const { gate, dialog } = useNicknameGate();
  const vote = useVotes(gate);
  return (
    <>
      <PagedList pages={pages} head={false} label={label} empty={empty} feed>
        {(row) => <PostItem key={row.id} row={row} vote={votes && row.visibility === 'public' && !row.deleted ? vote(row) : null} />}
      </PagedList>
      {dialog}
    </>
  );
}
