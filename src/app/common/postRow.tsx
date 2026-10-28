import { Bug, CircleCheck, Megaphone, CircleDot, CircleDashed, CircleHelp, CircleSlash, Eye, EyeOff, Lightbulb, Lock, MessageSquare, ShieldCheck, ThumbsUp, UserX, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { OPERATOR_NAME, type Author, type Category, type PostRow, type Status } from '../../contracts/board';
import { navigate } from '../shell/router';
import { Byline, PostCard, PostStat, Tag, VoteButton } from '../ui';
import { ACTS } from './acts';
import { ago } from './time';
import { count } from './typedNumber';
import { BOARD } from './words';

export const authorName = (author: Author) => (author.operator ? OPERATOR_NAME : author.left ? BOARD.left : (author.name ?? BOARD.unnamed));

// A post's 분류 reads by its tint and icon wherever it shows: the feed, the post, the write page's cards.
export const CATEGORY_LOOK: Record<Category, { hue: 1 | 2 | 3 | 4 | 5; icon: LucideIcon; sub: string }> = {
  bug: { hue: 4, icon: Bug, sub: '오류나 비정상적인 동작을 제보해요' },
  idea: { hue: 1, icon: Lightbulb, sub: '필요한 기능이나 개선할 점을 제안해요' },
  question: { hue: 2, icon: CircleHelp, sub: '사용 방법을 질문해요' },
  news: { hue: 5, icon: Megaphone, sub: '업데이트 내역과 공지사항' },
};

// An open post carries no status mark: every post starts open.
const STATUS_LOOK: Record<Exclude<Status, 'open'>, { tone: 'plain' | 'accent' | 'success' | 'faint'; icon: LucideIcon }> = {
  seen: { tone: 'plain', icon: Eye },
  working: { tone: 'accent', icon: CircleDashed },
  done: { tone: 'success', icon: CircleCheck },
  declined: { tone: 'faint', icon: CircleSlash },
};

// The mark of a status wherever it is named, 열림 too (a post the operator opened again).
export const statusIcon = (status: Status): LucideIcon => (status === 'open' ? CircleDot : STATUS_LOOK[status].icon);

export const statusWord = ({ status, version }: Pick<PostRow, 'status' | 'version'>) =>
  status === 'done' && version ? `${BOARD.statuses.done} · ${version}` : BOARD.statuses[status];

export const CategoryTag = ({ category }: { category: Category }) => (
  <Tag hue={CATEGORY_LOOK[category].hue} icon={CATEGORY_LOOK[category].icon}>
    {BOARD.categories[category]}
  </Tag>
);

export function PostMarks({ row }: { row: PostRow }) {
  return (
    <>
      <CategoryTag category={row.category} />
      {row.category === 'news' && row.version && <Tag>{row.version}</Tag>}
      {row.status !== 'open' && (
        <Tag tone={STATUS_LOOK[row.status].tone} icon={STATUS_LOOK[row.status].icon}>
          {statusWord(row)}
        </Tag>
      )}
      {row.visibility === 'operator' && <Tag icon={Lock}>{BOARD.operatorOnly}</Tag>}
      {row.hidden && (
        <Tag tone="faint" icon={EyeOff}>
          {BOARD.hidden}
        </Tag>
      )}
      {row.deleted && (
        <Tag tone="faint" icon={ACTS.remove.icon}>
          {BOARD.deleted}
        </Tag>
      )}
    </>
  );
}

export function AuthorLine({ author, note, marks, size }: { author: Author; note?: ReactNode; marks?: ReactNode; size?: 'sm' | 'md' }) {
  const face = author.operator ? ShieldCheck : author.left ? UserX : undefined;
  return <Byline name={authorName(author)} face={face} tone={author.operator ? 'accent' : 'plain'} marks={marks} note={note} size={size} />;
}

// vote: the feed's 추천 column, pressed in place; null where a post takes none (an operator-only one).
export function PostItem({ row, vote }: { row: PostRow; vote?: { voted: boolean; votes: number; onFlip: () => void } | null }) {
  const votes = `${BOARD.vote} ${count(vote?.votes ?? row.votes)}`;
  return (
    <PostCard
      title={row.title}
      excerpt={row.excerpt}
      tone={row.deleted ? 'muted' : 'plain'}
      marks={<PostMarks row={row} />}
      byline={<AuthorLine author={row.author} note={ago(row.createdAt)} />}
      stats={
        <>
          {!vote && row.visibility === 'public' && <PostStat icon={ThumbsUp} label={BOARD.vote} count={count(row.votes)} />}
          <PostStat icon={MessageSquare} label={BOARD.comment} count={count(row.commentCount)} />
        </>
      }
      vote={vote && <VoteButton layout="column" label={vote.voted ? `${votes}, 추천함` : votes} count={count(vote.votes)} pressed={vote.voted} onClick={vote.onFlip} />}
      onClick={() => navigate({ kind: 'post', id: row.id })}
    />
  );
}
